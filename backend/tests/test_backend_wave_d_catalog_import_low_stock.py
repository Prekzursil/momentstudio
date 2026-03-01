from __future__ import annotations
import asyncio

import csv
import io
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.models.catalog import Category, CategoryTranslation
from app.services import catalog as catalog_service


class _ScalarAccessor:
    def __init__(self, values):
        self._values = list(values)

    def all(self):
        return list(self._values)

    def unique(self):
        return self

    def __iter__(self):
        return iter(self._values)


class _ExecuteResult:
    def __init__(self, *, rows=None, scalar_values=None, scalar_one=None):
        self._rows = list(rows or [])
        self._scalar_values = list(scalar_values or [])
        self._scalar_one = scalar_one

    def all(self):
        return list(self._rows)

    def scalars(self):
        return _ScalarAccessor(self._scalar_values)

    def scalar_one_or_none(self):
        return self._scalar_one


class _FakeSession:
    def __init__(self):
        self.added: list[object] = []
        self.added_batches: list[list[object]] = []
        self.execute_results: list[_ExecuteResult] = []
        self.scalar_results: list[object] = []
        self.commit_calls = 0
        self.rollback_calls = 0
        self.flush_calls = 0
        self.refresh_calls = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    def add_all(self, values: list[object]) -> None:
        self.added_batches.append(list(values))

    async def execute(self, _statement):
        await asyncio.sleep(0)
        if self.execute_results:
            return self.execute_results.pop(0)
        return _ExecuteResult()

    async def scalar(self, _statement):
        await asyncio.sleep(0)
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commit_calls += 1

    async def rollback(self) -> None:
        await asyncio.sleep(0)
        self.rollback_calls += 1

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flush_calls += 1

    async def refresh(self, _value: object) -> None:
        await asyncio.sleep(0)
        self.refresh_calls += 1


