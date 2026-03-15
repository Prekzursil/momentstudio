from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi import HTTPException, Response
import pytest
from starlette.requests import Request

from app.api.v1 import admin_dashboard
from app.api.v1 import auth as auth_api
from app.api.v1 import catalog as catalog_api
from app.api.v1 import content as content_api
from app.api.v1 import coupons as coupons_api
from app.api.v1 import orders as orders_api
from app.models.catalog import ProductStatus
from app.models.order import OrderStatus
from app.models.user import UserRole
from app.schemas.auth import RefreshRequest
from app.schemas.content import ContentRedirectUpsertRequest
from app.schemas.coupons import CouponIssueToUserRequest


def _request(
    *,
    headers: dict[str, str] | None = None,
    cookies: dict[str, str] | None = None,
    client_host: str = "127.0.0.1",
) -> Request:
    header_map = {k.lower(): v for k, v in (headers or {}).items()}
    if cookies:
        cookie_header = "; ".join(f"{key}={value}" for key, value in cookies.items())
        header_map["cookie"] = cookie_header
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(key.encode(), value.encode()) for key, value in header_map.items()],
        "client": (client_host, 1234),
        "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


def test_orders_helper_branches() -> None:
    assert orders_api._normalize_email(" User@Example.com ") == "user@example.com"
    assert orders_api._money_to_cents(Decimal("1.235")) == 124
    assert orders_api._charge_label("shipping", "ro") == "Livrare"
    assert orders_api._charge_label("custom", "ro") == "custom"

    assert orders_api._split_customer_name("") == ("Customer", "Customer")
    assert orders_api._split_customer_name("Alice") == ("Alice", "Alice")
    assert orders_api._split_customer_name("Alice Bob Carol") == ("Alice", "Bob Carol")

    assert orders_api._resolve_country_payload(" ro ") == (642, "Romania")
    assert orders_api._resolve_country_payload("de") == (0, "DE")
    assert orders_api._sanitize_filename("../invoice.pdf") == "invoice.pdf"
    assert orders_api._sanitize_filename(None) == "shipping-label"


def test_orders_delivery_filters_and_guest_token_state() -> None:
    home = orders_api._delivery_from_payload(
        courier=" sameday ",
        delivery_type="home",
        locker_id="LOCK1",
        locker_name="Locker Name",
        locker_address="Street",
        locker_lat=44.0,
        locker_lng=26.0,
    )
    assert home == ("sameday", "home", None, None, None, None, None)

    with pytest.raises(HTTPException, match="Locker selection is required"):
        orders_api._delivery_from_payload(
            courier="sameday",
            delivery_type="locker",
            locker_id="LOCK1",
            locker_name="",
            locker_address="Street",
            locker_lat=44.0,
            locker_lng=26.0,
        )

    locker = orders_api._delivery_from_payload(
        courier="sameday",
        delivery_type="locker",
        locker_id=" LOCK1 ",
        locker_name=" Main Locker ",
        locker_address=" Addr ",
        locker_lat=44,
        locker_lng=26,
    )
    assert locker == ("sameday", "locker", "LOCK1", "Main Locker", "Addr", 44.0, 26.0)

    pending_any, parsed_status, parsed_statuses = orders_api._parse_admin_status_filter("pending")
    assert pending_any is True
    assert parsed_status is None
    assert parsed_statuses is None

    pending_any, parsed_status, parsed_statuses = orders_api._parse_admin_status_filter("sales")
    assert pending_any is False
    assert parsed_status is None
    assert parsed_statuses == [
        OrderStatus.paid,
        OrderStatus.shipped,
        OrderStatus.delivered,
        OrderStatus.refunded,
    ]

    pending_any, parsed_status, parsed_statuses = orders_api._parse_admin_status_filter("paid")
    assert pending_any is False
    assert parsed_status == OrderStatus.paid
    assert parsed_statuses is None

    with pytest.raises(HTTPException, match="Invalid order status"):
        orders_api._parse_admin_status_filter("not-a-status")

    assert orders_api._parse_admin_sla_filter("overdue_shipping") == "ship_overdue"
    assert orders_api._parse_admin_sla_filter("any") == "any_overdue"
    with pytest.raises(HTTPException, match="Invalid SLA filter"):
        orders_api._parse_admin_sla_filter("unknown")

    assert orders_api._parse_admin_fraud_filter("needs-review") == "queue"
    assert orders_api._parse_admin_fraud_filter("risk") == "flagged"
    with pytest.raises(HTTPException, match="Invalid fraud filter"):
        orders_api._parse_admin_fraud_filter("mystery")

    now = datetime(2026, 2, 1, tzinfo=timezone.utc)
    cart = SimpleNamespace(
        guest_email="User@Example.com",
        guest_email_verification_token=" 123456 ",
        guest_email_verification_expires_at=now + timedelta(minutes=5),
        guest_email_verification_attempts=2,
    )
    token, attempts = orders_api._assert_guest_email_token_state(cart, email="user@example.com", now=now)
    assert token == "123456"
    assert attempts == 2

    with pytest.raises(HTTPException, match="Email mismatch"):
        orders_api._assert_guest_email_token_state(cart, email="other@example.com", now=now)

    expired_cart = SimpleNamespace(
        guest_email="user@example.com",
        guest_email_verification_token="123456",
        guest_email_verification_expires_at=now - timedelta(seconds=1),
        guest_email_verification_attempts=0,
    )
    with pytest.raises(HTTPException, match="Invalid or expired token"):
        orders_api._assert_guest_email_token_state(expired_cart, email="user@example.com", now=now)

    blocked_cart = SimpleNamespace(
        guest_email="user@example.com",
        guest_email_verification_token="123456",
        guest_email_verification_expires_at=now + timedelta(minutes=1),
        guest_email_verification_attempts=orders_api.GUEST_EMAIL_TOKEN_MAX_ATTEMPTS,
    )
    with pytest.raises(HTTPException, match="Too many attempts"):
        orders_api._assert_guest_email_token_state(blocked_cart, email="user@example.com", now=now)


