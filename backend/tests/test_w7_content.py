"""Worker-7 coverage tests for ``app.api.v1.content``.

Self-contained: this file alone drives ``app.api.v1.content`` toward 100% line
and branch coverage. The router handlers are tested by **calling the handler
functions directly** (FastAPI ``Depends`` defaults are not resolved on a direct
call, so collaborators are passed in explicitly). Thin delegating handlers
monkeypatch their service; query handlers use an in-memory SQLite session from
``conftest.make_memory_session_factory``. No HTTP stack, no real network.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.api.v1 import content as c
from app.models.user import UserRole


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def session_factory():
    from tests.conftest import make_memory_session_factory

    return make_memory_session_factory()


def _user(role: UserRole = UserRole.admin) -> SimpleNamespace:
    return SimpleNamespace(id=uuid4(), role=role, email="a@b.ro")


def _block(**kw) -> SimpleNamespace:
    base = dict(
        id=uuid4(),
        key="page.about",
        title="About",
        body_markdown="hi",
        status="published",
        meta=None,
        lang="en",
        published_at=None,
        published_until=None,
        updated_at=datetime.now(timezone.utc),
        version=1,
        view_count=0,
        sort_order=0,
        needs_translation_en=False,
        needs_translation_ro=False,
        author_id=None,
        created_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return SimpleNamespace(**base)


async def _aval(value):  # async return helper
    return value


def _afn(value):
    async def _inner(*a, **k):
        return value

    return _inner


def _araise(exc):
    async def _inner(*a, **k):
        raise exc

    return _inner


# =========================================================================== #
# pure helpers
# =========================================================================== #
def test_requires_auth_variants() -> None:
    assert c._requires_auth(SimpleNamespace(meta={"requires_auth": True}))
    assert not c._requires_auth(SimpleNamespace(meta={"requires_auth": False}))
    assert not c._requires_auth(SimpleNamespace(meta=None))
    assert not c._requires_auth(SimpleNamespace(meta=["x"]))


def test_is_hidden_variants() -> None:
    assert c._is_hidden(SimpleNamespace(meta={"hidden": True}))
    assert not c._is_hidden(SimpleNamespace(meta={"hidden": False}))
    assert not c._is_hidden(SimpleNamespace(meta=None))
    assert not c._is_hidden(SimpleNamespace(meta="str"))


def test_normalize_image_tags() -> None:
    assert c._normalize_image_tags([]) == []
    assert c._normalize_image_tags(None) == []  # type: ignore[arg-type]
    assert c._normalize_image_tags([" Hello World "]) == ["hello-world"]
    assert c._normalize_image_tags(["", "   ", "***"]) == []
    assert c._normalize_image_tags(["a" * 65]) == []
    assert c._normalize_image_tags(["dup", "dup"]) == ["dup"]
    # cap at 10
    assert c._normalize_image_tags([f"t{i}" for i in range(15)]) == [
        f"t{i}" for i in range(10)
    ]


def test_require_owner_or_admin() -> None:
    c._require_owner_or_admin(_user(UserRole.owner))
    c._require_owner_or_admin(_user(UserRole.admin))
    with pytest.raises(HTTPException) as ei:
        c._require_owner_or_admin(_user(UserRole.customer))
    assert ei.value.status_code == 403


def test_redirect_key_to_display_value() -> None:
    assert c._redirect_key_to_display_value("page.about") == "/pages/about"
    assert c._redirect_key_to_display_value("plain") == "plain"
    # "page." with no slug after dot is still handled
    assert c._redirect_key_to_display_value("page.") == "/pages/"


def test_redirect_display_value_to_key(monkeypatch) -> None:
    monkeypatch.setattr(
        c.content_service, "slugify_page_slug", lambda s: s.strip().lower()
    )
    assert c._redirect_display_value_to_key("/pages/About") == "page.about"
    # non-pages value: returns original stripped value (leading slash kept).
    assert c._redirect_display_value_to_key("/other") == "/other"
    assert c._redirect_display_value_to_key("plain") == "plain"
    # slug normalises to empty -> empty key
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "")
    assert c._redirect_display_value_to_key("/pages/") == ""


def test_redirect_chain_error() -> None:
    assert c._redirect_chain_error("", {}) is None
    assert c._redirect_chain_error("a", {"a": "b"}) is None  # terminates
    assert c._redirect_chain_error("a", {"a": "b", "b": "a"}) == "loop"
    # too deep: a long non-looping chain
    chain = {f"k{i}": f"k{i + 1}" for i in range(60)}
    assert c._redirect_chain_error("k0", chain, max_hops=5) == "too_deep"


# =========================================================================== #
# get_static_page
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_get_static_page_invalid_slug(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "")
    with pytest.raises(HTTPException) as ei:
        await c.get_static_page(slug="!!", session=object(), lang=None, user=None)
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_get_static_page_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(None),
    )
    with pytest.raises(HTTPException) as ei:
        await c.get_static_page(
            slug="about", session=object(), lang=None, user=None
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_get_static_page_hidden(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about", meta={"hidden": True})
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    with pytest.raises(HTTPException) as ei:
        await c.get_static_page(
            slug="about", session=object(), lang=None, user=None
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_get_static_page_requires_auth(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about", meta={"requires_auth": True})
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    with pytest.raises(HTTPException) as ei:
        await c.get_static_page(
            slug="about", session=object(), lang=None, user=None
        )
    assert ei.value.status_code == 401


@pytest.mark.anyio("asyncio")
async def test_get_static_page_ok(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about", meta={"requires_auth": True})
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    out = await c.get_static_page(
        slug="about", session=object(), lang="en", user=_user()
    )
    assert out.key == "page.about"


# =========================================================================== #
# preview_static_page
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_preview_static_page_bad_token(monkeypatch) -> None:
    monkeypatch.setattr(c, "decode_content_preview_token", lambda t: "")
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    resp = SimpleNamespace(headers={})
    with pytest.raises(HTTPException) as ei:
        await c.preview_static_page(
            slug="about",
            response=resp,
            token="t",
            session=object(),
            lang=None,
            user=None,
        )
    assert ei.value.status_code == 403


@pytest.mark.anyio("asyncio")
async def test_preview_static_page_not_found(monkeypatch) -> None:
    monkeypatch.setattr(
        c, "decode_content_preview_token", lambda t: "page.about"
    )
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    resp = SimpleNamespace(headers={})
    with pytest.raises(HTTPException) as ei:
        await c.preview_static_page(
            slug="about",
            response=resp,
            token="t",
            session=object(),
            lang=None,
            user=None,
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_preview_static_page_requires_auth(monkeypatch) -> None:
    monkeypatch.setattr(
        c, "decode_content_preview_token", lambda t: "page.about"
    )
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about", meta={"requires_auth": True})
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
    resp = SimpleNamespace(headers={})
    with pytest.raises(HTTPException) as ei:
        await c.preview_static_page(
            slug="about",
            response=resp,
            token="t",
            session=object(),
            lang=None,
            user=None,
        )
    assert ei.value.status_code == 401


@pytest.mark.anyio("asyncio")
async def test_preview_static_page_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        c, "decode_content_preview_token", lambda t: "page.about"
    )
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about")
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
    resp = SimpleNamespace(headers={})
    out = await c.preview_static_page(
        slug="about",
        response=resp,
        token="t",
        session=object(),
        lang=None,
        user=_user(),
    )
    assert out.key == "page.about"
    assert resp.headers["Cache-Control"] == "private, no-store"


# =========================================================================== #
# create_page_preview_token
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_create_page_preview_token_invalid_slug(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "")
    with pytest.raises(HTTPException) as ei:
        await c.create_page_preview_token(
            slug="!!", session=object(), lang=None, expires_minutes=60, _=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_create_page_preview_token_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.create_page_preview_token(
            slug="about",
            session=object(),
            lang=None,
            expires_minutes=60,
            _=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_create_page_preview_token_ok_lang_from_block(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about", lang="ro")
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
    monkeypatch.setattr(
        c, "create_content_preview_token", lambda *, content_key, expires_at: "TOK"
    )
    monkeypatch.setattr(c.settings, "frontend_origin", "https://x/", False)
    out = await c.create_page_preview_token(
        slug="about", session=object(), lang=None, expires_minutes=60, _=_user()
    )
    assert out.token == "TOK"
    assert "lang=ro" in out.url


@pytest.mark.anyio("asyncio")
async def test_create_page_preview_token_default_lang(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "slugify_page_slug", lambda s: "about")
    blk = _block(key="page.about", lang=None)  # not en/ro -> "en"
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
    monkeypatch.setattr(
        c, "create_content_preview_token", lambda *, content_key, expires_at: "TOK"
    )
    monkeypatch.setattr(c.settings, "frontend_origin", "https://x", False)
    out = await c.create_page_preview_token(
        slug="about", session=object(), lang=None, expires_minutes=60, _=_user()
    )
    assert "lang=en" in out.url


# =========================================================================== #
# get_content
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_get_content_not_found(monkeypatch) -> None:
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(None),
    )
    with pytest.raises(HTTPException) as ei:
        await c.get_content(key="x", session=object(), lang=None, user=None)
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_get_content_hidden_page(monkeypatch) -> None:
    blk = _block(key="page.about", meta={"hidden": True})
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    with pytest.raises(HTTPException) as ei:
        await c.get_content(key="page.about", session=object(), lang=None, user=None)
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_get_content_page_requires_auth(monkeypatch) -> None:
    blk = _block(key="page.about", meta={"requires_auth": True})
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    with pytest.raises(HTTPException) as ei:
        await c.get_content(key="page.about", session=object(), lang=None, user=None)
    assert ei.value.status_code == 401


@pytest.mark.anyio("asyncio")
async def test_get_content_site_social_hydration(monkeypatch) -> None:
    blk = _block(key="site.social", meta={"x": 1})
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    monkeypatch.setattr(
        c.social_thumbnails, "hydrate_site_social_meta", _afn({"hydrated": True})
    )
    out = await c.get_content(
        key="site.social", session=object(), lang=None, user=None
    )
    assert out.meta == {"hydrated": True}


@pytest.mark.anyio("asyncio")
async def test_get_content_site_social_non_dict_meta(monkeypatch) -> None:
    # meta=None exercises the ``isinstance(block.meta, dict)`` -> else None path
    # (real ContentBlock.meta is JSON-nullable, never a bare string).
    blk = _block(key="site.social", meta=None)
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    captured = {}

    async def hydrate(meta):
        captured["meta"] = meta
        return {"ok": True}

    monkeypatch.setattr(c.social_thumbnails, "hydrate_site_social_meta", hydrate)
    out = await c.get_content(
        key="site.social", session=object(), lang=None, user=None
    )
    assert captured["meta"] is None  # non-dict meta passed as None
    assert out.meta == {"ok": True}


@pytest.mark.anyio("asyncio")
async def test_get_content_plain_ok(monkeypatch) -> None:
    blk = _block(key="faq.general", meta={"requires_auth": True})  # not page.* -> ok
    monkeypatch.setattr(
        c.content_service,
        "get_published_by_key_following_redirects",
        _afn(blk),
    )
    out = await c.get_content(key="faq.general", session=object(), lang=None, user=None)
    assert out.key == "faq.general"


# =========================================================================== #
# preview_home
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_preview_home_bad_token(monkeypatch) -> None:
    monkeypatch.setattr(c, "decode_content_preview_token", lambda t: "wrong")
    resp = SimpleNamespace(headers={})
    with pytest.raises(HTTPException) as ei:
        await c.preview_home(
            response=resp, token="t", session=object(), lang=None
        )
    assert ei.value.status_code == 403


@pytest.mark.anyio("asyncio")
async def test_preview_home_sections_not_found(monkeypatch) -> None:
    monkeypatch.setattr(
        c, "decode_content_preview_token", lambda t: "home.sections"
    )
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    resp = SimpleNamespace(headers={})
    with pytest.raises(HTTPException) as ei:
        await c.preview_home(
            response=resp, token="t", session=object(), lang=None
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_preview_home_ok_with_and_without_story(monkeypatch) -> None:
    monkeypatch.setattr(
        c, "decode_content_preview_token", lambda t: "home.sections"
    )
    sections = _block(key="home.sections")
    story = _block(key="home.story")

    calls = {"n": 0}

    async def get_block(session, key, lang=None):
        calls["n"] += 1
        if key == "home.sections":
            return sections
        return story if calls["n"] != 99 else None

    monkeypatch.setattr(c.content_service, "get_block_by_key", get_block)
    resp = SimpleNamespace(headers={})
    out = await c.preview_home(
        response=resp, token="t", session=object(), lang=None
    )
    assert out.story is not None

    async def get_block_no_story(session, key, lang=None):
        return sections if key == "home.sections" else None

    monkeypatch.setattr(c.content_service, "get_block_by_key", get_block_no_story)
    out2 = await c.preview_home(
        response=resp, token="t", session=object(), lang=None
    )
    assert out2.story is None


# =========================================================================== #
# create_home_preview_token
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_create_home_preview_token_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.create_home_preview_token(
            session=object(), lang=None, expires_minutes=60, _=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_create_home_preview_token_ok(monkeypatch) -> None:
    blk = _block(key="home.sections", lang="en")
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
    monkeypatch.setattr(
        c, "create_content_preview_token", lambda *, content_key, expires_at: "HT"
    )
    monkeypatch.setattr(c.settings, "frontend_origin", "https://x", False)
    out = await c.create_home_preview_token(
        session=object(), lang="ro", expires_minutes=60, _=_user()
    )
    assert out.token == "HT"
    assert "lang=ro" in out.url


# =========================================================================== #
# admin_fetch_social_thumbnail
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_admin_fetch_social_thumbnail_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        c.social_thumbnails, "fetch_social_thumbnail_url", _afn("https://t.png")
    )
    payload = SimpleNamespace(url="https://site.com")
    out = await c.admin_fetch_social_thumbnail(payload=payload, _=_user())
    assert out.thumbnail_url == "https://t.png"


@pytest.mark.anyio("asyncio")
async def test_admin_fetch_social_thumbnail_value_error(monkeypatch) -> None:
    monkeypatch.setattr(
        c.social_thumbnails,
        "fetch_social_thumbnail_url",
        _araise(ValueError("bad url")),
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_fetch_social_thumbnail(
            payload=SimpleNamespace(url="x"), _=_user()
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_fetch_social_thumbnail_http_error(monkeypatch) -> None:
    monkeypatch.setattr(
        c.social_thumbnails,
        "fetch_social_thumbnail_url",
        _araise(httpx.HTTPError("boom")),
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_fetch_social_thumbnail(
            payload=SimpleNamespace(url="x"), _=_user()
        )
    assert ei.value.status_code == 502


@pytest.mark.anyio("asyncio")
async def test_admin_fetch_social_thumbnail_empty(monkeypatch) -> None:
    monkeypatch.setattr(
        c.social_thumbnails, "fetch_social_thumbnail_url", _afn("")
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_fetch_social_thumbnail(
            payload=SimpleNamespace(url="x"), _=_user()
        )
    assert ei.value.status_code == 502


# =========================================================================== #
# DB-backed query handlers (in-memory SQLite session)
# =========================================================================== #
from app.models.content import (  # noqa: E402
    ContentBlock,
    ContentRedirect,
    ContentStatus,
)


async def _seed_block(session, **kw):
    base = dict(
        key="page.about",
        title="About",
        body_markdown="hi",
        status=ContentStatus.published,
        lang="en",
    )
    base.update(kw)
    blk = ContentBlock(**base)
    session.add(blk)
    await session.commit()
    await session.refresh(blk)
    return blk


# --------------------------- admin_list_scheduling ------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_list_scheduling_empty(session_factory) -> None:
    async with session_factory() as session:
        out = await c.admin_list_scheduling(
            session=session,
            window_days=90,
            window_start=None,
            page=1,
            limit=50,
            _=_user(),
        )
    assert out.meta.total_items == 0
    assert out.meta.total_pages == 1


@pytest.mark.anyio("asyncio")
async def test_admin_list_scheduling_naive_window_start(session_factory) -> None:
    async with session_factory() as session:
        await c.admin_list_scheduling(
            session=session,
            window_days=30,
            window_start=datetime(2000, 1, 1),  # naive -> tz added branch
            page=1,
            limit=2,
            _=_user(),
        )


@pytest.mark.anyio("asyncio")
async def test_admin_list_scheduling_default_window_pagination(
    session_factory,
) -> None:
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        # one publish event, one unpublish event, one with both set
        await _seed_block(
            session, key="page.future", published_at=now + timedelta(days=1)
        )
        await _seed_block(
            session,
            key="page.expiring",
            published_until=now + timedelta(days=2),
        )
        await _seed_block(
            session,
            key="page.both",
            published_at=now + timedelta(days=1),
            published_until=now + timedelta(days=3),
        )
        out = await c.admin_list_scheduling(
            session=session,
            window_days=90,
            window_start=None,  # default to today midnight branch
            page=2,
            limit=2,
            _=_user(),
        )
    assert out.meta.total_items == 3
    assert out.meta.total_pages == 2
    assert len(out.items) == 1


@pytest.mark.anyio("asyncio")
async def test_admin_list_scheduling_aware_window_start(session_factory) -> None:
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        await _seed_block(
            session, key="page.x", published_at=now + timedelta(days=1)
        )
        out = await c.admin_list_scheduling(
            session=session,
            window_days=90,
            window_start=now - timedelta(days=1),  # aware -> astimezone path
            page=1,
            limit=50,
            _=_user(),
        )
    assert out.meta.total_items == 1


# --------------------------- admin_list_redirects -------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_list_redirects_empty(session_factory) -> None:
    async with session_factory() as session:
        out = await c.admin_list_redirects(
            session=session, q=None, page=1, limit=25, _=_user()
        )
    assert out.meta.total_items == 0


@pytest.mark.anyio("asyncio")
async def test_admin_list_redirects_with_data_and_search(session_factory) -> None:
    async with session_factory() as session:
        await _seed_block(session, key="page.target")
        session.add(ContentRedirect(from_key="page.old", to_key="page.target"))
        session.add(ContentRedirect(from_key="page.loopa", to_key="page.loopb"))
        session.add(ContentRedirect(from_key="page.loopb", to_key="page.loopa"))
        await session.commit()
        out = await c.admin_list_redirects(
            session=session, q="old", page=1, limit=25, _=_user()
        )
        assert out.meta.total_items == 1
        assert out.items[0].target_exists is True
        out2 = await c.admin_list_redirects(
            session=session, q=None, page=1, limit=25, _=_user()
        )
        assert out2.meta.total_items == 3
        errors = {i.from_key: i.chain_error for i in out2.items}
        assert errors["page.loopa"] == "loop"


# --------------------------- admin_upsert_redirect ------------------------- #
def _upsert_req(from_key, to_key):
    from app.schemas.content import ContentRedirectUpsertRequest

    return ContentRedirectUpsertRequest(from_key=from_key, to_key=to_key)


@pytest.mark.anyio("asyncio")
async def test_admin_upsert_redirect_invalid(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_upsert_redirect(
                payload=_upsert_req("same", "same"),
                session=session,
                _=_user(),
            )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_upsert_redirect_target_missing(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_upsert_redirect(
                payload=_upsert_req("page.a", "page.nope"),
                session=session,
                _=_user(),
            )
    assert ei.value.status_code == 400
    assert "target" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_upsert_redirect_loop(session_factory) -> None:
    async with session_factory() as session:
        await _seed_block(session, key="page.b")
        session.add(ContentRedirect(from_key="page.b", to_key="page.a"))
        await _seed_block(session, key="page.a")
        await session.commit()
        with pytest.raises(HTTPException) as ei:
            await c.admin_upsert_redirect(
                payload=_upsert_req("page.a", "page.b"),
                session=session,
                _=_user(),
            )
    assert "loop" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_upsert_redirect_too_deep(session_factory) -> None:
    async with session_factory() as session:
        await _seed_block(session, key="page.b")
        prev = "page.b"
        for i in range(60):
            nxt = f"page.deep{i}"
            session.add(ContentRedirect(from_key=prev, to_key=nxt))
            prev = nxt
        await _seed_block(session, key="page.a")
        await session.commit()
        with pytest.raises(HTTPException) as ei:
            await c.admin_upsert_redirect(
                payload=_upsert_req("page.a", "page.b"),
                session=session,
                _=_user(),
            )
    assert "too deep" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_upsert_redirect_create_then_update(session_factory) -> None:
    async with session_factory() as session:
        await _seed_block(session, key="page.t1")
        await _seed_block(session, key="page.t2")
        out = await c.admin_upsert_redirect(
            payload=_upsert_req("page.from", "page.t1"),
            session=session,
            _=_user(),
        )
        assert out.to_key == "page.t1"
        out2 = await c.admin_upsert_redirect(
            payload=_upsert_req("page.from", "page.t2"),
            session=session,
            _=_user(),
        )
        assert out2.to_key == "page.t2"


# --------------------------- admin_export_redirects ------------------------ #
@pytest.mark.anyio("asyncio")
async def test_admin_export_redirects(session_factory) -> None:
    async with session_factory() as session:
        session.add(ContentRedirect(from_key="page.old", to_key="page.new"))
        session.add(ContentRedirect(from_key="plain", to_key="other"))
        await session.commit()
        resp = await c.admin_export_redirects(
            request=SimpleNamespace(),
            session=session,
            q="old",
            admin=_user(),
        )
        assert resp.media_type == "text/csv"
        assert "/pages/old" in resp.body.decode()
        resp2 = await c.admin_export_redirects(
            request=SimpleNamespace(), session=session, q=None, admin=_user()
        )
        assert "plain" in resp2.body.decode()


# --------------------------- admin_import_redirects ------------------------ #
class _UploadFile:
    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


@pytest.mark.anyio("asyncio")
async def test_admin_import_redirects_empty_only_errors(session_factory) -> None:
    # header skipped, blank skipped, comment skipped, "onlyone" -> missing
    # columns, "page.x," -> has 2 cells but to is empty -> missing from/to.
    csv_text = "from,to\n\n# comment\nonlyone\npage.x,\n"
    async with session_factory() as session:
        out = await c.admin_import_redirects(
            file=_UploadFile(csv_text.encode("utf-8-sig")),
            session=session,
            _=_user(),
        )
    assert out.created == 0 and out.updated == 0 and out.skipped == 0
    assert len(out.errors) == 2


@pytest.mark.anyio("asyncio")
async def test_admin_import_redirects_invalid_too_long_same(
    session_factory,
) -> None:
    long_key = "page." + ("x" * 130)
    csv_text = (
        "/pages/ ,page.real\n"
        + f"{long_key},page.real2\n"
        + "page.same,page.same\n"
    )
    async with session_factory() as session:
        out = await c.admin_import_redirects(
            file=_UploadFile(csv_text.encode("utf-8")),
            session=session,
            _=_user(),
        )
    codes = [e.error for e in out.errors]
    assert any("Invalid" in x for x in codes)
    assert any("too long" in x.lower() for x in codes)
    assert any("differ" in x for x in codes)


@pytest.mark.anyio("asyncio")
async def test_admin_import_redirects_loop_detection(session_factory) -> None:
    csv_text = "page.a,page.b\npage.b,page.a\n"
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_import_redirects(
                file=_UploadFile(csv_text.encode("utf-8")),
                session=session,
                _=_user(),
            )
    assert "loop" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_import_redirects_too_deep_detection(session_factory) -> None:
    lines = [f"page.k{i},page.k{i + 1}" for i in range(60)]
    csv_text = "\n".join(lines) + "\n"
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_import_redirects(
                file=_UploadFile(csv_text.encode("utf-8")),
                session=session,
                _=_user(),
            )
    assert "too deep" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_import_redirects_create_update_skip(session_factory) -> None:
    async with session_factory() as session:
        session.add(ContentRedirect(from_key="page.skip", to_key="page.x"))
        session.add(ContentRedirect(from_key="page.upd", to_key="page.old"))
        await session.commit()
        csv_text = (
            "page.skip,page.x\n"
            + "page.upd,page.new\n"
            + "page.new1,page.dest\n"
            + "page.new1,page.dest\n"
        )
        out = await c.admin_import_redirects(
            file=_UploadFile(csv_text.encode("utf-8")),
            session=session,
            _=_user(),
        )
    assert out.created == 1
    assert out.updated == 1
    assert out.skipped == 1


# =========================================================================== #
# Part 3: seo / content CRUD / content image asset handlers
# =========================================================================== #
from app.models.content import ContentImage, ContentImageTag  # noqa: E402


async def _seed_image(session, block, **kw):
    base = dict(
        content_block_id=block.id,
        url="https://cdn/x.png",
        alt_text="alt",
        sort_order=1,
    )
    base.update(kw)
    img = ContentImage(**base)
    session.add(img)
    await session.commit()
    await session.refresh(img)
    return img


# --------------------------- sitemap / structured data --------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_sitemap_preview(monkeypatch) -> None:
    monkeypatch.setattr(
        c.sitemap_service, "build_sitemap_urls", _afn({"en": ["/a"]})
    )
    out = await c.admin_sitemap_preview(session=object(), _=_user())
    assert out.by_lang == {"en": ["/a"]}


@pytest.mark.anyio("asyncio")
async def test_admin_validate_structured_data(monkeypatch) -> None:
    monkeypatch.setattr(
        c.structured_data_service,
        "validate_structured_data",
        _afn(
            {
                "checked_products": 1,
                "checked_pages": 2,
                "errors": 0,
                "warnings": 0,
                "issues": [],
            }
        ),
    )
    out = await c.admin_validate_structured_data(session=object(), _=_user())
    assert out is not None


# --------------------------- admin_delete_redirect ------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_delete_redirect_not_found(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_delete_redirect(
                redirect_id=uuid4(), session=session, _=_user()
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_delete_redirect_ok(session_factory) -> None:
    async with session_factory() as session:
        r = ContentRedirect(from_key="page.a", to_key="page.b")
        session.add(r)
        await session.commit()
        await session.refresh(r)
        resp = await c.admin_delete_redirect(
            redirect_id=r.id, session=session, _=_user()
        )
    assert resp.status_code == 204


# --------------------------- admin_get_content ----------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_get_content_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.admin_get_content(
            key="x", session=object(), lang=None, _=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_get_content_ok(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(_block()))
    out = await c.admin_get_content(
        key="page.about", session=object(), lang="en", _=_user()
    )
    assert out.key == "page.about"


# --------------------------- admin_update_content -------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_update_content(monkeypatch) -> None:
    from app.schemas.content import ContentBlockUpdate

    monkeypatch.setattr(c.content_service, "upsert_block", _afn(_block()))
    out = await c.admin_update_content(
        key="page.about",
        payload=ContentBlockUpdate(),
        session=object(),
        admin=_user(),
    )
    assert out.key == "page.about"


# --------------------------- admin_delete_content -------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_delete_content_not_blog() -> None:
    with pytest.raises(HTTPException) as ei:
        await c.admin_delete_content(
            key="page.about", session=object(), admin=_user()
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_delete_content_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.admin_delete_content(
            key="blog.post", session=object(), admin=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_delete_content_ok(session_factory) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="blog.post")
        resp = await c.admin_delete_content(
            key="blog.post", session=session, admin=_user()
        )
    assert resp.status_code == 204
    assert blk is not None


# --------------------------- admin_create_content -------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_create_content_exists(monkeypatch) -> None:
    from app.schemas.content import ContentBlockCreate

    monkeypatch.setattr(
        c.content_service, "validate_page_key_for_create", lambda k: None
    )
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(_block()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_create_content(
            key="page.new",
            payload=ContentBlockCreate(title="T", body_markdown="b"),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_create_content_ok(monkeypatch) -> None:
    from app.schemas.content import ContentBlockCreate

    monkeypatch.setattr(
        c.content_service, "validate_page_key_for_create", lambda k: None
    )
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    monkeypatch.setattr(c.content_service, "upsert_block", _afn(_block()))
    out = await c.admin_create_content(
        key="page.new",
        payload=ContentBlockCreate(title="T", body_markdown="b"),
        session=object(),
        admin=_user(),
    )
    assert out.key == "page.about"


# --------------------------- admin_upload_content_image -------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_upload_content_image_existing_block(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(_block()))
    monkeypatch.setattr(c.content_service, "add_image", _afn(_block()))
    out = await c.admin_upload_content_image(
        key="page.about",
        file=object(),
        session=object(),
        admin=_user(),
        lang=None,
    )
    assert out.key == "page.about"


@pytest.mark.anyio("asyncio")
async def test_admin_upload_content_image_creates_bucket(monkeypatch) -> None:
    # block missing -> implicit create path
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    monkeypatch.setattr(c.content_service, "upsert_block", _afn(_block()))
    monkeypatch.setattr(c.content_service, "add_image", _afn(_block()))
    out = await c.admin_upload_content_image(
        key="assets.bucket",
        file=object(),
        session=object(),
        admin=_user(),
        lang="en",
    )
    assert out.key == "page.about"


# --------------------------- admin_list_content_images --------------------- #
async def _list_images(session, **kw):
    base = dict(
        session=session,
        key=None,
        q=None,
        tag=None,
        sort="newest",
        created_from=None,
        created_to=None,
        page=1,
        limit=24,
        _=_user(),
    )
    base.update(kw)
    return await c.admin_list_content_images(**base)


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_images_empty(session_factory) -> None:
    async with session_factory() as session:
        out = await _list_images(session)
    assert out.meta.total_items == 0


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_images_filters_and_sorts(
    session_factory,
) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.gallery")
        img1 = await _seed_image(session, blk, url="https://cdn/1.png")
        img2 = await _seed_image(session, blk, url="https://cdn/2.png")
        # two distinct tags exercise the setdefault/append + sorted(set()) paths
        session.add(ContentImageTag(content_image_id=img1.id, tag="hero"))
        session.add(ContentImageTag(content_image_id=img1.id, tag="banner"))
        await session.commit()

        # key filter + q filter + sort variations
        for sort in ("newest", "oldest", "key_asc", "key_desc"):
            out = await _list_images(
                session, key="page.gallery", q="cdn", sort=sort
            )
            assert out.meta.total_items == 2
        # tag filter (join path) + tags surfaced
        out_tag = await _list_images(session, tag="HERO")
        assert out_tag.meta.total_items == 1
        # tag_map surfaces ALL tags for the matched image, sorted+deduped.
        assert out_tag.items[0].tags == ["banner", "hero"]
        assert img2 is not None


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_images_date_filters(session_factory) -> None:
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.g2")
        await _seed_image(session, blk)
        out = await _list_images(
            session,
            created_from=now - timedelta(days=1),
            created_to=now + timedelta(days=1),
        )
    assert out.meta.total_items >= 0


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_images_invalid_date_range(
    session_factory,
) -> None:
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await _list_images(
                session,
                created_from=now + timedelta(days=2),
                created_to=now - timedelta(days=2),
            )
    assert ei.value.status_code == 400


# --------------------------- admin_update_content_image -------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_not_found(session_factory) -> None:
    from app.schemas.content import ContentImageAssetUpdate

    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_update_content_image(
                image_id=uuid4(),
                payload=ContentImageAssetUpdate(alt_text="x"),
                session=session,
                _=_user(),
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_ok(session_factory) -> None:
    from app.schemas.content import ContentImageAssetUpdate

    async with session_factory() as session:
        blk = await _seed_block(session, key="page.imgblk")
        img = await _seed_image(session, blk)
        session.add(ContentImageTag(content_image_id=img.id, tag="t1"))
        await session.commit()
        out = await c.admin_update_content_image(
            image_id=img.id,
            payload=ContentImageAssetUpdate(alt_text="New Alt"),
            session=session,
            _=_user(),
        )
    assert out.alt_text == "New Alt"
    assert out.content_key == "page.imgblk"
    assert out.tags == ["t1"]


@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_blank_alt(session_factory) -> None:
    from app.schemas.content import ContentImageAssetUpdate

    async with session_factory() as session:
        blk = await _seed_block(session, key="page.imgblk2")
        img = await _seed_image(session, blk)
        out = await c.admin_update_content_image(
            image_id=img.id,
            payload=ContentImageAssetUpdate(alt_text="   "),  # blank -> None
            session=session,
            _=_user(),
        )
    assert out.alt_text is None


# =========================================================================== #
# Part 4: image tags / focal / edit / usage / delete
# =========================================================================== #
@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_tags_not_found(session_factory) -> None:
    from app.schemas.content import ContentImageTagsUpdate

    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_update_content_image_tags(
                image_id=uuid4(),
                payload=ContentImageTagsUpdate(tags=["a"]),
                session=session,
                _=_user(),
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_tags_add_and_remove(
    session_factory,
) -> None:
    from app.schemas.content import ContentImageTagsUpdate

    async with session_factory() as session:
        blk = await _seed_block(session, key="page.tagblk")
        img = await _seed_image(session, blk)
        session.add(ContentImageTag(content_image_id=img.id, tag="old"))
        await session.commit()
        # "old" removed, "new" added
        out = await c.admin_update_content_image_tags(
            image_id=img.id,
            payload=ContentImageTagsUpdate(tags=["new"]),
            session=session,
            _=_user(),
        )
    assert out.tags == ["new"]
    assert out.content_key == "page.tagblk"


@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_focal(session_factory) -> None:
    from app.schemas.content import ContentImageFocalPointUpdate

    async with session_factory() as session:
        blk = await _seed_block(session, key="page.focalblk")
        img = await _seed_image(session, blk)
        session.add(ContentImageTag(content_image_id=img.id, tag="z"))
        await session.commit()
        out = await c.admin_update_content_image_focal_point(
            image_id=img.id,
            payload=ContentImageFocalPointUpdate(focal_x=30, focal_y=70),
            session=session,
            _=_user(),
        )
    assert out.focal_x == 30 and out.focal_y == 70
    assert out.tags == ["z"]


@pytest.mark.anyio("asyncio")
async def test_admin_update_content_image_focal_not_found(session_factory) -> None:
    from app.schemas.content import ContentImageFocalPointUpdate

    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_update_content_image_focal_point(
                image_id=uuid4(),
                payload=ContentImageFocalPointUpdate(),
                session=session,
                _=_user(),
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_edit_content_image_not_found(session_factory) -> None:
    from app.schemas.content import ContentImageEditRequest

    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_edit_content_image(
                image_id=uuid4(),
                payload=ContentImageEditRequest(rotate_cw=90),
                session=session,
                admin=_user(),
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_edit_content_image_ok(session_factory, monkeypatch) -> None:
    from app.schemas.content import ContentImageEditRequest

    async with session_factory() as session:
        blk = await _seed_block(session, key="page.editblk")
        img = await _seed_image(session, blk)
        session.add(ContentImageTag(content_image_id=img.id, tag="e"))
        await session.commit()

        async def fake_edit(sess, *, image, payload, actor_id):
            return image  # return same image as the edited result

        monkeypatch.setattr(c.content_service, "edit_image_asset", fake_edit)
        out = await c.admin_edit_content_image(
            image_id=img.id,
            payload=ContentImageEditRequest(rotate_cw=90),
            session=session,
            admin=_user(),
        )
    assert out.content_key == "page.editblk"
    assert out.tags == ["e"]


@pytest.mark.anyio("asyncio")
async def test_admin_get_content_image_usage_not_found(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_get_content_image_usage(
                image_id=uuid4(), session=session, _=_user()
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_get_content_image_usage_ok(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.usageblk")
        img = await _seed_image(session, blk, url="https://cdn/u.png")
        monkeypatch.setattr(
            c.content_service, "get_asset_usage_keys", _afn(["page.usageblk"])
        )
        out = await c.admin_get_content_image_usage(
            image_id=img.id, session=session, _=_user()
        )
    assert out.stored_in_key == "page.usageblk"
    assert out.keys == ["page.usageblk"]


@pytest.mark.anyio("asyncio")
async def test_admin_delete_content_image_not_found(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as ei:
            await c.admin_delete_content_image(
                image_id=uuid4(),
                delete_versions=False,
                session=session,
                admin=_user(),
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_delete_content_image_ok(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.delblk")
        img = await _seed_image(session, blk)
        monkeypatch.setattr(
            c.content_service, "delete_image_asset", _afn(None)
        )
        resp = await c.admin_delete_content_image(
            image_id=img.id,
            delete_versions=True,
            session=session,
            admin=_user(),
        )
    assert resp.status_code == 204


# =========================================================================== #
# Part 5: media DAM asset handlers (media_dam fully mocked)
# =========================================================================== #
from app.models.media import MediaAssetStatus, MediaJobType  # noqa: E402


def _patch_media(monkeypatch, **overrides):
    """Install async/sync stubs onto media_dam; overrides win."""
    defaults = {
        "asset_to_read": lambda row: row,
        "job_to_read": lambda job: job,
        "coerce_visibility": lambda v: v,
        "get_redis": lambda: None,
    }
    for name, fn in defaults.items():
        if name not in overrides:
            monkeypatch.setattr(c.media_dam, name, fn)
    for name, fn in overrides.items():
        monkeypatch.setattr(c.media_dam, name, fn)


# --------------------------- admin_list_media_assets ----------------------- #
async def _list_assets(session=None, **kw):
    base = dict(
        q="",
        tag="",
        asset_type="",
        status_filter="",
        visibility="",
        include_trashed=False,
        created_from=None,
        created_to=None,
        page=1,
        limit=24,
        sort="newest",
        session=session or object(),
        _=_user(),
    )
    base.update(kw)
    return await c.admin_list_media_assets(**base)


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_assets_ok(monkeypatch) -> None:
    # rows empty so items validate trivially; meta is a dict[str, int].
    _patch_media(
        monkeypatch,
        list_assets=_afn(([], {"total_items": 0, "total_pages": 1})),
    )
    out = await _list_assets(
        created_from="2030-01-01T00:00:00", created_to="2030-02-01T00:00:00"
    )
    assert out.items == []
    assert out.meta["total_items"] == 0


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_assets_bad_date(monkeypatch) -> None:
    _patch_media(monkeypatch)
    with pytest.raises(HTTPException) as ei:
        await _list_assets(created_from="not-a-date")
    assert ei.value.status_code == 400
    assert "filters" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_assets_bad_range(monkeypatch) -> None:
    _patch_media(monkeypatch)
    with pytest.raises(HTTPException) as ei:
        await _list_assets(
            created_from="2030-02-01T00:00:00", created_to="2030-01-01T00:00:00"
        )
    assert ei.value.status_code == 400
    assert "range" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_assets_value_error(monkeypatch) -> None:
    _patch_media(monkeypatch, list_assets=_araise(ValueError("bad sort")))
    with pytest.raises(HTTPException) as ei:
        await _list_assets()
    assert ei.value.status_code == 400


# --------------------------- admin_upload_media_asset ---------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_upload_media_asset_no_job(monkeypatch) -> None:
    result = SimpleNamespace(asset="A", ingest_job_id=None)
    _patch_media(monkeypatch, create_asset_from_upload=_afn(result))
    out = await c.admin_upload_media_asset(
        file=object(),
        visibility="private",
        auto_finalize=True,
        session=object(),
        admin=_user(),
    )
    assert out == "A"


@pytest.mark.anyio("asyncio")
async def test_admin_upload_media_asset_auto_finalize(monkeypatch) -> None:
    result = SimpleNamespace(asset=SimpleNamespace(id=uuid4()), ingest_job_id=uuid4())
    _patch_media(
        monkeypatch,
        create_asset_from_upload=_afn(result),
        get_job_or_404=_afn("job"),
        process_job_inline=_afn(None),
        get_asset_or_404=_afn("finalized"),
        asset_to_read=lambda a: a,
    )
    out = await c.admin_upload_media_asset(
        file=object(),
        visibility="private",
        auto_finalize=True,
        session=object(),
        admin=_user(),
    )
    assert out == "finalized"


@pytest.mark.anyio("asyncio")
async def test_admin_upload_media_asset_finalize_value_error(monkeypatch) -> None:
    asset = SimpleNamespace(id=uuid4())
    result = SimpleNamespace(asset=asset, ingest_job_id=uuid4())
    _patch_media(
        monkeypatch,
        create_asset_from_upload=_afn(result),
        get_job_or_404=_araise(ValueError("nope")),
    )
    out = await c.admin_upload_media_asset(
        file=object(),
        visibility="private",
        auto_finalize=True,
        session=object(),
        admin=_user(),
    )
    assert out is asset  # falls through to return result.asset


# --------------------------- admin_finalize_media_asset -------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_finalize_media_asset_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaFinalizeRequest

    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_finalize_media_asset(
            asset_id=uuid4(),
            payload=MediaFinalizeRequest(),
            background_tasks=SimpleNamespace(add_task=lambda *a, **k: None),
            session=SimpleNamespace(commit=_afn(None)),
            admin=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_finalize_media_asset_all_jobs(monkeypatch) -> None:
    from app.schemas.media import MediaFinalizeRequest

    queued = []
    job = SimpleNamespace(id=uuid4())
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        enqueue_job=_afn(job),
        queue_job=_afn(None),
        get_redis=lambda: None,  # triggers background task path
        job_to_read=lambda j: j,
    )
    bt = SimpleNamespace(add_task=lambda *a, **k: queued.append(a))
    out = await c.admin_finalize_media_asset(
        asset_id=uuid4(),
        payload=MediaFinalizeRequest(run_ai_tagging=True, run_duplicate_scan=True),
        background_tasks=bt,
        session=SimpleNamespace(commit=_afn(None)),
        admin=_user(),
    )
    assert out is job
    assert queued  # background task scheduled


@pytest.mark.anyio("asyncio")
async def test_admin_finalize_media_asset_with_redis(monkeypatch) -> None:
    from app.schemas.media import MediaFinalizeRequest

    job = SimpleNamespace(id=uuid4())
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        enqueue_job=_afn(job),
        queue_job=_afn(None),
        get_redis=lambda: object(),  # redis present -> no background task
        job_to_read=lambda j: j,
    )
    bt = SimpleNamespace(add_task=lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    out = await c.admin_finalize_media_asset(
        asset_id=uuid4(),
        payload=MediaFinalizeRequest(run_ai_tagging=False, run_duplicate_scan=False),
        background_tasks=bt,
        session=SimpleNamespace(commit=_afn(None)),
        admin=_user(),
    )
    assert out is job


# --------------------------- _run_media_job_in_background ------------------ #
class _BgSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.mark.anyio("asyncio")
async def test_run_media_job_in_background_ok(monkeypatch) -> None:
    import app.db.session as dbsession

    monkeypatch.setattr(dbsession, "SessionLocal", lambda: _BgSession())
    _patch_media(
        monkeypatch,
        get_job_or_404=_afn("job"),
        process_job_inline=_afn(None),
    )
    await c._run_media_job_in_background(uuid4())


@pytest.mark.anyio("asyncio")
async def test_run_media_job_in_background_error(monkeypatch) -> None:
    import app.db.session as dbsession

    monkeypatch.setattr(dbsession, "SessionLocal", lambda: _BgSession())
    _patch_media(monkeypatch, get_job_or_404=_araise(RuntimeError("boom")))
    # Exception is swallowed/logged -> returns None without raising.
    await c._run_media_job_in_background(uuid4())


# --------------------------- update / approve / reject / delete ------------ #
@pytest.mark.anyio("asyncio")
async def test_admin_update_media_asset(monkeypatch) -> None:
    from app.schemas.media import MediaAssetUpdateRequest

    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        apply_asset_update=_afn(None),
        asset_to_read=lambda a: a,
    )
    out = await c.admin_update_media_asset(
        asset_id=uuid4(),
        payload=MediaAssetUpdateRequest(),
        session=SimpleNamespace(commit=_afn(None)),
        _=_user(),
    )
    assert out == "asset"


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_asset_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaAssetUpdateRequest

    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_update_media_asset(
            asset_id=uuid4(),
            payload=MediaAssetUpdateRequest(),
            session=object(),
            _=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_approve_media_asset(monkeypatch) -> None:
    from app.schemas.media import MediaApproveRequest

    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        change_status=_afn("approved"),
        asset_to_read=lambda a: a,
    )
    out = await c.admin_approve_media_asset(
        asset_id=uuid4(),
        payload=MediaApproveRequest(note="ok"),
        session=object(),
        admin=_user(),
    )
    assert out == "approved"


@pytest.mark.anyio("asyncio")
async def test_admin_approve_media_asset_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaApproveRequest

    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_approve_media_asset(
            asset_id=uuid4(),
            payload=MediaApproveRequest(),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_reject_media_asset(monkeypatch) -> None:
    from app.schemas.media import MediaRejectRequest

    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        change_status=_afn("rejected"),
        asset_to_read=lambda a: a,
    )
    out = await c.admin_reject_media_asset(
        asset_id=uuid4(),
        payload=MediaRejectRequest(note="no"),
        session=object(),
        admin=_user(),
    )
    assert out == "rejected"


@pytest.mark.anyio("asyncio")
async def test_admin_reject_media_asset_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaRejectRequest

    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_reject_media_asset(
            asset_id=uuid4(),
            payload=MediaRejectRequest(),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_soft_delete_media_asset(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        soft_delete_asset=_afn(None),
    )
    resp = await c.admin_soft_delete_media_asset(
        asset_id=uuid4(), session=object(), admin=_user()
    )
    assert resp.status_code == 204


@pytest.mark.anyio("asyncio")
async def test_admin_soft_delete_media_asset_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_soft_delete_media_asset(
            asset_id=uuid4(), session=object(), admin=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_restore_media_asset(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        restore_asset=_afn("restored"),
        asset_to_read=lambda a: a,
    )
    out = await c.admin_restore_media_asset(
        asset_id=uuid4(), session=object(), admin=_user()
    )
    assert out == "restored"


@pytest.mark.anyio("asyncio")
async def test_admin_restore_media_asset_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_restore_media_asset(
            asset_id=uuid4(), session=object(), admin=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_purge_media_asset(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        purge_asset=_afn(None),
    )
    resp = await c.admin_purge_media_asset(
        asset_id=uuid4(), session=object(), admin=_user()
    )
    assert resp.status_code == 204


@pytest.mark.anyio("asyncio")
async def test_admin_purge_media_asset_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_purge_media_asset(
            asset_id=uuid4(), session=object(), admin=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_usage(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        rebuild_usage_edges=_afn("usage"),
    )
    out = await c.admin_media_asset_usage(
        asset_id=uuid4(), session=object(), _=_user()
    )
    assert out == "usage"


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_usage_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_usage(
            asset_id=uuid4(), session=object(), _=_user()
        )
    assert ei.value.status_code == 404


# --------------------------- admin_media_asset_preview --------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_preview_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_preview(
            asset_id=uuid4(),
            exp=1,
            sig="x" * 16,
            variant_profile=None,
            session=object(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_preview_bad_sig(monkeypatch) -> None:
    asset = SimpleNamespace(id=uuid4())
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn(asset),
        verify_preview_signature=lambda *a, **k: False,
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_preview(
            asset_id=asset.id,
            exp=1,
            sig="x" * 16,
            variant_profile=None,
            session=object(),
        )
    assert ei.value.status_code == 403


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_preview_variant_not_found(monkeypatch) -> None:
    asset = SimpleNamespace(id=uuid4())

    def _resolve(*a, **k):
        raise ValueError("no variant")

    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn(asset),
        verify_preview_signature=lambda *a, **k: True,
        resolve_asset_preview_path=_resolve,
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_preview(
            asset_id=asset.id,
            exp=1,
            sig="x" * 16,
            variant_profile="web",
            session=object(),
        )
    assert ei.value.status_code == 404
    assert "Variant" in ei.value.detail


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_preview_file_missing(monkeypatch) -> None:
    asset = SimpleNamespace(id=uuid4())

    def _resolve(*a, **k):
        raise FileNotFoundError()

    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn(asset),
        verify_preview_signature=lambda *a, **k: True,
        resolve_asset_preview_path=_resolve,
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_preview(
            asset_id=asset.id,
            exp=1,
            sig="x" * 16,
            variant_profile=None,
            session=object(),
        )
    assert ei.value.status_code == 404
    assert "missing" in ei.value.detail.lower()


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_preview_ok(monkeypatch, tmp_path) -> None:
    asset = SimpleNamespace(id=uuid4())
    f = tmp_path / "img.png"
    f.write_bytes(b"data")
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn(asset),
        verify_preview_signature=lambda *a, **k: True,
        resolve_asset_preview_path=lambda *a, **k: str(f),
    )
    resp = await c.admin_media_asset_preview(
        asset_id=asset.id,
        exp=1,
        sig="x" * 16,
        variant_profile=None,
        session=object(),
    )
    assert resp.headers["Cache-Control"] == "private, no-store"


# --------------------------- variants / edit ------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_variants(monkeypatch) -> None:
    from app.schemas.media import MediaVariantRequest

    job = SimpleNamespace(id=uuid4())
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        enqueue_job=_afn(job),
        process_job_inline=_afn(None),
        job_to_read=lambda j: j,
    )
    out = await c.admin_media_asset_variants(
        asset_id=uuid4(),
        payload=MediaVariantRequest(profile="web-640"),
        session=SimpleNamespace(commit=_afn(None)),
        admin=_user(),
    )
    assert out is job


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_variants_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaVariantRequest

    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_variants(
            asset_id=uuid4(),
            payload=MediaVariantRequest(),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_edit(monkeypatch) -> None:
    from app.schemas.media import MediaEditRequest

    job = SimpleNamespace(id=uuid4())
    _patch_media(
        monkeypatch,
        get_asset_or_404=_afn("asset"),
        enqueue_job=_afn(job),
        process_job_inline=_afn(None),
        job_to_read=lambda j: j,
    )
    out = await c.admin_media_asset_edit(
        asset_id=uuid4(),
        payload=MediaEditRequest(rotate_cw=90),
        session=SimpleNamespace(commit=_afn(None)),
        admin=_user(),
    )
    assert out is job


@pytest.mark.anyio("asyncio")
async def test_admin_media_asset_edit_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaEditRequest

    _patch_media(monkeypatch, get_asset_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_asset_edit(
            asset_id=uuid4(),
            payload=MediaEditRequest(rotate_cw=90),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 404


# =========================================================================== #
# Part 6: media jobs / retry-policies / collections / tools / pages / versions
# =========================================================================== #
from app.models.content import ContentAuditLog, ContentBlockVersion  # noqa: E402


# --------------------------- admin_list_media_jobs ------------------------- #
async def _list_jobs(session=None, **kw):
    base = dict(
        page=1,
        limit=24,
        status_filter="",
        job_type="",
        asset_id=None,
        triage_state="",
        assigned_to_user_id=None,
        tag="",
        sla_breached=False,
        dead_letter_only=False,
        created_from=None,
        created_to=None,
        session=session or object(),
        _=_user(),
    )
    base.update(kw)
    return await c.admin_list_media_jobs(**base)


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_jobs_ok(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        list_jobs=_afn(([], {"total_items": 0, "total_pages": 1})),
    )
    out = await _list_jobs(
        created_from="2030-01-01T00:00:00", created_to="2030-02-01T00:00:00"
    )
    assert out.items == []


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_jobs_bad_date(monkeypatch) -> None:
    _patch_media(monkeypatch)
    with pytest.raises(HTTPException) as ei:
        await _list_jobs(created_from="bad")
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_jobs_bad_range(monkeypatch) -> None:
    _patch_media(monkeypatch)
    with pytest.raises(HTTPException) as ei:
        await _list_jobs(
            created_from="2030-02-01T00:00:00", created_to="2030-01-01T00:00:00"
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_jobs_value_error(monkeypatch) -> None:
    _patch_media(monkeypatch, list_jobs=_araise(ValueError("bad")))
    with pytest.raises(HTTPException) as ei:
        await _list_jobs()
    assert ei.value.status_code == 400


# --------------------------- telemetry / retry-policies -------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_media_telemetry(monkeypatch) -> None:
    _patch_media(monkeypatch, get_telemetry=_afn("telemetry"))
    assert await c.admin_media_telemetry(session=object(), _=_user()) == "telemetry"


@pytest.mark.anyio("asyncio")
async def test_admin_media_retry_policies(monkeypatch) -> None:
    _patch_media(monkeypatch, list_retry_policies=_afn([]))
    out = await c.admin_media_retry_policies(session=object(), _=_user())
    assert out.items == []


@pytest.mark.anyio("asyncio")
async def test_admin_media_retry_policy_history_ok(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        list_retry_policy_history=_afn(([], {"total_items": 0, "total_pages": 1})),
    )
    out = await c.admin_media_retry_policy_history(
        job_type=None, page=1, limit=20, session=object(), _=_user()
    )
    assert out.items == []


@pytest.mark.anyio("asyncio")
async def test_admin_media_retry_policy_history_value_error(monkeypatch) -> None:
    _patch_media(
        monkeypatch, list_retry_policy_history=_araise(ValueError("bad"))
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_retry_policy_history(
            job_type="x", page=1, limit=20, session=object(), _=_user()
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_media_retry_policy_presets_ok(monkeypatch) -> None:
    _patch_media(monkeypatch, get_retry_policy_presets=_afn("presets"))
    out = await c.admin_media_retry_policy_presets(
        job_type="ingest", session=object(), _=_user()
    )
    assert out == "presets"


@pytest.mark.anyio("asyncio")
async def test_admin_media_retry_policy_presets_value_error(monkeypatch) -> None:
    _patch_media(monkeypatch, get_retry_policy_presets=_araise(ValueError("bad")))
    with pytest.raises(HTTPException) as ei:
        await c.admin_media_retry_policy_presets(
            job_type="x", session=object(), _=_user()
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_retry_policy_ok(monkeypatch) -> None:
    from app.schemas.media import MediaRetryPolicyUpdateRequest

    _patch_media(monkeypatch, upsert_retry_policy=_afn("policy"))
    out = await c.admin_update_media_retry_policy(
        job_type="ingest",
        payload=MediaRetryPolicyUpdateRequest(),
        session=object(),
        admin=_user(),
    )
    assert out == "policy"


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_retry_policy_value_error(monkeypatch) -> None:
    from app.schemas.media import MediaRetryPolicyUpdateRequest

    _patch_media(monkeypatch, upsert_retry_policy=_araise(ValueError("bad")))
    with pytest.raises(HTTPException) as ei:
        await c.admin_update_media_retry_policy(
            job_type="x",
            payload=MediaRetryPolicyUpdateRequest(),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_rollback_media_retry_policy_ok(monkeypatch) -> None:
    from app.schemas.media import MediaRetryPolicyRollbackRequest

    _patch_media(monkeypatch, rollback_retry_policy=_afn("rolled"))
    out = await c.admin_rollback_media_retry_policy(
        job_type="ingest",
        payload=MediaRetryPolicyRollbackRequest(event_id=uuid4()),
        session=object(),
        admin=_user(),
    )
    assert out == "rolled"


@pytest.mark.anyio("asyncio")
async def test_admin_rollback_media_retry_policy_value_error(monkeypatch) -> None:
    from app.schemas.media import MediaRetryPolicyRollbackRequest

    _patch_media(monkeypatch, rollback_retry_policy=_araise(ValueError("bad")))
    with pytest.raises(HTTPException) as ei:
        await c.admin_rollback_media_retry_policy(
            job_type="x",
            payload=MediaRetryPolicyRollbackRequest(event_id=uuid4()),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_mark_media_retry_policy_known_good_ok(monkeypatch) -> None:
    _patch_media(monkeypatch, mark_retry_policy_known_good=_afn("event"))
    out = await c.admin_mark_media_retry_policy_known_good(
        job_type="ingest", note="ok", session=object(), admin=_user()
    )
    assert out == "event"


@pytest.mark.anyio("asyncio")
async def test_admin_mark_media_retry_policy_known_good_value_error(
    monkeypatch,
) -> None:
    _patch_media(
        monkeypatch, mark_retry_policy_known_good=_araise(ValueError("bad"))
    )
    with pytest.raises(HTTPException) as ei:
        await c.admin_mark_media_retry_policy_known_good(
            job_type="x", note=None, session=object(), admin=_user()
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_reset_media_retry_policy_ok(monkeypatch) -> None:
    _patch_media(monkeypatch, reset_retry_policy=_afn("reset"))
    out = await c.admin_reset_media_retry_policy(
        job_type="ingest", session=object(), admin=_user()
    )
    assert out == "reset"


@pytest.mark.anyio("asyncio")
async def test_admin_reset_media_retry_policy_value_error(monkeypatch) -> None:
    _patch_media(monkeypatch, reset_retry_policy=_araise(ValueError("bad")))
    with pytest.raises(HTTPException) as ei:
        await c.admin_reset_media_retry_policy(
            job_type="x", session=object(), admin=_user()
        )
    assert ei.value.status_code == 400


@pytest.mark.anyio("asyncio")
async def test_admin_reset_all_media_retry_policies(monkeypatch) -> None:
    _patch_media(monkeypatch, reset_all_retry_policies=_afn([]))
    out = await c.admin_reset_all_media_retry_policies(
        session=object(), admin=_user()
    )
    assert out.items == []


# --------------------------- usage reconcile ------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_media_usage_reconcile_background(monkeypatch) -> None:
    job = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(
        c.settings, "media_usage_reconcile_batch_size", 0, raising=False
    )
    queued = []
    _patch_media(
        monkeypatch,
        enqueue_job=_afn(job),
        queue_job=_afn(None),
        get_redis=lambda: None,
        job_to_read=lambda j: j,
    )
    bt = SimpleNamespace(add_task=lambda *a, **k: queued.append(a))
    out = await c.admin_media_usage_reconcile(
        background_tasks=bt,
        session=SimpleNamespace(commit=_afn(None)),
        admin=_user(),
    )
    assert out is job
    assert queued


@pytest.mark.anyio("asyncio")
async def test_admin_media_usage_reconcile_redis(monkeypatch) -> None:
    job = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(
        c.settings, "media_usage_reconcile_batch_size", 100, raising=False
    )
    _patch_media(
        monkeypatch,
        enqueue_job=_afn(job),
        queue_job=_afn(None),
        get_redis=lambda: object(),
        job_to_read=lambda j: j,
    )
    bt = SimpleNamespace(
        add_task=lambda *a, **k: (_ for _ in ()).throw(AssertionError)
    )
    out = await c.admin_media_usage_reconcile(
        background_tasks=bt,
        session=SimpleNamespace(commit=_afn(None)),
        admin=_user(),
    )
    assert out is job


# --------------------------- jobs: get / retry / bulk / triage / events ---- #
@pytest.mark.anyio("asyncio")
async def test_admin_get_media_job_ok(monkeypatch) -> None:
    _patch_media(
        monkeypatch, get_job_or_404=_afn("job"), job_to_read=lambda j: j
    )
    out = await c.admin_get_media_job(job_id=uuid4(), session=object(), _=_user())
    assert out == "job"


@pytest.mark.anyio("asyncio")
async def test_admin_get_media_job_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_job_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_get_media_job(job_id=uuid4(), session=object(), _=_user())
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_retry_media_job_ok(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        get_job_or_404=_afn("job"),
        manual_retry_job=_afn("retried"),
        job_to_read=lambda j: j,
    )
    out = await c.admin_retry_media_job(
        job_id=uuid4(), session=object(), admin=_user()
    )
    assert out == "retried"


@pytest.mark.anyio("asyncio")
async def test_admin_retry_media_job_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_job_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_retry_media_job(
            job_id=uuid4(), session=object(), admin=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_retry_media_jobs_bulk(monkeypatch) -> None:
    from app.schemas.media import MediaJobRetryBulkRequest

    # empty rows keep MediaJobListResponse.items validation trivial while still
    # exercising the comprehension + meta construction.
    _patch_media(
        monkeypatch,
        bulk_retry_jobs=_afn([]),
        job_to_read=lambda j: j,
    )
    out = await c.admin_retry_media_jobs_bulk(
        payload=MediaJobRetryBulkRequest(job_ids=[uuid4(), uuid4()]),
        session=object(),
        admin=_user(),
    )
    assert out.items == []
    assert out.meta["total_items"] == 0


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_job_triage_ok(monkeypatch) -> None:
    from app.schemas.media import MediaJobTriageUpdateRequest

    _patch_media(
        monkeypatch,
        get_job_or_404=_afn("job"),
        update_job_triage=_afn("updated"),
        job_to_read=lambda j: j,
    )
    out = await c.admin_update_media_job_triage(
        job_id=uuid4(),
        payload=MediaJobTriageUpdateRequest(),
        session=object(),
        admin=_user(),
    )
    assert out == "updated"


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_job_triage_not_found(monkeypatch) -> None:
    from app.schemas.media import MediaJobTriageUpdateRequest

    _patch_media(monkeypatch, get_job_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_update_media_job_triage(
            job_id=uuid4(),
            payload=MediaJobTriageUpdateRequest(),
            session=object(),
            admin=_user(),
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_job_events_ok(monkeypatch) -> None:
    _patch_media(
        monkeypatch,
        get_job_or_404=_afn("job"),
        list_job_events=_afn([]),
        job_event_to_read=lambda r: r,
    )
    out = await c.admin_list_media_job_events(
        job_id=uuid4(), limit=200, session=object(), _=_user()
    )
    assert out.items == []


@pytest.mark.anyio("asyncio")
async def test_admin_list_media_job_events_not_found(monkeypatch) -> None:
    _patch_media(monkeypatch, get_job_or_404=_araise(ValueError()))
    with pytest.raises(HTTPException) as ei:
        await c.admin_list_media_job_events(
            job_id=uuid4(), limit=200, session=object(), _=_user()
        )
    assert ei.value.status_code == 404


# --------------------------- collections ----------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_list_media_collections(monkeypatch) -> None:
    _patch_media(monkeypatch, list_collections=_afn(["col"]))
    out = await c.admin_list_media_collections(session=object(), _=_user())
    assert out == ["col"]


@pytest.mark.anyio("asyncio")
async def test_admin_create_media_collection(monkeypatch) -> None:
    from app.schemas.media import MediaCollectionUpsertRequest

    _patch_media(monkeypatch, upsert_collection=_afn("created"))
    out = await c.admin_create_media_collection(
        payload=MediaCollectionUpsertRequest(name="n", slug="s"),
        session=object(),
        admin=_user(),
    )
    assert out == "created"


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_collection(monkeypatch) -> None:
    from app.schemas.media import MediaCollectionUpsertRequest

    _patch_media(monkeypatch, upsert_collection=_afn("updated"))
    out = await c.admin_update_media_collection(
        collection_id=uuid4(),
        payload=MediaCollectionUpsertRequest(name="n", slug="s"),
        session=object(),
        admin=_user(),
    )
    assert out == "updated"


@pytest.mark.anyio("asyncio")
async def test_admin_update_media_collection_items(monkeypatch) -> None:
    from app.schemas.media import MediaCollectionItemsRequest

    _patch_media(monkeypatch, replace_collection_items=_afn(None))
    resp = await c.admin_update_media_collection_items(
        collection_id=uuid4(),
        payload=MediaCollectionItemsRequest(asset_ids=[uuid4()]),
        session=object(),
        _=_user(),
    )
    assert resp.status_code == 204


# --------------------------- tools: link-check / find-replace -------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_link_check(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "check_content_links", _afn([]))
    out = await c.admin_link_check(key="page.x", session=object(), _=_user())
    assert out.issues == []


@pytest.mark.anyio("asyncio")
async def test_admin_link_check_preview(monkeypatch) -> None:
    from app.schemas.content import ContentLinkCheckPreviewRequest

    monkeypatch.setattr(
        c.content_service, "check_content_links_preview", _afn([])
    )
    out = await c.admin_link_check_preview(
        payload=ContentLinkCheckPreviewRequest(key="page.x"),
        session=object(),
        _=_user(),
    )
    assert out.issues == []


@pytest.mark.anyio("asyncio")
async def test_admin_find_replace_preview(monkeypatch) -> None:
    from app.schemas.content import ContentFindReplacePreviewRequest

    monkeypatch.setattr(
        c.content_service, "preview_find_replace", _afn(([], 0, 0, False))
    )
    out = await c.admin_find_replace_preview(
        payload=ContentFindReplacePreviewRequest(find="x", replace="y"),
        session=object(),
        _=_user(),
    )
    assert out.total_items == 0


@pytest.mark.anyio("asyncio")
async def test_admin_find_replace_apply(monkeypatch) -> None:
    from app.schemas.content import ContentFindReplaceApplyRequest

    monkeypatch.setattr(
        c.content_service, "apply_find_replace", _afn((1, 2, 3, []))
    )
    out = await c.admin_find_replace_apply(
        payload=ContentFindReplaceApplyRequest(find="x", replace="y"),
        session=object(),
        admin=_user(),
    )
    assert out.updated_blocks == 1
    assert out.total_replacements == 3


# --------------------------- pages: list / rename / translation-status ----- #
@pytest.mark.anyio("asyncio")
async def test_admin_list_pages(session_factory) -> None:
    async with session_factory() as session:
        await _seed_block(session, key="page.alpha", meta={"hidden": True})
        await _seed_block(session, key="page.beta", meta=None)
        out = await c.admin_list_pages(session=session, _=_user())
    keys = {p.key for p in out}
    assert keys == {"page.alpha", "page.beta"}
    hidden = {p.key: p.hidden for p in out}
    assert hidden["page.alpha"] is True
    assert hidden["page.beta"] is False


@pytest.mark.anyio("asyncio")
async def test_admin_update_translation_status(monkeypatch) -> None:
    from app.schemas.content import ContentTranslationStatusUpdate

    monkeypatch.setattr(
        c.content_service, "set_translation_status", _afn(_block())
    )
    out = await c.admin_update_translation_status(
        key="page.x",
        payload=ContentTranslationStatusUpdate(needs_translation_en=True),
        session=object(),
        admin=_user(),
    )
    assert out.key == "page.about"


@pytest.mark.anyio("asyncio")
async def test_admin_rename_page(monkeypatch) -> None:
    from app.schemas.content import ContentPageRenameRequest

    monkeypatch.setattr(
        c.content_service,
        "rename_page_slug",
        _afn(("old", "new", "page.old", "page.new")),
    )
    out = await c.admin_rename_page(
        slug="old",
        payload=ContentPageRenameRequest(new_slug="new"),
        session=object(),
        admin=_user(),
    )
    assert out.new_key == "page.new"


# --------------------------- admin_preview_content ------------------------- #
@pytest.mark.anyio("asyncio")
async def test_admin_preview_content_bad_token(monkeypatch) -> None:
    monkeypatch.setattr(c.settings, "content_preview_token", "secret", False)
    with pytest.raises(HTTPException) as ei:
        await c.admin_preview_content(
            key="page.x", token="wrong", session=object(), lang=None
        )
    assert ei.value.status_code == 403


@pytest.mark.anyio("asyncio")
async def test_admin_preview_content_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.settings, "content_preview_token", "secret", False)
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.admin_preview_content(
            key="page.x", token="secret", session=object(), lang=None
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_preview_content_ok(monkeypatch) -> None:
    monkeypatch.setattr(c.settings, "content_preview_token", "secret", False)
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(_block()))
    out = await c.admin_preview_content(
        key="page.about", token="secret", session=object(), lang="en"
    )
    assert out.key == "page.about"


# --------------------------- audit / versions ------------------------------ #
@pytest.mark.anyio("asyncio")
async def test_admin_list_content_audit_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.admin_list_content_audit(
            key="page.x", session=object(), _=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_audit_ok(monkeypatch) -> None:
    # The handler serialises block.audits directly; supply a block whose audit
    # collection is already materialised (ContentAuditRead is from_attributes).
    audit = SimpleNamespace(
        id=uuid4(),
        action="update",
        version=1,
        user_id=None,
        created_at=datetime.now(timezone.utc),
    )
    blk = _block(key="page.audited")
    blk.audits = [audit]
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
    out = await c.admin_list_content_audit(
        key="page.audited", session=object(), _=_user()
    )
    assert len(out) == 1
    assert out[0].action == "update"


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_versions_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.admin_list_content_versions(
            key="page.x", session=object(), _=_user()
        )
    assert ei.value.status_code == 404


async def _seed_version(session, block, version=1):
    v = ContentBlockVersion(
        content_block_id=block.id,
        version=version,
        title="t",
        body_markdown="b",
        status=ContentStatus.published,
    )
    session.add(v)
    await session.commit()
    await session.refresh(v)
    return v


@pytest.mark.anyio("asyncio")
async def test_admin_list_content_versions_ok(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.versioned")
        await _seed_version(session, blk, version=1)
        await _seed_version(session, blk, version=2)
        monkeypatch.setattr(
            c.content_service, "get_block_by_key", _afn(blk)
        )
        out = await c.admin_list_content_versions(
            key="page.versioned", session=session, _=_user()
        )
    assert [v.version for v in out] == [2, 1]


@pytest.mark.anyio("asyncio")
async def test_admin_get_content_version_block_not_found(monkeypatch) -> None:
    monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(None))
    with pytest.raises(HTTPException) as ei:
        await c.admin_get_content_version(
            key="page.x", version=1, session=object(), _=_user()
        )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_get_content_version_version_not_found(
    session_factory, monkeypatch
) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.v2")
        monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
        with pytest.raises(HTTPException) as ei:
            await c.admin_get_content_version(
                key="page.v2", version=99, session=session, _=_user()
            )
    assert ei.value.status_code == 404


@pytest.mark.anyio("asyncio")
async def test_admin_get_content_version_ok(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        blk = await _seed_block(session, key="page.v3")
        await _seed_version(session, blk, version=5)
        monkeypatch.setattr(c.content_service, "get_block_by_key", _afn(blk))
        out = await c.admin_get_content_version(
            key="page.v3", version=5, session=session, _=_user()
        )
    assert out.version == 5


@pytest.mark.anyio("asyncio")
async def test_admin_rollback_content_version(monkeypatch) -> None:
    monkeypatch.setattr(
        c.content_service, "rollback_to_version", _afn(_block())
    )
    out = await c.admin_rollback_content_version(
        key="page.x", version=1, session=object(), admin=_user()
    )
    assert out.key == "page.about"
