"""API-layer tests for ``app.api.v1.fx`` (slice f-k).

Disjoint from ``test_fx_api.py``: this module targets the endpoint branches the
existing suite leaves uncovered — the admin-status endpoint serving the live
fallback (line 33) and the two revert-failure guards (404 missing audit entry,
400 unrestorable entry; lines 90 and 94).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.fx import FxOverrideAuditLog
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services import fx_rates
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_token(session_factory) -> str:
    async def create_and_token() -> str:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="fkadmin@example.com",
                    password="password123",
                    name="FK Admin",
                ),
            )
            user.role = UserRole.admin
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="PK",
                    credential_id=f"cred-{user.id}",
                    public_key=b"k",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_admin_status_serves_live_fallback(test_app, monkeypatch) -> None:
    """No override/last-known row: admin/status falls back to live effective
    rates (covers the ``get_admin_status`` endpoint return, line 33)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    token = _admin_token(session_factory)

    async def fake_get_fx_rates(*, force_refresh: bool = False) -> fx_rates.FxRates:
        return fx_rates.FxRates(
            base="RON",
            eur_per_ron=0.21,
            usd_per_ron=0.23,
            as_of=date(2026, 2, 1),
            source="bnr",
            fetched_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        )

    monkeypatch.setattr(fx_rates, "_reset_cache_for_tests", lambda: None)
    monkeypatch.setattr(fx_rates, "get_fx_rates", fake_get_fx_rates)

    resp = client.get("/api/v1/fx/admin/status", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["override"] is None
    assert data["effective"]["eur_per_ron"] == 0.21


def test_revert_missing_audit_entry_returns_404(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    token = _admin_token(session_factory)

    missing_id = uuid.uuid4()
    resp = client.post(
        f"/api/v1/fx/admin/override/audit/{missing_id}/revert",
        json={},
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Audit entry not found"


def test_revert_unrestorable_audit_entry_returns_400(test_app) -> None:
    """An audit entry whose rate fields are null cannot be restored (line 94)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    token = _admin_token(session_factory)

    async def seed_clear_entry() -> str:
        async with session_factory() as session:
            entry = FxOverrideAuditLog(
                action="clear",
                user_id=None,
                eur_per_ron=None,
                usd_per_ron=None,
                as_of=None,
                created_at=datetime.now(timezone.utc),
            )
            session.add(entry)
            await session.commit()
            await session.refresh(entry)
            return str(entry.id)

    entry_id = asyncio.run(seed_clear_entry())
    resp = client.post(
        f"/api/v1/fx/admin/override/audit/{entry_id}/revert",
        json={},
        headers=_auth(token),
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "Audit entry cannot be restored"
