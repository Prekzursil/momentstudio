"""Targeted coverage tests for app.services.content (coverage worker 4).

Self-contained: this file alone drives ``app.services.content`` toward 100%
line + branch coverage. Pure helpers are exercised directly; async DB functions
run against an in-memory SQLite session; image-editing uses ``tmp_path`` with a
monkeypatched media root and stubbed thumbnail generation.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.catalog import Category, Product, ProductStatus
from app.models.content import (
    ContentBlock,
    ContentBlockTranslation,
    ContentBlockVersion,
    ContentImage,
    ContentImageTag,
    ContentRedirect,
    ContentStatus,
)
from app.schemas.content import (
    ContentBlockCreate,
    ContentBlockUpdate,
    ContentImageEditRequest,
    ContentTranslationStatusUpdate,
)
from app.services import content as svc
from app.services import storage

pytestmark = pytest.mark.anyio


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture
def factory() -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    sf = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        import app.models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return sf


@pytest.fixture
def naive_now(monkeypatch):
    """SQLite returns naive datetimes for ``DateTime(timezone=True)`` columns, so
    make the service read ``now`` as UTC-naive too. This only changes the tzinfo
    representation to match the test DB; the branch logic is exercised unchanged.
    """

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(timezone.utc).replace(tzinfo=None)

    monkeypatch.setattr(svc, "datetime", _DT)


async def _add_block(factory, **fields) -> ContentBlock:
    async with factory() as session:
        block = ContentBlock(
            key=fields.pop("key", "page.test"),
            title=fields.pop("title", "Title"),
            body_markdown=fields.pop("body_markdown", "Body"),
            status=fields.pop("status", ContentStatus.draft),
            version=fields.pop("version", 1),
            **fields,
        )
        session.add(block)
        await session.commit()
        await session.refresh(block)
        return block


# --------------------------------------------------------------------------- #
# Pure helpers
# --------------------------------------------------------------------------- #


def test_present_langs_for_bilingual():
    block = ContentBlock(
        key="k", title="T", body_markdown="B", lang="en", status=ContentStatus.draft
    )
    block.translations = [
        ContentBlockTranslation(lang="ro", title="Ro", body_markdown="Corp"),
        ContentBlockTranslation(lang="de", title="", body_markdown=""),  # filtered
    ]
    present = svc._present_langs_for_bilingual(block)
    assert present == {"en", "ro"}


def test_present_langs_no_base():
    block = ContentBlock(key="k", title="", body_markdown="", lang="en")
    block.translations = []
    assert svc._present_langs_for_bilingual(block) == set()


def test_enforce_legal_pages_not_legal():
    block = ContentBlock(key="x", title="T", body_markdown="B", lang="en")
    svc._enforce_legal_pages_bilingual("page.about", block)  # no raise


def test_enforce_legal_pages_not_published():
    block = ContentBlock(
        key="page.terms", title="T", body_markdown="B", status=ContentStatus.draft
    )
    svc._enforce_legal_pages_bilingual("page.terms", block)  # no raise


def test_enforce_legal_pages_no_base_lang():
    block = ContentBlock(
        key="page.terms",
        title="T",
        body_markdown="B",
        status=ContentStatus.published,
        lang=None,
    )
    with pytest.raises(HTTPException) as exc:
        svc._enforce_legal_pages_bilingual("page.terms", block)
    assert "base language" in exc.value.detail


def test_enforce_legal_pages_missing_lang():
    block = ContentBlock(
        key="page.terms",
        title="T",
        body_markdown="B",
        status=ContentStatus.published,
        lang="en",
    )
    block.translations = []
    with pytest.raises(HTTPException) as exc:
        svc._enforce_legal_pages_bilingual("page.terms", block)
    assert "missing: ro" in exc.value.detail


def test_enforce_legal_pages_ok():
    block = ContentBlock(
        key="page.terms",
        title="T",
        body_markdown="B",
        status=ContentStatus.published,
        lang="en",
    )
    block.translations = [
        ContentBlockTranslation(lang="ro", title="Ro", body_markdown="Corp")
    ]
    svc._enforce_legal_pages_bilingual("page.terms", block)  # no raise


def test_clear_and_mark_needs_translation():
    block = ContentBlock(key="k", title="T", body_markdown="B")
    svc._clear_needs_translation(block, "en")
    assert block.needs_translation_en is False
    svc._clear_needs_translation(block, "ro")
    assert block.needs_translation_ro is False
    svc._clear_needs_translation(block, "de")  # ignored

    svc._mark_other_needs_translation(block, "en")
    assert block.needs_translation_ro is True
    svc._mark_other_needs_translation(block, "ro")
    assert block.needs_translation_en is True
    svc._mark_other_needs_translation(block, "de")  # ignored


def test_meta_changes_require_translation():
    assert svc._meta_changes_require_translation(None, None) is False
    assert svc._meta_changes_require_translation({"a": 1}, {"a": 1}) is False
    # Only non-translatable keys changed.
    assert (
        svc._meta_changes_require_translation({"hidden": False}, {"hidden": True})
        is False
    )
    # A translatable key changed.
    assert svc._meta_changes_require_translation({"x": 1}, {"x": 2}) is True


def test_slugify_page_slug():
    assert svc.slugify_page_slug("") == ""
    assert svc.slugify_page_slug("  ") == ""
    assert svc.slugify_page_slug("Hello World!") == "hello-world"
    assert svc.slugify_page_slug("Café-Déjà--vu") == "cafe-deja-vu"


def test_validate_page_slug():
    assert svc._validate_page_slug("My Page") == "my-page"
    with pytest.raises(HTTPException):
        svc._validate_page_slug("!!!")
    with pytest.raises(HTTPException) as exc:
        svc._validate_page_slug("about")
    assert exc.value.detail == "Page slug is reserved"


def test_validate_page_key_for_create():
    svc.validate_page_key_for_create("blog.something")  # not page. -> returns
    svc.validate_page_key_for_create("page.about")  # reserved but locked -> ok
    with pytest.raises(HTTPException):
        svc.validate_page_key_for_create("page.Bad Slug!!")
    with pytest.raises(HTTPException) as exc:
        svc.validate_page_key_for_create("page.admin")  # reserved, not locked
    assert exc.value.detail == "Page slug is reserved"


def test_ensure_utc():
    assert svc._ensure_utc(None) is None
    naive = datetime(2024, 1, 1, 12, 0, 0)
    assert svc._ensure_utc(naive).tzinfo is timezone.utc
    aware = datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert svc._ensure_utc(aware) == aware


def test_apply_content_translation():
    block = ContentBlock(key="k", title="T", body_markdown="B", lang="en")
    block.translations = [
        ContentBlockTranslation(lang="ro", title="Ro", body_markdown="Corp")
    ]
    svc._apply_content_translation(block, None)  # no lang -> noop
    svc._apply_content_translation(block, "en")  # equals base -> noop
    assert block.title == "T"
    svc._apply_content_translation(block, "ro")
    assert block.title == "Ro"
    # No matching translation
    block2 = ContentBlock(key="k", title="T", body_markdown="B", lang="en")
    block2.translations = []
    svc._apply_content_translation(block2, "ro")
    assert block2.title == "T"


def test_apply_content_translation_no_match():
    block = ContentBlock(key="k", title="T", body_markdown="B", lang="en")
    block.translations = [
        ContentBlockTranslation(lang="ro", title="Ro", body_markdown="Corp")
    ]
    # Requested lang has no matching translation -> title unchanged.
    svc._apply_content_translation(block, "de")
    assert block.title == "T"


def test_snapshot_translations():
    block = ContentBlock(key="k", title="T", body_markdown="B")
    block.translations = [
        ContentBlockTranslation(lang="ro", title="Ro", body_markdown="Corp")
    ]
    snap = svc._snapshot_translations(block)
    assert snap == [{"lang": "ro", "title": "Ro", "body_markdown": "Corp"}]


def test_sanitize_markdown():
    svc._sanitize_markdown("safe **markdown**")  # ok
    with pytest.raises(HTTPException) as exc:
        svc._sanitize_markdown("<script>alert(1)</script>")
    assert exc.value.detail == "Disallowed markup"
    with pytest.raises(HTTPException) as exc:
        svc._sanitize_markdown('<div onclick="x()">')
    assert exc.value.detail == "Disallowed event handlers"


def test_contains_inline_event_handler():
    assert svc._contains_inline_event_handler("plain text only") is False
    assert svc._contains_inline_event_handler('onclick = "x"') is True
    # "on" not followed by '=' is not an event handler.
    assert svc._contains_inline_event_handler("once upon a time") is False
    # "on" preceded by alnum is part of a word.
    assert svc._contains_inline_event_handler("button onx") is False
    # bare "on=" (no name after on) is not flagged.
    assert svc._contains_inline_event_handler("on=") is False


def test_find_replace_subn():
    assert svc._find_replace_subn("text", "", "x", case_sensitive=True) == ("text", 0)
    assert svc._find_replace_subn("aAa", "a", "b", case_sensitive=True) == ("bAb", 2)
    out, n = svc._find_replace_subn("aAa", "a", "b", case_sensitive=False)
    assert out == "bbb" and n == 3


def test_find_replace_in_json():
    assert svc._find_replace_in_json("foo", "o", "0", case_sensitive=True) == ("f00", 2)
    out, n = svc._find_replace_in_json(
        ["foo", 1, {"k": "foo"}], "foo", "bar", case_sensitive=True
    )
    assert out == ["bar", 1, {"k": "bar"}] and n == 2
    assert svc._find_replace_in_json(123, "a", "b", case_sensitive=True) == (123, 0)


def test_normalize_md_url():
    assert svc._normalize_md_url("") == ""
    assert svc._normalize_md_url("   ") == ""
    assert svc._normalize_md_url("<https://x.test>") == "https://x.test"
    assert svc._normalize_md_url("<>") == "<>"
    assert svc._normalize_md_url("mailto:a@b.com") == ""
    assert svc._normalize_md_url("#anchor") == ""
    assert svc._normalize_md_url('http://x.test "title"') == "http://x.test"


def test_normalize_md_url_empty_after_strip():
    assert svc._normalize_md_url("<>") == "<>"  # len 2 not stripped
    assert svc._normalize_md_url("< >") == ""  # becomes empty after inner strip


def test_extract_markdown_target_urls():
    assert svc._extract_markdown_target_urls("", image_only=False) == []
    body = "Text ![alt](img.png) and [link](page.html) and ![noclose"
    images = svc._extract_markdown_target_urls(body, image_only=True)
    assert images == ["img.png"]
    links = svc._extract_markdown_target_urls(body, image_only=False)
    assert "page.html" in links


def test_extract_markdown_target_urls_edge_cases():
    # link marker preceded by '!' is skipped in link mode.
    assert svc._extract_markdown_target_urls("![x](y)", image_only=False) == []
    # close bracket missing -> break.
    assert svc._extract_markdown_target_urls("[no close", image_only=False) == []
    # no open paren after bracket -> skipped.
    assert svc._extract_markdown_target_urls("[a] not paren", image_only=False) == []
    # whitespace between ] and ( is allowed.
    assert svc._extract_markdown_target_urls("[a]  (u)", image_only=False) == ["u"]
    # close paren missing -> break.
    assert svc._extract_markdown_target_urls("[a](no close", image_only=False) == []
    # empty url is dropped.
    assert svc._extract_markdown_target_urls("[a](#frag)", image_only=False) == []


def test_extract_markdown_refs():
    refs = svc._extract_markdown_refs("![i](pic.png) [l](href)")
    kinds = {r[0] for r in refs}
    assert kinds == {"image", "link"}


def test_extract_block_refs():
    assert svc._extract_block_refs(None) == []
    assert svc._extract_block_refs({"blocks": "x"}) == []
    meta = {
        "blocks": [
            "not-a-dict",
            {"type": "text", "body_markdown": "![i](a.png)"},
            {"type": "text", "body_markdown": 123},  # non-str body
            {"type": "image", "url": "u.png", "link_url": "l.html"},
            {"type": "gallery", "images": [{"url": "g.png"}, "bad"]},
            {"type": "gallery", "images": "notlist"},
            {"type": "banner", "slide": {"image_url": "b.png", "cta_url": "c"}},
            {"type": "banner", "slide": "notdict"},
            {"type": "carousel", "slides": [{"image_url": "s.png", "cta_url": "x"}, 1]},
            {"type": "carousel", "slides": "nope"},
            {"type": "unknown"},
        ]
    }
    refs = svc._extract_block_refs(meta)
    urls = {r[3] for r in refs}
    assert "a.png" in urls and "u.png" in urls and "g.png" in urls
    assert "b.png" in urls and "s.png" in urls


def test_resolve_redirect_chain():
    assert svc._resolve_redirect_chain("", {}) == ("", None)
    assert svc._resolve_redirect_chain("a", {}) == ("a", None)
    assert svc._resolve_redirect_chain("a", {"a": "b", "b": "c"}) == ("c", None)
    # loop
    final, err = svc._resolve_redirect_chain("a", {"a": "b", "b": "a"})
    assert err == "Redirect loop"
    # too deep
    chain = {f"k{i}": f"k{i + 1}" for i in range(20)}
    final, err = svc._resolve_redirect_chain("k0", chain, max_hops=3)
    assert err == "Redirect chain too deep"


def test_media_url_exists(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    assert svc._media_url_exists("https://external.test/a.png") is True
    assert svc._media_url_exists("/other/path") is True
    # media path that does not exist
    assert svc._media_url_exists("/media/missing.png") is False
    # traversal -> False
    assert svc._media_url_exists("/media/../escape.png") is False
    # existing file
    (tmp_path / "exists.png").write_bytes(b"x")
    assert svc._media_url_exists("/media/exists.png") is True
    # "media/" without leading slash gets normalized
    assert svc._media_url_exists("media/exists.png") is True


# --------------------------------------------------------------------------- #
# resolve_redirect_key (DB)
# --------------------------------------------------------------------------- #


async def test_resolve_redirect_key(factory):
    async with factory() as session:
        assert await svc.resolve_redirect_key(session, "") == ""
        assert await svc.resolve_redirect_key(session, "page.x") == "page.x"
        session.add(ContentRedirect(from_key="page.old", to_key="page.new"))
        await session.commit()
        assert await svc.resolve_redirect_key(session, "page.old") == "page.new"


async def test_resolve_redirect_key_loop(factory):
    async with factory() as session:
        session.add(ContentRedirect(from_key="a", to_key="b"))
        session.add(ContentRedirect(from_key="b", to_key="a"))
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await svc.resolve_redirect_key(session, "a")
        assert exc.value.detail == "Invalid content redirect loop"


async def test_resolve_redirect_key_too_deep(factory):
    async with factory() as session:
        for i in range(12):
            session.add(ContentRedirect(from_key=f"k{i}", to_key=f"k{i + 1}"))
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await svc.resolve_redirect_key(session, "k0", max_hops=3)
        assert exc.value.detail == "Invalid content redirect chain"


# --------------------------------------------------------------------------- #
# get_published_by_key* / get_block_by_key
# --------------------------------------------------------------------------- #


async def test_get_published_by_key(factory):
    await _add_block(
        factory,
        key="page.pub",
        status=ContentStatus.published,
        lang="en",
        published_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    async with factory() as session:
        block = await svc.get_published_by_key(session, "page.pub", lang="ro")
        assert block is not None
        assert await svc.get_published_by_key(session, "page.missing") is None


async def test_get_published_by_key_following_redirects(factory):
    await _add_block(factory, key="page.new", status=ContentStatus.published, lang="en")
    async with factory() as session:
        session.add(ContentRedirect(from_key="page.old", to_key="page.new"))
        await session.commit()
        block = await svc.get_published_by_key_following_redirects(session, "page.old")
        assert block is not None and block.key == "page.new"


async def test_get_block_by_key(factory):
    await _add_block(factory, key="page.b", lang="en")
    async with factory() as session:
        assert await svc.get_block_by_key(session, "page.b", lang="ro") is not None
        assert await svc.get_block_by_key(session, "page.none") is None


# --------------------------------------------------------------------------- #
# upsert_block - create
# --------------------------------------------------------------------------- #


async def test_upsert_block_create_draft(factory):
    payload = ContentBlockCreate(
        title="New", body_markdown="Body", status=ContentStatus.draft, lang="en"
    )
    async with factory() as session:
        block = await svc.upsert_block(
            session, "page.created", payload, actor_id=uuid4()
        )
        assert block.version == 1
        assert block.needs_translation_ro is True


async def test_upsert_block_create_published_with_window(factory):
    now = datetime.now(timezone.utc)
    payload = ContentBlockCreate(
        title="Pub",
        body_markdown="Body",
        status=ContentStatus.published,
        lang="ro",
        published_at=now,
        published_until=now + timedelta(days=1),
    )
    async with factory() as session:
        block = await svc.upsert_block(session, "page.pubcreate", payload)
        assert block.status == ContentStatus.published
        assert block.needs_translation_en is True


async def test_upsert_block_create_legal_published_rejected(factory):
    payload = ContentBlockCreate(
        title="T", body_markdown="B", status=ContentStatus.published, lang="en"
    )
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.upsert_block(session, "page.terms", payload)
        assert "draft" in exc.value.detail


async def test_upsert_block_create_bad_window(factory):
    now = datetime.now(timezone.utc)
    payload = ContentBlockCreate(
        title="T",
        body_markdown="B",
        status=ContentStatus.published,
        lang="en",
        published_at=now,
        published_until=now - timedelta(days=1),
    )
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.upsert_block(session, "page.badwindow", payload)
        assert "Unpublish" in exc.value.detail


# --------------------------------------------------------------------------- #
# upsert_block - update
# --------------------------------------------------------------------------- #


async def test_upsert_block_update_no_data(factory):
    await _add_block(factory, key="page.nd", lang="en")
    async with factory() as session:
        block = await svc.upsert_block(
            session, "page.nd", ContentBlockUpdate(), actor_id=None
        )
        assert block.version == 1  # unchanged


async def test_upsert_block_update_version_conflict(factory):
    await _add_block(factory, key="page.vc", lang="en", version=3)
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.upsert_block(
                session,
                "page.vc",
                ContentBlockUpdate(expected_version=1, title="X"),
            )
        assert exc.value.status_code == 409


async def test_upsert_block_update_base_fields(factory):
    await _add_block(factory, key="page.upd", lang="en", title="Old")
    async with factory() as session:
        block = await svc.upsert_block(
            session,
            "page.upd",
            ContentBlockUpdate(
                title="New",
                body_markdown="Updated body",
                status=ContentStatus.published,
                meta={"x": 1},
                sort_order=5,
            ),
        )
        assert block.title == "New"
        assert block.version == 2
        assert block.status == ContentStatus.published


async def test_upsert_block_update_publish_then_draft(factory):
    await _add_block(
        factory,
        key="page.pd",
        lang="en",
        status=ContentStatus.published,
        published_at=datetime.now(timezone.utc),
    )
    async with factory() as session:
        block = await svc.upsert_block(
            session, "page.pd", ContentBlockUpdate(status=ContentStatus.draft)
        )
        assert block.published_at is None


async def test_upsert_block_update_published_at_only(factory):
    await _add_block(factory, key="page.pa", lang="en", status=ContentStatus.review)
    now = datetime.now(timezone.utc)
    async with factory() as session:
        block = await svc.upsert_block(
            session, "page.pa", ContentBlockUpdate(published_at=now)
        )
        # status is review -> published_at forced None at end.
        assert block.published_at is None


async def test_upsert_block_update_translation(factory):
    await _add_block(factory, key="page.tr", lang="en", title="EN")
    async with factory() as session:
        block = await svc.upsert_block(
            session,
            "page.tr",
            ContentBlockUpdate(title="RO", body_markdown="Corp RO", lang="ro"),
        )
        assert any(t.lang == "ro" for t in block.translations)
        # Update the same translation again (exercises the update branch).
        block2 = await svc.upsert_block(
            session,
            "page.tr",
            ContentBlockUpdate(title="RO2", body_markdown="Corp2", lang="ro"),
        )
        ro = next(t for t in block2.translations if t.lang == "ro")
        assert ro.title == "RO2"


async def test_upsert_block_update_published_bad_window(factory):
    now = datetime.now(timezone.utc)
    await _add_block(
        factory,
        key="page.pbw",
        lang="en",
        status=ContentStatus.published,
        published_at=now,
    )
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.upsert_block(
                session,
                "page.pbw",
                ContentBlockUpdate(
                    status=ContentStatus.published,
                    published_at=now,
                    published_until=now - timedelta(days=1),
                ),
            )
        assert "Unpublish" in exc.value.detail


async def test_upsert_block_update_meta_only_translation_mark(factory):
    await _add_block(factory, key="page.mo", lang="en", meta={"a": 1})
    async with factory() as session:
        block = await svc.upsert_block(
            session, "page.mo", ContentBlockUpdate(meta={"a": 2})
        )
        assert block.needs_translation_ro is True


# --------------------------------------------------------------------------- #
# rename_page_slug
# --------------------------------------------------------------------------- #


async def test_rename_page_slug_success(factory):
    await _add_block(factory, key="page.oldname", lang="en")
    async with factory() as session:
        result = await svc.rename_page_slug(
            session, old_slug="oldname", new_slug="newname", actor_id=uuid4()
        )
        assert result == ("oldname", "newname", "page.oldname", "page.newname")
        # A redirect from old -> new now exists.
        redirect = await session.scalar(
            select(ContentRedirect).where(ContentRedirect.from_key == "page.oldname")
        )
        assert redirect.to_key == "page.newname"


async def test_rename_page_slug_invalid_old(factory):
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.rename_page_slug(session, old_slug="!!!", new_slug="x")
        assert exc.value.status_code == 404


async def test_rename_page_slug_missing(factory):
    async with factory() as session:
        with pytest.raises(HTTPException):
            await svc.rename_page_slug(session, old_slug="ghost", new_slug="x")


async def test_rename_page_slug_locked(factory):
    await _add_block(factory, key="page.about", lang="en")
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.rename_page_slug(session, old_slug="about", new_slug="x")
        assert "cannot be changed" in exc.value.detail


async def test_rename_page_slug_same(factory):
    await _add_block(factory, key="page.samep", lang="en")
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.rename_page_slug(session, old_slug="samep", new_slug="samep")
        assert "different" in exc.value.detail


async def test_rename_page_slug_exists(factory):
    await _add_block(factory, key="page.a1", lang="en")
    await _add_block(factory, key="page.a2", lang="en")
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.rename_page_slug(session, old_slug="a1", new_slug="a2")
        assert "already exists" in exc.value.detail


async def test_rename_page_slug_reserved_by_redirect(factory):
    await _add_block(factory, key="page.r1", lang="en")
    async with factory() as session:
        session.add(ContentRedirect(from_key="page.r2", to_key="page.somewhere"))
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await svc.rename_page_slug(session, old_slug="r1", new_slug="r2")
        assert "reserved by a redirect" in exc.value.detail


async def test_rename_page_slug_redirect_loop(factory):
    await _add_block(factory, key="page.l1", lang="en")
    async with factory() as session:
        # new_key resolves back to old_key via a redirect chain.
        session.add(ContentRedirect(from_key="page.l2", to_key="page.l1"))
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await svc.rename_page_slug(session, old_slug="l1", new_slug="l2")
        # Either "reserved by a redirect" or loop depending on order; both 400.
        assert exc.value.status_code == 400


async def test_rename_page_slug_updates_existing_redirect(factory):
    await _add_block(factory, key="page.e1", lang="en")
    async with factory() as session:
        # An existing redirect FROM old_key already exists.
        session.add(ContentRedirect(from_key="page.e1", to_key="page.target"))
        await session.commit()
    async with factory() as session:
        await svc.rename_page_slug(
            session, old_slug="e1", new_slug="e1renamed", actor_id=None
        )
        redirect = await session.scalar(
            select(ContentRedirect).where(ContentRedirect.from_key == "page.e1")
        )
        assert redirect.to_key == "page.e1renamed"


# --------------------------------------------------------------------------- #
# set_translation_status
# --------------------------------------------------------------------------- #


async def test_set_translation_status(factory):
    await _add_block(factory, key="page.ts", lang="en")
    async with factory() as session:
        block = await svc.set_translation_status(
            session,
            key="page.ts",
            payload=ContentTranslationStatusUpdate(
                needs_translation_en=True, needs_translation_ro=False
            ),
            actor_id=uuid4(),
        )
        assert block.needs_translation_en is True


async def test_set_translation_status_no_change(factory):
    await _add_block(factory, key="page.tsn", lang="en")
    async with factory() as session:
        block = await svc.set_translation_status(
            session,
            key="page.tsn",
            payload=ContentTranslationStatusUpdate(),
        )
        assert block.version == 1


async def test_set_translation_status_missing(factory):
    async with factory() as session:
        with pytest.raises(HTTPException):
            await svc.set_translation_status(
                session,
                key="page.none",
                payload=ContentTranslationStatusUpdate(needs_translation_en=True),
            )


# --------------------------------------------------------------------------- #
# rollback_to_version
# --------------------------------------------------------------------------- #


async def test_rollback_to_version(factory):
    await _add_block(factory, key="page.rb", lang="en", status=ContentStatus.published)
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.rb")
        session.add(
            ContentBlockVersion(
                content_block_id=block.id,
                version=1,
                title="V1 title",
                body_markdown="V1 body",
                status=ContentStatus.draft,
                meta={"k": "v"},
                lang="en",
                published_at=None,
                published_until=None,
                translations=[
                    {"lang": "ro", "title": "Ro", "body_markdown": "Corp"},
                    {"lang": "de", "title": None, "body_markdown": "x"},  # skipped
                    {"title": "no-lang"},  # skipped
                ],
            )
        )
        await session.commit()
        rolled = await svc.rollback_to_version(
            session, key="page.rb", version=1, actor_id=uuid4()
        )
        assert rolled.title == "V1 title"
        assert any(t.lang == "ro" for t in rolled.translations)


async def test_rollback_published_sets_published_at(factory):
    await _add_block(factory, key="page.rb2", lang="en")
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.rb2")
        session.add(
            ContentBlockVersion(
                content_block_id=block.id,
                version=1,
                title="Pub V1",
                body_markdown="Body",
                status=ContentStatus.published,
                meta=None,
                lang="en",
                published_at=None,
                published_until=None,
                translations=None,
            )
        )
        await session.commit()
        rolled = await svc.rollback_to_version(session, key="page.rb2", version=1)
        assert rolled.published_at is not None


async def test_rollback_published_with_published_at(factory):
    """Rollback to a published snapshot that already has a published_at -> the
    ``published_at is None`` elif is skipped (1096->1098)."""
    when = datetime.now(timezone.utc) - timedelta(days=3)
    await _add_block(factory, key="page.rb4", lang="en")
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.rb4")
        session.add(
            ContentBlockVersion(
                content_block_id=block.id,
                version=1,
                title="Pub With Date",
                body_markdown="Body",
                status=ContentStatus.published,
                meta=None,
                lang="en",
                published_at=when,
                published_until=None,
                translations=None,
            )
        )
        await session.commit()
    async with factory() as session:
        rolled = await svc.rollback_to_version(session, key="page.rb4", version=1)
        assert rolled.published_at is not None


async def test_rollback_missing_block(factory):
    async with factory() as session:
        with pytest.raises(HTTPException):
            await svc.rollback_to_version(session, key="page.none", version=1)


async def test_rollback_missing_version(factory):
    await _add_block(factory, key="page.rb3", lang="en")
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.rollback_to_version(session, key="page.rb3", version=99)
        assert exc.value.detail == "Version not found"


# --------------------------------------------------------------------------- #
# get_asset_usage_keys
# --------------------------------------------------------------------------- #


async def test_get_asset_usage_keys(factory):
    await _add_block(
        factory, key="page.uses", lang="en", body_markdown="See /media/x.png here"
    )
    async with factory() as session:
        assert await svc.get_asset_usage_keys(session, url="") == []
        keys = await svc.get_asset_usage_keys(session, url="/media/x.png")
        assert "page.uses" in keys


# --------------------------------------------------------------------------- #
# preview_find_replace / apply_find_replace
# --------------------------------------------------------------------------- #


async def test_preview_find_replace(factory):
    await _add_block(
        factory,
        key="page.fr1",
        lang="en",
        title="Find me",
        body_markdown="find body find",
        meta={"note": "find in meta"},
    )
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.fr1")
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id,
                lang="ro",
                title="find ro",
                body_markdown="nothing",
            )
        )
        await session.commit()
    async with factory() as session:
        items, total_items, total_matches, truncated = await svc.preview_find_replace(
            session, find="find", replace="X", case_sensitive=False
        )
        assert total_items == 1
        assert total_matches >= 4
        assert truncated is False
        assert items[0]["translations"]


async def test_preview_find_replace_no_match_and_truncate(factory):
    for i in range(3):
        await _add_block(
            factory, key=f"page.fr{i}", lang="en", title="alpha", body_markdown="alpha"
        )
    async with factory() as session:
        items, ti, tm, truncated = await svc.preview_find_replace(
            session, find="alpha", replace="beta", limit=2, key_prefix="page."
        )
        assert truncated is True
        assert len(items) == 2


async def test_apply_find_replace(factory):
    await _add_block(
        factory,
        key="page.afr",
        lang="en",
        title="hello world",
        body_markdown="hello body",
        meta={"x": "hello meta"},
    )
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.afr")
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id,
                lang="ro",
                title="hello ro",
                body_markdown="salut",
            )
        )
        await session.commit()
    async with factory() as session:
        ub, ut, tr, errors = await svc.apply_find_replace(
            session, find="hello", replace="hi", case_sensitive=True, actor_id=uuid4()
        )
        assert ub == 1
        assert ut == 1
        assert tr >= 3
        assert errors == []


async def test_apply_find_replace_sanitize_error(factory):
    await _add_block(
        factory, key="page.afre", lang="en", title="t", body_markdown="safe body"
    )
    async with factory() as session:
        # Replacing turns body into disallowed markup -> sanitize raises -> error
        # is recorded, transaction rolled back.
        ub, ut, tr, errors = await svc.apply_find_replace(
            session, find="safe", replace="<script>", case_sensitive=True
        )
        assert errors and errors[0]["key"] == "page.afre"
        assert ub == 0


async def test_apply_find_replace_no_match(factory):
    await _add_block(factory, key="page.afrn", lang="en", body_markdown="zzz")
    async with factory() as session:
        ub, ut, tr, errors = await svc.apply_find_replace(
            session, find="qqq", replace="x"
        )
        assert ub == 0 and errors == []


# --------------------------------------------------------------------------- #
# delete_image_asset
# --------------------------------------------------------------------------- #


async def _add_image(factory, block, **fields) -> ContentImage:
    async with factory() as session:
        image = ContentImage(
            content_block_id=block.id,
            url=fields.pop("url", "/media/img.png"),
            alt_text="alt",
            sort_order=fields.pop("sort_order", 1),
            **fields,
        )
        session.add(image)
        await session.commit()
        await session.refresh(image)
        return image


async def test_delete_image_asset_simple(factory, monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(storage, "delete_file", lambda url: deleted.append(url))
    block = await _add_block(factory, key="page.di", lang="en")
    image = await _add_image(factory, block, url="/media/del.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        await svc.delete_image_asset(session, image=fresh, actor_id=uuid4())
    assert "/media/del.png" in deleted


async def test_delete_image_asset_no_id(factory):
    image = ContentImage(content_block_id=uuid4(), url="/media/x.png", sort_order=1)
    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=image)
        assert exc.value.detail == "Image not found"


async def test_delete_image_asset_has_children(factory):
    block = await _add_block(factory, key="page.dic", lang="en")
    parent = await _add_image(factory, block, url="/media/parent.png")
    await _add_image(
        factory, block, url="/media/child.png", root_image_id=parent.id, sort_order=2
    )
    async with factory() as session:
        fresh = await session.get(ContentImage, parent.id)
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh)
        assert "edited versions" in exc.value.detail


async def test_delete_image_asset_shared_file(factory):
    block = await _add_block(factory, key="page.dis", lang="en")
    img1 = await _add_image(factory, block, url="/media/shared.png")
    await _add_image(factory, block, url="/media/shared.png", sort_order=2)
    async with factory() as session:
        fresh = await session.get(ContentImage, img1.id)
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh)
        assert "shared" in exc.value.detail


async def test_delete_image_asset_in_use(factory):
    block = await _add_block(
        factory, key="page.diu", lang="en", body_markdown="uses /media/used.png"
    )
    image = await _add_image(factory, block, url="/media/used.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh)
        assert exc.value.detail == "Image is used"


async def test_delete_image_asset_versions(factory, monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(storage, "delete_file", lambda url: deleted.append(url))
    block = await _add_block(factory, key="page.div", lang="en", body_markdown="none")
    root = await _add_image(factory, block, url="/media/root.png")
    await _add_image(
        factory,
        block,
        url="/media/edit.png",
        root_image_id=root.id,
        source_image_id=root.id,
        sort_order=2,
    )
    async with factory() as session:
        fresh = await session.get(ContentImage, root.id)
        await svc.delete_image_asset(
            session, image=fresh, delete_versions=True, actor_id=uuid4()
        )
    assert "/media/root.png" in deleted


async def test_delete_image_asset_versions_shared(factory):
    block = await _add_block(factory, key="page.divs", lang="en", body_markdown="none")
    root = await _add_image(factory, block, url="/media/rs.png")
    # Another image shares the same file but is NOT part of the version tree.
    await _add_image(factory, block, url="/media/rs.png", sort_order=9)
    async with factory() as session:
        fresh = await session.get(ContentImage, root.id)
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh, delete_versions=True)
        assert "shared" in exc.value.detail


async def test_delete_image_asset_versions_in_use(factory):
    block = await _add_block(
        factory, key="page.divu", lang="en", body_markdown="uses /media/vu.png"
    )
    root = await _add_image(factory, block, url="/media/vu.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, root.id)
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh, delete_versions=True)
        assert exc.value.detail == "Image is used"


# --------------------------------------------------------------------------- #
# edit_image_asset
# --------------------------------------------------------------------------- #


def _write_png(path, size=(200, 100), color=(255, 0, 0)):
    img = Image.new("RGB", size, color)
    img.save(path, format="PNG")


@pytest.fixture
def media_root(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    monkeypatch.setattr(storage, "ensure_media_root", lambda root=None: tmp_path)
    monkeypatch.setattr(storage, "generate_thumbnails", lambda path: None)
    return tmp_path


async def test_edit_image_asset_crop_resize_rotate(factory, media_root):
    src = media_root / "src.png"
    _write_png(src, size=(400, 200))
    block = await _add_block(factory, key="page.ei", lang="en")
    image = await _add_image(factory, block, url="/media/src.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        new_image = await svc.edit_image_asset(
            session,
            image=fresh,
            payload=ContentImageEditRequest(
                rotate_cw=90, crop_aspect_w=1, crop_aspect_h=1, resize_max_width=50
            ),
            actor_id=uuid4(),
        )
        assert new_image.url.startswith("/media/edited/")


async def test_edit_image_asset_rotate_180_270(factory, media_root):
    for angle in (180, 270):
        src = media_root / f"r{angle}.png"
        _write_png(src, size=(300, 150))
        block = await _add_block(factory, key=f"page.ri{angle}", lang="en")
        image = await _add_image(factory, block, url=f"/media/r{angle}.png")
        async with factory() as session:
            fresh = await session.get(ContentImage, image.id)
            out = await svc.edit_image_asset(
                session,
                image=fresh,
                payload=ContentImageEditRequest(rotate_cw=angle),
            )
            assert out.url.startswith("/media/edited/")


async def test_edit_image_asset_jpeg_with_tags(factory, media_root):
    src = media_root / "src.jpg"
    Image.new("RGB", (300, 200), (0, 128, 0)).save(src, format="JPEG")
    block = await _add_block(factory, key="page.eij", lang="en")
    image = await _add_image(
        factory, block, url="/media/src.jpg", focal_x=60, focal_y=40
    )
    async with factory() as session:
        session.add(ContentImageTag(content_image_id=image.id, tag="nature"))
        await session.commit()
        fresh = await session.get(ContentImage, image.id)
        out = await svc.edit_image_asset(
            session,
            image=fresh,
            payload=ContentImageEditRequest(resize_max_height=50),
        )
        tags = (
            (
                await session.execute(
                    select(ContentImageTag.tag).where(
                        ContentImageTag.content_image_id == out.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert "nature" in tags


async def test_edit_image_asset_webp(factory, media_root):
    src = media_root / "src.webp"
    Image.new("RGB", (200, 200), (0, 0, 255)).save(src, format="WEBP")
    block = await _add_block(factory, key="page.eiw", lang="en")
    image = await _add_image(factory, block, url="/media/src.webp")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        out = await svc.edit_image_asset(
            session,
            image=fresh,
            payload=ContentImageEditRequest(crop_aspect_w=4, crop_aspect_h=3),
        )
        assert out.url.endswith(".webp")


async def test_edit_image_asset_empty_url(factory, media_root):
    block = await _add_block(factory, key="page.eie", lang="en")
    image = await _add_image(factory, block, url="   ")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        with pytest.raises(HTTPException) as exc:
            await svc.edit_image_asset(
                session, image=fresh, payload=ContentImageEditRequest(rotate_cw=90)
            )
        assert exc.value.detail == "Invalid image URL"


async def test_edit_image_asset_bad_url(factory, media_root):
    block = await _add_block(factory, key="page.eib", lang="en")
    image = await _add_image(factory, block, url="https://external/x.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        with pytest.raises(HTTPException) as exc:
            await svc.edit_image_asset(
                session, image=fresh, payload=ContentImageEditRequest(rotate_cw=90)
            )
        assert exc.value.status_code == 400


async def test_edit_image_asset_missing_file(factory, media_root):
    block = await _add_block(factory, key="page.eim", lang="en")
    image = await _add_image(factory, block, url="/media/gone.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        with pytest.raises(HTTPException) as exc:
            await svc.edit_image_asset(
                session, image=fresh, payload=ContentImageEditRequest(rotate_cw=90)
            )
        assert exc.value.detail == "Image file not found"


async def test_edit_image_asset_unsupported_type(factory, media_root):
    src = media_root / "src.bmp"
    Image.new("RGB", (50, 50), (1, 1, 1)).save(src, format="BMP")
    block = await _add_block(factory, key="page.eiu", lang="en")
    image = await _add_image(factory, block, url="/media/src.bmp")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        with pytest.raises(HTTPException) as exc:
            await svc.edit_image_asset(
                session, image=fresh, payload=ContentImageEditRequest(rotate_cw=90)
            )
        assert exc.value.detail == "Unsupported image type"


async def test_edit_image_asset_gif_rejected(factory, media_root):
    src = media_root / "src.gif"
    Image.new("P", (40, 40)).save(src, format="GIF")
    block = await _add_block(factory, key="page.eig", lang="en")
    image = await _add_image(factory, block, url="/media/src.gif")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        with pytest.raises(HTTPException) as exc:
            await svc.edit_image_asset(
                session, image=fresh, payload=ContentImageEditRequest(rotate_cw=90)
            )
        assert "GIF" in exc.value.detail


async def test_edit_image_asset_missing_block(factory, media_root):
    src = media_root / "orphan.png"
    _write_png(src)
    # Image points to a non-existent content block.
    image = ContentImage(
        content_block_id=uuid4(), url="/media/orphan.png", sort_order=1
    )
    async with factory() as session:
        image.id = uuid4()
        with pytest.raises(HTTPException) as exc:
            await svc.edit_image_asset(
                session, image=image, payload=ContentImageEditRequest(rotate_cw=90)
            )
        assert exc.value.detail == "Content not found"


# --------------------------------------------------------------------------- #
# check_content_links
# --------------------------------------------------------------------------- #


async def _seed_link_target(factory):
    async with factory() as session:
        cat = Category(slug="catx", name="Cat X")
        session.add(cat)
        await session.flush()
        session.add(
            Product(
                category_id=cat.id,
                slug="prodx",
                name="Prod X",
                status=ProductStatus.published,
            )
        )
        session.add(
            Product(
                category_id=cat.id,
                slug="proddraft",
                name="Draft",
                status=ProductStatus.draft,
            )
        )
        session.add(
            ContentBlock(
                key="page.target",
                title="Target",
                body_markdown="Body",
                status=ContentStatus.published,
                version=1,
                lang="en",
                published_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
        )
        await session.commit()


async def test_check_content_links_missing_block(factory, naive_now):
    async with factory() as session:
        with pytest.raises(HTTPException):
            await svc.check_content_links(session, key="page.none")


async def test_check_content_links_full(factory, naive_now):
    await _seed_link_target(factory)
    body = (
        "[ext](https://x.test) "
        "[media-bad](/media/missing.png) "
        "[prod-ok](/products/prodx) "
        "[prod-draft](/products/proddraft) "
        "[prod-missing](/products/ghost) "
        "[cat-ok](/shop/catx) "
        "[cat-bad](/shop/ghostcat) "
        "[cat-query](/shop?category=ghostcat2&sub=ghostcat3) "
        "[page-ok](/pages/target) "
        "[page-missing](/pages/ghostpage) "
        "[blog-missing](/blog/ghostblog) "
        "[empty-prod](/products/) "
    )
    block = await _add_block(
        factory,
        key="page.links",
        lang="en",
        body_markdown=body,
        meta={"blocks": [{"type": "image", "url": "/media/nope.png"}]},
    )
    await _add_image(factory, block, url="/media/imgref.png")
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.links")
        reasons = {i.reason for i in issues}
        assert "Media file not found" in reasons
        assert "Product not found" in reasons
        assert "Product is not publicly visible" in reasons
        assert "Category not found" in reasons
        assert "Content not found" in reasons


async def test_check_content_links_redirect_loop(factory, naive_now):
    async with factory() as session:
        session.add(ContentRedirect(from_key="page.lp1", to_key="page.lp2"))
        session.add(ContentRedirect(from_key="page.lp2", to_key="page.lp1"))
        await session.commit()
    await _add_block(
        factory, key="page.loopcheck", lang="en", body_markdown="[x](/pages/lp1)"
    )
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.loopcheck")
        assert any(i.reason == "Redirect loop" for i in issues)


async def test_check_content_links_not_public(factory, naive_now):
    future = datetime.now(timezone.utc) + timedelta(days=5)
    await _add_block(
        factory,
        key="page.futurepub",
        lang="en",
        status=ContentStatus.published,
        published_at=future,
    )
    await _add_block(
        factory, key="page.refs", lang="en", body_markdown="[x](/pages/futurepub)"
    )
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.refs")
        assert any(i.reason == "Content is not publicly visible" for i in issues)


async def test_check_content_links_clean(factory, naive_now):
    await _seed_link_target(factory)
    await _add_block(
        factory,
        key="page.clean",
        lang="en",
        body_markdown="[ok](/products/prodx) [pg](/pages/target) [cat](/shop/catx)",
    )
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.clean")
        assert issues == []


# --------------------------------------------------------------------------- #
# check_content_links_preview
# --------------------------------------------------------------------------- #


async def test_check_content_links_preview(factory, monkeypatch, tmp_path, naive_now):
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    await _seed_link_target(factory)
    issues = None
    body = (
        "[ext](https://x.test) "
        "[media-bad](/media/missing.png) "
        "[prod-ok](/products/prodx) "
        "[prod-draft](/products/proddraft) "
        "[prod-missing](/products/ghost) "
        "[cat-bad](/shop/ghostcat) "
        "[cat-query](/shop?category=ghostq&sub=ghostq2) "
        "[page-ok](/pages/target) "
        "[page-missing](/pages/ghost) "
        "[empty-prod](/products/) "
    )
    async with factory() as session:
        issues = await svc.check_content_links_preview(
            session,
            key="",
            body_markdown=body,
            meta={"blocks": [{"type": "image", "url": "/media/x.png"}]},
            images=["/media/preview.png", "   "],
        )
    reasons = {i.reason for i in issues}
    assert "Product not found" in reasons
    assert "Category not found" in reasons
    assert "Content not found" in reasons


async def test_check_content_links_preview_not_public(factory, naive_now):
    future = datetime.now(timezone.utc) + timedelta(days=5)
    await _add_block(
        factory,
        key="page.pfut",
        lang="en",
        status=ContentStatus.published,
        published_at=future,
    )
    async with factory() as session:
        issues = await svc.check_content_links_preview(
            session, key="preview", body_markdown="[x](/pages/pfut)"
        )
        assert any(i.reason == "Content is not publicly visible" for i in issues)


async def test_upsert_block_create_lang_none(factory):
    payload = ContentBlockCreate(
        title="NL", body_markdown="Body", status=ContentStatus.draft, lang=None
    )
    async with factory() as session:
        block = await svc.upsert_block(session, "page.langnone", payload)
        assert block.needs_translation_en is False
        assert block.needs_translation_ro is False


async def test_upsert_update_translation_meta_only(factory):
    """Existing translation, update sends meta+lang only (no title/body) -> the
    title/body translation-update conditionals are both skipped."""
    await _add_block(factory, key="page.trmeta", lang="en", title="EN")
    async with factory() as session:
        # First create the ro translation.
        await svc.upsert_block(
            session,
            "page.trmeta",
            ContentBlockUpdate(title="RO", body_markdown="Corp", lang="ro"),
        )
    async with factory() as session:
        block = await svc.upsert_block(
            session,
            "page.trmeta",
            ContentBlockUpdate(meta={"k": 1}, lang="ro"),
        )
        assert block is not None


async def test_upsert_update_publish_no_published_at(factory):
    """status->published without published_at and with block.published_at None
    sets published_at=now (line 541->.. elif branch)."""
    await _add_block(factory, key="page.pubnow", lang="en", status=ContentStatus.draft)
    async with factory() as session:
        block = await svc.upsert_block(
            session,
            "page.pubnow",
            ContentBlockUpdate(status=ContentStatus.published),
        )
        assert block.published_at is not None


async def test_upsert_update_lang_same_as_base(factory):
    """Update sends lang == block.lang -> base update path, line 555 executes."""
    await _add_block(factory, key="page.langsame", lang="en", title="EN")
    async with factory() as session:
        block = await svc.upsert_block(
            session,
            "page.langsame",
            ContentBlockUpdate(title="EN2", lang="en"),
        )
        assert block.lang == "en"
        assert block.title == "EN2"


async def test_edit_image_asset_wide_crop_and_upscale_noop(factory, media_root):
    """Wide source + 1:1 crop hits the ``current_ratio > target_ratio`` branch;
    a resize larger than the image is a no-op (scale >= 1.0)."""
    src = media_root / "wide.png"
    _write_png(src, size=(400, 100))
    block = await _add_block(factory, key="page.wide", lang="en")
    image = await _add_image(factory, block, url="/media/wide.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        out = await svc.edit_image_asset(
            session,
            image=fresh,
            payload=ContentImageEditRequest(
                crop_aspect_w=1,
                crop_aspect_h=1,
                resize_max_width=9000,  # larger than image -> no downscale
            ),
        )
        assert out.url.startswith("/media/edited/")


async def test_delete_image_asset_blank_url(factory, monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(storage, "delete_file", lambda url: deleted.append(url))
    block = await _add_block(factory, key="page.dblank", lang="en")
    image = await _add_image(factory, block, url="   ")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        await svc.delete_image_asset(session, image=fresh)
    assert deleted == []  # blank url -> no file deletion


async def test_delete_image_asset_missing_block(factory):
    block = await _add_block(factory, key="page.dmb", lang="en")
    image = await _add_image(factory, block, url="/media/dmb.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, image.id)
        # Point the image at a non-existent content block (orphaned FK) so the
        # "Content not found" guard fires while the image row still exists.
        fresh.content_block_id = uuid4()
        await session.flush()
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh)
        assert exc.value.detail == "Content not found"


async def test_delete_image_asset_versions_missing_block(factory):
    block = await _add_block(factory, key="page.dvmb", lang="en", body_markdown="none")
    root = await _add_image(factory, block, url="/media/dvmb.png")
    async with factory() as session:
        fresh = await session.get(ContentImage, root.id)
        fresh.content_block_id = uuid4()  # orphan FK -> Content not found
        await session.flush()
        with pytest.raises(HTTPException) as exc:
            await svc.delete_image_asset(session, image=fresh, delete_versions=True)
        assert exc.value.detail == "Content not found"


async def test_delete_image_asset_versions_circular(factory, monkeypatch):
    """All images in the version set reference each other (no leaves) -> the
    fallback ``leaves = list(remaining.values())`` runs (944)."""
    deleted: list[str] = []
    monkeypatch.setattr(storage, "delete_file", lambda url: deleted.append(url))
    block = await _add_block(factory, key="page.dvc", lang="en", body_markdown="none")
    a = await _add_image(factory, block, url="/media/cyca.png")
    b = await _add_image(
        factory, block, url="/media/cycb.png", root_image_id=a.id, sort_order=2
    )
    async with factory() as session:
        # Make A and B reference each other and share the same root so both are
        # selected by the version query, yet neither is a leaf.
        ia = await session.get(ContentImage, a.id)
        ib = await session.get(ContentImage, b.id)
        ia.root_image_id = a.id
        ia.source_image_id = b.id
        ib.root_image_id = a.id
        ib.source_image_id = a.id
        await session.commit()
    async with factory() as session:
        fresh = await session.get(ContentImage, a.id)
        await svc.delete_image_asset(session, image=fresh, delete_versions=True)
    assert "/media/cyca.png" in deleted


async def test_delete_image_asset_versions_blank_url(factory, monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(storage, "delete_file", lambda url: deleted.append(url))
    block = await _add_block(factory, key="page.dvblank", lang="en", body_markdown="x")
    root = await _add_image(factory, block, url="   ")
    async with factory() as session:
        fresh = await session.get(ContentImage, root.id)
        await svc.delete_image_asset(session, image=fresh, delete_versions=True)
    assert deleted == []


async def test_upsert_update_publish_already_published(factory):
    """status->published on an already-published block (published_at set) and no
    published_at in payload -> the elif branch is skipped (541->548)."""
    now = datetime.now(timezone.utc)
    await _add_block(
        factory,
        key="page.alreadypub",
        lang="en",
        status=ContentStatus.published,
        published_at=now - timedelta(days=2),
    )
    async with factory() as session:
        block = await svc.upsert_block(
            session,
            "page.alreadypub",
            ContentBlockUpdate(status=ContentStatus.published, title="New title"),
        )
        assert block.published_at is not None


async def test_set_translation_status_no_actor(factory):
    await _add_block(factory, key="page.tsna", lang="en")
    async with factory() as session:
        block = await svc.set_translation_status(
            session,
            key="page.tsna",
            payload=ContentTranslationStatusUpdate(needs_translation_ro=True),
            actor_id=None,
        )
        assert block.needs_translation_ro is True


async def test_apply_find_replace_key_prefix_and_body_unchanged(factory):
    """key_prefix filter applies (1370); a base change where the body does NOT
    change (only title/meta matched) skips the body-sanitize branch (1451->1453);
    a non-EN/RO translation that changes skips the needs-translation clear
    (1462->1460)."""
    await _add_block(
        factory,
        key="page.kpbu",
        lang="en",
        title="zebra title",  # title matches
        body_markdown="plain body",  # body no match
        meta={"k": "zebra meta"},  # meta matches
    )
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.kpbu")
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id,
                lang="de",  # non en/ro -> clear-needs-translation skipped
                title="zebra de",
                body_markdown="corp",
            )
        )
        await session.commit()
    async with factory() as session:
        ub, ut, tr, errors = await svc.apply_find_replace(
            session,
            find="zebra",
            replace="horse",
            case_sensitive=True,
            key_prefix="page.",
        )
        assert ub == 1
        assert ut == 1
        assert errors == []


async def test_check_content_links_image_blank_url(factory, naive_now):
    """A block image with a blank url is skipped (1681->1679)."""
    block = await _add_block(
        factory, key="page.imgblank", lang="en", body_markdown="no refs"
    )
    await _add_image(factory, block, url="   ")
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.imgblank")
        assert issues == []


async def test_check_content_links_preview_no_content_refs(
    factory, naive_now, tmp_path, monkeypatch
):
    """A preview with only product/category refs (no page/blog) leaves
    resolved_targets empty (2051->2067)."""
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    await _seed_link_target(factory)
    async with factory() as session:
        issues = await svc.check_content_links_preview(
            session,
            key="preview",
            body_markdown="[p](/products/prodx) [c](/shop/catx)",
        )
        assert all(i.reason != "Content not found" for i in issues)


async def test_add_image(factory, monkeypatch):
    monkeypatch.setattr(
        storage, "save_upload", lambda *a, **k: ("/media/up.png", "up.png")
    )
    block = await _add_block(factory, key="page.ai", lang="en")
    await _add_image(factory, block, url="/media/existing.png", sort_order=3)
    async with factory() as session:
        fresh = await session.get(ContentBlock, block.id)
        await session.refresh(fresh, attribute_names=["images"])
        out = await svc.add_image(session, fresh, object(), actor_id=uuid4())
        assert any(img.url == "/media/up.png" for img in out.images)


async def test_rollback_updates_and_removes_translations(factory):
    await _add_block(factory, key="page.rbt", lang="en")
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.rbt")
        # Existing translations: 'ro' will be updated, 'de' will be removed.
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id, lang="ro", title="old", body_markdown="vechi"
            )
        )
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id, lang="de", title="d", body_markdown="d"
            )
        )
        session.add(
            ContentBlockVersion(
                content_block_id=block.id,
                version=1,
                title="V1",
                body_markdown="Body",
                status=ContentStatus.draft,
                meta=None,
                lang="en",
                published_at=None,
                published_until=None,
                translations=[
                    {"lang": "ro", "title": "nou", "body_markdown": "nou corp"},
                ],
            )
        )
        await session.commit()
    async with factory() as session:
        rolled = await svc.rollback_to_version(session, key="page.rbt", version=1)
        await session.refresh(rolled, attribute_names=["translations"])
        langs = {t.lang for t in rolled.translations}
        assert "ro" in langs
        assert "de" not in langs
        ro = next(t for t in rolled.translations if t.lang == "ro")
        assert ro.title == "nou"


async def test_apply_find_replace_translation_only(factory):
    """Only a translation matches (base unchanged); covers tr-only branches and
    the ``base_changed`` False path."""
    await _add_block(
        factory, key="page.tro", lang="en", title="nomatch", body_markdown="nomatch"
    )
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.tro")
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id,
                lang="ro",
                title="zebra",  # title matches
                body_markdown="plain",  # body no match
            )
        )
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id,
                lang="de",
                title="plain",  # no match at all -> tr_changed False (continue)
                body_markdown="plain",
            )
        )
        await session.commit()
    async with factory() as session:
        ub, ut, tr, errors = await svc.apply_find_replace(
            session, find="zebra", replace="horse", case_sensitive=True
        )
        assert ub == 1
        assert ut == 1
        assert errors == []


async def test_apply_find_replace_translation_sanitize_error(factory):
    await _add_block(factory, key="page.trse", lang="en", title="x", body_markdown="x")
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.trse")
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id,
                lang="ro",
                title="ok",
                body_markdown="safe corp",
            )
        )
        await session.commit()
    async with factory() as session:
        ub, ut, tr, errors = await svc.apply_find_replace(
            session, find="safe", replace="<iframe>", case_sensitive=True
        )
        assert errors and errors[0]["key"] == "page.trse"


async def test_check_content_links_register_extras(
    factory, naive_now, tmp_path, monkeypatch
):
    """Covers register() + issue branches: leading-slash-less media, blog refs,
    existing media file, draft target (not public), and expired published_until.
    """
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    (tmp_path / "ok.png").write_bytes(b"x")
    now = datetime.now(timezone.utc)
    # A draft target page and an expired (published_until in past) page.
    await _add_block(
        factory, key="page.drafttarget", lang="en", status=ContentStatus.draft
    )
    await _add_block(
        factory,
        key="blog.expired",
        lang="en",
        status=ContentStatus.published,
        published_at=now - timedelta(days=5),
        published_until=now - timedelta(days=1),
    )
    body = (
        "[media-rel](media/ok.png) "  # leading-slash-less media that exists
        "[media-ok](/media/ok.png) "  # existing media -> no issue
        "[blog-bad](/blog/expired) "  # published but expired -> not public
        "[page-draft](/pages/drafttarget) "  # draft -> not public
        "[shop-noslug](/shop) "  # /shop with <2 parts
    )
    await _add_block(factory, key="page.regextra", lang="en", body_markdown=body)
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.regextra")
        reasons = [i.reason for i in issues]
        assert "Content is not publicly visible" in reasons


async def test_check_content_links_preview_register_extras(
    factory, naive_now, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    (tmp_path / "pv.png").write_bytes(b"x")
    body = (
        "[media-rel](media/pv.png) "
        "[media-ok](/media/pv.png) "
        "[media-bad](/media/missing.png) "
        "[blog-missing](/blog/ghostb) "
        "[shop-cat](/shop/somecat) "
        "[shop-noslug](/shop) "
        "[prod-empty](/products/) "
        "[page-empty](/pages/) "
    )
    async with factory() as session:
        issues = await svc.check_content_links_preview(
            session, key="preview", body_markdown=body
        )
        reasons = {i.reason for i in issues}
        assert "Media file not found" in reasons
        assert "Content not found" in reasons


async def test_preview_find_replace_meta_key_only(factory):
    """A block matched by the LIKE on cast(meta) where the term is only in a JSON
    KEY (not a value) yields 0 real matches -> the block is skipped (1308/1314)."""
    await _add_block(
        factory,
        key="page.metakey",
        lang="en",
        title="plain title",
        body_markdown="plain body",
        meta={"zzz": "value"},  # term 'zzz' only in key
    )
    async with factory() as session:
        block = await svc.get_block_by_key(session, "page.metakey")
        # Translation with no match either.
        session.add(
            ContentBlockTranslation(
                content_block_id=block.id, lang="ro", title="x", body_markdown="y"
            )
        )
        await session.commit()
    async with factory() as session:
        items, ti, tm, truncated = await svc.preview_find_replace(
            session, find="zzz", replace="QQQ", case_sensitive=True
        )
        assert ti == 0


async def test_apply_find_replace_meta_key_only(factory):
    await _add_block(
        factory,
        key="page.ametakey",
        lang="en",
        title="plain",
        body_markdown="plain",
        meta={"www": "value"},
    )
    async with factory() as session:
        ub, ut, tr, errors = await svc.apply_find_replace(
            session, find="www", replace="X", case_sensitive=True
        )
        assert ub == 0
        assert errors == []


async def test_check_content_links_category_and_path_branches(factory, naive_now):
    await _seed_link_target(factory)
    body = (
        "[cat-query-ok](/shop?category=catx) "  # existing category via query
        "[shop-cat-ok](/shop/catx) "  # existing category via path
        "[pages-empty](/pages/) "  # empty slug -> continue
        "[blog-empty](/blog/) "  # empty slug -> continue
        "[bare](/somethingelse) "  # matches no prefix -> fall through
        "[root](/) "
    )
    await _add_block(factory, key="page.catbranch", lang="en", body_markdown=body)
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.catbranch")
        # The existing category / path links produce no "Category not found".
        assert all(i.reason != "Category not found" for i in issues)


async def test_check_content_links_blog_not_public(factory, naive_now):
    """A blog target that is draft -> Content is not publicly visible."""
    await _add_block(
        factory, key="blog.draftpost", lang="en", status=ContentStatus.draft
    )
    await _add_block(
        factory, key="page.blogref", lang="en", body_markdown="[b](/blog/draftpost)"
    )
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.blogref")
        assert any(i.reason == "Content is not publicly visible" for i in issues)


async def test_check_content_links_expired_until(factory, naive_now):
    now = datetime.now(timezone.utc)
    await _add_block(
        factory,
        key="page.expuntil",
        lang="en",
        status=ContentStatus.published,
        published_at=now - timedelta(days=5),
        published_until=now - timedelta(days=1),
    )
    await _add_block(
        factory, key="page.expref", lang="en", body_markdown="[x](/pages/expuntil)"
    )
    async with factory() as session:
        issues = await svc.check_content_links(session, key="page.expref")
        assert any(i.reason == "Content is not publicly visible" for i in issues)


async def test_check_content_links_preview_branch_extras(
    factory, naive_now, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    await _seed_link_target(factory)
    now = datetime.now(timezone.utc)
    await _add_block(factory, key="page.pvdraft", lang="en", status=ContentStatus.draft)
    await _add_block(
        factory,
        key="page.pvexp",
        lang="en",
        status=ContentStatus.published,
        published_at=now - timedelta(days=5),
        published_until=now - timedelta(days=1),
    )
    body = (
        "[cat-query-ok](/shop?category=catx) "
        "[shop-cat-ok](/shop/catx) "
        "[prod-ok](/products/prodx) "
        "[prod-draft](/products/proddraft) "
        "[page-draft](/pages/pvdraft) "
        "[page-exp](/pages/pvexp) "
        "[pages-empty](/pages/) "
        "[blog-empty](/blog/) "
        "[bare](/nothing) "
    )
    async with factory() as session:
        issues = await svc.check_content_links_preview(
            session, key="preview", body_markdown=body
        )
        reasons = [i.reason for i in issues]
        assert "Content is not publicly visible" in reasons
        assert "Product is not publicly visible" in reasons


async def test_check_content_links_preview_redirect_err(factory, naive_now):
    async with factory() as session:
        session.add(ContentRedirect(from_key="page.p1", to_key="page.p2"))
        session.add(ContentRedirect(from_key="page.p2", to_key="page.p1"))
        await session.commit()
        issues = await svc.check_content_links_preview(
            session, key="preview", body_markdown="[x](/pages/p1)"
        )
        assert any(i.reason == "Redirect loop" for i in issues)
