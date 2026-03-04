from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import catalog as catalog_service
from app.schemas.catalog import BulkProductUpdateItem, ProductCreate, ProductUpdate, ProductVariantMatrixUpdate


class _ScalarResult:
    def __init__(self, values):
        self._values = list(values)

    def __iter__(self):
        return iter(self._values)

    def all(self):
        return list(self._values)


class _ExecuteResult:
    def __init__(self, *, scalar_values=None, scalar_one_or_none=None):
        self._scalar_values = list(scalar_values or [])
        self._scalar_one_or_none = scalar_one_or_none

    def scalars(self):
        return _ScalarResult(self._scalar_values)

    def scalar_one_or_none(self):
        return self._scalar_one_or_none


class _FakeSession:
    def __init__(self):
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.execute_results: list[_ExecuteResult] = []
        self.scalar_results: list[object] = []
        self.commit_calls = 0
        self.flush_calls = 0
        self.refresh_calls = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def execute(self, _statement):
        await asyncio.sleep(0)
        if self.execute_results:
            return self.execute_results.pop(0)
        return _ExecuteResult()

    async def scalar(self, _statement):
        await asyncio.sleep(0)
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return 0

    async def delete(self, value: object):
        await asyncio.sleep(0)
        self.deleted.append(value)

    async def commit(self):
        await asyncio.sleep(0)
        self.commit_calls += 1

    async def flush(self):
        await asyncio.sleep(0)
        self.flush_calls += 1

    async def refresh(self, _obj, attribute_names=None):
        await asyncio.sleep(0)
        self.refresh_calls += 1


def _product_stub() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        slug="ring-one",
        name="Ring One",
        category_id=uuid4(),
        base_price=Decimal("100.00"),
        currency="RON",
        sale_type=None,
        sale_value=None,
        sale_price=None,
        sale_start_at=None,
        sale_end_at=None,
        sale_auto_publish=False,
        stock_quantity=3,
        low_stock_threshold=1,
        allow_backorder=False,
        restock_at=None,
        weight_grams=100,
        width_cm=1.0,
        height_cm=1.0,
        depth_cm=1.0,
        shipping_class=None,
        shipping_allow_locker=True,
        shipping_disallowed_couriers=[],
        meta_title="",
        meta_description="",
        short_description="short",
        long_description="long",
        status=catalog_service.ProductStatus.published,
        publish_at=None,
        is_active=True,
        is_featured=False,
        publish_scheduled_for=None,
        unpublish_scheduled_for=None,
        tags=[SimpleNamespace(slug="tag-a")],
        badges=[SimpleNamespace(badge="new", start_at=None, end_at=None)],
        options=[SimpleNamespace(option_name="size", option_value="M")],
        images=[],
        variants=[],
        is_deleted=False,
        deleted_slug=None,
        deleted_at=None,
        deleted_by=None,
        sort_order=0,
    )


def test_catalog_create_resolution_helpers() -> None:
    session = _FakeSession()
    payload = ProductCreate(
        category_id=uuid4(),
        name="Ring Name",
        base_price=Decimal("15.00"),
        currency="RON",
        stock_quantity=2,
    )

    session.scalar_results = [0]
    sort_order = asyncio.run(catalog_service._resolve_create_product_sort_order(session, payload))
    assert sort_order == 0

    session.scalar_results = [2, 7]
    sort_order = asyncio.run(catalog_service._resolve_create_product_sort_order(session, payload))
    assert sort_order == 8


def test_catalog_update_payload_and_snapshot_helpers() -> None:
    product = _product_stub()

    payload = ProductUpdate(name="Renamed")
    normalized = catalog_service._normalize_product_update_payload_or_400(product, payload)
    assert normalized["name"] == "Renamed"

    with pytest.raises(catalog_service.HTTPException, match="Slug cannot be changed"):
        catalog_service._normalize_product_update_payload_or_400(product, ProductUpdate(slug="other"))

    tracked = catalog_service._snapshot_product_tracked_fields(product)
    tags = catalog_service._snapshot_product_tags(product)
    badges = catalog_service._snapshot_product_badges(product)
    options = catalog_service._snapshot_product_options(product)
    relations = catalog_service._snapshot_product_relations(product)

    assert tracked["name"] == "Ring One"
    assert tags == ["tag-a"]
    assert badges == [("new", None, None)]
    assert options == [("size", "M")]
    assert relations["tags"] == ["tag-a"]


def test_catalog_scalar_and_sale_transition_helpers() -> None:
    product = _product_stub()
    data = {
        "currency": "ron",
        "name": "Updated",
        "publish_scheduled_for": datetime.now(timezone.utc),
        "unpublish_scheduled_for": datetime.now(timezone.utc) + timedelta(hours=1),
        "sale_type": "amount",
        "sale_value": Decimal("10"),
        "stock_quantity": 1,
    }

    catalog_service._normalize_product_schedule_fields(data)
    catalog_service._apply_product_scalar_updates(product, data)
    assert product.currency == "RON"
    assert product.name == "Updated"

    catalog_service._validate_product_publish_windows_or_400(product)

    product.unpublish_scheduled_for = product.publish_scheduled_for
    with pytest.raises(catalog_service.HTTPException, match="Unpublish schedule"):
        catalog_service._validate_product_publish_windows_or_400(product)

    product.unpublish_scheduled_for = None
    catalog_service._apply_sale_field_transitions(
        product,
        data={"sale_type": "amount", "sale_value": Decimal("10")},
        before_sale_type=None,
        before_sale_value=None,
    )
    assert product.status == catalog_service.ProductStatus.draft


