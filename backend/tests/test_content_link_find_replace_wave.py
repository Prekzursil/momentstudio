from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import content as content_service


class _ScalarResult:
    def __init__(self, values):
        self._values = list(values)

    def __iter__(self):
        return iter(self._values)

    def all(self):
        return list(self._values)


class _ExecuteResult:
    def __init__(self, *, rows=None, scalar_values=None):
        self._rows = list(rows or [])
        self._scalar_values = list(scalar_values or [])

    def all(self):
        return list(self._rows)

    def scalars(self):
        return _ScalarResult(self._scalar_values)


class _FakeSession:
    def __init__(self):
        self.execute_results: list[_ExecuteResult] = []

    async def execute(self, _statement):
        await asyncio.sleep(0)
        if self.execute_results:
            return self.execute_results.pop(0)
        return _ExecuteResult()


def test_content_sanitize_and_event_handler_helpers() -> None:
    content_service._sanitize_markdown("# Title")
    assert content_service._is_event_handler_boundary_char("a") is True
    assert content_service._is_event_handler_name_char("9") is True
    assert content_service._has_event_handler_assignment("onclick = 'x'", 0, text_len=12) is True
    assert content_service._contains_inline_event_handler('onclick="x"') is True
    assert content_service._contains_inline_event_handler("harmonyonline") is False

    with pytest.raises(content_service.HTTPException, match="Disallowed markup"):
        content_service._sanitize_markdown("<script>alert(1)</script>")

    with pytest.raises(content_service.HTTPException, match="Disallowed event handlers"):
        content_service._sanitize_markdown('<div onload="x"></div>')


def test_content_find_replace_and_preview_helpers() -> None:
    replaced, count = content_service._find_replace_subn("Alpha alpha", "alpha", "beta", case_sensitive=False)
    assert replaced == "beta beta"
    assert count == 2

    payload, changed = content_service._find_replace_in_json(
        {"k": ["Alpha", {"deep": "alpha"}]},
        "alpha",
        "omega",
        case_sensitive=False,
    )
    assert changed == 2
    assert payload["k"][1]["deep"] == "omega"

    block = SimpleNamespace(
        key="page.about",
        title="Alpha",
        body_markdown="alpha alpha",
        meta={"text": "alpha"},
        translations=[SimpleNamespace(lang="ro", title="alpha", body_markdown="none")],
    )
    item, matches = content_service._build_preview_find_replace_item(
        block,
        find="alpha",
        replace="beta",
        case_sensitive=False,
    )
    assert item is not None
    assert matches >= 4


def test_content_markdown_reference_extractors() -> None:
    assert content_service._normalize_md_url(" < /media/img.png > ") == "/media/img.png"
    assert content_service._normalize_md_url("mailto:test@example.com") == ""

    body = "![img](/media/a.png) [prod](/products/ring)"
    image_urls = content_service._extract_markdown_target_urls(body, image_only=True)
    link_urls = content_service._extract_markdown_target_urls(body, image_only=False)
    assert image_urls == ["/media/a.png"]
    assert link_urls == ["/products/ring"]

    refs = content_service._extract_markdown_refs(body)
    assert len(refs) == 2

    text_block_refs = content_service._refs_from_text_block({"body_markdown": body}, prefix="meta.blocks[0]")
    assert len(text_block_refs) == 2

    asset_refs = content_service._refs_from_asset_block("image", {"url": "/media/a.png", "link_url": "/pages/about"}, prefix="meta.blocks[1]")
    assert len(asset_refs) == 2

    meta_refs = content_service._extract_block_refs({"blocks": [{"type": "text", "body_markdown": body}]})
    assert len(meta_refs) == 2


