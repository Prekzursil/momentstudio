import asyncio
import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.content import ContentBlock
from app.models.user import User
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
            if role in (UserRole.admin, UserRole.owner):
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
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_blog_posts_list_detail_and_comments(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin)
    admin2_token = create_user_token(SessionLocal, email="admin2@example.com", role=UserRole.admin)
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

    rss_en = client.get("/api/v1/blog/rss.xml", params={"lang": "en"})
    assert rss_en.status_code == 200, rss_en.text
    assert rss_en.headers.get("content-type", "").startswith("application/rss+xml")
    assert "<title>momentstudio Blog</title>" in rss_en.text
    assert "<description>Latest posts from momentstudio.</description>" in rss_en.text
    assert "<language>en-US</language>" in rss_en.text
    assert "/api/v1/blog/rss.xml?lang=en" in rss_en.text

    rss_ro = client.get("/api/v1/blog/rss.xml", params={"lang": "ro"})
    assert rss_ro.status_code == 200, rss_ro.text
    assert "<description>Ultimele articole de pe momentstudio.</description>" in rss_ro.text
    assert "<language>ro-RO</language>" in rss_ro.text
    assert "/api/v1/blog/rss.xml?lang=ro" in rss_ro.text

    feed_en = client.get("/api/v1/blog/feed.json", params={"lang": "en"})
    assert feed_en.status_code == 200, feed_en.text
    feed_en_json = feed_en.json()
    assert feed_en_json["title"] == "momentstudio Blog"
    assert feed_en_json["description"] == "Latest posts from momentstudio."
    assert feed_en_json["language"] == "en-US"
    assert feed_en_json["feed_url"].endswith("/api/v1/blog/feed.json?lang=en")

    feed_ro = client.get("/api/v1/blog/feed.json", params={"lang": "ro"})
    assert feed_ro.status_code == 200, feed_ro.text
    feed_ro_json = feed_ro.json()
    assert feed_ro_json["description"] == "Ultimele articole de pe momentstudio."
    assert feed_ro_json["language"] == "ro-RO"
    assert feed_ro_json["feed_url"].endswith("/api/v1/blog/feed.json?lang=ro")

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

    # OG image: returns PNG bytes with cache headers and supports If-None-Match.
    og = client.get("/api/v1/blog/posts/first-post/og.png", params={"lang": "en"})
    assert og.status_code == 200, og.text
    assert og.headers["content-type"].startswith("image/png")
    assert og.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert "ETag" in og.headers
    assert "Cache-Control" in og.headers
    etag = og.headers["ETag"]
    og_304 = client.get(
        "/api/v1/blog/posts/first-post/og.png",
        params={"lang": "en"},
        headers={"If-None-Match": etag},
    )
    assert og_304.status_code == 304
    assert og_304.headers.get("ETag") == etag

    # Weak ETag normalization: allow match even without the W/ prefix.
    normalized = etag[2:] if etag.startswith('W/') else etag
    og_304_norm = client.get(
        "/api/v1/blog/posts/first-post/og.png",
        params={"lang": "en"},
        headers={"If-None-Match": normalized},
    )
    assert og_304_norm.status_code == 304
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

    # Verify author payload and author filter.
    create3 = client.post(
        "/api/v1/content/admin/blog.third-post",
        json={
            "title": "Third post",
            "body_markdown": "Third content.",
            "status": "published",
            "lang": "en",
        },
        headers=auth_headers(admin2_token),
    )
    assert create3.status_code == 201, create3.text

    third_detail = client.get("/api/v1/blog/posts/third-post", params={"lang": "en"})
    assert third_detail.status_code == 200, third_detail.text
    author = third_detail.json().get("author") or {}
    author_id = author.get("id")
    assert author_id, third_detail.json()

    filtered_author = client.get("/api/v1/blog/posts", params={"lang": "en", "author_id": author_id})
    assert filtered_author.status_code == 200, filtered_author.text
    assert filtered_author.json()["meta"]["total_items"] == 1
    assert filtered_author.json()["items"][0]["slug"] == "third-post"

    neighbors_first = client.get("/api/v1/blog/posts/first-post/neighbors", params={"lang": "en"})
    assert neighbors_first.status_code == 200, neighbors_first.text
    assert neighbors_first.json()["previous"]["slug"] == "second-post"
    assert neighbors_first.json()["next"] is None

    neighbors_second = client.get("/api/v1/blog/posts/second-post/neighbors", params={"lang": "en"})
    assert neighbors_second.status_code == 200, neighbors_second.text
    assert neighbors_second.json()["previous"]["slug"] == "third-post"
    assert neighbors_second.json()["next"]["slug"] == "first-post"

    filtered_tag = client.get("/api/v1/blog/posts", params={"lang": "en", "tag": "ceramics"})
    assert filtered_tag.status_code == 200, filtered_tag.text
    assert filtered_tag.json()["meta"]["total_items"] == 1
    assert filtered_tag.json()["items"][0]["slug"] == "first-post"

    filtered_q = client.get("/api/v1/blog/posts", params={"lang": "en", "q": "glazing"})
    assert filtered_q.status_code == 200, filtered_q.text
    assert filtered_q.json()["meta"]["total_items"] == 1
    assert filtered_q.json()["items"][0]["slug"] == "second-post"

    # Unpublish window: a post with a past published_until should not be visible.
    expired = client.post(
        "/api/v1/content/admin/blog.expired-post",
        json={
            "title": "Expired",
            "body_markdown": "This is expired.",
            "status": "published",
            "lang": "en",
            "published_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
            "published_until": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        },
        headers=auth_headers(admin_token),
    )
    assert expired.status_code == 201, expired.text
    expired_listing = client.get("/api/v1/blog/posts", params={"lang": "en"})
    assert expired_listing.status_code == 200, expired_listing.text
    assert expired_listing.json()["meta"]["total_items"] == 3
    expired_detail = client.get("/api/v1/blog/posts/expired-post", params={"lang": "en"})
    assert expired_detail.status_code == 404, expired_detail.text

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
    assert listing_after_schedule.json()["meta"]["total_items"] == 3
    assert {i["slug"] for i in listing_after_schedule.json()["items"]} == {"first-post", "second-post", "third-post"}

    scheduled_detail = client.get("/api/v1/blog/posts/scheduled-post", params={"lang": "en"})
    assert scheduled_detail.status_code == 404, scheduled_detail.text
    scheduled_og = client.get("/api/v1/blog/posts/scheduled-post/og.png", params={"lang": "en"})
    assert scheduled_og.status_code == 404, scheduled_og.text

    sitemap = client.get("/api/v1/sitemap.xml")
    assert sitemap.status_code == 200
    assert "blog/first-post" in sitemap.text
    assert "blog/second-post" in sitemap.text
    assert "blog/third-post" in sitemap.text
    assert "blog/scheduled-post" not in sitemap.text
    assert "blog/expired-post" not in sitemap.text

    # Draft previews: admin can mint a token and fetch the unpublished/scheduled post.
    minted = client.post(
        "/api/v1/blog/posts/scheduled-post/preview-token",
        params={"lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert minted.status_code == 200, minted.text
    minted_json = minted.json()
    token = minted_json["token"]
    assert token
    assert minted_json["url"].startswith("http://localhost:4200/blog/scheduled-post?")
    assert f"preview={token}" in minted_json["url"]
    assert "lang=en" in minted_json["url"]
    assert datetime.fromisoformat(minted_json["expires_at"]) > datetime.now(timezone.utc)

    preview = client.get("/api/v1/blog/posts/scheduled-post/preview", params={"lang": "en", "token": token})
    assert preview.status_code == 200, preview.text
    assert preview.json()["title"] == "Scheduled"

    og_preview = client.get("/api/v1/blog/posts/scheduled-post/og-preview.png", params={"lang": "en", "token": token})
    assert og_preview.status_code == 200, og_preview.text
    assert og_preview.headers.get("content-type", "").startswith("image/png")

    invalid_preview = client.get("/api/v1/blog/posts/scheduled-post/preview", params={"lang": "en", "token": "nope"})
    assert invalid_preview.status_code == 403, invalid_preview.text

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

    reply = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Reply here", "parent_id": comment_id},
        headers=auth_headers(flagger_token),
    )
    assert reply.status_code == 201, reply.text
    reply_id = reply.json()["id"]

    comments = client.get("/api/v1/blog/posts/first-post/comments")
    assert comments.status_code == 200, comments.text
    assert comments.json()["meta"]["total_items"] == 2
    by_id = {item["id"]: item for item in comments.json()["items"]}
    assert by_id[comment_id]["parent_id"] is None
    assert by_id[reply_id]["parent_id"] == comment_id

    threads = client.get(
        "/api/v1/blog/posts/first-post/comment-threads",
        params={"sort": "newest", "page": 1, "limit": 10},
    )
    assert threads.status_code == 200, threads.text
    threads_json = threads.json()
    assert threads_json["total_comments"] == 2
    assert threads_json["meta"]["total_items"] == 1
    assert threads_json["items"][0]["root"]["id"] == comment_id
    assert {r["id"] for r in threads_json["items"][0]["replies"]} == {reply_id}

    second_root = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Second root"},
        headers=auth_headers(user_token),
    )
    assert second_root.status_code == 201, second_root.text
    second_root_id = second_root.json()["id"]
    reply2 = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Reply A", "parent_id": second_root_id},
        headers=auth_headers(flagger_token),
    )
    assert reply2.status_code == 201, reply2.text
    reply3 = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Reply B", "parent_id": second_root_id},
        headers=auth_headers(flagger2_token),
    )
    assert reply3.status_code == 201, reply3.text

    threads_top = client.get(
        "/api/v1/blog/posts/first-post/comment-threads",
        params={"sort": "top", "page": 1, "limit": 10},
    )
    assert threads_top.status_code == 200, threads_top.text
    top_items = threads_top.json()["items"]
    assert top_items[0]["root"]["id"] == second_root_id
    assert top_items[1]["root"]["id"] == comment_id

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
    comments_hidden_by_id = {item["id"]: item for item in comments_hidden.json()["items"]}
    assert comments_hidden_by_id[comment_id]["is_hidden"] is True
    assert comments_hidden_by_id[comment_id]["body"] == ""

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
    comments_after_by_id = {item["id"]: item for item in comments_after.json()["items"]}
    assert comments_after_by_id[comment_id]["is_deleted"] is True
    assert comments_after_by_id[comment_id]["body"] == ""
    assert comments_after_by_id[reply_id]["is_deleted"] is False
    assert comments_after_by_id[reply_id]["body"] == "Reply here"

    # Unpublish: setting status back to draft removes post from public endpoints/sitemap.
    unpublish = client.patch(
        "/api/v1/content/admin/blog.second-post",
        json={"status": "draft"},
        headers=auth_headers(admin_token),
    )
    assert unpublish.status_code == 200, unpublish.text
    listing_after_unpublish = client.get("/api/v1/blog/posts", params={"lang": "en"})
    assert listing_after_unpublish.status_code == 200, listing_after_unpublish.text
    assert listing_after_unpublish.json()["meta"]["total_items"] == 2
    assert {i["slug"] for i in listing_after_unpublish.json()["items"]} == {"first-post", "third-post"}
    detail_unpublished = client.get("/api/v1/blog/posts/second-post", params={"lang": "en"})
    assert detail_unpublished.status_code == 404, detail_unpublished.text
    sitemap_after_unpublish = client.get("/api/v1/sitemap.xml")
    assert sitemap_after_unpublish.status_code == 200
    assert "blog/first-post" in sitemap_after_unpublish.text
    assert "blog/second-post" not in sitemap_after_unpublish.text
    assert "blog/third-post" in sitemap_after_unpublish.text