@pytest.mark.anyio
async def test_catalog_wave_d_product_import_parsers_and_apply_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    required = catalog_service._import_product_required_fields(
        {"slug": " test-product ", "name": " Test Product ", "category_slug": " rings "}
    )
    assert required == ("test-product", "Test Product", "rings")

    parsed, err = catalog_service._parse_import_product_pricing_or_error(
        {"base_price": "12.2", "stock_quantity": "5"}, idx=2
    )
    assert err is None
    assert parsed == (Decimal("12.20"), 5)

    _, err = catalog_service._parse_import_product_pricing_or_error(
        {"base_price": "bad", "stock_quantity": "nan"}, idx=9
    )
    assert err == "Row 9: invalid base_price or stock_quantity"

    currency, err = catalog_service._parse_import_product_currency_or_error({"currency": "ron"}, idx=2)
    assert currency == "RON"
    assert err is None

    _, err = catalog_service._parse_import_product_currency_or_error({"currency": "eur"}, idx=4)
    assert err == "Row 4: currency must be RON"

    status_enum, err = catalog_service._parse_import_product_status_or_error({"status": "published"}, idx=5)
    assert status_enum is not None
    assert status_enum.value == "published"
    _, err = catalog_service._parse_import_product_status_or_error({"status": "oops"}, idx=5)
    assert err == "Row 5: invalid status oops"

    row_data, err = catalog_service._parse_import_product_row(
        {
            "slug": "p-1",
            "name": " Product 1 ",
            "category_slug": "rings",
            "base_price": "20",
            "stock_quantity": "4",
            "currency": "ron",
            "status": "draft",
            "is_featured": "yes",
            "is_active": "0",
            "short_description": " short ",
            "long_description": "",
            "tags": "new, sale, , gift",
        },
        idx=2,
    )
    assert err is None
    assert row_data == {
        "slug": "p-1",
        "name": "Product 1",
        "category_slug": "rings",
        "base_price": Decimal("20.00"),
        "stock_quantity": 4,
        "currency": "RON",
        "status_enum": catalog_service.ProductStatus.draft,
        "is_featured": True,
        "is_active": False,
        "short_description": "short",
        "long_description": None,
        "tag_slugs": ["new", "sale", "gift"],
    }

    missing_data, missing_err = catalog_service._parse_import_product_row({"slug": "", "name": "", "category_slug": ""}, idx=7)
    assert missing_data is None
    assert missing_err == "Row 7: missing slug, name, or category_slug"

    category_id = uuid4()
    update_payload = catalog_service._build_import_product_update_payload(
        {
            "name": "P",
            "base_price": Decimal("10.00"),
            "currency": "RON",
            "stock_quantity": 2,
            "status_enum": catalog_service.ProductStatus.published,
            "is_featured": True,
            "is_active": True,
            "short_description": None,
            "long_description": "Long",
            "tag_slugs": ["a", "b"],
        },
        category_id,
    )
    assert update_payload.category_id == category_id
    assert update_payload.tags == ["a", "b"]

    create_payload = catalog_service._build_import_product_create_payload(
        {
            "slug": "p-2",
            "name": "P2",
            "base_price": Decimal("8.00"),
            "currency": "RON",
            "stock_quantity": 1,
            "status_enum": catalog_service.ProductStatus.draft,
            "is_featured": False,
            "is_active": True,
            "short_description": None,
            "long_description": None,
            "tag_slugs": [],
        },
        category_id,
    )
    assert create_payload.slug == "p-2"
    assert create_payload.category_id == category_id

    product = SimpleNamespace(id=uuid4())

    async def _get_existing(_session, _slug, follow_history=False):  # noqa: ARG001
        await asyncio.sleep(0)
        return product

    update_calls: list[object] = []

    async def _update(_session, _existing, payload, commit=False):  # noqa: ARG001
        await asyncio.sleep(0)
        update_calls.append(payload)

    monkeypatch.setattr(catalog_service, "get_product_by_slug", _get_existing)
    monkeypatch.setattr(catalog_service, "update_product", _update)

    created, updated = await catalog_service._apply_import_product_row(
        _FakeSession(),
        row_data={
            "slug": "p-2",
            "name": "Updated",
            "base_price": Decimal("1.00"),
            "currency": "RON",
            "stock_quantity": 1,
            "status_enum": catalog_service.ProductStatus.draft,
            "is_featured": False,
            "is_active": True,
            "short_description": None,
            "long_description": None,
            "tag_slugs": [],
        },
        category=SimpleNamespace(id=category_id),
        dry_run=False,
    )
    assert (created, updated) == (0, 1)
    assert len(update_calls) == 1

    async def _get_missing(_session, _slug, follow_history=False):  # noqa: ARG001
        await asyncio.sleep(0)
        return None

    create_calls: list[object] = []

    async def _create(_session, payload, commit=False):  # noqa: ARG001
        await asyncio.sleep(0)
        create_calls.append(payload)

    monkeypatch.setattr(catalog_service, "get_product_by_slug", _get_missing)
    monkeypatch.setattr(catalog_service, "create_product", _create)

    created, updated = await catalog_service._apply_import_product_row(
        _FakeSession(),
        row_data={
            "slug": "p-3",
            "name": "Created",
            "base_price": Decimal("2.00"),
            "currency": "RON",
            "stock_quantity": 2,
            "status_enum": catalog_service.ProductStatus.draft,
            "is_featured": False,
            "is_active": True,
            "short_description": None,
            "long_description": None,
            "tag_slugs": [],
        },
        category=SimpleNamespace(id=category_id),
        dry_run=False,
    )
    assert (created, updated) == (1, 0)
    assert len(create_calls) == 1

    session = _FakeSession()
    await catalog_service._finalize_import_products_transaction(session, dry_run=True, errors=[])
    await catalog_service._finalize_import_products_transaction(session, dry_run=False, errors=["err"])
    await catalog_service._finalize_import_products_transaction(session, dry_run=False, errors=[])
    assert session.rollback_calls == 1
    assert session.commit_calls == 1


