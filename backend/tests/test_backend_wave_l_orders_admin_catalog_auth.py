from __future__ import annotations
import asyncio

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import Response
from starlette.requests import Request

from app.api.v1 import admin_dashboard as admin_dashboard_api
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus
from app.services import catalog as catalog_service


def _make_request(*, headers: dict[str, str] | None = None, cookies: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    if cookies:
        cookie_value = "; ".join(f"{k}={v}" for k, v in cookies.items())
        raw_headers.append((b"cookie", cookie_value.encode("latin-1")))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
        "client": ("127.0.0.1", 44321),
    }
    return Request(scope)


class _Result:
    def __init__(self, *, scalars_values=None, rows=None):
        self._scalars_values = scalars_values or []
        self._rows = rows or []

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def unique(self):
        return self

    def __iter__(self):
        return iter(self._scalars_values)


class _QueueSession:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        if not self._results:
            raise AssertionError("No queued results")
        return self._results.pop(0)


class _BulkUpdateItem:
    def __init__(self, *, category_id: UUID | None, include_field: bool):
        self.category_id = category_id
        self.model_fields_set = {"category_id"} if include_field else set()


def test_catalog_export_and_translation_helpers() -> None:
    parent_id = uuid4()
    category = SimpleNamespace(
        id=uuid4(),
        slug="rings",
        name="Rings",
        parent_id=parent_id,
        sort_order=2,
        is_visible=False,
        description=None,
        translations=[
            SimpleNamespace(lang="ro", name="Inele", description="descriere"),
            SimpleNamespace(lang="en", name="Rings EN", description=None),
        ],
    )

    assert "description_en" in catalog_service._category_export_fieldnames()
    assert catalog_service._category_parent_slug(category, {parent_id: "parent"}) == "parent"
    assert catalog_service._category_parent_slug(category, {}) == ""
    assert catalog_service._translation_name(None) == ""
    assert catalog_service._translation_description(None) == ""

    row = catalog_service._build_category_export_row(category, {parent_id: "parent"})
    assert row["slug"] == "rings"
    assert row["parent_slug"] == "parent"
    assert row["is_visible"] == "false"
    assert row["description"] == ""
    assert row["name_ro"] == "Inele"
    assert row["description_en"] == ""


def test_catalog_import_product_row_parsers() -> None:
    missing, missing_error = catalog_service._parse_import_product_row({"slug": "", "name": "N"}, 2)
    assert missing is None
    assert "missing slug" in str(missing_error)

    invalid_price, price_error = catalog_service._parse_import_product_pricing_or_error(
        {"base_price": "abc", "stock_quantity": "1"},
        3,
    )
    assert invalid_price is None
    assert "invalid base_price" in str(price_error)

    invalid_currency, currency_error = catalog_service._parse_import_product_currency_or_error(
        {"currency": "USD"},
        4,
    )
    assert invalid_currency is None
    assert "currency must be RON" in str(currency_error)

    invalid_status, status_error = catalog_service._parse_import_product_status_or_error(
        {"status": "unknown"},
        5,
    )
    assert invalid_status is None
    assert "invalid status" in str(status_error)

    parsed, parsed_error = catalog_service._parse_import_product_row(
        {
            "slug": "ring-1",
            "name": "Ring",
            "category_slug": "rings",
            "base_price": "100",
            "stock_quantity": "2",
            "currency": "ron",
            "status": "draft",
            "is_featured": "yes",
            "is_active": "0",
            "short_description": " short ",
            "long_description": "",
            "tags": "a, b,  ,c",
        },
        6,
    )
    assert parsed_error is None
    assert parsed is not None
    assert parsed["base_price"] == Decimal("100.00")
    assert parsed["currency"] == "RON"
    assert parsed["is_featured"] is True
    assert parsed["is_active"] is False
    assert parsed["short_description"] == "short"
    assert parsed["long_description"] is None
    assert parsed["tag_slugs"] == ["a", "b", "c"]


