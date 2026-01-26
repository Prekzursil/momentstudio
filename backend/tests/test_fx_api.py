import asyncio
from datetime import date, datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
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


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_admin_token(session_factory) -> str:
    async def create_and_token() -> str:
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email="admin@example.com", password="password123", name="Admin"))
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
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_fx_rates_endpoint_persists_last_known_and_falls_back(test_app: Dict[str, object], monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    async def fake_get_fx_rates(*, force_refresh: bool = False) -> fx_rates.FxRates:
        return fx_rates.FxRates(
            base="RON",
            eur_per_ron=0.2,
            usd_per_ron=0.22,
            as_of=date(2026, 1, 1),
            source="bnr",
            fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )

    monkeypatch.setattr(fx_rates, "_reset_cache_for_tests", lambda: None)
    monkeypatch.setattr(fx_rates, "get_fx_rates", fake_get_fx_rates)

    resp = client.get("/api/v1/fx/rates")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["base"] == "RON"
    assert data["eur_per_ron"] == 0.2
    assert data["usd_per_ron"] == 0.22
    assert data["as_of"] == "2026-01-01"
    assert data["source"] == "bnr"

    async def failing_get_fx_rates(*, force_refresh: bool = False) -> fx_rates.FxRates:
        raise RuntimeError("upstream down")

    monkeypatch.setattr(fx_rates, "get_fx_rates", failing_get_fx_rates)

    fallback = client.get("/api/v1/fx/rates")
    assert fallback.status_code == 200, fallback.text
    assert fallback.json()["eur_per_ron"] == 0.2
    assert fallback.json()["usd_per_ron"] == 0.22


def test_fx_admin_override_takes_precedence(test_app: Dict[str, object], monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    token = create_admin_token(SessionLocal)

    async def failing_get_fx_rates(*, force_refresh: bool = False) -> fx_rates.FxRates:
        raise RuntimeError("upstream down")

    monkeypatch.setattr(fx_rates, "_reset_cache_for_tests", lambda: None)
    monkeypatch.setattr(fx_rates, "get_fx_rates", failing_get_fx_rates)

    set_resp = client.put(
        "/api/v1/fx/admin/override",
        json={"eur_per_ron": 0.25, "usd_per_ron": 0.23, "as_of": "2026-01-02"},
        headers=auth_headers(token),
    )
    assert set_resp.status_code == 200, set_resp.text
    assert set_resp.json()["eur_per_ron"] == 0.25
    assert set_resp.json()["source"] == "admin"

    resp = client.get("/api/v1/fx/rates")
    assert resp.status_code == 200, resp.text
    assert resp.json()["eur_per_ron"] == 0.25

    clear = client.delete("/api/v1/fx/admin/override", headers=auth_headers(token))
    assert clear.status_code == 204, clear.text


def test_fx_override_audit_and_restore(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    token = create_admin_token(SessionLocal)

    set_first = client.put(
        "/api/v1/fx/admin/override",
        json={"eur_per_ron": 0.25, "usd_per_ron": 0.23, "as_of": "2026-01-02"},
        headers=auth_headers(token),
    )
    assert set_first.status_code == 200, set_first.text

    set_second = client.put(
        "/api/v1/fx/admin/override",
        json={"eur_per_ron": 0.3, "usd_per_ron": 0.28, "as_of": "2026-01-03"},
        headers=auth_headers(token),
    )
    assert set_second.status_code == 200, set_second.text

    audit = client.get("/api/v1/fx/admin/override/audit", headers=auth_headers(token))
    assert audit.status_code == 200, audit.text
    entries = audit.json()
    assert len(entries) >= 2
    assert any(e["action"] == "set" for e in entries)
    assert any(e.get("user_email") == "admin@example.com" for e in entries)

    restore_target = next(e for e in entries if e.get("eur_per_ron") == 0.25 and e.get("usd_per_ron") == 0.23)
    restore = client.post(
        f"/api/v1/fx/admin/override/audit/{restore_target['id']}/revert",
        json={},
        headers=auth_headers(token),
    )
    assert restore.status_code == 200, restore.text
    restored = restore.json()
    assert restored["override"]["eur_per_ron"] == 0.25
    assert restored["override"]["usd_per_ron"] == 0.23

    audit_after = client.get("/api/v1/fx/admin/override/audit", headers=auth_headers(token))
    assert audit_after.status_code == 200, audit_after.text
    after_entries = audit_after.json()
    assert after_entries[0]["action"] == "restore"
