from __future__ import annotations
import asyncio

from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.api.v1 import catalog as catalog_api
from app.models.catalog import ProductStatus
from app.models.user import UserRole
from app.schemas.catalog import CategoryCreate, CategoryMergeRequest, CategoryReorderItem, CategoryUpdate, ProductPriceBounds


class _ExecResult:
    def __init__(
        self,
        *,
        scalars_rows: list[object] | None = None,
        scalar_value: object | None = None,
        rowcount: int | None = None,
    ) -> None:
        self._scalars_rows = list(scalars_rows or [])
        self._scalar_value = scalar_value
        self.rowcount = rowcount

    def scalars(self) -> list[object]:
        return list(self._scalars_rows)

    def scalar_one(self) -> object | None:
        return self._scalar_value


class _CatalogSession:
    def __init__(self, *, execute_results: list[_ExecResult] | None = None) -> None:
        self.execute_results = list(execute_results or [])
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.commits = 0
        self.refresh_calls: list[object] = []

    async def execute(self, _stmt: object) -> _ExecResult:
        await asyncio.sleep(0)
        if not self.execute_results:
            raise AssertionError("Unexpected execute() call")
        return self.execute_results.pop(0)

    def add(self, value: object) -> None:
        self.added.append(value)

    async def delete(self, value: object) -> None:
        await asyncio.sleep(0)
        self.deleted.append(value)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, value: object) -> None:
        await asyncio.sleep(0)
        self.refresh_calls.append(value)