@pytest.mark.anyio
async def test_catalog_wave_d_resolve_import_category_and_csv_export_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = SimpleNamespace(id=uuid4(), slug="rings", name="Rings")

    async def _get_found(_session, _slug):  # noqa: ARG001
        await asyncio.sleep(0)
        return existing

    monkeypatch.setattr(catalog_service, "get_category_by_slug", _get_found)
    category, err = await catalog_service._resolve_import_product_category(_FakeSession(), category_slug="rings", idx=2, dry_run=False)
    assert category is existing
    assert err is None

    async def _get_missing(_session, _slug):  # noqa: ARG001
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_service, "get_category_by_slug", _get_missing)
    category, err = await catalog_service._resolve_import_product_category(_FakeSession(), category_slug="missing", idx=4, dry_run=True)
    assert category is None
    assert err == "Row 4: category missing not found"

    session = _FakeSession()
    created, err = await catalog_service._resolve_import_product_category(session, category_slug="new-category", idx=5, dry_run=False)
    assert err is None
    assert created is not None
    assert created.slug == "new-category"
    assert session.flush_calls == 1
    assert any(isinstance(item, Category) for item in session.added)

    fieldnames = catalog_service._category_export_fieldnames()
    assert fieldnames[:4] == ["slug", "name", "parent_slug", "sort_order"]

    parent_id = uuid4()
    child = SimpleNamespace(
        id=uuid4(),
        slug="child",
        name="Child",
        parent_id=parent_id,
        sort_order=3,
        is_visible=True,
        description="Child desc",
        translations=[
            SimpleNamespace(lang="ro", name="Copil", description="Descriere"),
            SimpleNamespace(lang="en", name="Child EN", description="English"),
        ],
    )
    row = catalog_service._build_category_export_row(child, {parent_id: "parent"})
    assert row["parent_slug"] == "parent"
    assert row["name_ro"] == "Copil"
    assert row["description_en"] == "English"

    assert catalog_service._category_parent_slug(SimpleNamespace(parent_id=None), {}) == ""
    assert catalog_service._translation_name(None) == ""
    assert catalog_service._translation_description(None) == ""

    fake_categories = [
        SimpleNamespace(
            id=parent_id,
            slug="parent",
            name="Parent",
            parent_id=None,
            sort_order=0,
            is_visible=True,
            description="",
            translations=[],
        ),
        SimpleNamespace(
            id=uuid4(),
            slug="rings",
            name="Rings",
            parent_id=None,
            sort_order=0,
            is_visible=True,
            description="",
            translations=[],
        ),
        child,
    ]

    async def _load_categories(_session):
        await asyncio.sleep(0)
        return fake_categories

    monkeypatch.setattr(catalog_service, "_load_categories_for_csv_export", _load_categories)
    csv_text = await catalog_service.export_categories_csv(_FakeSession(), template=False)
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    assert len(rows) == 3
    child_row = next(row for row in rows if row["slug"] == "child")
    assert child_row["parent_slug"] == "parent"
    template_text = await catalog_service.export_categories_csv(_FakeSession(), template=True)
    assert "slug,name,parent_slug" in template_text


