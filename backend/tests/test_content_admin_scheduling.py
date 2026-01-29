import asyncio
from datetime import datetime, timedelta, timezone
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
from app.models.content import ContentBlock, ContentStatus
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


async def seed_admin(session_factory) -> None:
    settings.maintenance_mode = False
    async with session_factory() as session:
        await session.execute(delete(UserPasskey))
        await session.execute(delete(User).where(User.email == "admin@example.com"))
        admin = User(
            email="admin@example.com",
            username="admin",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
        )
        session.add(admin)
        await session.flush()
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


def admin_headers(client: TestClient, session_factory) -> dict[str, str]:
    asyncio.run(seed_admin(session_factory))
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


def test_admin_scheduling_endpoint_paginates_and_orders(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]

    async def seed_blocks() -> None:
        now = datetime.now(timezone.utc)
        async with session_factory() as session:
            await session.execute(delete(ContentBlock))
            session.add(
                ContentBlock(
                    key="page.soon",
                    title="Soon",
                    body_markdown="Hello",
                    status=ContentStatus.published,
                    version=1,
                    published_at=now + timedelta(days=1),
                    meta={"version": 2, "blocks": []},
                )
            )
            session.add(
                ContentBlock(
                    key="page.live",
                    title="Live",
                    body_markdown="Hello",
                    status=ContentStatus.published,
                    version=1,
                    published_at=now - timedelta(days=30),
                    published_until=now + timedelta(days=2),
                    meta={"version": 2, "blocks": []},
                )
            )
            session.add(
                ContentBlock(
                    key="page.outside-window",
                    title="Outside",
                    body_markdown="Hello",
                    status=ContentStatus.published,
                    version=1,
                    published_at=now - timedelta(days=1),
                    published_until=now + timedelta(days=120),
                    meta={"version": 2, "blocks": []},
                )
            )
            session.add(
                ContentBlock(
                    key="product.ignore-me",
                    title="Ignore",
                    body_markdown="Hello",
                    status=ContentStatus.published,
                    version=1,
                    published_at=now + timedelta(days=1),
                    meta={"version": 2, "blocks": []},
                )
            )
            await session.commit()

    asyncio.run(seed_blocks())
    headers = admin_headers(client, session_factory)

    res = client.get(
        "/api/v1/content/admin/scheduling",
        params={"window_days": 30, "page": 1, "limit": 2},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["meta"]["total_items"] == 2
    assert body["meta"]["total_pages"] == 1

    keys = [item["key"] for item in body["items"]]
    assert keys == ["page.soon", "page.live"]

    res2 = client.get(
        "/api/v1/content/admin/scheduling",
        params={"window_days": 30, "page": 1, "limit": 1},
        headers=headers,
    )
    assert res2.status_code == 200, res2.text
    body2 = res2.json()
    assert body2["meta"]["total_items"] == 2
    assert body2["meta"]["total_pages"] == 2
    assert body2["items"][0]["key"] == "page.soon"

    res3 = client.get(
        "/api/v1/content/admin/scheduling",
        params={"window_days": 30, "page": 2, "limit": 1},
        headers=headers,
    )
    assert res3.status_code == 200, res3.text
    assert res3.json()["items"][0]["key"] == "page.live"

