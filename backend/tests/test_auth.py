import asyncio
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.user import User, UserRole


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


def test_register_and_login_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    register_payload = {"email": "user@example.com", "password": "supersecret", "name": "User"}
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user"]["email"] == "user@example.com"
    assert body["tokens"]["access_token"]
    assert body["tokens"]["refresh_token"]

    # Login
    login_payload = {"email": "user@example.com", "password": "supersecret"}
    res = client.post("/api/v1/auth/login", json=login_payload)
    assert res.status_code == 200, res.text
    tokens = res.json()["tokens"]
    assert tokens["access_token"]
    assert tokens["refresh_token"]

    # Refresh
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 200, res.text
    refreshed = res.json()
    assert refreshed["access_token"]
    assert refreshed["refresh_token"]


def test_invalid_login_and_refresh(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "invalidpw"})
    assert res.status_code == 401

    res = client.post("/api/v1/auth/refresh", json={"refresh_token": "not-a-token"})
    assert res.status_code == 401


def test_admin_guard(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    # Register user
    res = client.post("/api/v1/auth/register", json={"email": "admin@example.com", "password": "adminpass"})
    assert res.status_code == 201
    access_token = res.json()["tokens"]["access_token"]

    # Non-admin should be forbidden
    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 403

    # Promote to admin directly in DB for test
    async def promote() -> None:
        async with SessionLocal() as session:
            result = await session.execute(select(User).where(User.email == "admin@example.com"))
            user = result.scalar_one()
            user.role = UserRole.admin
            await session.commit()

    asyncio.run(promote())

    # Acquire new tokens after role change
    res = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "adminpass"})
    admin_access = res.json()["tokens"]["access_token"]

    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {admin_access}"})
    assert res.status_code == 200
    assert res.json()["status"] == "admin-ok"


def test_password_reset_flow(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    sent = {"token": None}

    async def fake_send(email: str, token: str):
        sent["token"] = token
        return True

    monkeypatch.setattr("app.services.email.send_password_reset", fake_send)

    res = client.post("/api/v1/auth/register", json={"email": "reset@example.com", "password": "resetpass"})
    assert res.status_code == 201

    req = client.post("/api/v1/auth/password-reset/request", json={"email": "reset@example.com"})
    assert req.status_code == 202
    assert sent["token"]

    confirm = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": sent["token"], "new_password": "newsecret"},
    )
    assert confirm.status_code == 200

    login = client.post("/api/v1/auth/login", json={"email": "reset@example.com", "password": "newsecret"})
    assert login.status_code == 200


def test_update_profile_me(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post("/api/v1/auth/register", json={"email": "me@example.com", "password": "supersecret", "name": "Old"})
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    patch = client.patch(
        "/api/v1/auth/me",
        json={"name": "New Name", "phone": "+40723204204", "preferred_language": "ro"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patch.status_code == 200, patch.text
    body = patch.json()
    assert body["name"] == "New Name"
    assert body["phone"] == "+40723204204"
    assert body["preferred_language"] == "ro"
    assert body["notify_marketing"] is False

    cleared = client.patch(
        "/api/v1/auth/me",
        json={"phone": "   "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cleared.status_code == 200
    assert cleared.json()["phone"] is None
