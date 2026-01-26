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
from app.models.passkeys import UserPasskey
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
    yield {"client": client, "session_factory": SessionLocal, "engine": engine}
    client.close()
    app.dependency_overrides.clear()


async def seed_user(session_factory, email: str, role: UserRole, with_passkey: bool) -> None:
    settings.maintenance_mode = False
    async with session_factory() as session:
        await session.execute(delete(User).where(User.email == email))
        user = User(
            email=email,
            username=email.split("@")[0],
            hashed_password=security.hash_password("Password123"),
            name=email.split("@")[0],
            role=role,
        )
        session.add(user)
        await session.flush()
        if with_passkey:
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


def auth_headers(client: TestClient, session_factory, *, email: str, role: UserRole, with_passkey: bool) -> dict:
    asyncio.run(seed_user(session_factory, email=email, role=role, with_passkey=with_passkey))
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {
        "Authorization": f"Bearer {token}",
        "X-Maintenance-Bypass": settings.maintenance_bypass_token,
    }


def test_admin_favorites_empty(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    headers = auth_headers(
        client,
        test_app["session_factory"],
        email="admin@example.com",
        role=UserRole.admin,
        with_passkey=True,
    )
    resp = client.get("/api/v1/admin/ui/favorites", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"items": []}


def test_admin_favorites_update_and_dedupe(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    headers = auth_headers(
        client,
        test_app["session_factory"],
        email="admin2@example.com",
        role=UserRole.admin,
        with_passkey=True,
    )

    payload = {
        "items": [
            {"key": "page:/admin/orders", "type": "page", "label": "Orders", "subtitle": "", "url": "/admin/orders", "state": None},
            {"key": "page:/admin/orders", "type": "page", "label": "Orders dup", "subtitle": "", "url": "/admin/orders", "state": None},
            {"key": "product:abc", "type": "product", "label": "Test product", "subtitle": "abc", "url": "/admin/products", "state": {"editProductSlug": "abc"}},
        ]
    }
    resp = client.put("/api/v1/admin/ui/favorites", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert [it["key"] for it in data["items"]] == ["page:/admin/orders", "product:abc"]

    resp2 = client.get("/api/v1/admin/ui/favorites", headers=headers)
    assert resp2.status_code == 200, resp2.text
    data2 = resp2.json()
    assert [it["key"] for it in data2["items"]] == ["page:/admin/orders", "product:abc"]


def test_customer_cannot_access_admin_favorites(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    headers = auth_headers(
        client,
        test_app["session_factory"],
        email="customer@example.com",
        role=UserRole.customer,
        with_passkey=False,
    )
    resp = client.get("/api/v1/admin/ui/favorites", headers=headers)
    assert resp.status_code == 403, resp.text