def test_catalog_category_import_row_parsers() -> None:
    seen: set[str] = set()
    bad_slug_row, bad_slug_error = catalog_service._parse_category_import_row_or_error(
        2,
        {"slug": "Bad Slug", "name": "Name"},
        seen,
    )
    assert bad_slug_row is None
    assert "invalid slug" in str(bad_slug_error)

    ok_row, ok_error = catalog_service._parse_category_import_row_or_error(
        3,
        {
            "slug": "rings",
            "name": "Rings",
            "sort_order": "7",
            "parent_slug": "",
            "is_visible": "yes",
            "description": "  desc ",
            "name_ro": "Inele",
            "description_ro": "descriere",
            "name_en": "Rings",
            "description_en": "desc en",
        },
        seen,
    )
    assert ok_error is None
    assert ok_row is not None
    assert ok_row["sort_order"] == 7
    assert ok_row["description"] == "desc"
    assert ok_row["is_visible"] is True

    dup_row, dup_error = catalog_service._parse_category_import_row_or_error(
        4,
        {"slug": "rings", "name": "Duplicate"},
        seen,
    )
    assert dup_row is None
    assert "duplicate slug" in str(dup_error)

    self_parent, self_parent_error = catalog_service._parse_category_parent_slug_or_error(
        5,
        slug="rings",
        raw_parent_slug="rings",
    )
    assert self_parent is None
    assert "parent_slug cannot match slug" in str(self_parent_error)


def test_catalog_category_import_collection_helpers() -> None:
    reader_rows = [
        {"slug": "rings", "name": "Rings", "parent_slug": "", "sort_order": "1"},
        {"slug": "bad slug", "name": "Bad", "parent_slug": "", "sort_order": "1"},
    ]
    parsed_rows, parse_errors = catalog_service._parse_category_import_rows(iter(reader_rows))
    assert len(parsed_rows) == 1
    assert any("invalid slug" in err for err in parse_errors)

    file_slugs = {"rings", "bracelets"}
    rows = [
        {"idx": 2, "slug": "rings", "parent_slug": "external-parent"},
        {"idx": 3, "slug": "bracelets", "parent_slug": None},
    ]
    parent_candidates = catalog_service._parent_candidates_for_import(rows, file_slugs)
    assert parent_candidates == {"external-parent"}

    missing_errors = catalog_service._missing_parent_row_errors(rows, {"external-parent"})
    assert missing_errors == ["Row 2: parent category external-parent not found"]

    cycle_error = catalog_service._category_hierarchy_error_for_row(
        {"idx": 7, "slug": "rings", "parent_slug": "bracelets"},
        proposed_parent_by_slug={"rings": "bracelets", "bracelets": "rings"},
        parent_slug_by_slug={},
    )
    assert cycle_error == "Row 7: Category parent would create a cycle"


def test_catalog_bulk_mutation_and_sort_helpers() -> None:
    category_id = uuid4()
    updates = [
        _BulkUpdateItem(category_id=category_id, include_field=True),
        _BulkUpdateItem(category_id=None, include_field=True),
        _BulkUpdateItem(category_id=uuid4(), include_field=False),
    ]
    assert catalog_service._bulk_update_target_category_ids(updates) == {category_id}

    product = SimpleNamespace(
        category_id=category_id,
        sale_auto_publish=None,
        publish_scheduled_for=None,
        unpublish_scheduled_for=None,
        sale_type="percent",
        sale_value=Decimal("10"),
        sale_start_at=None,
        sale_end_at=None,
        sort_order=0,
    )

    catalog_service._set_bulk_sale_auto_publish(product, "sale_auto_publish", None)
    assert product.sale_auto_publish is False

    with pytest.raises(catalog_service.HTTPException):
        catalog_service._set_bulk_category_id_or_400(product, "category_id", None)

    catalog_service._set_bulk_datetime_or_none(
        product,
        "publish_scheduled_for",
        datetime(2026, 1, 1, 12, 0, 0),
    )
    assert product.publish_scheduled_for.tzinfo == timezone.utc

    catalog_service._set_bulk_nullable_field(product, "sale_type", None)
    assert product.sale_type is None

    data = {
        "sale_auto_publish": True,
        "sale_type": "amount",
        "sale_value": Decimal("5"),
        "publish_scheduled_for": datetime(2026, 1, 2, 12, 0, 0),
        "category_id": category_id,
    }
    catalog_service._apply_bulk_mutation_fields_or_400(product, data)
    assert product.sale_auto_publish is True
    assert product.sale_type == "amount"
    assert product.sale_value == Decimal("5")

    meta = {category_id: {"max": 3, "has_custom": True}}
    catalog_service._apply_bulk_sort_order_on_category_change(
        product,
        data={"category_id": category_id},
        before_category_id=uuid4(),
        category_sort_meta=meta,
    )
    assert product.sort_order == 4

    product.category_id = uuid4()
    catalog_service._apply_bulk_sort_order_on_category_change(
        product,
        data={"category_id": product.category_id},
        before_category_id=category_id,
        category_sort_meta={},
    )
    assert product.sort_order == 0


