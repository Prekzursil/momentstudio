from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import literal, select

from app.models.catalog import Product, Tag
from app.services import catalog as catalog_service


class _ScalarResult:
    def __init__(self, values):
        self._values = list(values)

    def __iter__(self):
        return iter(self._values)

    def all(self):
        return list(self._values)

    def unique(self):
        return self


class _ExecuteResult:
    def __init__(self, *, one_row=None, scalar_one=None, scalar_values=None, rows=None):
        self._one_row = one_row
        self._scalar_one = scalar_one
        self._scalar_values = list(scalar_values or [])
        self._rows = list(rows or [])

    def one(self):
        return self._one_row

    def scalar_one(self):
        return self._scalar_one

    def scalars(self):
        return _ScalarResult(self._scalar_values)

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self):
        self.execute_results: list[_ExecuteResult] = []
        self.scalar_results: list[object] = []
        self.added: list[object] = []
        self.flush_calls = 0
        self.commit_calls = 0
        self.refresh_calls = 0

    async def execute(self, _statement):
        await asyncio.sleep(0)
        if self.execute_results:
            return self.execute_results.pop(0)
        return _ExecuteResult(rows=[])

    async def scalar(self, _statement):
        await asyncio.sleep(0)
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return 0

    async def flush(self):
        await asyncio.sleep(0)
        self.flush_calls += 1

    async def commit(self):
        await asyncio.sleep(0)
        self.commit_calls += 1

    async def refresh(self, _obj):
        await asyncio.sleep(0)
        self.refresh_calls += 1

    def add(self, obj):
        self.added.append(obj)


def test_catalog_query_and_search_helpers_cover_branches() -> None:
    assert catalog_service.slugify("  Gold Ring / 24K ") == "gold-ring-24k"
    assert catalog_service._normalize_search_text(" Șnur Áccent ") == "snur accent"
    assert catalog_service._normalize_search_text("   ") == ""

    expr = catalog_service._normalized_search_expr(Product.name)
    assert expr is not None

    query_public = catalog_service._build_product_price_bounds_query(
        literal(Decimal("10.00")),
        include_unpublished=False,
    )
    query_all = catalog_service._build_product_price_bounds_query(
        literal(Decimal("10.00")),
        include_unpublished=True,
    )
    assert "is_deleted" in str(query_public)
    assert "is_deleted" in str(query_all)


def test_catalog_price_bounds_filter_helpers() -> None:
    base = select(Product)
    sale_active = literal(True)

    searched = catalog_service._apply_price_bounds_search_filter(base, "ring")
    no_search = catalog_service._apply_price_bounds_search_filter(base, "   ")
    assert searched is not None
    assert no_search is not None

    filtered = catalog_service._apply_price_bounds_state_filters(
        base,
        sale_active=sale_active,
        on_sale=True,
        is_featured=False,
        tags=["gift"],
    )
    no_filters = catalog_service._apply_price_bounds_state_filters(
        base,
        sale_active=sale_active,
        on_sale=None,
        is_featured=None,
        tags=None,
    )
    assert filtered is not None
    assert no_filters is not None


@pytest.mark.anyio
async def test_catalog_apply_price_bounds_category_filter_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    base = select(Product.id)
    category_id = uuid4()
    session.execute_results = [_ExecuteResult(scalar_values=[category_id])]

    async def _descendants(_session, _slug):
        await asyncio.sleep(0)
        return [category_id]

    monkeypatch.setattr(catalog_service, "_get_category_and_descendant_ids_by_slug", _descendants)

    with_visible = await catalog_service._apply_price_bounds_category_filter(
        session,
        base,
        "rings",
        include_unpublished=False,
    )
    no_slug = await catalog_service._apply_price_bounds_category_filter(
        session,
        base,
        None,
        include_unpublished=False,
    )

    async def _none(_session, _slug):
        await asyncio.sleep(0)
        return []

    monkeypatch.setattr(catalog_service, "_get_category_and_descendant_ids_by_slug", _none)
    no_categories = await catalog_service._apply_price_bounds_category_filter(
        session,
        base,
        "missing",
        include_unpublished=False,
    )
    assert with_visible is not None
    assert no_slug is base
    assert no_categories is not None


