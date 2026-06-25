"""Targeted coverage tests for app.api.v1.blog (coverage worker 4).

Self-contained: this file alone drives ``app.api.v1.blog`` toward 100% line +
branch coverage. It unit-tests the pure helpers directly and exercises every
route via FastAPI's ``TestClient`` against an in-memory SQLite database. Email /
captcha / OG-render collaborators are monkeypatched so no network or heavy work
runs.
"""

import asyncio
import base64
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import blog as blog_api
from app.core.config import settings
from app.core.security import create_content_preview_token
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentStatus
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# --------------------------------------------------------------------------- #
# Pure-helper unit tests (no DB)
# --------------------------------------------------------------------------- #


def test_cookie_samesite(monkeypatch):
    monkeypatch.setattr(settings, "cookie_samesite", "Strict", raising=False)
    assert blog_api._cookie_samesite() == "strict"
    monkeypatch.setattr(settings, "cookie_samesite", "None", raising=False)
    assert blog_api._cookie_samesite() == "none"
    monkeypatch.setattr(settings, "cookie_samesite", "lax", raising=False)
    assert blog_api._cookie_samesite() == "lax"
    monkeypatch.setattr(settings, "cookie_samesite", "weird", raising=False)
    assert blog_api._cookie_samesite() == "lax"


def test_site_base_url(monkeypatch):
    monkeypatch.setattr(settings, "public_base_url", "https://pub.test/", raising=False)
    assert blog_api._site_base_url() == "https://pub.test"
    monkeypatch.setattr(settings, "public_base_url", None, raising=False)
    monkeypatch.setattr(settings, "frontend_origin", "https://fe.test/", raising=False)
    assert blog_api._site_base_url() == "https://fe.test"


def test_site_locale():
    assert blog_api._site_locale("ro") == "ro-RO"
    assert blog_api._site_locale("en") == "en-US"
    assert blog_api._site_locale("de") == "en-US"


def test_site_description(monkeypatch):
    monkeypatch.setattr(settings, "site_name", "Shop", raising=False)
    assert blog_api._site_description("ro") == "Ultimele articole de pe Shop."
    assert blog_api._site_description("en") == "Latest posts from Shop."
    monkeypatch.setattr(settings, "site_name", "  ", raising=False)
    assert "momentstudio" in blog_api._site_description("en")


def test_is_probable_bot():
    assert blog_api._is_probable_bot("") is False
    assert blog_api._is_probable_bot("   ") is False
    assert blog_api._is_probable_bot("Googlebot/2.1") is True
    assert blog_api._is_probable_bot("Mozilla/5.0 normal") is False


def test_normalize_cookie_post_id():
    assert blog_api._normalize_cookie_post_id("") == ""
    assert blog_api._normalize_cookie_post_id("not-a-uuid") == ""
    valid = "12345678-1234-5678-1234-567812345678"
    assert blog_api._normalize_cookie_post_id(valid) == valid


def test_encode_decode_view_cookie_roundtrip():
    valid = "12345678-1234-5678-1234-567812345678"
    encoded = blog_api._encode_view_cookie([(valid, 1000)])
    decoded = blog_api._decode_view_cookie(encoded)
    assert decoded == [(valid, 1000)]


def test_encode_view_cookie_skips_invalid():
    # Non-int ts / empty pid entries are skipped.
    out = blog_api._encode_view_cookie([("", 1), ("pid", "notint")])  # type: ignore[list-item]
    assert blog_api._decode_view_cookie(out) == []


def test_decode_view_cookie_empty_and_bad():
    assert blog_api._decode_view_cookie("") == []
    assert blog_api._decode_view_cookie("@@@not-base64@@@") == []
    # Not a list (a dict) -> []
    raw = base64.urlsafe_b64encode(json.dumps({"x": 1}).encode()).decode()
    assert blog_api._decode_view_cookie(raw) == []


def test_decode_view_cookie_item_variants():
    valid = "12345678-1234-5678-1234-567812345678"
    payload = [
        "not-a-dict",  # skipped (not dict)
        {"pid": "bad-uuid", "ts": 1},  # skipped (bad pid)
        {"pid": valid, "ts": None},  # skipped (ts None)
        {"pid": valid, "ts": "55"},  # coerced to int
        {"pid": valid, "ts": "notint"},  # skipped (uncoercible)
        {"pid": valid, "ts": 7},  # kept as-is
    ]
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    decoded = blog_api._decode_view_cookie(raw)
    assert (valid, 55) in decoded
    assert (valid, 7) in decoded
    assert len([d for d in decoded if d[0] == valid]) == 2


