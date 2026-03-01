from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1 import admin_dashboard
from app.api.v1 import coupons as coupons_api
from app.api.v1 import orders as orders_api
from app.models.catalog import ProductStatus
from app.models.coupons import (
    CouponBulkJobAction,
    CouponBulkJobStatus,
    PromotionDiscountType,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import OrderStatus
from app.models.user import UserRole
from app.models.user_export import UserDataExportStatus
from app.services import catalog as catalog_service


def _request(*, headers: dict[str, str] | None = None, client_host: str | None = "127.0.0.1") -> Request:
    header_items = []
    for key, value in (headers or {}).items():
        header_items.append((key.lower().encode("latin-1"), value.encode("latin-1")))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": header_items,
        "client": (client_host, 1234) if client_host else None,
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


class _MemorySession:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)


def test_backend_wave_c_catalog_helpers_cover_validation_and_relationship_branches() -> None:
    with pytest.raises(HTTPException, match="Base price must be non-negative"):
        catalog_service._validate_price_currency(Decimal("-1.00"), "RON")
    with pytest.raises(HTTPException, match="Currency must be a 3-letter code"):
        catalog_service._validate_price_currency(Decimal("10.00"), "RO")
    with pytest.raises(HTTPException, match="Only RON currency is supported"):
        catalog_service._validate_price_currency(Decimal("10.00"), "USD")
    catalog_service._validate_price_currency(Decimal("10.00"), " ron ")
    catalog_service._validate_price_currency(None, "")

    with pytest.raises(HTTPException, match="Sale end must be after sale start"):
        catalog_service._validate_sale_schedule(
            sale_start_at=datetime(2026, 1, 5),
            sale_end_at=datetime(2026, 1, 1),
            sale_auto_publish=False,
        )
    with pytest.raises(HTTPException, match="Sale start is required for auto-publish"):
        catalog_service._validate_sale_schedule(sale_start_at=None, sale_end_at=None, sale_auto_publish=True)

    with pytest.raises(HTTPException, match="Badge is required"):
        catalog_service._extract_badge_value({})
    start_at, end_at = catalog_service._parse_badge_schedule(
        {"start_at": datetime(2026, 1, 1, 9, 0), "end_at": datetime(2026, 1, 2, 9, 0)}
    )
    assert start_at is not None and start_at.tzinfo is not None
    assert end_at is not None and end_at.tzinfo is not None
    with pytest.raises(HTTPException, match="Badge end must be after badge start"):
        catalog_service._parse_badge_schedule(
            {"start_at": datetime(2026, 1, 2, 10, 0), "end_at": datetime(2026, 1, 2, 9, 0)}
        )

    badges = catalog_service._build_product_badges(
        [
            {"badge": "new", "start_at": datetime(2026, 1, 1), "end_at": datetime(2026, 1, 2)},
            {"badge": "sale"},
        ]
    )
    assert [row.badge for row in badges] == ["new", "sale"]
    with pytest.raises(HTTPException, match="Duplicate badge"):
        catalog_service._build_product_badges([{"badge": "dup"}, {"badge": "dup"}])

    assert catalog_service._compute_sale_price(base_price="100", sale_type="percent", sale_value="10") == Decimal("90.00")
    assert catalog_service._compute_sale_price(base_price="100", sale_type="amount", sale_value="120") == Decimal("0.00")
    assert catalog_service._compute_sale_price(base_price="100", sale_type="bogus", sale_value="10") is None
    assert catalog_service._compute_sale_price(base_price="0", sale_type="percent", sale_value="10") is None
    assert catalog_service._resolve_sale_discount(Decimal("100"), "percent", Decimal("100")) == Decimal("100")
    assert catalog_service._finalize_sale_price(Decimal("100"), Decimal("-1")) is None

    product = SimpleNamespace(publish_at=None)
    catalog_service._set_publish_timestamp(product, ProductStatus.published)
    first_publish_at = product.publish_at
    catalog_service._set_publish_timestamp(product, ProductStatus.published)
    assert product.publish_at == first_publish_at
    catalog_service._set_publish_timestamp(product, None)
    assert product.publish_at == first_publish_at

    with_sale = SimpleNamespace(
        base_price=Decimal("100.00"),
        sale_type="percent",
        sale_value=Decimal("10"),
        sale_start_at=datetime(2026, 1, 1, 8, 0),
        sale_end_at=datetime(2026, 1, 3, 8, 0),
        sale_auto_publish=1,
    )
    catalog_service._sync_sale_fields(with_sale)
    assert with_sale.sale_price == Decimal("90.00")
    assert with_sale.sale_start_at.tzinfo is not None
    assert with_sale.sale_end_at.tzinfo is not None
    assert with_sale.sale_auto_publish is True

    without_sale = SimpleNamespace(
        base_price=Decimal("100.00"),
        sale_type=None,
        sale_value=None,
        sale_start_at=datetime(2026, 1, 1, 8, 0),
        sale_end_at=datetime(2026, 1, 3, 8, 0),
        sale_auto_publish=True,
    )
    catalog_service._sync_sale_fields(without_sale)
    assert without_sale.sale_price is None
    assert without_sale.sale_type is None
    assert without_sale.sale_value is None
    assert without_sale.sale_start_at is None
    assert without_sale.sale_end_at is None
    assert without_sale.sale_auto_publish is False

    invalid_schedule = SimpleNamespace(
        base_price=Decimal("100.00"),
        sale_type="percent",
        sale_value=Decimal("10"),
        sale_start_at=None,
        sale_end_at=None,
        sale_auto_publish=True,
    )
    with pytest.raises(HTTPException, match="Sale start is required for auto-publish"):
        catalog_service._sync_sale_fields(invalid_schedule)

    values = [uuid4(), uuid4()]
    deduped = catalog_service._dedupe_uuid_list([values[0], values[0], values[1]])
    assert deduped == values

    related, upsells = catalog_service._normalized_relationship_ids(
        product_id=uuid4(),
        payload=SimpleNamespace(
            related_product_ids=[values[0], values[0], values[1]],
            upsell_product_ids=[values[1], values[0]],
        ),
    )
    assert related == values
    assert upsells == []

    self_id = uuid4()
    with pytest.raises(HTTPException, match="cannot reference itself"):
        catalog_service._normalized_relationship_ids(
            product_id=self_id,
            payload=SimpleNamespace(related_product_ids=[self_id], upsell_product_ids=[]),
        )