def test_content_target_collection_and_redirect_helpers() -> None:
    product_slugs: set[str] = set()
    category_slugs: set[str] = set()
    page_keys: set[str] = set()
    blog_keys: set[str] = set()
    media_urls: set[str] = set()

    content_service._register_content_target_url(
        "/products/Ring-1",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/shop/rings?sub=gold",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/pages/about-us",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/blog/news-post",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )

    assert "Ring-1" in product_slugs
    assert "rings" in category_slugs
    assert "gold" in category_slugs
    assert "page.about-us" in page_keys
    assert "blog.news-post" in blog_keys

    resolved, error = content_service._resolve_redirect_chain(
        "page.a",
        {"page.a": "page.b", "page.b": "page.c"},
    )
    assert resolved == "page.c"
    assert error is None

    _, loop_error = content_service._resolve_redirect_chain("x", {"x": "y", "y": "x"})
    assert loop_error == "Redirect loop"


def test_content_link_reason_and_visibility_helpers() -> None:
    assert content_service._resolve_content_link_key("/pages/about") == "page.about"
    assert content_service._resolve_content_link_key("/blog/entry") == "blog.entry"
    assert content_service._resolve_content_link_key("/unknown") is None

    now = datetime.now(timezone.utc)
    published = content_service._is_content_public(
        content_service.ContentStatus.published,
        published_at=now - timedelta(seconds=1),
        published_until=now + timedelta(seconds=1),
        now=now,
        allow_until_equal=False,
    )
    hidden = content_service._is_content_public(
        content_service.ContentStatus.draft,
        published_at=None,
        published_until=None,
        now=now,
        allow_until_equal=True,
    )
    assert published is True
    assert hidden is False

    reason = content_service._resolve_content_link_reason(
        "page.about",
        resolved_keys={"page.about": ("page.about", None)},
        blocks_by_key={"page.about": (content_service.ContentStatus.draft, None, None)},
        is_public=lambda status, *_: status == content_service.ContentStatus.published,
    )
    assert reason == "Content is not publicly visible"


def test_content_build_link_issues_dispatches_expected_reasons(monkeypatch: pytest.MonkeyPatch) -> None:
    refs = [
        ("link", "markdown", "body_markdown", "/products/missing"),
        ("link", "markdown", "body_markdown", "/shop/missing"),
        ("link", "markdown", "body_markdown", "/pages/missing"),
    ]

    monkeypatch.setattr(content_service, "_media_url_exists", lambda _path: True)

    issues = content_service._build_link_issues(
        refs,
        content_key="page.home",
        products_by_slug={},
        existing_categories=set(),
        resolved_keys={"page.missing": ("page.missing", None)},
        blocks_by_key={},
        is_public=lambda *_args, **_kwargs: False,
    )
    reasons = {item.reason for item in issues}
    assert "Product not found" in reasons
    assert "Category not found" in reasons
    assert "Content not found" in reasons


@pytest.mark.anyio
async def test_content_load_context_helpers_and_preview_link_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    session.execute_results = [
        _ExecuteResult(rows=[("ring", content_service.ProductStatus.published, False)]),
        _ExecuteResult(scalar_values=["rings"]),
        _ExecuteResult(rows=[("page.a", "page.b")]),
        _ExecuteResult(rows=[("page.b", content_service.ContentStatus.published, None, None)]),
    ]

    products_by_slug, existing_categories, resolved_keys, blocks_by_key = await content_service._load_link_validation_context(
        session,
        product_slugs={"ring"},
        category_slugs={"rings"},
        page_keys={"page.a"},
        blog_keys=set(),
    )
    assert products_by_slug["ring"][0] == content_service.ProductStatus.published
    assert "rings" in existing_categories
    assert resolved_keys["page.a"][0] == "page.b"
    assert "page.b" in blocks_by_key

    async def _load_context(_session, **_kwargs):
        await asyncio.sleep(0)
        return products_by_slug, existing_categories, resolved_keys, blocks_by_key

    monkeypatch.setattr(content_service, "_load_link_validation_context", _load_context)

    preview = await content_service.check_content_links_preview(
        session,
        key="preview.page",
        body_markdown="[ok](/pages/a)",
        meta={"blocks": [{"type": "image", "url": "/media/missing.png"}]},
        images=["/media/also-missing.png"],
    )
    assert isinstance(preview, list)


def test_content_find_replace_plan_and_apply_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    block = SimpleNamespace(
        key="page.terms",
        lang="ro",
        title="alpha",
        body_markdown="alpha",
        meta={"k": "alpha"},
        needs_translation_en=False,
        needs_translation_ro=True,
        translations=[SimpleNamespace(lang="en", title="alpha", body_markdown="alpha")],
    )

    base_changed, base_matches, next_title, next_body, next_meta = content_service._plan_base_find_replace_update(
        block,
        find="alpha",
        replace="beta",
        case_sensitive=False,
    )
    assert base_changed is True
    assert base_matches >= 3

    langs, rows_changed, tr_total, updates = content_service._plan_translation_find_replace_updates(
        block,
        find="alpha",
        replace="beta",
        case_sensitive=False,
    )
    assert langs == {"en"}
    assert rows_changed == 1
    assert tr_total == 2

    content_service._apply_translation_replacements(updates)
    content_service._apply_base_replacement(
        block,
        base_changed=base_changed,
        next_title=next_title,
        next_body=next_body,
        next_meta=next_meta,
    )

    marks: list[str] = []
    clears: list[str] = []
    monkeypatch.setattr(content_service, "_mark_other_needs_translation", lambda _block, lang: marks.append(lang))
    monkeypatch.setattr(content_service, "_clear_needs_translation", lambda _block, lang: clears.append(lang))
    content_service._update_translation_flags_after_find_replace(
        block,
        base_changed=True,
        translations_changed_langs={"en"},
    )
    assert marks == ["ro"]
    assert clears == ["en"]


class _NestedSession(_FakeSession):
    def __init__(self):
        super().__init__()
        self.added: list[object] = []
        self.commit_calls = 0
        self.refresh_calls = 0

    class _BeginNested:
        async def __aenter__(self):
            return None

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def begin_nested(self):
        return self._BeginNested()

    def add(self, value: object) -> None:
        self.added.append(value)

    async def refresh(self, _obj, attribute_names=None):
        await asyncio.sleep(0)
        self.refresh_calls += 1

    async def commit(self):
        await asyncio.sleep(0)
        self.commit_calls += 1


@pytest.mark.anyio
async def test_content_apply_find_replace_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _NestedSession()
    block = SimpleNamespace(
        key="page.legal",
        lang="ro",
        title="alpha",
        body_markdown="alpha",
        meta={},
        version=1,
        translations=[SimpleNamespace(lang="en", title="alpha", body_markdown="alpha")],
    )

    async def _audit(*_args, **_kwargs):
        await asyncio.sleep(0)

    monkeypatch.setattr(content_service, "_add_block_version_and_audit", _audit)
    monkeypatch.setattr(content_service, "_enforce_legal_pages_bilingual", lambda *_args, **_kwargs: None)

    changed, tr_rows, matches = await content_service._apply_find_replace_to_block(
        session,
        block=block,
        find="alpha",
        replace="beta",
        case_sensitive=False,
        actor_id=None,
    )
    assert changed is True
    assert tr_rows == 1
    assert matches >= 3
    assert block.version == 2

    blocks = [SimpleNamespace(key="page.ok"), SimpleNamespace(key="page.bad")]
    session.execute_results = [_ExecuteResult(scalar_values=blocks)]

    async def _apply_one(_session, *, block, **_kwargs):
        await asyncio.sleep(0)
        if block.key == "page.bad":
            raise content_service.HTTPException(status_code=400, detail="bad")
        return True, 2, 5

    monkeypatch.setattr(content_service, "_apply_find_replace_to_block", _apply_one)
    updated_blocks, updated_translations, replacements, errors = await content_service.apply_find_replace(
        session,
        find="x",
        replace="y",
        case_sensitive=True,
    )
    assert (updated_blocks, updated_translations, replacements) == (1, 2, 5)
    assert errors == [{"key": "page.bad", "error": "bad"}]
    assert session.refresh_calls == 1
    assert session.commit_calls >= 1


@pytest.mark.anyio
async def test_content_check_links_not_found_and_success(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()

    async def _none(_session, _key):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(content_service, "get_block_by_key", _none)
    with pytest.raises(content_service.HTTPException, match="Content not found"):
        await content_service.check_content_links(session, key="page.missing")

    block = SimpleNamespace(key="page.home", body_markdown="[ok](/pages/a)", meta=None, images=[])

    async def _block(_session, _key):
        await asyncio.sleep(0)
        return block

    async def _ctx(_session, **_kwargs):
        await asyncio.sleep(0)
        return {}, set(), {"page.a": ("page.a", None)}, {"page.a": (content_service.ContentStatus.published, None, None)}

    monkeypatch.setattr(content_service, "get_block_by_key", _block)
    monkeypatch.setattr(content_service, "_load_link_validation_context", _ctx)

    issues = await content_service.check_content_links(session, key="page.home")
    assert issues == []