# --------------------------------------------------------------------------- #
# Route tests via TestClient
# --------------------------------------------------------------------------- #


@pytest.fixture
def test_app(monkeypatch) -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    # Neutralize external collaborators so route bodies run without network.
    async def _noop_verify(token, *, remote_ip=None):
        return None

    monkeypatch.setattr(blog_api.captcha_service, "verify", _noop_verify)
    monkeypatch.setattr(
        blog_api.og_images, "render_blog_post_og", lambda **kw: b"\x89PNG\r\n\x1a\nDATA"
    )

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_user(
    factory,
    *,
    email: str,
    role: UserRole = UserRole.customer,
    **prefs,
) -> tuple[str, str]:
    async def run():
        async with factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email=email, password="password123", name=email.split("@")[0]
                ),
            )
            user.role = role
            user.email_verified = True
            for k, v in prefs.items():
                setattr(user, k, v)
            if role in (UserRole.admin, UserRole.owner):
                session.add(
                    UserPasskey(
                        user_id=user.id,
                        name="pk",
                        credential_id=f"cred-{user.id}",
                        public_key=b"k",
                        sign_count=0,
                        backed_up=False,
                    )
                )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return str(user.id), tokens["access_token"]

    return asyncio.run(run())


def _make_post(
    factory,
    *,
    key: str = "blog.first-post",
    title: str = "Hello",
    status: ContentStatus = ContentStatus.published,
    published: bool = True,
    **fields,
) -> str:
    async def run():
        async with factory() as session:
            block = ContentBlock(
                key=key,
                title=title,
                body_markdown="Body text here.",
                status=status,
                version=1,
                lang="en",
                published_at=(
                    datetime.now(timezone.utc) - timedelta(days=1)
                    if published
                    else None
                ),
                **fields,
            )
            session.add(block)
            await session.commit()
            await session.refresh(block)
            return str(block.id)

    return asyncio.run(run())


def test_list_posts_empty(test_app):
    client = test_app["client"]
    res = client.get("/api/v1/blog/posts")
    assert res.status_code == 200
    body = res.json()
    assert body["items"] == []
    assert body["meta"]["total_pages"] == 1


def test_get_post_404(test_app):
    client = test_app["client"]
    assert client.get("/api/v1/blog/posts/missing").status_code == 404


