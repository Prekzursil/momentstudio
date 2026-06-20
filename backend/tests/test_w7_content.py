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
