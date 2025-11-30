import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.models.user import UserRole


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
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email="cms@example.com", password="cmspassword", name="CMS"))
            user.role = UserRole.admin
            await session.commit()
            return issue_tokens_for_user(user)["access_token"]

    return asyncio.run(create_and_token())


def test_content_crud_and_public(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal)

    # Create
    create = client.post(
        "/api/v1/content/admin/home.hero",
        json={"title": "Hero", "body_markdown": "Welcome!", "status": "published"},
        headers=auth_headers(admin_token),
    )
    assert create.status_code == 201, create.text
    assert create.json()["version"] == 1

    public = client.get("/api/v1/content/home.hero")
    assert public.status_code == 200
    assert public.json()["title"] == "Hero"

    # Update increments version
    update = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"body_markdown": "Updated body", "status": "published"},
        headers=auth_headers(admin_token),
    )
    assert update.status_code == 200
    assert update.json()["version"] == 2
    assert update.json()["body_markdown"] == "Updated body"

    # Validation rejects script
    bad = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"body_markdown": "<script>alert(1)</script>"},
        headers=auth_headers(admin_token),
    )
    assert bad.status_code == 422

    # Draft not visible publicly
    client.patch(
        "/api/v1/content/admin/page.about",
        json={"title": "About", "body_markdown": "Draft only", "status": "draft"},
        headers=auth_headers(admin_token),
    )
    missing = client.get("/api/v1/content/page.about")
    assert missing.status_code == 404