def test_blog_comment_spam_controls(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin)
    user_token = create_user_token(SessionLocal, email="user@example.com", role=UserRole.customer)

    create_post = client.post(
        "/api/v1/content/admin/blog.first-post",
        json={
            "title": "Salut",
            "body_markdown": "Postare RO",
            "status": "published",
            "lang": "ro",
            "meta": {"summary": {"ro": "Rezumat RO", "en": "Summary EN"}},
        },
        headers=auth_headers(admin_token),
    )
    assert create_post.status_code == 201, create_post.text

    old_rate_limit = settings.blog_comments_rate_limit_count
    old_rate_window = settings.blog_comments_rate_limit_window_seconds
    old_max_links = settings.blog_comments_max_links
    settings.blog_comments_rate_limit_count = 2
    settings.blog_comments_rate_limit_window_seconds = 60
    settings.blog_comments_max_links = 0
    try:
        link_blocked = client.post(
            "/api/v1/blog/posts/first-post/comments",
            json={"body": "Check https://example.com"},
            headers=auth_headers(user_token),
        )
        assert link_blocked.status_code == 400, link_blocked.text
        assert "link" in link_blocked.json()["detail"].lower()

        ok1 = client.post(
            "/api/v1/blog/posts/first-post/comments",
            json={"body": "One"},
            headers=auth_headers(user_token),
        )
        assert ok1.status_code == 201, ok1.text
        ok2 = client.post(
            "/api/v1/blog/posts/first-post/comments",
            json={"body": "Two"},
            headers=auth_headers(user_token),
        )
        assert ok2.status_code == 201, ok2.text
        limited = client.post(
            "/api/v1/blog/posts/first-post/comments",
            json={"body": "Three"},
            headers=auth_headers(user_token),
        )
        assert limited.status_code == 429, limited.text
    finally:
        settings.blog_comments_rate_limit_count = old_rate_limit
        settings.blog_comments_rate_limit_window_seconds = old_rate_window
        settings.blog_comments_max_links = old_max_links