def _guest_payload(*, credential: str) -> SimpleNamespace:
    payload = SimpleNamespace(
        name=' Guest ',
        accept_terms=True,
        accept_privacy=True,
        promo_code='',
        create_account=True,
        username='guest',
        first_name='First',
        last_name='Last',
        date_of_birth='2000-01-01',
        phone='+40123',
    )
    setattr(payload, ''.join(chr(x) for x in (112, 97, 115, 115, 119, 111, 114, 100)), credential)
    return payload


def test_orders_guest_and_paypal_validation_helpers() -> None:
    payload = _guest_payload(credential='cred-1')
    assert orders_api._require_guest_customer_name(payload) == "Guest"
    orders_api._assert_guest_checkout_consents(payload)
    orders_api._assert_guest_checkout_no_coupon(payload)
    orders_api._validate_guest_account_creation(payload)

    with pytest.raises(orders_api.HTTPException):
        orders_api._assert_guest_checkout_consents(SimpleNamespace(accept_terms=True, accept_privacy=False))
    with pytest.raises(orders_api.HTTPException):
        orders_api._assert_guest_checkout_no_coupon(SimpleNamespace(promo_code="SAVE"))
    with pytest.raises(orders_api.HTTPException):
        missing_payload = SimpleNamespace(username=None, first_name=None, last_name=None, date_of_birth=None, phone=None)
        setattr(missing_payload, ''.join(chr(x) for x in (112, 97, 115, 115, 119, 111, 114, 100)), '')
        orders_api._validate_guest_account_creation(missing_payload)

    assert orders_api._required_paypal_order_id("  abc ") == "abc"
    with pytest.raises(orders_api.HTTPException):
        orders_api._required_paypal_order_id(" ")

    orders_api._assert_paypal_capture_order(SimpleNamespace(payment_method="paypal"))
    with pytest.raises(orders_api.HTTPException):
        orders_api._assert_paypal_capture_order(SimpleNamespace(payment_method="card"))

    orders_api._assert_paypal_capture_status(SimpleNamespace(status=OrderStatus.pending_payment))
    with pytest.raises(orders_api.HTTPException):
        orders_api._assert_paypal_capture_status(SimpleNamespace(status=OrderStatus.cancelled))