def test_get_post_counts_view_and_sets_cookie(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    res = client.get("/api/v1/blog/posts/first-post", params={"lang": "en"})
    assert res.status_code == 200
    assert blog_api.BLOG_VIEW_COOKIE in res.cookies


def test_get_post_bot_no_cookie(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    res = client.get(
        "/api/v1/blog/posts/first-post",
        headers={"user-agent": "Googlebot/2.1"},
    )
    assert res.status_code == 200
    assert blog_api.BLOG_VIEW_COOKIE not in res.cookies


def test_get_post_already_viewed_skips_count(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    post_id = _make_post(factory)
    now = int(time.time())
    cookie = blog_api._encode_view_cookie([(post_id, now)])
    client.cookies.set(blog_api.BLOG_VIEW_COOKIE, cookie)
    res = client.get("/api/v1/blog/posts/first-post")
    assert res.status_code == 200
    client.cookies.clear()


def test_get_post_stale_cookie_pruned(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    other = "12345678-1234-5678-1234-567812345678"
    old_ts = int(time.time()) - blog_api.BLOG_VIEW_COOKIE_TTL_SECONDS - 10
    cookie = blog_api._encode_view_cookie([(other, old_ts)])
    client.cookies.set(blog_api.BLOG_VIEW_COOKIE, cookie)
    res = client.get("/api/v1/blog/posts/first-post")
    assert res.status_code == 200
    client.cookies.clear()


def test_get_post_view_count_db_error_rolls_back(test_app, monkeypatch):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)

    # Force the view-count UPDATE to raise so the except/rollback path runs.
    import app.api.v1.blog as mod

    real_update = mod.sa.update

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(mod.sa, "update", boom)
    res = client.get("/api/v1/blog/posts/first-post")
    assert res.status_code == 200
    monkeypatch.setattr(mod.sa, "update", real_update)


def test_rss_and_json_feed(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(
        factory,
        meta={
            "summary": {"en": "Summary EN"},
            "tags": ["News"],
            "cover_image_url": "https://example.com/c.jpg",
        },
    )
    rss = client.get("/api/v1/blog/rss.xml", params={"lang": "en"})
    assert rss.status_code == 200
    assert "application/rss+xml" in rss.headers["content-type"]
    feed = client.get("/api/v1/blog/feed.json", params={"lang": "en"})
    assert feed.status_code == 200
    data = feed.json()
    assert data["items"]
    item = data["items"][0]
    assert item["summary"] == "Summary EN"
    assert item["tags"] == ["News"]
    assert item["image"] == "https://example.com/c.jpg"


def test_rss_and_feed_empty(test_app):
    """No posts: exercises the ``if blocks`` false branch in RSS + feed."""
    client = test_app["client"]
    rss = client.get("/api/v1/blog/rss.xml")
    assert rss.status_code == 200
    feed = client.get("/api/v1/blog/feed.json")
    assert feed.status_code == 200
    assert feed.json()["items"] == []


def test_feed_item_no_published_at(test_app):
    """A published post with ``published_at=None`` is still listed; the RSS
    pubDate branch (258->262) is skipped because there is no publish date."""
    client = test_app["client"]
    factory = test_app["session_factory"]

    async def run():
        async with factory() as session:
            block = ContentBlock(
                key="blog.nodate",
                title="No Date",
                body_markdown="Body",
                status=ContentStatus.published,
                version=1,
                lang="en",
                published_at=None,  # no publish date -> RSS pubDate skipped
                meta=None,
            )
            session.add(block)
            await session.commit()

    asyncio.run(run())
    rss = client.get("/api/v1/blog/rss.xml", params={"lang": "en"})
    assert rss.status_code == 200
    assert "<pubDate>" not in rss.text
    feed = client.get("/api/v1/blog/feed.json", params={"lang": "en"})
    assert feed.status_code == 200
    item = feed.json()["items"][0]
    # No author / series in a bare post.
    assert "authors" not in item
    assert "_series" not in item


def test_feed_item_with_author_and_series(test_app):
    """A post with an author and a ``series`` exercises the author/series true
    branches (303, 312) in the JSON feed item builder."""
    client = test_app["client"]
    factory = test_app["session_factory"]
    author_id, _ = _make_user(factory, email="postauthor@example.com")

    async def run():
        from uuid import UUID

        async with factory() as session:
            block = ContentBlock(
                key="blog.rich",
                title="Rich",
                body_markdown="Body",
                status=ContentStatus.published,
                version=1,
                lang="en",
                published_at=datetime.now(timezone.utc) - timedelta(days=1),
                author_id=UUID(author_id),
                meta={"series": "My Series", "tags": ["t1"]},
            )
            session.add(block)
            await session.commit()

    asyncio.run(run())
    feed = client.get("/api/v1/blog/feed.json", params={"lang": "en"})
    assert feed.status_code == 200
    item = next(i for i in feed.json()["items"] if i["title"] == "Rich")
    assert item["authors"][0]["name"]
    assert item["_series"] == "My Series"
    assert item["tags"] == ["t1"]


def test_neighbors(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory, key="blog.p1", title="P1")
    _make_post(factory, key="blog.p2", title="P2")
    res = client.get("/api/v1/blog/posts/p1/neighbors")
    assert res.status_code == 200


def test_neighbors_404(test_app):
    client = test_app["client"]
    assert client.get("/api/v1/blog/posts/none/neighbors").status_code == 404


def test_preview_invalid_token(test_app):
    client = test_app["client"]
    res = client.get("/api/v1/blog/posts/first-post/preview", params={"token": "bogus"})
    assert res.status_code == 403


def test_preview_valid_token(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    token = create_content_preview_token(
        content_key="blog.first-post",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    res = client.get("/api/v1/blog/posts/first-post/preview", params={"token": token})
    assert res.status_code == 200


def test_preview_valid_token_post_missing(test_app):
    client = test_app["client"]
    token = create_content_preview_token(
        content_key="blog.gone",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    res = client.get("/api/v1/blog/posts/gone/preview", params={"token": token})
    assert res.status_code == 404


def test_create_preview_token_admin(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _, admin = _make_user(factory, email="admin@example.com", role=UserRole.admin)
    res = client.post(
        "/api/v1/blog/posts/first-post/preview-token", headers=_auth(admin)
    )
    assert res.status_code == 200, res.text
    assert res.json()["token"]


def test_create_preview_token_missing_post(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _, admin = _make_user(factory, email="admin2@example.com", role=UserRole.admin)
    res = client.post("/api/v1/blog/posts/gone/preview-token", headers=_auth(admin))
    assert res.status_code == 404


def test_og_png_and_304(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    res = client.get("/api/v1/blog/posts/first-post/og.png")
    assert res.status_code == 200
    etag = res.headers["ETag"]
    # If-None-Match -> 304
    res304 = client.get(
        "/api/v1/blog/posts/first-post/og.png",
        headers={"if-none-match": etag},
    )
    assert res304.status_code == 304
    # Wildcard if-none-match is ignored (still 200).
    res_star = client.get(
        "/api/v1/blog/posts/first-post/og.png",
        headers={"if-none-match": "*"},
    )
    assert res_star.status_code == 200
    # Non-matching candidate list -> 200.
    res_other = client.get(
        "/api/v1/blog/posts/first-post/og.png",
        headers={"if-none-match": '"other", '},
    )
    assert res_other.status_code == 200


def test_og_png_404(test_app):
    client = test_app["client"]
    assert client.get("/api/v1/blog/posts/none/og.png").status_code == 404


def test_og_preview_invalid_and_valid(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    bad = client.get(
        "/api/v1/blog/posts/first-post/og-preview.png", params={"token": "x"}
    )
    assert bad.status_code == 403
    token = create_content_preview_token(
        content_key="blog.first-post",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    ok = client.get(
        "/api/v1/blog/posts/first-post/og-preview.png", params={"token": token}
    )
    assert ok.status_code == 200


def test_og_preview_post_missing(test_app):
    client = test_app["client"]
    token = create_content_preview_token(
        content_key="blog.gone",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    res = client.get("/api/v1/blog/posts/gone/og-preview.png", params={"token": token})
    assert res.status_code == 404


def test_list_comments_and_404(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    assert client.get("/api/v1/blog/posts/first-post/comments").status_code == 200
    assert client.get("/api/v1/blog/posts/none/comments").status_code == 404


def test_list_comment_threads_and_404(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    assert (
        client.get("/api/v1/blog/posts/first-post/comment-threads").status_code == 200
    )
    assert client.get("/api/v1/blog/posts/none/comment-threads").status_code == 404


def test_comment_subscription_get_and_set(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _, user = _make_user(factory, email="sub@example.com")
    g = client.get(
        "/api/v1/blog/posts/first-post/comment-subscription", headers=_auth(user)
    )
    assert g.status_code == 200
    s = client.put(
        "/api/v1/blog/posts/first-post/comment-subscription",
        json={"enabled": True},
        headers=_auth(user),
    )
    assert s.status_code == 200
    assert s.json()["enabled"] is True


def test_comment_subscription_404(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _, user = _make_user(factory, email="sub2@example.com")
    assert (
        client.get(
            "/api/v1/blog/posts/none/comment-subscription", headers=_auth(user)
        ).status_code
        == 404
    )
    assert (
        client.put(
            "/api/v1/blog/posts/none/comment-subscription",
            json={"enabled": True},
            headers=_auth(user),
        ).status_code
        == 404
    )


def test_list_my_comments(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _, user = _make_user(factory, email="me@example.com")
    res = client.get("/api/v1/blog/me/comments", headers=_auth(user))
    assert res.status_code == 200


def test_create_comment_404(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _, user = _make_user(factory, email="c1@example.com")
    res = client.post(
        "/api/v1/blog/posts/none/comments",
        json={"body": "hi"},
        headers=_auth(user),
    )
    assert res.status_code == 404


def test_create_comment_no_smtp(test_app, monkeypatch):
    monkeypatch.setattr(settings, "smtp_enabled", False, raising=False)
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _, user = _make_user(factory, email="c2@example.com")
    res = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Nice post"},
        headers=_auth(user),
    )
    assert res.status_code == 201


def test_create_comment_with_smtp_full_notifications(test_app, monkeypatch):
    """Exercises the full email/notification block (root + reply paths)."""
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "frontend_origin", "https://fe.test/", raising=False)
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)

    # Capture background email tasks instead of sending them.
    sent: list[str] = []

    async def _noop_async(*a, **k):
        sent.append("async")

    def _noop_sync(*a, **k):
        sent.append("sync")

    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_admin_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_reply_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_subscriber_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.notification_service, "create_notification", _noop_async
    )

    # Admin who wants notifications + an admin who is the commenter (skipped).
    _make_user(
        factory,
        email="admin-notif@example.com",
        role=UserRole.admin,
        notify_blog_comments=True,
    )
    # Subscriber to root comments.
    sub_id, _ = _make_user(
        factory, email="subscriber@example.com", notify_blog_comments=False
    )
    # The parent comment author who wants reply notifications.
    parent_id, parent_token = _make_user(
        factory,
        email="parent@example.com",
        notify_blog_comment_replies=True,
    )
    # Commenter who replies.
    _, replier = _make_user(factory, email="replier@example.com")

    # Subscribe the subscriber to root comments on the post.
    s = client.put(
        "/api/v1/blog/posts/first-post/comment-subscription",
        json={"enabled": True},
        headers=_auth(_login_token(factory, sub_id)),
    )
    assert s.status_code == 200

    # Parent posts a root comment (triggers admin + subscriber notifications).
    root = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Root comment body"},
        headers=_auth(parent_token),
    )
    assert root.status_code == 201, root.text
    root_id = root.json()["id"]

    # Replier replies to the root (triggers reply notification to parent author).
    reply = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "x" * 500, "parent_id": root_id},  # long body -> snippet trim
        headers=_auth(replier),
    )
    assert reply.status_code == 201, reply.text
    assert sent  # background tasks were registered


def test_create_comment_smtp_self_skip_branches(test_app, monkeypatch):
    """Admin who is the commenter is skipped (701); subscriber who is the
    commenter is skipped (756); reply to a parent author who does NOT want
    notifications skips the reply block (720->748)."""
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "frontend_origin", "https://fe.test/", raising=False)
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)

    def _noop_sync(*a, **k):
        return None

    async def _noop_async(*a, **k):
        return None

    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_admin_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_reply_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_subscriber_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.notification_service, "create_notification", _noop_async
    )

    # The admin is also the commenter -> admin notification self-skip (701).
    admin_id, admin_token = _make_user(
        factory,
        email="selfadmin@example.com",
        role=UserRole.admin,
        notify_blog_comments=True,
    )
    # Admin subscribes to the post so the subscriber loop sees the commenter (756).
    sub = client.put(
        "/api/v1/blog/posts/first-post/comment-subscription",
        json={"enabled": True},
        headers=_auth(admin_token),
    )
    assert sub.status_code == 200

    # Admin posts a ROOT comment: admin-notify loop self-skips, subscriber
    # loop self-skips.
    root = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Self root"},
        headers=_auth(admin_token),
    )
    assert root.status_code == 201, root.text

    # A parent author who does NOT want reply notifications.
    _, quiet_parent = _make_user(
        factory, email="quietparent@example.com", notify_blog_comment_replies=False
    )
    quiet_root = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Quiet root"},
        headers=_auth(quiet_parent),
    )
    assert quiet_root.status_code == 201
    quiet_root_id = quiet_root.json()["id"]

    # Someone replies to the quiet parent -> reply-notification condition is
    # False (parent opted out), exercising the 720->748 skip branch.
    _, replier2 = _make_user(factory, email="replier2@example.com")
    reply = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "reply body", "parent_id": quiet_root_id},
        headers=_auth(replier2),
    )
    assert reply.status_code == 201, reply.text


def test_create_comment_smtp_reply_ro_locale(test_app, monkeypatch):
    """Reply notification to a parent author with RO locale exercises the RO
    title branch (741->742)."""
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "frontend_origin", "https://fe.test/", raising=False)
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)

    def _noop_sync(*a, **k):
        return None

    async def _noop_async(*a, **k):
        return None

    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_admin_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_reply_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.email_service, "send_blog_comment_subscriber_notification", _noop_sync
    )
    monkeypatch.setattr(
        blog_api.notification_service, "create_notification", _noop_async
    )

    _, parent_token = _make_user(
        factory,
        email="roparent@example.com",
        notify_blog_comment_replies=True,
        preferred_language="ro",
    )
    root = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "RO root"},
        headers=_auth(parent_token),
    )
    assert root.status_code == 201
    root_id = root.json()["id"]
    _, replier = _make_user(factory, email="roreplier@example.com")
    reply = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "reply", "parent_id": root_id},
        headers=_auth(replier),
    )
    assert reply.status_code == 201, reply.text


