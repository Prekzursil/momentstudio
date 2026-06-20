"""Lean-gate coverage for the uncovered branches of ``app.api.v1.ops``.

Disjoint from any broader ops suite: targets the public-banner success path and
the create/update/delete validation + 404 guards.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import ops as ops_api
from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.ops import MaintenanceBanner
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole


@pytest.fixture
def ops_app(monkeypatch) -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session

    async def _noop_audit(*a, **k):  # noqa: ANN002, ANN003
        return None

    monkeypatch.setattr(ops_api.audit_chain_service, "add_admin_audit_log", _noop_audit)

    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def _admin_token(client: TestClient, session_factory) -> str:
    async def seed() -> None:
        async with session_factory() as session:
            admin = User(
                email="opsadmin@example.com",
                username="opsadmin",
                hashed_password=security.hash_password("Password123"),
                name="Ops",
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
            session.add(
                UserPasskey(
                    user_id=admin.id,
                    name="pk",
                    credential_id=f"cred-{admin.id}",
                    public_key=b"k",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()

    asyncio.run(seed())
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "opsadmin@example.com", "password": "Password123"},
    )
    assert login.status_code == 200, login.text
    return login.json()["tokens"]["access_token"]


# --------------------------------------------------------------------------- #
# public banner                                                                #
# --------------------------------------------------------------------------- #
def test_get_active_banner_none(ops_app) -> None:
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/ops/banner")
    assert res.status_code == 204


def test_get_active_banner_present(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                MaintenanceBanner(
                    is_active=True,
                    level="info",
                    message_en="Hello",
                    message_ro="Salut",
                    starts_at=datetime.now(timezone.utc) - timedelta(hours=1),
                    ends_at=datetime.now(timezone.utc) + timedelta(hours=1),
                )
            )
            await session.commit()

    asyncio.run(seed())
    res = client.get("/api/v1/ops/banner")
    assert res.status_code == 200, res.text
    assert res.json()["message_en"] == "Hello"


# --------------------------------------------------------------------------- #
# create banner validation                                                     #
# --------------------------------------------------------------------------- #
def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_create_banner_end_before_start(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    starts = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/ops/admin/banners",
        headers=_auth(token),
        json={
            "message_en": "m",
            "message_ro": "m",
            "starts_at": starts.isoformat(),
            "ends_at": (starts - timedelta(hours=1)).isoformat(),
        },
    )
    assert res.status_code == 400
    assert "after start" in res.json()["detail"]


def test_create_banner_start_too_old(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    old = datetime.now(timezone.utc) - timedelta(days=365 * 6)
    res = client.post(
        "/api/v1/ops/admin/banners",
        headers=_auth(token),
        json={
            "message_en": "m",
            "message_ro": "m",
            "starts_at": old.isoformat(),
        },
    )
    assert res.status_code == 400
    assert "too far in the past" in res.json()["detail"]


def test_create_banner_success(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    starts = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/ops/admin/banners",
        headers=_auth(token),
        json={
            "message_en": "Live",
            "message_ro": "Live",
            "starts_at": starts.isoformat(),
            "ends_at": (starts + timedelta(hours=2)).isoformat(),
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["message_en"] == "Live"


# --------------------------------------------------------------------------- #
# update banner                                                                #
# --------------------------------------------------------------------------- #
def test_update_banner_not_found(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.patch(
        f"/api/v1/ops/admin/banners/{uuid.uuid4()}",
        headers=_auth(token),
        json={"message_en": "x"},
    )
    assert res.status_code == 404


def test_update_banner_end_before_start(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)

    banner_id = {"v": None}

    async def seed() -> None:
        async with SessionLocal() as session:
            banner = MaintenanceBanner(
                is_active=True,
                level="info",
                message_en="m",
                message_ro="m",
                starts_at=datetime.now(timezone.utc),
            )
            session.add(banner)
            await session.commit()
            await session.refresh(banner)
            banner_id["v"] = str(banner.id)

    asyncio.run(seed())
    starts = datetime.now(timezone.utc)
    res = client.patch(
        f"/api/v1/ops/admin/banners/{banner_id['v']}",
        headers=_auth(token),
        json={
            "starts_at": starts.isoformat(),
            "ends_at": (starts - timedelta(hours=1)).isoformat(),
        },
    )
    assert res.status_code == 400
    assert "after start" in res.json()["detail"]


def test_update_banner_success(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)

    banner_id = {"v": None}

    async def seed() -> None:
        async with SessionLocal() as session:
            banner = MaintenanceBanner(
                is_active=True,
                level="info",
                message_en="before",
                message_ro="m",
                starts_at=datetime.now(timezone.utc),
            )
            session.add(banner)
            await session.commit()
            await session.refresh(banner)
            banner_id["v"] = str(banner.id)

    asyncio.run(seed())
    res = client.patch(
        f"/api/v1/ops/admin/banners/{banner_id['v']}",
        headers=_auth(token),
        json={"message_en": "after"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["message_en"] == "after"


# --------------------------------------------------------------------------- #
# delete banner                                                                #
# --------------------------------------------------------------------------- #
def test_delete_banner_not_found(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.delete(
        f"/api/v1/ops/admin/banners/{uuid.uuid4()}", headers=_auth(token)
    )
    assert res.status_code == 404


def test_admin_list_banners(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.get("/api/v1/ops/admin/banners", headers=_auth(token))
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_admin_diagnostics(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.get("/api/v1/ops/admin/diagnostics", headers=_auth(token))
    assert res.status_code == 200


def test_admin_shipping_simulate(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.post(
        "/api/v1/ops/admin/shipping-simulate",
        headers=_auth(token),
        json={"subtotal_ron": "100.00", "discount_ron": "0.00"},
    )
    assert res.status_code == 200, res.text


def test_admin_webhook_read_endpoints(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    h = _auth(token)
    assert client.get("/api/v1/ops/admin/webhooks", headers=h).status_code == 200
    assert client.get("/api/v1/ops/admin/webhooks/stats", headers=h).status_code == 200
    assert (
        client.get("/api/v1/ops/admin/webhooks/backlog", headers=h).status_code == 200
    )
    # Unknown stripe event -> service raises 404 (covers the detail endpoint).
    res = client.get("/api/v1/ops/admin/webhooks/stripe/evt_missing", headers=h)
    assert res.status_code == 404


def test_admin_email_endpoints(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    h = _auth(token)
    assert (
        client.get("/api/v1/ops/admin/email-failures/stats", headers=h).status_code
        == 200
    )
    assert client.get("/api/v1/ops/admin/email-failures", headers=h).status_code == 200
    assert client.get("/api/v1/ops/admin/email-events", headers=h).status_code == 200


def test_admin_retry_webhook_success(ops_app, monkeypatch) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)

    from app.models.webhook import StripeWebhookEvent
    from app.services import webhook_handlers

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                StripeWebhookEvent(
                    stripe_event_id="evt_retry",
                    event_type="payment_intent.succeeded",
                    attempts=1,
                    last_error="prior failure",
                    payload={"id": "evt_retry"},
                )
            )
            await session.commit()

    asyncio.run(seed())

    async def fake_process(session, background_tasks, payload):  # noqa: ANN001
        return None

    monkeypatch.setattr(webhook_handlers, "process_stripe_event", fake_process)

    res = client.post(
        "/api/v1/ops/admin/webhooks/stripe/evt_retry/retry", headers=_auth(token)
    )
    assert res.status_code == 200, res.text
    assert res.json()["event_id"] == "evt_retry"


def test_delete_banner_success(ops_app) -> None:
    SessionLocal = ops_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = ops_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)

    banner_id = {"v": None}

    async def seed() -> None:
        async with SessionLocal() as session:
            banner = MaintenanceBanner(
                is_active=True,
                level="info",
                message_en="del",
                message_ro="m",
                starts_at=datetime.now(timezone.utc),
                ends_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(banner)
            await session.commit()
            await session.refresh(banner)
            banner_id["v"] = str(banner.id)

    asyncio.run(seed())
    res = client.delete(
        f"/api/v1/ops/admin/banners/{banner_id['v']}", headers=_auth(token)
    )
    assert res.status_code == 204