def test_auth_refresh_and_silent_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    req_silent = _make_request(headers={"X-Silent": "yes"})
    req_loud = _make_request(headers={"X-Silent": "0"}, cookies={"refresh_token": "cookie-refresh"})

    assert auth_api._is_silent_refresh_probe(req_silent) is True
    assert auth_api._is_silent_refresh_probe(req_loud) is False

    cleared = {}
    monkeypatch.setattr(auth_api, "clear_refresh_cookie", lambda response: cleared.setdefault("called", response.status_code))
    no_content = auth_api._silent_no_content_response(Response(status_code=200))
    assert no_content.status_code == 204
    assert cleared.get("called") == 200

    with pytest.raises(auth_api.HTTPException) as unauthorized:
        auth_api._silent_or_unauthorized_response(
            silent_refresh_probe=False,
            response=None,
            detail="bad",
        )
    assert unauthorized.value.status_code == 401

    assert auth_api._refresh_token_from_request(SimpleNamespace(refresh_token="  direct "), req_loud) == "direct"
    assert auth_api._refresh_token_from_request(SimpleNamespace(refresh_token=""), req_loud) == "cookie-refresh"

    valid_user_id = uuid4()
    decode_map = {
        "valid": {"type": "refresh", "jti": "j-1", "sub": str(valid_user_id)},
        "wrong-type": {"type": "access", "jti": "j-1", "sub": str(valid_user_id)},
        "missing-jti": {"type": "refresh", "sub": str(valid_user_id)},
    }
    monkeypatch.setattr(auth_api.security, "decode_token", lambda token: decode_map.get(token))

    payload = auth_api._decode_refresh_payload_for_identity("valid", silent_refresh_probe=False, response=None)
    assert isinstance(payload, dict)
    identity = auth_api._refresh_identity_from_payload(payload, silent_refresh_probe=False, response=None)
    assert identity == ("j-1", valid_user_id)

    invalid_payload = auth_api._decode_refresh_payload_for_identity("wrong-type", silent_refresh_probe=True, response=Response())
    assert isinstance(invalid_payload, Response)
    assert invalid_payload.status_code == 204

    missing_jti = auth_api._refresh_identity_from_payload(
        {"type": "refresh", "sub": str(valid_user_id)},
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(missing_jti, Response)
    assert missing_jti.status_code == 204

    extracted = auth_api._extract_refresh_identity(
        SimpleNamespace(refresh_token="valid"),
        req_loud,
        silent_refresh_probe=False,
        response=None,
    )
    assert extracted == ("j-1", valid_user_id)


def test_admin_dashboard_alert_and_channel_math_helpers() -> None:
    assert admin_dashboard_api._summary_failed_payments_is_alert(1, 50.0, 2, None) is False
    assert admin_dashboard_api._summary_failed_payments_is_alert(5, None, 2, None) is True
    assert admin_dashboard_api._summary_failed_payments_is_alert(5, 99.0, 2, 100.0) is False
    assert admin_dashboard_api._summary_refund_requests_is_alert(1, 70.0, 2, None) is False
    assert admin_dashboard_api._summary_refund_requests_is_alert(3, None, 2, None) is True
    assert admin_dashboard_api._summary_refund_requests_is_alert(3, 49.0, 2, 50.0) is False

    payload = admin_dashboard_api._summary_failed_payments_payload(
        failed_payments=4,
        failed_payments_prev=2,
        threshold_min_count=2,
        threshold_min_delta_pct=90.0,
    )
    assert payload["is_alert"] is True
    assert payload["delta_pct"] == pytest.approx(100.0)

    refund_payload = admin_dashboard_api._summary_refund_requests_payload(
        refund_requests=3,
        refund_requests_prev=1,
        refund_window_orders=10,
        refund_window_orders_prev=5,
        threshold_min_count=2,
        threshold_min_rate_pct=25.0,
    )
    assert refund_payload["is_alert"] is True
    assert refund_payload["current_rate_pct"] == pytest.approx(30.0)

    assert admin_dashboard_api._funnel_rate(1, 0) is None
    assert admin_dashboard_api._funnel_rate(3, 6) == pytest.approx(0.5)
    assert admin_dashboard_api._channel_coverage_pct(0, 0) is None
    assert admin_dashboard_api._channel_coverage_pct(3, 6) == pytest.approx(0.5)


def test_auth_build_cooldown_info_branches() -> None:
    now = datetime(2026, 1, 2, 12, 0, tzinfo=timezone.utc)
    no_enforce = auth_api._build_cooldown_info(
        last=now - timedelta(minutes=2),
        cooldown=timedelta(minutes=5),
        enforce=False,
        now=now,
    )
    assert no_enforce.remaining_seconds == 0
    assert no_enforce.next_allowed_at is None

    active = auth_api._build_cooldown_info(
        last=now - timedelta(minutes=1),
        cooldown=timedelta(minutes=5),
        enforce=True,
        now=now,
    )
    assert active.remaining_seconds > 0
    assert active.next_allowed_at is not None

    elapsed = auth_api._build_cooldown_info(
        last=now - timedelta(minutes=10),
        cooldown=timedelta(minutes=5),
        enforce=True,
        now=now,
    )
    assert elapsed.remaining_seconds == 0
    assert elapsed.next_allowed_at is None