def test_backend_wave_c_admin_dashboard_helper_branches() -> None:
    assert admin_dashboard._decimal_or_none(None) is None
    assert admin_dashboard._decimal_or_none("2.5") == Decimal("2.5")

    assert admin_dashboard._summary_delta_pct(10, 0) is None
    assert admin_dashboard._summary_delta_pct(15, 10) == 50.0
    assert admin_dashboard._summary_rate_pct(1, 0) is None
    assert admin_dashboard._summary_rate_pct(2, 4) == 50.0

    now = datetime(2026, 2, 28, tzinfo=timezone.utc)
    with pytest.raises(HTTPException, match="must be provided together"):
        admin_dashboard._summary_resolve_range(now, 30, date(2026, 2, 1), None)
    with pytest.raises(HTTPException, match="on/after"):
        admin_dashboard._summary_resolve_range(now, 30, date(2026, 2, 5), date(2026, 2, 4))

    start, end, days = admin_dashboard._summary_resolve_range(now, 30, date(2026, 2, 1), date(2026, 2, 4))
    assert start == datetime(2026, 2, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 2, 5, tzinfo=timezone.utc)
    assert days == 4

    assert admin_dashboard._summary_failed_payments_is_alert(0, 10.0, 1, None) is False
    assert admin_dashboard._summary_failed_payments_is_alert(2, None, 1, None) is True
    assert admin_dashboard._summary_failed_payments_is_alert(2, 9.0, 1, 10.0) is False
    assert admin_dashboard._summary_failed_payments_is_alert(2, 11.0, 1, 10.0) is True

    assert admin_dashboard._summary_refund_requests_is_alert(0, 20.0, 1, None) is False
    assert admin_dashboard._summary_refund_requests_is_alert(2, None, 1, None) is True
    assert admin_dashboard._summary_refund_requests_is_alert(2, 4.0, 1, 5.0) is False
    assert admin_dashboard._summary_refund_requests_is_alert(2, 5.0, 1, 5.0) is True

    anomalies = admin_dashboard._summary_anomalies_payload(
        {
            "failed_payments": 3,
            "failed_payments_prev": 1,
            "refund_requests": 2,
            "refund_requests_prev": 1,
            "refund_window_orders": 10,
            "refund_window_orders_prev": 8,
            "stockouts": 5,
        },
        {
            "failed_payments_min_count": 2,
            "failed_payments_min_delta_pct": 50.0,
            "refund_requests_min_count": 2,
            "refund_requests_min_rate_pct": 10.0,
            "stockouts_min_count": 4,
        },
    )
    assert anomalies["failed_payments"]["is_alert"] is True
    assert anomalies["refund_requests"]["is_alert"] is True
    assert anomalies["stockouts"]["is_alert"] is True

    channel_items = admin_dashboard._channel_items(
        [("stripe", 2, Decimal("20.0")), (None, 1, Decimal("10.0"))],
        {"stripe": Decimal("3.0")},
        {"stripe": Decimal("2.0")},
        "unknown",
    )
    assert channel_items[0]["key"] == "stripe"
    assert channel_items[0]["net_sales"] == 15.0
    assert channel_items[1]["key"] == "unknown"
    assert admin_dashboard._channel_coverage_pct(0, 0) is None
    assert admin_dashboard._channel_coverage_pct(2, 4) == 0.5

    assert admin_dashboard._normalize_refund_reason_text("  Întârziere LIVRARE  ") == "intarziere livrare"
    assert admin_dashboard._refund_reason_category("Package arrived broken") == "damaged"
    assert admin_dashboard._refund_reason_category("Nu corespunde cu poza") == "not_as_described"
    assert admin_dashboard._refund_reason_category("Totul ok") == "other"

    base = datetime(2026, 2, 1, tzinfo=timezone.utc)
    duration_map = admin_dashboard._shipping_duration_map(
        [
            ("fast", base, base + timedelta(hours=4)),
            ("fast", base, base - timedelta(hours=1)),
            (None, base, base + timedelta(hours=2)),
            ("slow", base, base + timedelta(days=500)),
            ("skip", None, base + timedelta(hours=1)),
        ],
        courier_idx=0,
        start_idx=1,
        end_idx=2,
    )
    assert duration_map["fast"] == [4.0]
    assert duration_map["unknown"] == [2.0]
    assert "slow" not in duration_map

    rows = admin_dashboard._shipping_rows({"fast": [4.0, 6.0]}, {"fast": [2.0], "slow": [10.0]})
    assert rows[0]["courier"] == "fast"
    assert rows[0]["current"]["avg_hours"] == 5.0
    assert rows[0]["delta_pct"]["count"] == 100.0
    assert any(row["courier"] == "slow" for row in rows)

    payload = admin_dashboard._shipping_response_payload(
        7,
        base,
        base + timedelta(days=7),
        {"fast": [3.0]},
        {"fast": [2.0]},
        {"fast": [4.0]},
        {"fast": [3.0]},
    )
    assert payload["window_days"] == 7
    assert payload["time_to_ship"][0]["courier"] == "fast"