@pytest.mark.anyio
async def test_catalog_get_product_price_bounds_maps_currency_count(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    session.execute_results = [_ExecuteResult(one_row=(Decimal("1.23"), Decimal("5.67"), 1, "RON"))]

    async def _identity(_session, query, _slug, include_unpublished=False):
        await asyncio.sleep(0)
        return query

    monkeypatch.setattr(catalog_service, "_apply_price_bounds_category_filter", _identity)
    bounds = await catalog_service.get_product_price_bounds(
        session,
        category_slug=None,
        on_sale=None,
        is_featured=None,
        search=None,
        tags=None,
        include_unpublished=False,
    )
    assert bounds == (1.23, 5.67, "RON")

    session.execute_results = [_ExecuteResult(one_row=(None, None, 2, "RON"))]
    multi_currency = await catalog_service.get_product_price_bounds(
        session,
        category_slug=None,
        on_sale=None,
        is_featured=None,
        search=None,
        tags=None,
        include_unpublished=False,
    )
    assert multi_currency == (0.0, 0.0, None)


def test_catalog_listing_sort_and_filter_helpers() -> None:
    base = select(Product)
    sale_active = literal(True)
    effective_price = literal(Decimal("9.99"))

    out = catalog_service._apply_products_listing_filters(
        base,
        sale_active=sale_active,
        on_sale=False,
        is_featured=True,
        search="bracelet",
        min_price=1.0,
        max_price=9.0,
        tags=["featured"],
        effective_price=effective_price,
    )
    assert out is not None

    for sort_name in ("recommended", "price_asc", "price_desc", "name_asc", "name_desc", None):
        sorted_query = catalog_service._apply_products_listing_sort(base, sort=sort_name, effective_price=effective_price)
        assert sorted_query is not None


@pytest.mark.anyio
async def test_catalog_listing_count_page_and_translation_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    items = [SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())]
    session.execute_results = [
        _ExecuteResult(scalar_one=2),
        _ExecuteResult(scalar_values=items),
    ]
    count = await catalog_service._count_products_for_listing(session, select(Product))
    loaded = await catalog_service._load_products_page(session, select(Product), limit=10, offset=0)
    assert count == 2
    assert loaded == items

    applied: list[str] = []

    def _apply_translation(_item, lang):
        applied.append(lang or "")

    monkeypatch.setattr(catalog_service, "apply_product_translation", _apply_translation)
    catalog_service._apply_listing_translations(loaded, "en")
    assert applied == ["en", "en"]


@pytest.mark.anyio
async def test_catalog_get_or_create_tags_reuses_existing_and_creates_new() -> None:
    session = _FakeSession()
    existing = Tag(name="Ring", slug="ring")
    session.execute_results = [_ExecuteResult(scalar_values=[existing])]

    tags = await catalog_service._get_or_create_tags(session, ["Ring", "Bracelet"])
    assert len(tags) == 2
    assert tags[0].slug == "ring"
    assert tags[1].slug == "bracelet"
    assert session.flush_calls == 1
    assert any(isinstance(item, Tag) and item.slug == "bracelet" for item in session.added)


@pytest.mark.anyio
async def test_catalog_duplicate_slug_and_product_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    duplicate_errors = [catalog_service.HTTPException(status_code=400, detail="dup"), None]

    async def _ensure_slug_unique(_session, _slug):
        await asyncio.sleep(0)
        maybe_error = duplicate_errors.pop(0) if duplicate_errors else None
        if maybe_error:
            raise maybe_error

    monkeypatch.setattr(catalog_service, "_ensure_slug_unique", _ensure_slug_unique)
    slug = await catalog_service._generate_duplicate_slug(session, "gold-ring")
    assert slug.startswith("gold-ring-copy")

    product_id = uuid4()
    product = SimpleNamespace(id=product_id, slug="gold-ring", category_id=uuid4())
    clone = SimpleNamespace(id=uuid4(), slug="gold-ring-copy", category_id=product.category_id)
    log_calls: list[tuple[str, object]] = []

    async def _unique_sku(_session, _slug):
        await asyncio.sleep(0)
        return "SKU-COPY"

    async def _sort_order(_session, _category_id):
        await asyncio.sleep(0)
        return 9

    def _build_clone(_product, *, new_slug, new_sku, sort_order):
        assert new_slug and new_sku and sort_order == 9
        return clone

    async def _log_action(_session, item_id, action, _user_id, _payload):
        await asyncio.sleep(0)
        log_calls.append((action, item_id))

    monkeypatch.setattr(catalog_service, "_generate_unique_sku", _unique_sku)
    monkeypatch.setattr(catalog_service, "_resolve_duplicate_sort_order", _sort_order)
    monkeypatch.setattr(catalog_service, "_build_duplicate_product_clone", _build_clone)
    monkeypatch.setattr(catalog_service, "_log_product_action", _log_action)

    duplicated = await catalog_service.duplicate_product(session, product, user_id=uuid4(), source="admin")
    assert duplicated is clone
    assert session.commit_calls == 1
    assert session.refresh_calls == 1
    assert log_calls == [("duplicate", clone.id)]
