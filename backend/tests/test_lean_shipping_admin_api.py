"""Lean-gate unit coverage for ``app.api.v1.shipping_admin``.

Authenticates a real admin user and drives the three sameday-sync admin
endpoints (status, runs list, run-now) with the mirror service monkeypatched to
return lightweight snapshot/run objects, covering ``_run_to_read`` and each
endpoint body.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Dict
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import shipping_admin as shipping_admin_api
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.shipping_locker import (
    ShippingLockerProvider,
    ShippingLockerSyncStatus,
)
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole


def _run_ns():
    return SimpleNamespace(
        id=uuid4(),
        provider=ShippingLockerProvider.sameday,
        status=ShippingLockerSyncStatus.success,
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        fetched_count=10,
        upserted_count=8,
        deactivated_count=1,
        candidate_count=12,
        normalized_count=9,
        normalization_ratio=0.75,
        schema_signature="sig",
        schema_drift_detected=False,
        failure_kind=None,
        challenge_failure=False,
        error_message=None,
        source_url_used="https://x",
        payload_hash="hash",
    )


def _snapshot_ns():
    return SimpleNamespace(
        total_lockers=100,
        last_success_at=datetime.now(timezone.utc),
        last_error=None,
        stale=False,
        stale_age_seconds=0,
        challenge_failure_streak=0,
        schema_drift_detected=False,
        last_schema_drift_at=None,
        canary_alert_codes=[],
        canary_alert_messages=[],
    )


@pytest.fixture
def ctx() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    async def _override():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = _override
    c = TestClient(app)
    yield {"client": c, "factory": SessionLocal}
    c.close()
    app.dependency_overrides.clear()


def _admin_headers(ctx) -> dict:
    settings.maintenance_mode = False

    async def _seed() -> None:
        async with ctx["factory"]() as session:
            await session.execute(delete(User).where(User.email == "ops@example.com"))
            admin = User(
                email="ops@example.com",
                username="opsadmin",
                hashed_password=security.hash_password("Password123"),
                name="Ops Admin",
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
            # A registered passkey satisfies the admin-MFA gate.
            session.add(
                UserPasskey(
                    user_id=admin.id,
                    name="Test Passkey",
                    credential_id=f"cred-{admin.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()

    asyncio.run(_seed())
    common = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = ctx["client"].post(
        "/api/v1/auth/login",
        json={"email": "ops@example.com", "password": "Password123"},
        headers=common,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Maintenance-Bypass": settings.maintenance_bypass_token,
    }
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def test_get_sameday_sync_status(ctx, monkeypatch) -> None:
    headers = _admin_headers(ctx)

    async def _snap(session):
        return _snapshot_ns()

    async def _latest(session):
        return _run_ns()

    monkeypatch.setattr(
        shipping_admin_api.sameday_easybox_mirror, "get_snapshot_status", _snap
    )
    monkeypatch.setattr(
        shipping_admin_api.sameday_easybox_mirror, "get_latest_run", _latest
    )
    res = ctx["client"].get(
        "/api/v1/admin/shipping/sameday-sync/status", headers=headers
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_lockers"] == 100
    assert body["latest_run"]["fetched_count"] == 10


def test_get_sameday_sync_status_no_latest_run(ctx, monkeypatch) -> None:
    headers = _admin_headers(ctx)

    async def _snap(session):
        return _snapshot_ns()

    async def _latest(session):
        return None

    monkeypatch.setattr(
        shipping_admin_api.sameday_easybox_mirror, "get_snapshot_status", _snap
    )
    monkeypatch.setattr(
        shipping_admin_api.sameday_easybox_mirror, "get_latest_run", _latest
    )
    res = ctx["client"].get(
        "/api/v1/admin/shipping/sameday-sync/status", headers=headers
    )
    assert res.status_code == 200
    assert res.json()["latest_run"] is None


def test_list_sameday_sync_runs(ctx, monkeypatch) -> None:
    headers = _admin_headers(ctx)

    async def _list(session, *, page, limit):
        return [_run_ns()], 1

    monkeypatch.setattr(
        shipping_admin_api.sameday_easybox_mirror, "list_sync_runs", _list
    )
    res = ctx["client"].get(
        "/api/v1/admin/shipping/sameday-sync/runs", headers=headers
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["meta"]["total"] == 1
    assert len(body["items"]) == 1


def test_run_sameday_sync_now(ctx, monkeypatch) -> None:
    headers = _admin_headers(ctx)

    async def _sync(session, *, trigger):
        assert trigger == "manual"
        return _run_ns()

    monkeypatch.setattr(shipping_admin_api.sameday_easybox_mirror, "sync_now", _sync)
    res = ctx["client"].post(
        "/api/v1/admin/shipping/sameday-sync/run", headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "success"