def test_orders_cancel_request_helpers() -> None:
    orders_api._validate_cancel_request_eligibility(SimpleNamespace(status=OrderStatus.pending_payment))
    with pytest.raises(HTTPException, match="Cancel request not eligible"):
        orders_api._validate_cancel_request_eligibility(SimpleNamespace(status=OrderStatus.shipped))

    assert orders_api._require_cancel_request_reason(SimpleNamespace(reason="  Need to cancel  ")) == "Need to cancel"
    with pytest.raises(HTTPException, match="Cancel reason is required"):
        orders_api._require_cancel_request_reason(SimpleNamespace(reason="   "))

    orders_api._ensure_cancel_request_not_duplicate(SimpleNamespace(events=[SimpleNamespace(event="created")]))
    with pytest.raises(HTTPException, match="Cancel request already exists"):
        orders_api._ensure_cancel_request_not_duplicate(
            SimpleNamespace(events=[SimpleNamespace(event="cancel_requested")])
        )


def test_auth_helper_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    assert auth_api._extract_bearer_token(_request(headers={"authorization": "Bearer access"})) == "access"
    assert auth_api._extract_bearer_token(_request(headers={"authorization": "Basic abc"})) is None

    def fake_decode_token(token: str) -> dict[str, object] | None:
        if token == "refresh-cookie":
            return {"type": "refresh", "jti": "refresh-jti"}
        if token == "access-token":
            return {"type": "access", "jti": "access-jti"}
        if token == "good-refresh":
            return {"type": "refresh", "jti": "identity-jti", "sub": str(uuid4())}
        if token == "bad-refresh":
            return {"type": "access", "jti": "wrong-type"}
        return None

    monkeypatch.setattr(auth_api.security, "decode_token", fake_decode_token)

    assert auth_api._extract_token_jti("refresh-cookie", token_type="refresh") == "refresh-jti"
    assert auth_api._extract_token_jti("refresh-cookie", token_type="access") is None

    req_cookie = _request(
        headers={"authorization": "Bearer access-token"},
        cookies={"refresh_token": "refresh-cookie"},
    )
    assert auth_api._extract_refresh_session_jti(req_cookie) == "refresh-jti"

    req_access = _request(headers={"authorization": "Bearer access-token"})
    assert auth_api._extract_refresh_session_jti(req_access) == "access-jti"

    country_req = _request(headers={"cf-ipcountry": "XX", "x-country": " ro "})
    assert auth_api._extract_country_code(country_req) == "RO"
    assert auth_api._extract_country_code(_request(headers={"x-country": "R0!"})) is None

    assert auth_api._is_silent_refresh_probe(_request(headers={"x-silent": "true"})) is True
    assert auth_api._is_silent_refresh_probe(_request(headers={"x-silent": "off"})) is False

    with pytest.raises(HTTPException, match="Refresh token missing"):
        auth_api._extract_refresh_identity(
            RefreshRequest(refresh_token=None),
            _request(),
            silent_refresh_probe=False,
            response=None,
        )

    silent_response = auth_api._extract_refresh_identity(
        RefreshRequest(refresh_token=None),
        _request(),
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(silent_response, Response)
    assert silent_response.status_code == 204

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        auth_api._extract_refresh_identity(
            RefreshRequest(refresh_token="bad-refresh"),
            _request(),
            silent_refresh_probe=False,
            response=None,
        )

    identity = auth_api._extract_refresh_identity(
        RefreshRequest(refresh_token="good-refresh"),
        _request(),
        silent_refresh_probe=False,
        response=None,
    )
    assert isinstance(identity, tuple)
    assert identity[0] == "identity-jti"
    assert isinstance(identity[1], UUID)

    now = datetime.now(timezone.utc)
    monkeypatch.setattr(auth_api.settings, "refresh_token_rotation_grace_seconds", 60)
    rotated = SimpleNamespace(
        revoked_reason="rotated",
        rotated_at=now - timedelta(seconds=5),
        replaced_by_jti="replacement-jti",
    )
    assert auth_api._rotated_replacement_jti_within_grace(rotated, now=now) == "replacement-jti"
    assert auth_api._rotated_replacement_jti_within_grace(
        SimpleNamespace(revoked_reason="manual", rotated_at=now, replaced_by_jti="x"),
        now=now,
    ) is None


def test_content_api_import_and_access_helpers() -> None:
    assert content_api._normalize_image_tag(" Hero Banner 2026 ") == "hero-banner-2026"
    assert content_api._normalize_image_tag("x" * 70) is None
    tags = content_api._normalize_image_tags(
        ["Hero Banner", "hero-banner", "promo", "promo", "x" * 70, "news"]
    )
    assert tags == ["hero-banner", "promo", "news"]

    assert content_api._redirect_display_value_to_key("/pages/About Us") == "page.about-us"
    assert content_api._redirect_key_to_display_value("page.about-us") == "/pages/about-us"

    redirects = {"a": "b", "b": "a"}
    assert content_api._redirect_chain_error("a", redirects) == "loop"
    deep = {f"k{i}": f"k{i+1}" for i in range(3)}
    assert content_api._redirect_chain_error("k0", deep, max_hops=2) == "too_deep"

    from_key, to_key = content_api._parse_redirect_upsert_payload_or_400(
        ContentRedirectUpsertRequest(from_key="/pages/home", to_key="/pages/about")
    )
    assert from_key == "page.home"
    assert to_key == "page.about"
    with pytest.raises(HTTPException, match="Invalid redirect"):
        content_api._parse_redirect_upsert_payload_or_400(
            ContentRedirectUpsertRequest(from_key="/pages/home", to_key="/pages/home")
        )

    csv_text = "\n".join(
        [
            "from,to",
            "# comment",
            "/pages/old,/pages/new",
            "/pages/a,",
            ",/pages/b",
            "/pages/same,/pages/same",
        ]
    )
    rows, errors = content_api._collect_redirect_import_rows(csv_text)
    assert rows == [(3, "page.old", "page.new")]
    assert len(errors) == 3

    with pytest.raises(HTTPException, match="Redirect loop detected"):
        content_api._raise_for_redirect_import_chain_errors({"page.a": "page.b", "page.b": "page.a"})

    parsed_from, parsed_to = content_api._parse_optional_datetime_range(
        "2026-01-01T00:00:00+00:00",
        "2026-01-02T00:00:00+00:00",
    )
    assert parsed_from is not None and parsed_to is not None
    with pytest.raises(HTTPException, match="Invalid date filters"):
        content_api._parse_optional_datetime_range("invalid", None)

    hidden_page = SimpleNamespace(key="page.hidden", meta={"hidden": True})
    with pytest.raises(HTTPException, match="Content not found"):
        content_api._validate_public_page_access(hidden_page, user=object())

    auth_page = SimpleNamespace(key="page.private", meta={"requires_auth": True})
    with pytest.raises(HTTPException, match="Not authenticated"):
        content_api._validate_public_page_access(auth_page, user=None)


def test_catalog_api_view_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert catalog_api._normalize_sale_filter("sale", None) == (None, True)
    assert catalog_api._normalize_sale_filter("rings", False) == ("rings", False)
    assert catalog_api._normalize_sale_filter("sale", True) == ("sale", True)

    assert catalog_api._is_catalog_staff(SimpleNamespace(role=UserRole.admin)) is True
    assert catalog_api._is_catalog_staff(SimpleNamespace(role=UserRole.content)) is True
    assert catalog_api._is_catalog_staff(SimpleNamespace(role=UserRole.customer)) is False
    assert catalog_api._is_catalog_staff(None) is False

    product = SimpleNamespace(is_deleted=False, is_active=True, status=ProductStatus.published)
    assert catalog_api._is_product_publicly_visible(product) is True
    assert catalog_api._is_product_publicly_visible(
        SimpleNamespace(is_active=False, status=ProductStatus.published)
    ) is False
    assert catalog_api._product_is_missing(None) is True
    assert catalog_api._product_is_missing(SimpleNamespace(is_deleted=True)) is True
    assert catalog_api._product_is_missing(SimpleNamespace(is_deleted=False)) is False
    assert catalog_api._should_hide_product_from_view(product, is_admin=False) is False
    assert catalog_api._should_hide_product_from_view(
        SimpleNamespace(is_deleted=False, is_active=False, status=ProductStatus.published),
        is_admin=False,
    ) is True
    assert catalog_api._should_hide_product_from_view(
        SimpleNamespace(is_deleted=False, is_active=False, status=ProductStatus.published),
        is_admin=True,
    ) is False

    monkeypatch.setattr(catalog_api.catalog_service, "is_sale_active", lambda _product: False)
    assert catalog_api._should_hide_sale_price(product, is_admin=False) is True
    assert catalog_api._should_hide_sale_price(product, is_admin=True) is False

    monkeypatch.setattr(catalog_api.catalog_service, "is_sale_active", lambda _product: True)
    assert catalog_api._should_hide_sale_price(product, is_admin=False) is False

    assert catalog_api._build_product_list_meta(0, 1, 20) == {
        "total_items": 0,
        "total_pages": 1,
        "page": 1,
        "limit": 20,
    }
    assert catalog_api._build_product_list_meta(21, 2, 20) == {
        "total_items": 21,
        "total_pages": 2,
        "page": 2,
        "limit": 20,
    }


def test_catalog_api_payload_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        catalog_api.ProductRead,
        "model_validate",
        staticmethod(lambda _product: SimpleNamespace(sale_price=Decimal("19.99"))),
    )
    monkeypatch.setattr(catalog_api.catalog_service, "is_sale_active", lambda product: bool(getattr(product, "sale_active", False)))

    with_sale = SimpleNamespace(sale_active=True)
    without_sale = SimpleNamespace(sale_active=False)
    payload = catalog_api._build_product_list_payload([with_sale, without_sale])

    assert payload[0].sale_price == Decimal("19.99")
    assert payload[1].sale_price is None