def test_backend_wave_c_admin_dashboard_access_and_gdpr_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    naive_now = datetime(2026, 2, 1, 10, 0)
    aware_now = datetime(2026, 2, 1, 10, 0, tzinfo=timezone.utc)

    assert admin_dashboard._as_utc(naive_now).tzinfo is not None
    assert admin_dashboard._as_utc(aware_now) == aware_now
    assert admin_dashboard._as_utc(None) is None

    expired = admin_dashboard._refresh_session_to_response(
        SimpleNamespace(
            id=uuid4(),
            created_at=naive_now,
            expires_at=aware_now - timedelta(minutes=1),
            persistent=True,
            user_agent="ua",
            ip_address="203.0.113.9",
            country_code="RO",
        ),
        aware_now,
    )
    assert expired is None

    active = admin_dashboard._refresh_session_to_response(
        SimpleNamespace(
            id=uuid4(),
            created_at=naive_now,
            expires_at=aware_now + timedelta(hours=1),
            persistent=False,
            user_agent="ua",
            ip_address="203.0.113.9",
            country_code="RO",
        ),
        aware_now,
    )
    assert active is not None
    assert active.persistent is False

    with pytest.raises(HTTPException, match="Owner access required"):
        admin_dashboard._require_owner_access(SimpleNamespace(role=UserRole.admin))
    admin_dashboard._require_owner_access(SimpleNamespace(role=UserRole.owner))

    with pytest.raises(HTTPException, match="Only owner/admin"):
        admin_dashboard._require_owner_or_admin_access(SimpleNamespace(role=UserRole.support))
    admin_dashboard._require_owner_or_admin_access(SimpleNamespace(role=UserRole.admin))

    with pytest.raises(HTTPException, match="confirm"):
        admin_dashboard._require_confirm_value("no", keyword="YES", detail="confirm")
    admin_dashboard._require_confirm_value(" yes ", keyword="YES", detail="confirm")
    with pytest.raises(HTTPException, match="confirm"):
        admin_dashboard._require_confirm_keyword({"confirm": "x"}, keyword="YES", detail="confirm")
    admin_dashboard._require_confirm_keyword({"confirm": "YES"}, keyword="YES", detail="confirm")

    monkeypatch.setattr(admin_dashboard.security, "verify_password", lambda *_args, **_kwargs: False)
    with pytest.raises(HTTPException, match="Invalid password"):
        admin_dashboard._require_admin_password("pw", SimpleNamespace(hashed_password="hash"))
    monkeypatch.setattr(admin_dashboard.security, "verify_password", lambda *_args, **_kwargs: True)
    admin_dashboard._require_admin_password("pw", SimpleNamespace(hashed_password="hash"))

    with pytest.raises(HTTPException, match="User not found"):
        admin_dashboard._role_update_target_user(None)
    with pytest.raises(HTTPException, match="Owner role can only be transferred"):
        admin_dashboard._role_update_target_user(SimpleNamespace(role=UserRole.owner))
    user = SimpleNamespace(role=UserRole.customer)
    assert admin_dashboard._role_update_target_user(user) is user

    with pytest.raises(HTTPException, match="Invalid role"):
        admin_dashboard._validated_role_value("owner")
    assert admin_dashboard._validated_role_value("admin") == UserRole.admin

    assert admin_dashboard._gdpr_deletion_status(None, aware_now) == "scheduled"
    assert admin_dashboard._gdpr_deletion_status(aware_now - timedelta(minutes=1), aware_now) == "due"
    assert admin_dashboard._gdpr_deletion_status(aware_now + timedelta(minutes=1), aware_now) == "cooldown"

    job = SimpleNamespace(
        status=UserDataExportStatus.succeeded,
        file_path="exports/job.json",
        expires_at=datetime(2026, 2, 1, 9, 0),
        finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    assert admin_dashboard._gdpr_downloadable_job(job) is job
    assert admin_dashboard._gdpr_export_is_expired(job, now=aware_now) is True
    filename = admin_dashboard._gdpr_export_download_filename(job)
    assert filename.startswith("moment-studio-export-")
    assert filename.endswith(".json")

    with pytest.raises(HTTPException, match="Export is not ready"):
        admin_dashboard._gdpr_downloadable_job(SimpleNamespace(status=UserDataExportStatus.pending, file_path=None))

    current_user = SimpleNamespace(role=UserRole.admin)
    with pytest.raises(HTTPException, match="Owner account cannot be deleted"):
        admin_dashboard._assert_gdpr_deletion_target_allowed(
            SimpleNamespace(role=UserRole.owner),
            current_user,
            owner_error="Owner account cannot be deleted",
            staff_error="Only owner",
        )
    with pytest.raises(HTTPException, match="Only owner"):
        admin_dashboard._assert_gdpr_deletion_target_allowed(
            SimpleNamespace(role=UserRole.support),
            current_user,
            owner_error="Owner account cannot be deleted",
            staff_error="Only owner",
        )


def test_backend_wave_c_orders_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orders_api, "decode_token", lambda token: {"sub": "u-123"} if token == "good" else None)
    assert (
        orders_api._user_or_session_or_ip_identifier(
            _request(headers={"Authorization": "Bearer good"})
        )
        == "user:u-123"
    )
    assert (
        orders_api._user_or_session_or_ip_identifier(
            _request(headers={"Authorization": "Bearer bad", "X-Session-Id": " sid-1 "})
        )
        == "sid:sid-1"
    )
    assert orders_api._user_or_session_or_ip_identifier(_request(client_host="203.0.113.11")) == "ip:203.0.113.11"

    assert orders_api._split_customer_name("") == ("Customer", "Customer")
    assert orders_api._split_customer_name("Ada") == ("Ada", "Ada")
    assert orders_api._split_customer_name("Ada Lovelace") == ("Ada", "Lovelace")

    assert orders_api._resolve_country_payload(None) == (642, "Romania")
    assert orders_api._resolve_country_payload("us") == (0, "US")

    addr = SimpleNamespace(
        line1="Main 1",
        line2="Apt 2",
        city="Bucharest",
        country="RO",
        region="B",
        postal_code="010101",
    )
    payload = orders_api._netopia_address_payload(
        email=" buyer@example.com ",
        phone=" +40123 ",
        first_name="",
        last_name="Lovelace",
        addr=addr,
    )
    assert payload["email"] == "buyer@example.com"
    assert payload["firstName"] == "Customer"
    assert payload["lastName"] == "Lovelace"
    assert payload["details"] == "Main 1, Apt 2"

    assert orders_api._sanitize_filename(" ../label.pdf ") == "label.pdf"
    assert orders_api._sanitize_filename(None) == "shipping-label"

    monkeypatch.setattr(orders_api.settings, "cors_origins", ["https://store.example"], raising=False)
    monkeypatch.setattr(orders_api.settings, "frontend_origin", "https://fallback.example/", raising=False)
    assert orders_api._frontend_base_from_request(_request(headers={"Origin": "https://store.example"})) == "https://store.example"
    assert orders_api._frontend_base_from_request(_request(headers={"Origin": "https://other.example"})) == "https://fallback.example"

    order_with_user = SimpleNamespace(user=SimpleNamespace(email="user@example.com"), customer_email="customer@example.com")
    order_without_user = SimpleNamespace(user=None, customer_email="customer@example.com")
    assert orders_api._resolve_order_contact_email(order_with_user) == "user@example.com"
    assert orders_api._resolve_order_contact_email(order_without_user) == "customer@example.com"

    assert orders_api._parse_admin_status_filter(None) == (False, None, None)
    assert orders_api._parse_admin_status_filter("pending") == (True, None, None)
    sales_filter = orders_api._parse_admin_status_filter("sales")
    assert sales_filter[0] is False and sales_filter[1] is None and sales_filter[2] is not None
    assert orders_api._parse_admin_status_filter("paid") == (False, OrderStatus.paid, None)
    with pytest.raises(HTTPException, match="Invalid order status"):
        orders_api._parse_admin_status_filter("not-a-status")

    assert orders_api._parse_admin_sla_filter("overdue_acceptance") == "accept_overdue"
    assert orders_api._parse_admin_sla_filter("ship_overdue") == "ship_overdue"
    assert orders_api._parse_admin_sla_filter("any") == "any_overdue"
    with pytest.raises(HTTPException, match="Invalid SLA filter"):
        orders_api._parse_admin_sla_filter("bad")

    assert orders_api._parse_admin_fraud_filter("needs-review") == "queue"
    assert orders_api._parse_admin_fraud_filter("risk") == "flagged"
    assert orders_api._parse_admin_fraud_filter("approved") == "approved"
    assert orders_api._parse_admin_fraud_filter("denied") == "denied"
    with pytest.raises(HTTPException, match="Invalid fraud filter"):
        orders_api._parse_admin_fraud_filter("bad")

    naive = datetime(2026, 2, 1, 8, 0)
    aware = datetime(2026, 2, 1, 8, 0, tzinfo=timezone.utc)
    assert orders_api._ensure_utc_datetime(naive).tzinfo is not None
    assert orders_api._ensure_utc_datetime(aware) == aware
    assert orders_api._ensure_utc_datetime(None) is None

    due_at, overdue = orders_api._admin_order_sla_due(
        sla_kind="accept",
        sla_started_at=aware,
        now=aware + timedelta(hours=25),
        accept_hours=24,
        ship_hours=48,
    )
    assert due_at == aware + timedelta(hours=24)
    assert overdue is True
    assert orders_api._admin_order_sla_due(
        sla_kind=None,
        sla_started_at=aware,
        now=aware,
        accept_hours=24,
        ship_hours=48,
    ) == (None, False)

    monkeypatch.setattr(orders_api, "_order_has_payment_captured", lambda _order: True)
    paypal_order = SimpleNamespace(payment_method="paypal", paypal_capture_id="cap", stripe_payment_intent_id=None)
    assert orders_api._cancelled_order_refund_method(paypal_order) == "paypal"
    no_capture_paypal = SimpleNamespace(payment_method="paypal", paypal_capture_id=None, stripe_payment_intent_id=None)
    assert orders_api._cancelled_order_refund_method(no_capture_paypal) is None
    stripe_order = SimpleNamespace(payment_method="stripe", paypal_capture_id=None, stripe_payment_intent_id="pi_1")
    assert orders_api._cancelled_order_refund_method(stripe_order) == "stripe"

    owner_ro = SimpleNamespace(preferred_language="ro")
    owner_en = SimpleNamespace(preferred_language="en")
    order = SimpleNamespace(reference_code="R-100", id=uuid4())
    assert orders_api._owner_prefers_romanian(owner_ro) is True
    assert orders_api._manual_refund_notification_title(owner_ro) == "Rambursare necesară"
    assert "manual refund" in orders_api._manual_refund_notification_body(order, payment_method="stripe", owner=owner_en)
    assert orders_api._normalize_optional_note("  ") is None
    assert orders_api._normalize_optional_note(" note ") == "note"

    assert orders_api._order_update_notification_title(
        SimpleNamespace(status=OrderStatus.paid, user=SimpleNamespace(preferred_language="ro"))
    ) == "Comandă în procesare"
    assert orders_api._order_update_notification_title(
        SimpleNamespace(status="other", user=SimpleNamespace(preferred_language="en"))
    ) == "Order update"


