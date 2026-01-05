import asyncio
from datetime import datetime, timedelta, timezone
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
    flagger_token = create_user_token(SessionLocal, email="flagger@example.com", role=UserRole.customer)
    flagger2_token = create_user_token(SessionLocal, email="flagger2@example.com", role=UserRole.customer)

    prefs = client.patch(
        "/api/v1/auth/me/notifications",
        json={"notify_blog_comment_replies": True},
        headers=auth_headers(user_token),
    )
    assert prefs.status_code == 200, prefs.text
    assert prefs.json()["notify_blog_comment_replies"] is True

    now = datetime.now(timezone.utc)
    past_v1 = (now - timedelta(days=7)).isoformat()
    past_v3 = (now - timedelta(days=1)).isoformat()

    # Create a blog post as content (base RO) and add EN translation
    create = client.post(
        "/api/v1/content/admin/blog.first-post",
        json={
            "title": "Salut",
            "body_markdown": "Postare RO",
            "status": "published",
            "lang": "ro",
            "published_at": past_v1,
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

    og = client.get("/api/v1/blog/posts/first-post/og.png", params={"lang": "en"})
    assert og.status_code == 200, og.text
    assert og.headers.get("content-type", "").startswith("image/png")
    assert og.content[:8] == b"\x89PNG\r\n\x1a\n"
    etag = og.headers.get("etag")
    assert etag
    og_cached = client.get("/api/v1/blog/posts/first-post/og.png", params={"lang": "en"}, headers={"If-None-Match": etag})
    assert og_cached.status_code == 304
    etag_strong = etag[2:] if etag.startswith('W/') else etag
    og_cached_strong = client.get(
        "/api/v1/blog/posts/first-post/og.png",
        params={"lang": "en"},
        headers={"If-None-Match": etag_strong},
    )
    assert og_cached_strong.status_code == 304
    og_missing = client.get("/api/v1/blog/posts/missing/og.png", params={"lang": "en"})
    assert og_missing.status_code == 404, og_missing.text

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

    # Scheduling: published posts with a future published_at should not be visible yet.
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    scheduled = client.post(
        "/api/v1/content/admin/blog.scheduled-post",
        json={
            "title": "Scheduled",
            "body_markdown": "This is scheduled.",
            "status": "published",
            "lang": "en",
            "published_at": future,
        },
        headers=auth_headers(admin_token),
    )
    assert scheduled.status_code == 201, scheduled.text

    listing_after_schedule = client.get("/api/v1/blog/posts", params={"lang": "en"})
    assert listing_after_schedule.status_code == 200, listing_after_schedule.text
    assert listing_after_schedule.json()["meta"]["total_items"] == 2
    assert {i["slug"] for i in listing_after_schedule.json()["items"]} == {"first-post", "second-post"}

    scheduled_detail = client.get("/api/v1/blog/posts/scheduled-post", params={"lang": "en"})
    assert scheduled_detail.status_code == 404, scheduled_detail.text
    scheduled_og = client.get("/api/v1/blog/posts/scheduled-post/og.png", params={"lang": "en"})
    assert scheduled_og.status_code == 404, scheduled_og.text

    # Draft previews: admin can mint a token and fetch the unpublished/scheduled post.
    minted = client.post(
        "/api/v1/blog/posts/scheduled-post/preview-token",
        params={"lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert minted.status_code == 200, minted.text
    token = minted.json()["token"]
    assert token

    preview = client.get("/api/v1/blog/posts/scheduled-post/preview", params={"lang": "en", "token": token})
    assert preview.status_code == 200, preview.text
    assert preview.json()["title"] == "Scheduled"

    wrong = client.get("/api/v1/blog/posts/first-post/preview", params={"token": token})
    assert wrong.status_code == 403, wrong.text

    # Revisions: translation + base updates create versions, and rollback restores snapshot
    update_base = client.patch(
        "/api/v1/content/admin/blog.first-post",
        json={
            "title": "Salut (v2)",
            "body_markdown": "Postare RO v2",
            "published_at": past_v3,
            "meta": {"summary": {"ro": "Rezumat RO v2", "en": "Summary EN v2"}, "tags": ["Ceramics"]},
        },
        headers=auth_headers(admin_token),
    )
    assert update_base.status_code == 200, update_base.text

    update_tr = client.patch(
        "/api/v1/content/admin/blog.first-post",
        json={"title": "Hello (v2)", "body_markdown": "Post EN v2", "lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert update_tr.status_code == 200, update_tr.text

    versions = client.get("/api/v1/content/admin/blog.first-post/versions", headers=auth_headers(admin_token))
    assert versions.status_code == 200, versions.text
    versions_json = versions.json()
    assert versions_json[0]["version"] == 4
    assert versions_json[-1]["version"] == 1

    v2 = client.get("/api/v1/content/admin/blog.first-post/versions/2", headers=auth_headers(admin_token))
    assert v2.status_code == 200, v2.text

    rolled = client.post("/api/v1/content/admin/blog.first-post/versions/2/rollback", headers=auth_headers(admin_token))
    assert rolled.status_code == 200, rolled.text
    rolled_json = rolled.json()
    assert rolled_json["title"] == v2.json()["title"]
    assert rolled_json["body_markdown"] == v2.json()["body_markdown"]
    assert rolled_json["meta"] == v2.json()["meta"]
    assert datetime.fromisoformat(rolled_json["published_at"]) == datetime.fromisoformat(v2.json()["published_at"])

    rolled_en = client.get("/api/v1/content/admin/blog.first-post", params={"lang": "en"}, headers=auth_headers(admin_token))
    assert rolled_en.status_code == 200, rolled_en.text
    assert rolled_en.json()["title"] == "Hello"
    assert rolled_en.json()["body_markdown"] == "Post EN"

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

    # Moderation: users can flag comments, admins can review/resolve/hide/unhide.
    flagged = client.post(
        f"/api/v1/blog/comments/{comment_id}/flag",
        json={"reason": "Spam"},
        headers=auth_headers(flagger_token),
    )
    assert flagged.status_code == 201, flagged.text
    flagged2 = client.post(
        f"/api/v1/blog/comments/{comment_id}/flag",
        json={"reason": "Offensive"},
        headers=auth_headers(flagger2_token),
    )
    assert flagged2.status_code == 201, flagged2.text

    flagged_list = client.get("/api/v1/blog/admin/comments/flagged", headers=auth_headers(admin_token))
    assert flagged_list.status_code == 200, flagged_list.text
    assert flagged_list.json()["meta"]["total_items"] == 1
    flagged_item = flagged_list.json()["items"][0]
    assert flagged_item["id"] == comment_id
    assert flagged_item["flag_count"] == 2
    assert len(flagged_item["flags"]) == 2

    resolved = client.post(
        f"/api/v1/blog/admin/comments/{comment_id}/resolve-flags",
        headers=auth_headers(admin_token),
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolved"] == 2
    flagged_list_after = client.get("/api/v1/blog/admin/comments/flagged", headers=auth_headers(admin_token))
    assert flagged_list_after.status_code == 200, flagged_list_after.text
    assert flagged_list_after.json()["meta"]["total_items"] == 0

    hidden = client.post(
        f"/api/v1/blog/admin/comments/{comment_id}/hide",
        json={"reason": "Abuse"},
        headers=auth_headers(admin_token),
    )
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["is_hidden"] is True

    comments_hidden = client.get("/api/v1/blog/posts/first-post/comments")
    assert comments_hidden.status_code == 200, comments_hidden.text
    assert comments_hidden.json()["items"][0]["is_hidden"] is True
    assert comments_hidden.json()["items"][0]["body"] == ""

    unhidden = client.post(
        f"/api/v1/blog/admin/comments/{comment_id}/unhide",
        headers=auth_headers(admin_token),
    )
    assert unhidden.status_code == 200, unhidden.text
    assert unhidden.json()["is_hidden"] is False

    # Delete by author
    deleted = client.delete(f"/api/v1/blog/comments/{comment_id}", headers=auth_headers(user_token))
    assert deleted.status_code == 204, deleted.text

    comments_after = client.get("/api/v1/blog/posts/first-post/comments")
    assert comments_after.status_code == 200
    assert comments_after.json()["items"][0]["is_deleted"] is True
    assert comments_after.json()["items"][0]["body"] == ""
