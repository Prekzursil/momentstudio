import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import User, UserRole


@pytest.fixture(scope="module")
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


async def seed_admin(session_factory):
    async with session_factory() as session:
        await session.execute(delete(User))
        admin = User(
            email="admin@example.com",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
        )
        session.add(admin)
        await session.commit()


def auth_headers(client: TestClient, session_factory) -> dict:
    asyncio.run(seed_admin(session_factory))
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123", "name": "Admin"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


def test_admin_summary(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    headers = auth_headers(client, session_factory)
    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "products" in data and "orders" in data and "users" in data


def test_admin_maintenance_toggle(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    headers = auth_headers(client, session_factory)
    resp = client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": True}, headers=headers)
    assert resp.status_code == 200
    assert resp.json().get("enabled") is True
    resp_off = client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers)
    assert resp_off.status_code == 200
    assert resp_off.json().get("enabled") is False
    resp_get = client.get("/api/v1/admin/dashboard/maintenance", headers=headers)
    assert resp_get.status_code == 200
    assert resp_get.json().get("enabled") is False


def test_sitemap_and_robots(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    headers = auth_headers(client, test_app["session_factory"])  # type: ignore[arg-type]
    client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers)
    resp = client.get("/api/v1/sitemap.xml")
    assert resp.status_code == 200
    assert "<urlset" in resp.text
    robots = client.get("/api/v1/robots.txt")
    assert robots.status_code == 200
    assert "Sitemap:" in robots.text