def test_backend_wave_c_coupons_helper_branches() -> None:
    assert coupons_api._sanitize_coupon_prefix(" spring-sale_2026! ") == "SPRINGSALE2026"
    assert coupons_api._to_decimal("12.5") == Decimal("12.5")
    assert coupons_api._to_decimal(object()) == Decimal("0.00")

    with pytest.raises(HTTPException, match="percentage_off is required"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.percent,
            percentage_off=None,
            amount_off=None,
        )
    with pytest.raises(HTTPException, match="amount_off is required"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.amount,
            percentage_off=None,
            amount_off=None,
        )
    with pytest.raises(HTTPException, match="free_shipping promotions cannot set"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.free_shipping,
            percentage_off=10,
            amount_off=None,
        )
    with pytest.raises(HTTPException, match="Choose percentage_off or amount_off"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.percent,
            percentage_off=10,
            amount_off=Decimal("5"),
        )
    coupons_api._validate_promotion_discount_values(
        discount_type=PromotionDiscountType.percent,
        percentage_off=10,
        amount_off=None,
    )

    include_product = uuid4()
    exclude_category = uuid4()
    promo = SimpleNamespace(
        scopes=[
            SimpleNamespace(
                entity_type=PromotionScopeEntityType.product,
                mode=PromotionScopeMode.include,
                entity_id=include_product,
            ),
            SimpleNamespace(
                entity_type=PromotionScopeEntityType.category,
                mode=PromotionScopeMode.exclude,
                entity_id=exclude_category,
            ),
        ]
    )
    assert coupons_api._resolve_scope_updates(promo=promo, data={}) is None
    resolved = coupons_api._resolve_scope_updates(
        promo=promo,
        data={"included_category_ids": [exclude_category]},
    )
    assert resolved is not None
    include_products, exclude_products, include_categories, exclude_categories = resolved
    assert include_products == {include_product}
    assert exclude_products == set()
    assert include_categories == {exclude_category}
    assert exclude_categories == {exclude_category}

    requested, normalized, invalid = coupons_api._normalize_bulk_email_request(
        [" user@example.com ", "bad-email", "USER@example.com"]
    )
    assert requested == 3
    assert normalized == ["user@example.com"]
    assert invalid == ["bad-email"]

    with pytest.raises(HTTPException, match="Too many emails"):
        coupons_api._normalize_bulk_email_request([f"user{i}@example.com" for i in range(501)])

    assert coupons_api._normalize_bulk_email_value(None) is None
    assert coupons_api._normalize_bulk_email_value("  A@B.COM ") == "a@b.com"
    assert coupons_api._is_valid_bulk_email("a@b.com") is True
    assert coupons_api._is_valid_bulk_email("invalid") is False

    assert coupons_api._parse_bucket_config(bucket_total=None, bucket_index=None, bucket_seed=None) is None
    with pytest.raises(ValueError, match="requires bucket_total"):
        coupons_api._parse_bucket_config(bucket_total=10, bucket_index=None, bucket_seed="seed")
    with pytest.raises(ValueError, match="between 2 and 100"):
        coupons_api._parse_bucket_config(bucket_total=1, bucket_index=0, bucket_seed="seed")
    with pytest.raises(ValueError, match="within bucket_total range"):
        coupons_api._parse_bucket_config(bucket_total=2, bucket_index=2, bucket_seed="seed")
    config = coupons_api._parse_bucket_config(bucket_total=10, bucket_index=3, bucket_seed="x" * 120)
    assert config is not None
    assert config.seed == "x" * 80
    assert 0 <= coupons_api._bucket_index_for_user(user_id=uuid4(), seed="seed", total=10) < 10

    notify: list[tuple[str, str | None]] = []
    coupons_api._append_job_notification(
        notify,
        send_email=True,
        email="user@example.com",
        preferred_language="ro",
    )
    coupons_api._append_job_notification(
        notify,
        send_email=False,
        email="ignored@example.com",
        preferred_language="en",
    )
    assert notify == [("user@example.com", "ro")]

    now = datetime.now(timezone.utc)
    active_assignment = SimpleNamespace(user_id=uuid4(), revoked_at=None, revoked_reason=None)
    revoked_assignment = SimpleNamespace(user_id=uuid4(), revoked_at=now, revoked_reason="old")
    assign_rows = [
        (active_assignment.user_id, "active@example.com", "en"),
        (revoked_assignment.user_id, "revoked@example.com", "ro"),
        (uuid4(), "new@example.com", "en"),
    ]
    assign_job = SimpleNamespace(
        action=CouponBulkJobAction.assign,
        send_email=True,
        coupon_id=uuid4(),
        already_active=0,
        restored=0,
        created=0,
        processed=0,
        not_assigned=0,
        already_revoked=0,
        revoked=0,
    )
    session = _MemorySession()
    assign_notify = coupons_api._apply_bulk_job_rows(
        session=session,
        job=assign_job,
        rows=assign_rows,
        assignments_by_user_id={
            active_assignment.user_id: active_assignment,
            revoked_assignment.user_id: revoked_assignment,
        },
        now=now,
        revoke_reason=None,
    )
    assert assign_job.processed == 3
    assert assign_job.already_active == 1
    assert assign_job.restored == 1
    assert assign_job.created == 1
    assert len(assign_notify) == 2

    revoke_rows = [
        (active_assignment.user_id, "active@example.com", "en"),
        (revoked_assignment.user_id, "revoked@example.com", "ro"),
        (uuid4(), "missing@example.com", "en"),
    ]
    revoked_assignment.revoked_at = now
    revoke_job = SimpleNamespace(
        action=CouponBulkJobAction.revoke,
        send_email=True,
        coupon_id=uuid4(),
        already_active=0,
        restored=0,
        created=0,
        processed=0,
        not_assigned=0,
        already_revoked=0,
        revoked=0,
    )
    revoke_notify = coupons_api._apply_bulk_job_rows(
        session=session,
        job=revoke_job,
        rows=revoke_rows,
        assignments_by_user_id={
            active_assignment.user_id: active_assignment,
            revoked_assignment.user_id: revoked_assignment,
        },
        now=now,
        revoke_reason="cleanup",
    )
    assert revoke_job.processed == 3
    assert revoke_job.revoked == 1
    assert revoke_job.already_revoked == 1
    assert revoke_job.not_assigned == 1
    assert len(revoke_notify) == 1

    assert coupons_api._is_bulk_job_runnable(SimpleNamespace(status=CouponBulkJobStatus.pending)) is True
    assert coupons_api._is_bulk_job_runnable(SimpleNamespace(status=CouponBulkJobStatus.running)) is True
    assert coupons_api._is_bulk_job_runnable(SimpleNamespace(status=CouponBulkJobStatus.succeeded)) is False
