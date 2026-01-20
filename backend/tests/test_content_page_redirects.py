import asyncio
from datetime import datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentRedirect, ContentStatus
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
        await session.execute(delete(User).where(User.email == "admin@example.com"))
        admin = User(
            email="admin@example.com",
            username="admin",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
        )
        session.add(admin)
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


async def seed_page(session_factory, *, key: str, title: str) -> None:
    async with session_factory() as session:
        await session.execute(delete(ContentRedirect))
        await session.execute(delete(ContentBlock).where(ContentBlock.key.like("page.%")))
        block = ContentBlock(
            key=key,
            title=title,
            body_markdown="Hello",
            status=ContentStatus.published,
            version=1,
            published_at=datetime.now(timezone.utc),
            meta={"version": 2, "blocks": []},
        )
        session.add(block)
        await session.commit()


def test_admin_can_rename_page_and_old_slug_redirects(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]
    asyncio.run(seed_page(session_factory, key="page.old-page", title="Old Page"))

    headers = admin_headers(client, session_factory)
    renamed = client.post(
        "/api/v1/content/admin/pages/old-page/rename",
        json={"new_slug": "new-page"},
        headers=headers,
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["old_key"] == "page.old-page"
    assert renamed.json()["new_key"] == "page.new-page"

    # Old slug should resolve to the new key.
    res = client.get("/api/v1/content/pages/old-page")
    assert res.status_code == 200, res.text
    assert res.json()["key"] == "page.new-page"

    async def verify_redirects() -> None:
        async with session_factory() as session:
            redirect = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == "page.old-page"))
            assert redirect is not None
            assert redirect.to_key == "page.new-page"
            old = await session.scalar(select(ContentBlock).where(ContentBlock.key == "page.old-page"))
            assert old is None

    asyncio.run(verify_redirects())


def test_renaming_twice_flattens_redirect_chain(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]
    asyncio.run(seed_page(session_factory, key="page.first", title="First"))

    headers = admin_headers(client, session_factory)
    r1 = client.post("/api/v1/content/admin/pages/first/rename", json={"new_slug": "second"}, headers=headers)
    assert r1.status_code == 200, r1.text
    r2 = client.post("/api/v1/content/admin/pages/second/rename", json={"new_slug": "final"}, headers=headers)
    assert r2.status_code == 200, r2.text

    res = client.get("/api/v1/content/pages/first")
    assert res.status_code == 200, res.text
    assert res.json()["key"] == "page.final"

    async def verify_chain() -> None:
        async with session_factory() as session:
            old = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == "page.first"))
            mid = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == "page.second"))
            assert old is not None and mid is not None
            assert old.to_key == "page.final"
            assert mid.to_key == "page.final"

    asyncio.run(verify_chain())

