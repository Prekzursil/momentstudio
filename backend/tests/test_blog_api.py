import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import UserRole
from app.schemas.user import UserCreate
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


def create_user_token(session_factory, *, email: str, role: UserRole = UserRole.customer) -> str:
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="password123", name="User"))
            user.role = role
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_blog_posts_list_detail_and_comments(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin)
    user_token = create_user_token(SessionLocal, email="user@example.com", role=UserRole.customer)

    # Create a blog post as content (base RO) and add EN translation
    create = client.post(
        "/api/v1/content/admin/blog.first-post",
        json={"title": "Salut", "body_markdown": "Postare RO", "status": "published", "lang": "ro"},
        headers=auth_headers(admin_token),
    )
    assert create.status_code == 201, create.text

    tr = client.patch(
        "/api/v1/content/admin/blog.first-post",
        json={"title": "Hello", "body_markdown": "Post EN", "lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert tr.status_code == 200, tr.text

    listing = client.get("/api/v1/blog/posts", params={"lang": "en"})
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert len(items) == 1
    assert items[0]["slug"] == "first-post"
    assert items[0]["title"] == "Hello"

    detail_en = client.get("/api/v1/blog/posts/first-post", params={"lang": "en"})
    assert detail_en.status_code == 200, detail_en.text
    assert detail_en.json()["title"] == "Hello"
    assert detail_en.json()["body_markdown"] == "Post EN"

    detail_ro = client.get("/api/v1/blog/posts/first-post", params={"lang": "ro"})
    assert detail_ro.status_code == 200, detail_ro.text
    assert detail_ro.json()["title"] == "Salut"
    assert detail_ro.json()["body_markdown"] == "Postare RO"

    # Comments: create and list
    created = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Nice post!"},
        headers=auth_headers(user_token),
    )
    assert created.status_code == 201, created.text
    comment_id = created.json()["id"]
    assert created.json()["body"] == "Nice post!"

    comments = client.get("/api/v1/blog/posts/first-post/comments")
    assert comments.status_code == 200, comments.text
    assert comments.json()["meta"]["total_items"] == 1
    assert comments.json()["items"][0]["id"] == comment_id

    # Delete by author
    deleted = client.delete(f"/api/v1/blog/comments/{comment_id}", headers=auth_headers(user_token))
    assert deleted.status_code == 204, deleted.text

    comments_after = client.get("/api/v1/blog/posts/first-post/comments")
    assert comments_after.status_code == 200
    assert comments_after.json()["items"][0]["is_deleted"] is True
    assert comments_after.json()["items"][0]["body"] == ""

