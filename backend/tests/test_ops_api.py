import asyncio
from datetime import datetime, timedelta, timezone
import uuid
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import UserRole
from app.models.passkeys import UserPasskey
from app.models.email_event import EmailDeliveryEvent
from app.models.email_failure import EmailDeliveryFailure
from app.models.webhook import StripeWebhookEvent
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user


@pytest.fixture
def test_app() -> Dict[str, object]:
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
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_admin_token(session_factory) -> str:
    async def _create() -> str:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(email="admin-ops@example.com", password="pass123", name="Admin", username="admin_ops"),
            )
            user.email_verified = True
            user.role = UserRole.admin
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="Test Passkey",
                    credential_id=f"cred-{user.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_create())


def test_ops_banners_and_shipping_simulation(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_admin_token(SessionLocal)

    empty = client.get("/api/v1/ops/banner")
    assert empty.status_code == 204, empty.text

    now = datetime.now(timezone.utc)
    created = client.post(
        "/api/v1/ops/admin/banners",
        headers=auth_headers(token),
        json={
            "is_active": True,
            "level": "info",
            "message_en": "Planned downtime",
            "message_ro": "Mentenanță planificată",
            "starts_at": (now - timedelta(minutes=1)).isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    banner_id = created.json()["id"]

    listed = client.get("/api/v1/ops/admin/banners", headers=auth_headers(token))
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == banner_id for row in listed.json())

    active = client.get("/api/v1/ops/banner")
    assert active.status_code == 200, active.text
    assert active.json()["message_en"] == "Planned downtime"

    simulated = client.post(
        "/api/v1/ops/admin/shipping-simulate",
        headers=auth_headers(token),
        json={"subtotal_ron": "100.00", "discount_ron": "0.00"},
    )
    assert simulated.status_code == 200, simulated.text
    data = simulated.json()
    assert "total_ron" in data

    deleted = client.delete(f"/api/v1/ops/admin/banners/{uuid.UUID(banner_id)}", headers=auth_headers(token))
    assert deleted.status_code == 204, deleted.text

    def seed_stripe_webhook() -> None:
        async def _seed() -> None:
            async with SessionLocal() as session:
                session.add(
                    StripeWebhookEvent(
                        stripe_event_id="evt_test",
                        event_type="unhandled.event",
                        attempts=1,
                        last_attempt_at=datetime.now(timezone.utc),
                        processed_at=None,
                        last_error="boom",
                        payload={"id": "evt_test", "type": "unhandled.event"},
                    )
                )
                await session.commit()

        asyncio.run(_seed())

    seed_stripe_webhook()

    listed_hooks = client.get("/api/v1/ops/admin/webhooks", headers=auth_headers(token))
    assert listed_hooks.status_code == 200, listed_hooks.text
    assert any(row["provider"] == "stripe" and row["event_id"] == "evt_test" for row in listed_hooks.json())

    failure_stats = client.get("/api/v1/ops/admin/webhooks/stats?since_hours=24", headers=auth_headers(token))
    assert failure_stats.status_code == 200, failure_stats.text
    assert failure_stats.json()["failed"] == 1

    detail = client.get("/api/v1/ops/admin/webhooks/stripe/evt_test", headers=auth_headers(token))
    assert detail.status_code == 200, detail.text
    assert detail.json()["payload"]["id"] == "evt_test"

    def seed_email_failure() -> None:
        async def _seed() -> None:
            async with SessionLocal() as session:
                session.add(
                    EmailDeliveryFailure(
                        to_email="customer@example.com",
                        subject="Test email",
                        error_message="smtp unavailable",
                        created_at=datetime.now(timezone.utc),
                    )
                )
                session.add(
                    EmailDeliveryEvent(
                        to_email="customer@example.com",
                        subject="Order confirmation",
                        status="sent",
                        created_at=datetime.now(timezone.utc),
                    )
                )
                session.add(
                    EmailDeliveryEvent(
                        to_email="customer@example.com",
                        subject="Shipping update",
                        status="failed",
                        error_message="smtp unavailable",
                        created_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()

        asyncio.run(_seed())

    seed_email_failure()

    email_stats = client.get("/api/v1/ops/admin/email-failures/stats?since_hours=24", headers=auth_headers(token))
    assert email_stats.status_code == 200, email_stats.text
    assert email_stats.json()["failed"] == 1

    email_rows = client.get("/api/v1/ops/admin/email-failures?limit=10&since_hours=24", headers=auth_headers(token))
    assert email_rows.status_code == 200, email_rows.text
    assert any(row["to_email"] == "customer@example.com" for row in email_rows.json())

    filtered_email_rows = client.get(
        "/api/v1/ops/admin/email-failures",
        params={"limit": 10, "since_hours": 24, "to_email": "customer@example.com"},
        headers=auth_headers(token),
    )
    assert filtered_email_rows.status_code == 200, filtered_email_rows.text
    assert all(row["to_email"] == "customer@example.com" for row in filtered_email_rows.json())

    filtered_email_rows_none = client.get(
        "/api/v1/ops/admin/email-failures",
        params={"limit": 10, "since_hours": 24, "to_email": "nobody@example.com"},
        headers=auth_headers(token),
    )
    assert filtered_email_rows_none.status_code == 200, filtered_email_rows_none.text
    assert filtered_email_rows_none.json() == []

    email_events = client.get(
        "/api/v1/ops/admin/email-events",
        params={"limit": 10, "since_hours": 24, "to_email": "customer@example.com"},
        headers=auth_headers(token),
    )
    assert email_events.status_code == 200, email_events.text
    events_payload = email_events.json()
    assert any(row["status"] == "sent" for row in events_payload)
    assert any(row["status"] == "failed" for row in events_payload)

    sent_only_events = client.get(
        "/api/v1/ops/admin/email-events",
        params={"limit": 10, "since_hours": 24, "to_email": "customer@example.com", "status": "sent"},
        headers=auth_headers(token),
    )
    assert sent_only_events.status_code == 200, sent_only_events.text
    assert sent_only_events.json()
    assert all(row["status"] == "sent" for row in sent_only_events.json())

    retried = client.post("/api/v1/ops/admin/webhooks/stripe/evt_test/retry", headers=auth_headers(token))
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "processed"


def test_ops_diagnostics(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_admin_token(SessionLocal)

    resp = client.get("/api/v1/ops/admin/diagnostics", headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["environment"]
    assert isinstance(data["app_version"], str)
    assert data["payments_provider"]

    for key in ("smtp", "redis", "storage", "stripe", "paypal", "netopia"):
        check = data[key]
        assert check["status"] in {"ok", "warning", "error", "off"}
        assert isinstance(check["configured"], bool)
        assert isinstance(check["healthy"], bool)