def test_catalog_api_additional_query_helpers() -> None:
    assert len(catalog_api._build_product_query_options(None)) == 2
    assert len(catalog_api._build_product_query_options("ro")) == 3
    assert catalog_api._is_catalog_admin_viewer(None) is False
    assert catalog_api._is_catalog_admin_viewer(SimpleNamespace(role=UserRole.owner)) is True

    user_id = uuid4()
    assert catalog_api._recently_viewed_user_id(SimpleNamespace(id=user_id)) == user_id
    assert catalog_api._recently_viewed_user_id(None) is None

    with pytest.raises(HTTPException, match="Product not found"):
        catalog_api._raise_product_not_found()


def test_admin_dashboard_misc_helpers() -> None:
    assert admin_dashboard._payments_success_rate(0, 0) is None
    assert admin_dashboard._payments_success_rate(3, 1) == pytest.approx(0.75)

    methods = admin_dashboard._payments_sorted_methods(
        {"paypal": 2, "custom_provider": 1},
        {"stripe": 1},
    )
    assert methods.index("stripe") < methods.index("paypal")
    assert methods.index("unknown") < methods.index("custom_provider")

    assert admin_dashboard._refund_reason_category("Broken package") == "damaged"
    assert admin_dashboard._refund_reason_category("No reason") == "other"
    reasons = admin_dashboard._refund_reasons_payload({"damaged": 3}, {"damaged": 1})
    damaged = next(row for row in reasons if row["category"] == "damaged")
    assert damaged["current"] == 3
    assert damaged["delta_pct"] == pytest.approx(200.0)

    assert admin_dashboard._shipping_delta_pct(None, 10.0) is None
    assert admin_dashboard._shipping_delta_pct(12.0, 10.0) == pytest.approx(20.0)
    assert admin_dashboard._shipping_avg([]) is None
    assert admin_dashboard._shipping_avg([2.0, 4.0, 6.0]) == pytest.approx(4.0)

    assert admin_dashboard._channel_normalize_value("  source  ") == "source"
    assert admin_dashboard._channel_normalize_value(123) == ""
    assert admin_dashboard._duplicate_suggested_slug("product", {"product", "product-2"}) == "product-3"

    assert admin_dashboard._audit_mask_email("alice@example.com") == "a****@example.com"
    redacted = admin_dashboard._audit_redact_text("Contact alice@example.com from 1.2.3.4")
    assert "@example.com" in redacted
    assert "***.***.***.***" in redacted
    assert admin_dashboard._audit_csv_cell("=1+1") == "'=1+1"

    now = datetime(2026, 2, 1, tzinfo=timezone.utc)
    assert admin_dashboard._gdpr_deletion_status(None, now) == "scheduled"
    assert admin_dashboard._gdpr_deletion_status(now - timedelta(seconds=1), now) == "due"
    assert admin_dashboard._gdpr_deletion_status(now + timedelta(seconds=1), now) == "cooldown"