def _insert_blank_email_user(factory, *, role=UserRole.customer, **prefs) -> None:
    """Insert a user row with an empty email to exercise the ``if not x.email``
    guards (a published-but-blank account)."""

    async def run():
        async with factory() as session:
            user = User(
                email="",
                username="blank-user",
                name="Blank User",
                hashed_password="x",
                email_verified=True,
                role=role,
                **prefs,
            )
            session.add(user)
            await session.commit()

    asyncio.run(run())


def test_create_comment_admin_blank_email_skipped(test_app, monkeypatch):
    """An admin recipient with a blank email is skipped (line 699)."""
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _insert_blank_email_user(factory, role=UserRole.admin, notify_blog_comments=True)
    _, user = _make_user(factory, email="commenter9@example.com")
    res = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "hello"},
        headers=_auth(user),
    )
    assert res.status_code == 201, res.text


def test_create_comment_subscriber_blank_email_skipped(test_app, monkeypatch):
    """A subscriber recipient with a blank email is skipped (line 754)."""
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    client = test_app["client"]
    factory = test_app["session_factory"]
    post_id = _make_post(factory)
    _insert_blank_email_user(factory)

    # Subscribe the blank-email user to the post directly.
    async def subscribe():
        from app.services import blog as bsvc
        from sqlalchemy import select as _select
        from uuid import UUID

        async with factory() as session:
            blank = (
                await session.execute(_select(User).where(User.email == ""))
            ).scalar_one()
            await bsvc.set_comment_subscription(
                session,
                content_block_id=UUID(post_id),
                user_id=blank.id,
                enabled=True,
            )

    asyncio.run(subscribe())
    _, user = _make_user(factory, email="commenter10@example.com")
    res = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "root hello"},
        headers=_auth(user),
    )
    assert res.status_code == 201, res.text