def test_catalog_bulk_mutation_and_audit_helpers() -> None:
    product = _product_stub()

    catalog_service._set_bulk_sale_auto_publish(product, "sale_auto_publish", None)
    assert product.sale_auto_publish is False

    with pytest.raises(catalog_service.HTTPException, match="category_id cannot be null"):
        catalog_service._set_bulk_category_id_or_400(product, "category_id", None)

    now = datetime.now(timezone.utc)
    catalog_service._set_bulk_datetime_or_none(product, "publish_scheduled_for", now)
    assert product.publish_scheduled_for is not None

    catalog_service._set_bulk_nullable_field(product, "sale_type", None)
    assert product.sale_type is None

    catalog_service._apply_bulk_mutation_field_or_400(product, "is_featured", True)
    assert product.is_featured is True

    item = BulkProductUpdateItem(product_id=uuid4(), category_id=uuid4())
    target_ids = catalog_service._bulk_update_target_category_ids([item])
    assert item.category_id in target_ids

    payload = catalog_service._bulk_update_audit_payload(product, source="storefront")
    assert payload["source"] == "storefront"


@pytest.mark.anyio
async def test_catalog_variant_and_bulk_async_helper_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    product = _product_stub()
    existing_variant_id = uuid4()
    existing_variant = SimpleNamespace(
        id=existing_variant_id,
        stock_quantity=2,
        name="Default",
        additional_price_delta=Decimal("0"),
    )
    product.variants = [existing_variant]

    payload = ProductVariantMatrixUpdate(
        variants=[
            {"id": existing_variant_id, "name": "Updated", "additional_price_delta": "1.0", "stock_quantity": 3},
            {"name": "New", "additional_price_delta": "0", "stock_quantity": 2},
        ],
        delete_variant_ids=[],
    )

    queued: list[tuple[int, int]] = []

    def _queue_variant(_session, *, before_quantity, after_quantity, **_kwargs):
        queued.append((before_quantity, after_quantity))

    monkeypatch.setattr(catalog_service, "_queue_variant_stock_adjustment", _queue_variant)

    updated_rows, created_with_stock = catalog_service._upsert_variant_rows(
        session=session,
        product=product,
        payload=payload,
        existing_by_id={existing_variant_id: existing_variant},
        user_id=uuid4(),
    )
    assert len(updated_rows) == 2
    assert len(created_with_stock) == 1
    assert queued[0] == (2, 3)

    await catalog_service._queue_created_variant_stock_adjustments(
        session=session,
        product=product,
        created_with_stock=created_with_stock,
        user_id=uuid4(),
    )
    assert session.flush_calls == 1

    logs: list[str] = []

    async def _log(_session, _product_id, action, _user_id, _payload):
        await asyncio.sleep(0)
        logs.append(action)

    monkeypatch.setattr(catalog_service, "_log_product_action", _log)

    finalized = await catalog_service._finalize_variant_matrix_update(
        session=session,
        product=product,
        updated_rows=updated_rows,
        delete_ids=set(),
        user_id=uuid4(),
    )
    assert finalized == product.variants
    assert "variants_update" in logs


@pytest.mark.anyio
async def test_catalog_soft_delete_restore_and_bulk_update_item(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession()
    product = _product_stub()

    async def _log(_session, _product_id, _action, _user_id, _payload):
        await asyncio.sleep(0)

    monkeypatch.setattr(catalog_service, "_log_product_action", _log)
    await catalog_service.soft_delete_product(session, product, user_id=uuid4())
    assert product.is_deleted is True
    assert product.slug.startswith("deleted-")

    async def _unique(_session, _slug, exclude_id=None):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_service, "_ensure_slug_unique", _unique)
    restored = await catalog_service.restore_soft_deleted_product(session, product, user_id=uuid4())
    assert restored.is_deleted is False

    restocked: set[object] = set()
    queued: list[tuple[int, int]] = []

    def _queue_stock(_session, *, before_quantity, after_quantity, **_kwargs):
        queued.append((before_quantity, after_quantity))

    monkeypatch.setattr(catalog_service, "_queue_stock_adjustment", _queue_stock)

    update_item = BulkProductUpdateItem(product_id=product.id, stock_quantity=5, is_featured=True)
    updated = catalog_service._apply_bulk_update_item(
        session=session,
        item=update_item,
        products={product.id: product},
        category_sort_meta={},
        restocked=restocked,
        user_id=uuid4(),
    )
    assert updated.id == product.id
    assert queued[-1] == (3, 5)