def test_catalog_wave_d_category_import_parse_helpers() -> None:
    assert catalog_service._parse_category_sort_order_or_error(2, "") == (0, None)
    assert catalog_service._parse_category_sort_order_or_error(2, "7") == (7, None)
    assert catalog_service._parse_category_sort_order_or_error(2, "bad") == (None, "Row 2: invalid sort_order bad")

    seen: set[str] = set()
    assert catalog_service._validate_category_slug_fields_or_error(2, slug="rings", name="Rings", seen=seen) is None
    assert catalog_service._validate_category_slug_fields_or_error(3, slug="", name="Rings", seen=seen) == "Row 3: missing slug or name"
    assert catalog_service._validate_category_slug_fields_or_error(4, slug="Bad Slug", name="Rings", seen=seen) == "Row 4: invalid slug Bad Slug"
    assert catalog_service._validate_category_slug_fields_or_error(5, slug="rings", name="Rings", seen=seen) == "Row 5: duplicate slug rings"

    parent, err = catalog_service._parse_category_parent_slug_or_error(2, slug="rings", raw_parent_slug="")
    assert parent is None and err is None
    _, err = catalog_service._parse_category_parent_slug_or_error(3, slug="rings", raw_parent_slug="rings")
    assert err == "Row 3: parent_slug cannot match slug"

    assert catalog_service._parse_category_is_visible("") is None
    assert catalog_service._parse_category_is_visible("false") is False
    assert catalog_service._parse_category_is_visible("1") is True

    name_ro, name_en, description_ro, description_en = catalog_service._category_translation_fields(
        {
            "name_ro": " Nume ",
            "name_en": " Name ",
            "description_ro": " RO ",
            "description_en": " EN ",
        }
    )
    assert (name_ro, name_en, description_ro, description_en) == ("Nume", "Name", "RO", "EN")

    assert (
        catalog_service._validate_category_translation_fields_or_error(
            2,
            name_ro="",
            name_en="Name",
            description_ro="has desc",
            description_en=None,
        )
        == "Row 2: description_ro provided without name_ro"
    )
    assert (
        catalog_service._validate_category_translation_fields_or_error(
            3,
            name_ro="Nume",
            name_en="",
            description_ro=None,
            description_en="has desc",
        )
        == "Row 3: description_en provided without name_en"
    )

    assert catalog_service._csv_trimmed_value({"slug": " a "}, "slug") == "a"
    assert catalog_service._csv_trimmed_value({}, "slug") == ""

    parsed, err = catalog_service._parse_category_import_row_or_error(
        2,
        {
            "slug": "rings",
            "name": "Rings",
            "parent_slug": "",
            "sort_order": "4",
            "is_visible": "true",
            "description": "Fine rings",
            "name_ro": "Inele",
            "description_ro": "descr",
            "name_en": "Rings",
            "description_en": "desc",
        },
        seen=set(),
    )
    assert err is None
    assert parsed["slug"] == "rings"
    assert parsed["is_visible"] is True

    parsed, err = catalog_service._parse_category_import_row_or_error(
        3,
        {
            "slug": "rings",
            "name": "Rings",
            "parent_slug": "rings",
            "sort_order": "1",
        },
        seen={"rings"},
    )
    assert parsed is None
    assert "duplicate slug" in err

    reader = csv.DictReader(
        io.StringIO(
            "slug,name,parent_slug,sort_order\n"
            "rings,Rings,,1\n"
            "bad slug,Bad,,1\n"
            "bracelets,Bracelets,rings,2\n"
        )
    )
    rows, errors = catalog_service._parse_category_import_rows(reader)
    assert len(rows) == 2
    assert len(errors) == 1
    assert "invalid slug" in errors[0]

    missing_errors = catalog_service._missing_parent_row_errors(
        [{"idx": 8, "parent_slug": "ghost"}, {"idx": 9, "parent_slug": None}], {"ghost"}
    )
    assert missing_errors == ["Row 8: parent category ghost not found"]

    rows_data = [{"slug": "a", "parent_slug": "b"}, {"slug": "b", "parent_slug": None}]
    assert catalog_service._parent_candidates_for_import(rows_data, {"a"}) == {"b"}

    cycle_err = catalog_service._category_hierarchy_error_for_row(
        {"idx": 10, "slug": "a", "parent_slug": "b"},
        proposed_parent_by_slug={"a": "b", "b": "a"},
        parent_slug_by_slug={},
    )
    assert cycle_err == "Row 10: Category parent would create a cycle"

    broken_err = catalog_service._category_hierarchy_error_for_row(
        {"idx": 11, "slug": "a", "parent_slug": "x"},
        proposed_parent_by_slug={"a": "x", "x": "y", "y": "x"},
        parent_slug_by_slug={},
    )
    assert broken_err == "Row 11: Invalid category hierarchy"