def test_coupons_helper_branches() -> None:
    starts_at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    naive_end = datetime(2026, 2, 2)
    normalized = coupons_api._normalize_issue_coupon_ends_at(
        ends_at=naive_end,
        validity_days=None,
        starts_at=starts_at,
    )
    assert normalized is not None and normalized.tzinfo == timezone.utc

    validity_end = coupons_api._normalize_issue_coupon_ends_at(
        ends_at=None,
        validity_days=3,
        starts_at=starts_at,
    )
    assert validity_end == starts_at + timedelta(days=3)

    opted_in_user = SimpleNamespace(email="user@example.com", notify_marketing=True)
    assert coupons_api._resolve_issue_coupon_should_email(send_email=True, user=opted_in_user) is True
    assert coupons_api._resolve_issue_coupon_should_email(send_email=False, user=opted_in_user) is False

    with pytest.raises(HTTPException, match="not opted in to marketing"):
        coupons_api._resolve_issue_coupon_should_email(
            send_email=True,
            user=SimpleNamespace(email="user@example.com", notify_marketing=False),
        )

    with pytest.raises(HTTPException, match="ends_at must be in the future"):
        coupons_api._resolve_issue_coupon_ends_at_or_400(
            payload=CouponIssueToUserRequest(
                user_id=uuid4(),
                promotion_id=uuid4(),
                ends_at=starts_at - timedelta(seconds=1),
                send_email=False,
            ),
            starts_at=starts_at,
        )

    coupon = SimpleNamespace(
        code="SAVE10",
        ends_at=starts_at + timedelta(days=7),
        promotion=SimpleNamespace(name="Promo Name", description="Promo description"),
    )
    context = coupons_api._coupon_email_context(coupon)
    assert context.coupon_code == "SAVE10"
    assert context.promotion_name == "Promo Name"
    assert context.promotion_description == "Promo description"

    assert coupons_api._trimmed_revoke_reason("  reason  ") == "reason"
    assert coupons_api._trimmed_revoke_reason("x" * 400, max_len=5) == "xxxxx"
    assert coupons_api._notification_revoke_reason("   ") is None
    assert coupons_api._notification_revoke_reason("  revoked  ") == "revoked"

    order_id = uuid4()
    product_a = uuid4()
    product_b = uuid4()
    item_rows = [
        (order_id, product_a, "product-a", "Product A", 2, Decimal("20.00")),
        (order_id, product_b, "product-b", "Product B", 1, Decimal("30.00")),
        (None, product_a, "product-a", "Product A", 1, Decimal("9.00")),
        (order_id, None, "ignored", "Ignored", 1, Decimal("5.00")),
    ]
    subtotals = coupons_api._coupon_order_subtotals(item_rows)
    assert subtotals[order_id] == Decimal("55.00")

    aggregates = coupons_api._coupon_analytics_aggregates(
        item_rows=item_rows,
        order_discount_by_id={order_id: Decimal("10.00")},
    )
    assert aggregates[product_a].quantity == 2
    assert aggregates[product_b].quantity == 1
    assert aggregates[product_a].allocated == pytest.approx(Decimal("3.636363636363636363636363636"))
    assert aggregates[product_b].allocated == pytest.approx(Decimal("5.454545454545454545454545455"))
    assert coupons_api._allocated_discount(
        order_discount=Decimal("0"),
        subtotal=Decimal("10"),
        order_subtotal=Decimal("100"),
    ) == Decimal("0.00")
