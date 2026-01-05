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
        json={
            "title": "Salut",
            "body_markdown": "Postare RO",
            "status": "published",
            "lang": "ro",
            "meta": {
                "summary": {"ro": "Rezumat RO", "en": "Summary EN"},
                "tags": ["Ceramics", "News"],
                "reading_time_minutes": 7,
                "cover_image_url": "https://example.com/cover.jpg",
            },
        },
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
    assert items[0]["excerpt"] == "Summary EN"
    assert items[0]["tags"] == ["Ceramics", "News"]
    assert items[0]["reading_time_minutes"] == 7
    assert items[0]["cover_image_url"] == "https://example.com/cover.jpg"

    detail_en = client.get("/api/v1/blog/posts/first-post", params={"lang": "en"})
    assert detail_en.status_code == 200, detail_en.text
    assert detail_en.json()["title"] == "Hello"
    assert detail_en.json()["body_markdown"] == "Post EN"
    assert detail_en.json()["summary"] == "Summary EN"
    assert detail_en.json()["tags"] == ["Ceramics", "News"]
    assert detail_en.json()["reading_time_minutes"] == 7
    assert detail_en.json()["cover_image_url"] == "https://example.com/cover.jpg"

    detail_ro = client.get("/api/v1/blog/posts/first-post", params={"lang": "ro"})
    assert detail_ro.status_code == 200, detail_ro.text
    assert detail_ro.json()["title"] == "Salut"
    assert detail_ro.json()["body_markdown"] == "Postare RO"
    assert detail_ro.json()["summary"] == "Rezumat RO"

    # Create another blog post to verify filters
    create2 = client.post(
        "/api/v1/content/admin/blog.second-post",
        json={
            "title": "Another post",
            "body_markdown": "Some content about glazing techniques.",
            "status": "published",
            "lang": "en",
            "meta": {"tags": ["Tech"], "summary": "Second summary"},
        },
        headers=auth_headers(admin_token),
    )
    assert create2.status_code == 201, create2.text

    filtered_tag = client.get("/api/v1/blog/posts", params={"lang": "en", "tag": "ceramics"})
    assert filtered_tag.status_code == 200, filtered_tag.text
    assert filtered_tag.json()["meta"]["total_items"] == 1
    assert filtered_tag.json()["items"][0]["slug"] == "first-post"

    filtered_q = client.get("/api/v1/blog/posts", params={"lang": "en", "q": "glazing"})
    assert filtered_q.status_code == 200, filtered_q.text
    assert filtered_q.json()["meta"]["total_items"] == 1
    assert filtered_q.json()["items"][0]["slug"] == "second-post"

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