@pytest.mark.anyio
async def test_catalog_wave_d_category_import_mutation_and_translation_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    existing_category = SimpleNamespace(
        id=uuid4(),
        slug="rings",
        name="Rings",
        description="Old",
        sort_order=1,
        is_visible=True,
        parent_id=None,
    )
    by_slug = {"rings": existing_category}
    rows = [
        {
            "idx": 2,
            "slug": "rings",
            "name": "Updated Rings",
            "description": "New",
            "sort_order": 10,
            "is_visible": False,
        },
        {
            "idx": 3,
            "slug": "bracelets",
            "name": "Bracelets",
            "description": None,
            "sort_order": 11,
            "is_visible": None,
        },
    ]
    session = _FakeSession()
    catalog_service._upsert_categories_from_import_rows(session, rows, by_slug)
    assert existing_category.name == "Updated Rings"
    assert existing_category.sort_order == 10
    created = by_slug["bracelets"]
    assert isinstance(created, Category)
    assert created.is_visible is True

    rows_with_parents = [
        {"idx": 2, "slug": "rings", "parent_slug": None},
        {"idx": 3, "slug": "bracelets", "parent_slug": "rings"},
        {"idx": 4, "slug": "missing", "parent_slug": None},
    ]

    async def _validate_parent(_session, *, category_id, parent_id):  # noqa: ARG001
        await asyncio.sleep(0)
        if parent_id == existing_category.id:
            raise HTTPException(status_code=400, detail="Category parent would create a cycle")

    monkeypatch.setattr(catalog_service, "_validate_category_parent_assignment", _validate_parent)
    errors = await catalog_service._assign_import_category_parents(session, rows_with_parents, by_slug)
    assert "Row 3: Category parent would create a cycle" in errors
    assert "Row 4: category missing not found after upsert" in errors

    category = SimpleNamespace(id=uuid4())
    existing_translation = SimpleNamespace(name="Old", description="Old desc")

    session.scalar_results = [existing_translation, None]
    await catalog_service._upsert_import_category_translation_for_lang(
        session,
        category=category,
        lang="ro",
        raw_name="Nume",
        raw_desc="Descriere",
    )
    assert existing_translation.name == "Nume"
    assert existing_translation.description == "Descriere"

    await catalog_service._upsert_import_category_translation_for_lang(
        session,
        category=category,
        lang="en",
        raw_name="Name",
        raw_desc="",
    )
    assert any(isinstance(item, CategoryTranslation) and item.lang == "en" for item in session.added)

    upsert_calls: list[tuple[str, str]] = []

    async def _upsert_lang(_session, *, category, lang, raw_name, raw_desc):  # noqa: ARG001
        await asyncio.sleep(0)
        upsert_calls.append((lang, raw_name))

    monkeypatch.setattr(catalog_service, "_upsert_import_category_translation_for_lang", _upsert_lang)
    await catalog_service._upsert_import_category_translations(
        session,
        rows=[
            {"slug": "rings", "name_ro": "Inele", "description_ro": "descr", "name_en": "Rings", "description_en": "desc"},
            {"slug": "bracelets", "name_ro": "", "description_ro": "", "name_en": "", "description_en": ""},
        ],
        by_slug={"rings": category},
    )
    assert upsert_calls == [("ro", "Inele"), ("en", "Rings")]


@pytest.mark.anyio
async def test_catalog_wave_d_import_categories_csv_control_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    rows = [{"idx": 2, "slug": "rings", "parent_slug": None, "name": "Rings"}]

    monkeypatch.setattr(catalog_service, "_parse_category_import_rows", lambda _reader: (rows, []))

    async def _count_changes(_session, _slugs):
        await asyncio.sleep(0)
        return 1, 2

    async def _missing_parent_errors(_session, _rows, _slugs):
        await asyncio.sleep(0)
        return []

    async def _hierarchy_errors(_session, _rows):
        await asyncio.sleep(0)
        return ["Row 2: Category parent would create a cycle"]

    monkeypatch.setattr(catalog_service, "_count_category_import_changes", _count_changes)
    monkeypatch.setattr(catalog_service, "_collect_missing_parent_errors", _missing_parent_errors)
    monkeypatch.setattr(catalog_service, "_collect_category_hierarchy_errors", _hierarchy_errors)

    dry_run = await catalog_service.import_categories_csv(
        session,
        content="slug,name,parent_slug\nrings,Rings,\n",
        dry_run=True,
    )
    assert dry_run == {
        "created": 1,
        "updated": 2,
        "errors": ["Row 2: Category parent would create a cycle"],
    }

    async def _load_import_categories(_session, _rows):
        await asyncio.sleep(0)
        return {"rings": SimpleNamespace(id=uuid4(), slug="rings")}

    def _upsert_categories(_session, _rows, _by_slug):
        return None

    async def _assign_parents(_session, _rows, _by_slug):
        await asyncio.sleep(0)
        return []

    async def _upsert_translations(_session, _rows, _by_slug):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_service, "_collect_category_hierarchy_errors", lambda _session, _rows: [])
    monkeypatch.setattr(catalog_service, "_load_categories_for_import", _load_import_categories)
    monkeypatch.setattr(catalog_service, "_upsert_categories_from_import_rows", _upsert_categories)
    monkeypatch.setattr(catalog_service, "_assign_import_category_parents", _assign_parents)
    monkeypatch.setattr(catalog_service, "_upsert_import_category_translations", _upsert_translations)

    non_dry = await catalog_service.import_categories_csv(
        session,
        content="slug,name,parent_slug\nrings,Rings,\n",
        dry_run=False,
    )
    assert non_dry == {"created": 1, "updated": 2, "errors": []}
    assert session.commit_calls == 1

    async def _assign_with_error(_session, _rows, _by_slug):
        await asyncio.sleep(0)
        return ["Row 2: invalid hierarchy"]

    monkeypatch.setattr(catalog_service, "_assign_import_category_parents", _assign_with_error)
    failure = await catalog_service.import_categories_csv(
        session,
        content="slug,name,parent_slug\nrings,Rings,\n",
        dry_run=False,
    )
    assert failure["errors"] == ["Row 2: invalid hierarchy"]
    assert session.rollback_calls >= 1