@pytest.mark.anyio
async def test_catalog_csv_and_listing_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    ok_file = UploadFile(filename="ok.csv", file=BytesIO(b"a,b\n1,2\n"))
    raw = await catalog_api._read_upload_csv_bytes(ok_file, max_bytes=16)
    assert raw.startswith(b"a,b")

    too_large = UploadFile(filename="large.csv", file=BytesIO(b"x" * 20))
    with pytest.raises(HTTPException, match="CSV file too large"):
        await catalog_api._read_upload_csv_bytes(too_large, max_bytes=5)

    categories = [SimpleNamespace(slug="rings", name="Rings")]
    session = _CatalogSession(execute_results=[_ExecResult(scalars_rows=categories), _ExecResult(scalars_rows=categories)])
    translated: list[tuple[object, str]] = []
    monkeypatch.setattr(catalog_api.catalog_service, "apply_category_translation", lambda category, lang: translated.append((category, lang)))

    result_default = await catalog_api.list_categories(
        session=session,
        lang=None,
        include_hidden=False,
        current_user=None,
    )
    assert result_default == categories

    staff_user = SimpleNamespace(role=UserRole.admin)
    result_ro = await catalog_api.list_categories(
        session=session,
        lang="ro",
        include_hidden=True,
        current_user=staff_user,
    )
    assert result_ro == categories
    assert translated == [(categories[0], "ro")]

    async def _auto_publish(_session: object) -> None:
        await asyncio.sleep(0)
        return None

    async def _apply_due(_session: object) -> None:
        await asyncio.sleep(0)
        return None

    async def _fetch_listing(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [SimpleNamespace(id=uuid4())], 7, ProductPriceBounds(min_price=10.0, max_price=20.0, currency="RON")

    monkeypatch.setattr(catalog_api.catalog_service, "auto_publish_due_sales", _auto_publish)
    monkeypatch.setattr(catalog_api.catalog_service, "apply_due_product_schedules", _apply_due)
    monkeypatch.setattr(catalog_api, "_fetch_product_listing_data", _fetch_listing)
    monkeypatch.setattr(catalog_api, "_build_product_list_payload", lambda _items: ["serialized"])
    monkeypatch.setattr(catalog_api, "ProductListResponse", lambda **kwargs: SimpleNamespace(**kwargs))

    product_response = await catalog_api.list_products(
        session=object(),
        category_slug="sale",
        on_sale=None,
        is_featured=False,
        include_unpublished=True,
        search=None,
        min_price=None,
        max_price=None,
        tags=None,
        sort=None,
        page=2,
        limit=5,
        lang="en",
        current_user=SimpleNamespace(role=UserRole.content),
    )
    assert product_response.meta["page"] == 2
    assert product_response.meta["total_items"] == 7
    assert product_response.items == ["serialized"]

    bounds_calls: list[dict[str, object]] = []

    async def _bounds(*_args, **kwargs):
        await asyncio.sleep(0)
        bounds_calls.append(kwargs)
        return (1.0, 9.0, "RON")

    monkeypatch.setattr(catalog_api.catalog_service, "get_product_price_bounds", _bounds)
    bounds = await catalog_api.get_product_price_bounds(
        session=object(),
        category_slug="sale",
        on_sale=None,
        is_featured=None,
        include_unpublished=True,
        search=None,
        tags=None,
        current_user=SimpleNamespace(role=UserRole.customer),
    )
    assert bounds.min_price == 1.0
    assert bounds.max_price == 9.0
    assert bounds_calls[0]["category_slug"] is None
    assert bounds_calls[0]["on_sale"] is True
    assert bounds_calls[0]["include_unpublished"] is False


@pytest.mark.anyio
async def test_catalog_category_routes_and_merge_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _CatalogSession()
    current_user = SimpleNamespace(id=uuid4())
    created = SimpleNamespace(id=uuid4(), slug="rings")
    updated = SimpleNamespace(id=uuid4(), slug="rings")

    async def _create_category(_session: object, payload: CategoryCreate):
        await asyncio.sleep(0)
        assert payload.name == "Rings"
        return created

    async def _update_category(_session: object, category: object, payload: CategoryUpdate):
        await asyncio.sleep(0)
        assert category is created
        return updated

    monkeypatch.setattr(catalog_api.catalog_service, "create_category", _create_category)
    monkeypatch.setattr(catalog_api.catalog_service, "update_category", _update_category)

    audit_actions: list[str] = []

    async def _audit_log(_session: object, *, action: str, **_kwargs):
        await asyncio.sleep(0)
        audit_actions.append(action)

    monkeypatch.setattr(catalog_api.audit_chain_service, "add_admin_audit_log", _audit_log)

    created_result = await catalog_api.create_category(
        payload=CategoryCreate(name="Rings"),
        session=session,
        current_user=current_user,
        source=None,
    )
    assert created_result is created
    assert session.commits == 0

    await catalog_api.create_category(
        payload=CategoryCreate(name="Rings"),
        session=session,
        current_user=current_user,
        source="storefront",
    )
    assert "catalog.category.create" in audit_actions
    assert session.commits == 1

    async def _get_category_none(_session: object, _slug: str):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _get_category_none)
    with pytest.raises(HTTPException, match="Category not found"):
        await catalog_api.update_category(
            slug="missing",
            payload=CategoryUpdate(name="New"),
            session=session,
            current_user=current_user,
            source="storefront",
        )

    async def _get_category_found(_session: object, _slug: str):
        await asyncio.sleep(0)
        return created

    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _get_category_found)
    updated_result = await catalog_api.update_category(
        slug="rings",
        payload=CategoryUpdate(name="Rings 2"),
        session=session,
        current_user=current_user,
        source="storefront",
    )
    assert updated_result is updated

    delete_missing_session = _CatalogSession()
    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _get_category_none)
    with pytest.raises(HTTPException, match="Category not found"):
        await catalog_api.delete_category(
            slug="missing",
            session=delete_missing_session,
            current_user=current_user,
            source=None,
        )

    delete_session = _CatalogSession()
    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _get_category_found)
    deleted = await catalog_api.delete_category(
        slug="rings",
        session=delete_session,
        current_user=current_user,
        source="storefront",
    )
    assert deleted is created
    assert delete_session.deleted == [created]
    assert delete_session.commits >= 2

    reorder_payload = [CategoryReorderItem(slug="rings", sort_order=1)]

    async def _reorder(_session: object, payload: list[CategoryReorderItem]):
        await asyncio.sleep(0)
        assert len(payload) == 1
        return [created]

    monkeypatch.setattr(catalog_api.catalog_service, "reorder_categories", _reorder)
    reordered = await catalog_api.reorder_categories(
        payload=reorder_payload,
        session=delete_session,
        current_user=current_user,
        source="storefront",
    )
    assert reordered == [created]

    preview_session = _CatalogSession(execute_results=[_ExecResult(scalar_value=2), _ExecResult(scalar_value=1)])
    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _get_category_found)
    preview = await catalog_api.preview_delete_category(
        slug="rings",
        session=preview_session,
        _=object(),
    )
    assert preview.product_count == 2
    assert preview.child_count == 1
    assert preview.can_delete is False

    source = SimpleNamespace(id=uuid4(), slug="source", parent_id=uuid4())
    same_target = SimpleNamespace(id=uuid4(), slug="source", parent_id=source.parent_id)
    diff_parent_target = SimpleNamespace(id=uuid4(), slug="target", parent_id=uuid4())
    good_target = SimpleNamespace(id=uuid4(), slug="target", parent_id=source.parent_id)

    async def _get_merge_category(_session: object, slug: str):
        await asyncio.sleep(0)
        mapping = {
            "source": source,
            "same": same_target,
            "different": diff_parent_target,
            "target": good_target,
        }
        return mapping.get(slug)

    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _get_merge_category)

    merge_same_session = _CatalogSession(execute_results=[_ExecResult(scalar_value=1), _ExecResult(scalar_value=0)])
    merge_same = await catalog_api.preview_merge_category(
        slug="source",
        target_slug="same",
        session=merge_same_session,
        _=object(),
    )
    assert merge_same.can_merge is False
    assert merge_same.reason == "same_category"

    merge_parent_session = _CatalogSession(execute_results=[_ExecResult(scalar_value=1), _ExecResult(scalar_value=0)])
    merge_parent = await catalog_api.preview_merge_category(
        slug="source",
        target_slug="different",
        session=merge_parent_session,
        _=object(),
    )
    assert merge_parent.can_merge is False
    assert merge_parent.reason == "different_parent"

    merge_children_session = _CatalogSession(execute_results=[_ExecResult(scalar_value=1), _ExecResult(scalar_value=3)])
    merge_children = await catalog_api.preview_merge_category(
        slug="source",
        target_slug="target",
        session=merge_children_session,
        _=object(),
    )
    assert merge_children.can_merge is False
    assert merge_children.reason == "source_has_children"

    merge_session = _CatalogSession(execute_results=[_ExecResult(rowcount=4)])

    async def _merge_pair(_session: object, _source_slug: str, _target_slug: str):
        await asyncio.sleep(0)
        return source, good_target

    async def _ensure_no_children(_session: object, _category: object) -> None:
        await asyncio.sleep(0)
        return None

    async def _audit_merge(*_args, **_kwargs) -> None:
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_api, "_get_merge_source_and_target_categories", _merge_pair)
    monkeypatch.setattr(catalog_api, "_ensure_category_has_no_children", _ensure_no_children)
    monkeypatch.setattr(catalog_api, "_audit_category_merge_if_requested", _audit_merge)

    merge_result = await catalog_api.merge_category(
        slug="source",
        payload=CategoryMergeRequest(target_slug="target"),
        session=merge_session,
        current_user=current_user,
        audit_source="storefront",
    )
    assert merge_result.source_slug == "source"
    assert merge_result.target_slug == "target"
    assert merge_result.moved_products == 4