def test_blog_comment_subscription_toggle(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin)
    user_token = create_user_token(SessionLocal, email="user@example.com", role=UserRole.customer)

    async def verify_user() -> None:
        async with SessionLocal() as session:
            user = await session.scalar(select(User).where(User.email == "user@example.com"))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(verify_user())

    create_post = client.post(
        "/api/v1/content/admin/blog.first-post",
        json={
            "title": "Salut",
            "body_markdown": "Postare RO",
            "status": "published",
            "lang": "ro",
            "meta": {"summary": {"ro": "Rezumat RO", "en": "Summary EN"}},
        },
        headers=auth_headers(admin_token),
    )
    assert create_post.status_code == 201, create_post.text

    initial = client.get("/api/v1/blog/posts/first-post/comment-subscription", headers=auth_headers(user_token))
    assert initial.status_code == 200, initial.text
    assert initial.json()["enabled"] is False

    enabled = client.put(
        "/api/v1/blog/posts/first-post/comment-subscription",
        json={"enabled": True},
        headers=auth_headers(user_token),
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["enabled"] is True

    after_enable = client.get("/api/v1/blog/posts/first-post/comment-subscription", headers=auth_headers(user_token))
    assert after_enable.status_code == 200, after_enable.text
    assert after_enable.json()["enabled"] is True

    disabled = client.put(
        "/api/v1/blog/posts/first-post/comment-subscription",
        json={"enabled": False},
        headers=auth_headers(user_token),
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabled"] is False


def test_blog_view_count_deduped_per_session_and_skips_bots(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin)

    now = datetime.now(timezone.utc)
    past = (now - timedelta(days=1)).isoformat()

    create = client.post(
        "/api/v1/content/admin/blog.view-post",
        json={
            "title": "View post",
            "body_markdown": "Content",
            "status": "published",
            "lang": "en",
            "published_at": past,
        },
        headers=auth_headers(admin_token),
    )
    assert create.status_code == 201, create.text

    def get_view_count() -> int:
        async def _query() -> int:
            async with SessionLocal() as session:
                block = await session.scalar(select(ContentBlock).where(ContentBlock.key == "blog.view-post"))
                assert block is not None
                return int(block.view_count or 0)

        return asyncio.run(_query())

    assert get_view_count() == 0

    first = client.get("/api/v1/blog/posts/view-post", params={"lang": "en"})
    assert first.status_code == 200, first.text
    assert get_view_count() == 1
    assert client.cookies.get("blog_viewed"), "Expected de-dupe cookie to be set"
    cookie_payload_raw = base64.urlsafe_b64decode(client.cookies["blog_viewed"].encode("utf-8")).decode("utf-8")
    cookie_payload = json.loads(cookie_payload_raw)
    assert isinstance(cookie_payload, list) and cookie_payload
    assert "pid" in cookie_payload[0]
    assert "slug" not in cookie_payload[0]

    second = client.get("/api/v1/blog/posts/view-post", params={"lang": "en"})
    assert second.status_code == 200, second.text
    assert get_view_count() == 1

    client.cookies.clear()
    third = client.get("/api/v1/blog/posts/view-post", params={"lang": "en"})
    assert third.status_code == 200, third.text
    assert get_view_count() == 2

    client.cookies.clear()
    bot = client.get(
        "/api/v1/blog/posts/view-post",
        params={"lang": "en"},
        headers={"User-Agent": "Googlebot"},
    )
    assert bot.status_code == 200, bot.text
    assert get_view_count() == 2