@pytest.mark.anyio
async def test_catalog_wave_d_low_stock_and_back_in_stock_flows(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    product = SimpleNamespace(category_id=uuid4(), category=None, low_stock_threshold=5, stock_quantity=3, name="Ring", slug="ring")
    assert await catalog_service._effective_low_stock_threshold(session, product=product, default_threshold=2) == 5

    product.low_stock_threshold = None
    product.category = SimpleNamespace(low_stock_threshold=4)
    assert await catalog_service._effective_low_stock_threshold(session, product=product, default_threshold=2) == 4

    product.category = None
    session.scalar_results = [3]
    assert await catalog_service._effective_low_stock_threshold(session, product=product, default_threshold=2) == 3
    session.scalar_results = [None]
    assert await catalog_service._effective_low_stock_threshold(session, product=product, default_threshold=2) == 2

    sent_alerts: list[tuple[str, str, int]] = []

    async def _owner_email(_session):
        await asyncio.sleep(0)
        return None

    async def _send_low_stock(email: str, name: str, quantity: int):
        await asyncio.sleep(0)
        sent_alerts.append((email, name, quantity))

    monkeypatch.setattr(catalog_service.auth_service, "get_owner_email", _owner_email)
    monkeypatch.setattr(catalog_service.email_service, "send_low_stock_alert", _send_low_stock)
    monkeypatch.setattr(catalog_service.settings, "admin_alert_email", "ops@example.com", raising=False)

    product.stock_quantity = 1
    await catalog_service._maybe_alert_low_stock(session, product, threshold=2)
    assert sent_alerts == [("ops@example.com", "Ring", 1)]

    product.stock_quantity = 10
    await catalog_service._maybe_alert_low_stock(session, product, threshold=2)
    assert len(sent_alerts) == 1

    assert catalog_service.is_out_of_stock(SimpleNamespace(stock_quantity=0, allow_backorder=False)) is True
    assert catalog_service.is_out_of_stock(SimpleNamespace(stock_quantity=0, allow_backorder=True)) is False

    user_id = uuid4()
    owner = SimpleNamespace(id=uuid4())

    async def _existing_request(_session, *, user_id, product_id):  # noqa: ARG001
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4(), user_id=user_id, product_id=product_id)

    monkeypatch.setattr(catalog_service, "get_active_back_in_stock_request", _existing_request)
    existing = await catalog_service.create_back_in_stock_request(
        session,
        user_id=user_id,
        product=SimpleNamespace(id=uuid4(), stock_quantity=0, allow_backorder=False, name="Ring", slug="ring"),
    )
    assert existing is not None

    async def _no_existing(_session, *, user_id, product_id):  # noqa: ARG001
        await asyncio.sleep(0)
        return None

    async def _owner_user(_session):
        await asyncio.sleep(0)
        return owner

    async def _notify_fail(*args, **kwargs):
        await asyncio.sleep(0)
        raise RuntimeError("notify failed")

    monkeypatch.setattr(catalog_service, "get_active_back_in_stock_request", _no_existing)
    monkeypatch.setattr(catalog_service.auth_service, "get_owner_user", _owner_user)
    monkeypatch.setattr(catalog_service.notifications_service, "create_notification", _notify_fail)

    created = await catalog_service.create_back_in_stock_request(
        session,
        user_id=user_id,
        product=SimpleNamespace(id=uuid4(), stock_quantity=0, allow_backorder=False, name="Ring", slug="ring"),
    )
    assert created.user_id == user_id
    assert session.commit_calls >= 1

    with pytest.raises(HTTPException, match="Product is in stock"):
        await catalog_service.create_back_in_stock_request(
            session,
            user_id=user_id,
            product=SimpleNamespace(id=uuid4(), stock_quantity=5, allow_backorder=False, name="Ring", slug="ring"),
        )

    cancelled_record = SimpleNamespace(canceled_at=None)

    async def _get_for_cancel(_session, *, user_id, product_id):  # noqa: ARG001
        await asyncio.sleep(0)
        return cancelled_record

    monkeypatch.setattr(catalog_service, "get_active_back_in_stock_request", _get_for_cancel)
    cancelled = await catalog_service.cancel_back_in_stock_request(session, user_id=user_id, product_id=uuid4())
    assert cancelled is cancelled_record
    assert cancelled_record.canceled_at is not None

    rows = [
        (SimpleNamespace(fulfilled_at=None, notified_at=None), "a@example.com"),
        (SimpleNamespace(fulfilled_at=None, notified_at=None), ""),
        (SimpleNamespace(fulfilled_at=None, notified_at=None), "b@example.com"),
    ]
    session.execute_results = [_ExecuteResult(rows=rows)]

    async def _send_back_in_stock(email: str, _product_name: str) -> bool:
        await asyncio.sleep(0)
        return email == "a@example.com"

    monkeypatch.setattr(catalog_service.email_service, "send_back_in_stock", _send_back_in_stock)
    sent = await catalog_service.fulfill_back_in_stock_requests(
        session,
        product=SimpleNamespace(id=uuid4(), name="Ring"),
    )
    assert sent == 1
    assert rows[0][0].fulfilled_at is not None
    assert rows[0][0].notified_at is not None

    session.execute_results = [_ExecuteResult(rows=[])]
    assert await catalog_service.fulfill_back_in_stock_requests(
        session,
        product=SimpleNamespace(id=uuid4(), name="Ring"),
    ) == 0


