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

    asyncio.get_event_loop().run_until_complete(init_models())

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

    asyncio.get_event_loop().run_until_complete(promote())

    # Acquire new tokens after role change
    res = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "adminpass"})
    admin_access = res.json()["tokens"]["access_token"]

    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {admin_access}"})
    assert res.status_code == 200
    assert res.json()["status"] == "admin-ok"