def _login_token(factory, user_id: str) -> str:
    async def run():
        from uuid import UUID

        async with factory() as session:
            user = await session.get(User, UUID(user_id))
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(run())


def test_delete_comment(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _, user = _make_user(factory, email="del@example.com")
    monkey_post = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "to delete"},
        headers=_auth(user),
    )
    cid = monkey_post.json()["id"]
    res = client.delete(f"/api/v1/blog/comments/{cid}", headers=_auth(user))
    assert res.status_code == 204


def test_flag_comment(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _, author = _make_user(factory, email="author@example.com")
    posted = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "flag me"},
        headers=_auth(author),
    )
    cid = posted.json()["id"]
    _, flagger = _make_user(factory, email="flagger@example.com")
    res = client.post(
        f"/api/v1/blog/comments/{cid}/flag",
        json={"reason": "spam"},
        headers=_auth(flagger),
    )
    assert res.status_code == 201


def test_admin_flag_hide_unhide_resolve(test_app):
    client = test_app["client"]
    factory = test_app["session_factory"]
    _make_post(factory)
    _, author = _make_user(factory, email="author2@example.com")
    posted = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "moderate me"},
        headers=_auth(author),
    )
    cid = posted.json()["id"]
    _, flagger = _make_user(factory, email="flagger2@example.com")
    client.post(
        f"/api/v1/blog/comments/{cid}/flag",
        json={"reason": "abuse"},
        headers=_auth(flagger),
    )
    _, admin = _make_user(factory, email="modadmin@example.com", role=UserRole.admin)

    listed = client.get("/api/v1/blog/admin/comments/flagged", headers=_auth(admin))
    assert listed.status_code == 200

    hide = client.post(
        f"/api/v1/blog/admin/comments/{cid}/hide",
        json={"reason": "policy"},
        headers=_auth(admin),
    )
    assert hide.status_code == 200

    unhide = client.post(
        f"/api/v1/blog/admin/comments/{cid}/unhide", headers=_auth(admin)
    )
    assert unhide.status_code == 200

    resolved = client.post(
        f"/api/v1/blog/admin/comments/{cid}/resolve-flags", headers=_auth(admin)
    )
    assert resolved.status_code == 200
    assert "resolved" in resolved.json()