@pytest.mark.anyio
async def test_catalog_product_visibility_and_import_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _auto_publish(_session: object) -> None:
        await asyncio.sleep(0)
        return None

    async def _apply_due(_session: object) -> None:
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_api.catalog_service, "auto_publish_due_sales", _auto_publish)
    monkeypatch.setattr(catalog_api.catalog_service, "apply_due_product_schedules", _apply_due)

    async def _missing_product(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_api.catalog_service, "get_product_by_slug", _missing_product)
    with pytest.raises(HTTPException, match="Product not found"):
        await catalog_api.get_product(
            slug="missing",
            session=object(),
            session_id=None,
            lang=None,
            current_user=None,
        )

    product = SimpleNamespace(
        id=uuid4(),
        slug="ring",
        is_deleted=False,
        is_active=True,
        status=ProductStatus.published,
    )

    async def _found_product(*_args, **_kwargs):
        await asyncio.sleep(0)
        return product

    viewed_calls: list[tuple[object, object, object, object]] = []

    async def _record_recently_viewed(*args):
        await asyncio.sleep(0)
        viewed_calls.append(args)

    monkeypatch.setattr(catalog_api.catalog_service, "get_product_by_slug", _found_product)
    monkeypatch.setattr(catalog_api.catalog_service, "record_recently_viewed", _record_recently_viewed)
    monkeypatch.setattr(catalog_api.catalog_service, "is_sale_active", lambda _product: False)
    monkeypatch.setattr(catalog_api.ProductRead, "model_validate", staticmethod(lambda _product: SimpleNamespace(sale_price=Decimal("10.00"))))

    customer = SimpleNamespace(id=uuid4(), role=UserRole.customer)
    model_customer = await catalog_api.get_product(
        slug="ring",
        session=object(),
        session_id="sid-1",
        lang=None,
        current_user=customer,
    )
    assert model_customer.sale_price is None
    assert len(viewed_calls) == 1

    model_admin = await catalog_api.get_product(
        slug="ring",
        session=object(),
        session_id=None,
        lang=None,
        current_user=SimpleNamespace(id=uuid4(), role=UserRole.admin),
    )
    assert model_admin.sale_price == Decimal("10.00")

    async def _get_active_request(_session: object, *, user_id: object, product_id: object):
        await asyncio.sleep(0)
        assert user_id is not None
        assert product_id == product.id
        return None

    monkeypatch.setattr(catalog_api.catalog_service, "get_active_back_in_stock_request", _get_active_request)
    monkeypatch.setattr(catalog_api.catalog_service, "is_out_of_stock", lambda _product: False)
    status_model = await catalog_api.get_back_in_stock_status(
        slug="ring",
        session=object(),
        current_user=customer,
    )
    assert status_model.in_stock is True
    assert status_model.request is None

    monkeypatch.setattr(catalog_api.BackInStockRequestRead, "model_validate", staticmethod(lambda _record: {"id": "req-1"}))

    async def _create_back_in_stock(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(catalog_api.catalog_service, "create_back_in_stock_request", _create_back_in_stock)
    request_model = await catalog_api.request_back_in_stock(
        slug="ring",
        session=object(),
        current_user=customer,
    )
    assert request_model == {"id": "req-1"}

    cancelled: list[tuple[object, object]] = []

    async def _cancel_back_in_stock(_session: object, *, user_id: object, product_id: object) -> None:
        await asyncio.sleep(0)
        cancelled.append((user_id, product_id))

    monkeypatch.setattr(catalog_api.catalog_service, "cancel_back_in_stock_request", _cancel_back_in_stock)
    result = await catalog_api.cancel_back_in_stock(
        slug="ring",
        session=object(),
        current_user=customer,
    )
    assert result is None
    assert cancelled and cancelled[0][1] == product.id

    with pytest.raises(HTTPException, match="CSV file required"):
        await catalog_api.import_categories_csv(
            file=UploadFile(filename="bad.txt", file=BytesIO(b"x")),
            dry_run=True,
            session=object(),
            _=object(),
        )

    with pytest.raises(HTTPException, match="Unable to decode CSV"):
        await catalog_api.import_categories_csv(
            file=UploadFile(filename="bad.csv", file=BytesIO(b"\xff\xff")),
            dry_run=True,
            session=object(),
            _=object(),
        )

    async def _import_categories(_session: object, content: str, *, dry_run: bool):
        await asyncio.sleep(0)
        assert dry_run is False
        assert "name" in content
        return {"created": 1, "updated": 0, "errors": []}

    monkeypatch.setattr(catalog_api.catalog_service, "import_categories_csv", _import_categories)
    categories_result = await catalog_api.import_categories_csv(
        file=UploadFile(filename="ok.csv", file=BytesIO(b"name\nrings\n")),
        dry_run=False,
        session=object(),
        _=object(),
    )
    assert categories_result.created == 1

    with pytest.raises(HTTPException, match="CSV file required"):
        await catalog_api.import_products_csv(
            file=UploadFile(filename="bad.txt", file=BytesIO(b"x")),
            dry_run=True,
            session=object(),
            _=object(),
        )

    with pytest.raises(HTTPException, match="Unable to decode CSV"):
        await catalog_api.import_products_csv(
            file=UploadFile(filename="bad.csv", file=BytesIO(b"\xff\xff")),
            dry_run=True,
            session=object(),
            _=object(),
        )

    async def _import_products(_session: object, content: str, *, dry_run: bool):
        await asyncio.sleep(0)
        assert dry_run is True
        assert "slug" in content
        return {"created": 0, "updated": 2, "errors": ["row 3"]}

    monkeypatch.setattr(catalog_api.catalog_service, "import_products_csv", _import_products)
    products_result = await catalog_api.import_products_csv(
        file=UploadFile(filename="ok.csv", file=BytesIO(b"slug\nring\n")),
        dry_run=True,
        session=object(),
        _=object(),
    )
    assert products_result.updated == 2
    assert products_result.errors == ["row 3"]