@pytest.mark.anyio
async def test_catalog_wave_d_import_products_csv_control_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()

    def _parse_row(row: dict[str, str], idx: int):
        if idx == 2:
            return {"slug": "ok", "category_slug": "rings"}, None
        if idx == 3:
            return None, "Row 3: invalid"
        return {"slug": "second", "category_slug": "rings"}, None

    async def _resolve_category(_session, *, category_slug: str, idx: int, dry_run: bool):  # noqa: ARG001
        await asyncio.sleep(0)
        if idx == 4:
            return None, "Row 4: category missing"
        return SimpleNamespace(id=uuid4()), None

    async def _apply_row(_session, *, row_data, category, dry_run: bool):  # noqa: ARG001
        await asyncio.sleep(0)
        if row_data["slug"] == "ok":
            return 1, 0
        return 0, 1

    finalize_calls: list[tuple[bool, list[str]]] = []

    async def _finalize(_session, *, dry_run: bool, errors: list[str]):
        await asyncio.sleep(0)
        finalize_calls.append((dry_run, list(errors)))

    monkeypatch.setattr(catalog_service, "_parse_import_product_row", _parse_row)
    monkeypatch.setattr(catalog_service, "_resolve_import_product_category", _resolve_category)
    monkeypatch.setattr(catalog_service, "_apply_import_product_row", _apply_row)
    monkeypatch.setattr(catalog_service, "_finalize_import_products_transaction", _finalize)

    result = await catalog_service.import_products_csv(
        session,
        content=(
            "slug,name,category_slug\n"
            "ok,Product,rings\n"
            "bad,Product,rings\n"
            "second,Product,rings\n"
        ),
        dry_run=False,
    )
    assert result == {
        "created": 1,
        "updated": 0,
        "errors": ["Row 3: invalid", "Row 4: category missing"],
    }
    assert finalize_calls == [(False, ["Row 3: invalid", "Row 4: category missing"])]
