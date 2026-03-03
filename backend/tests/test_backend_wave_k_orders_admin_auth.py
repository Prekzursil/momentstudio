from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Response
from starlette.requests import Request

from app.api.v1 import admin_dashboard as admin_dashboard_api
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus
from app.models.user import UserRole


def _make_request(
    *,
    headers: dict[str, str] | None = None,
    cookies: dict[str, str] | None = None,
    client_host: str | None = "127.0.0.1",
) -> Request:
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
        "client": (client_host, 44321) if client_host is not None else None,
    }
    return Request(scope)


def _set_cookie_headers(response: Response) -> list[str]:
    return [
        value.decode("latin-1")
        for name, value in response.raw_headers
        if name.decode("latin-1").lower() == "set-cookie"
    ]


def test_orders_identifier_prefers_user_then_session_then_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        orders_api,
        "decode_token",
        lambda token: {"sub": "user-42"} if token == "good-token" else None,
    )

    req_user = _make_request(
        headers={"authorization": "Bearer good-token", "x-session-id": "session-a"},
        client_host="10.0.0.1",
    )
    assert orders_api._user_or_session_or_ip_identifier(req_user) == "user:user-42"

    req_session = _make_request(
        headers={"authorization": "Bearer bad-token", "x-session-id": "  session-a  "},
        client_host="10.0.0.2",
    )
    assert orders_api._user_or_session_or_ip_identifier(req_session) == "sid:session-a"

    req_ip = _make_request(client_host="10.0.0.3")
    assert orders_api._user_or_session_or_ip_identifier(req_ip) == "ip:10.0.0.3"

    req_anon = _make_request(client_host=None)
    assert orders_api._user_or_session_or_ip_identifier(req_anon) == "ip:anon"


def test_orders_basic_helpers_and_labels(monkeypatch: pytest.MonkeyPatch) -> None:
    assert orders_api._normalize_email("  USER@Example.COM ") == "user@example.com"
    assert orders_api._account_orders_url(SimpleNamespace(reference_code="REF 01", id="unused")) == "/account/orders?q=REF+01"

    monkeypatch.setattr(orders_api.secrets, "randbelow", lambda _n: 42)
    assert orders_api._generate_guest_email_token() == "000042"

    value = Decimal("12.34")
    assert orders_api._as_decimal(value) == value
    assert orders_api._as_decimal("1.2") == Decimal("1.2")

    monkeypatch.setattr(orders_api.pricing, "quantize_money", lambda _v: Decimal("1.24"))
    assert orders_api._money_to_cents(Decimal("1.2345")) == 124

    assert orders_api._charge_label("shipping", "ro") == "Livrare"
    assert orders_api._charge_label("fee", "en") == "Fee"
    assert orders_api._charge_label("unknown", "ro") == "unknown"

    assert orders_api._split_customer_name("") == ("Customer", "Customer")
    assert orders_api._split_customer_name("Alice") == ("Alice", "Alice")
    assert orders_api._split_customer_name("Alice Bob Carol") == ("Alice", "Bob Carol")


def test_orders_delivery_billing_phone_and_frontend_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(orders_api.HTTPException) as locker_exc:
        orders_api._delivery_from_payload(
            courier="sameday",
            delivery_type="locker",
            locker_id="L1",
            locker_name="Locker",
            locker_address=None,
            locker_lat=None,
            locker_lng=26.1,
        )
    assert locker_exc.value.status_code == 400
    assert "Locker selection is required" in str(locker_exc.value.detail)

    locker_tuple = orders_api._delivery_from_payload(
        courier="  fan ",
        delivery_type="locker",
        locker_id="  L1 ",
        locker_name="  Mega Locker ",
        locker_address="  Main street ",
        locker_lat=45.7,
        locker_lng=26.1,
    )
    assert locker_tuple == ("fan", "locker", "L1", "Mega Locker", "Main street", 45.7, 26.1)

    home_tuple = orders_api._delivery_from_payload(
        courier="sameday",
        delivery_type="home",
        locker_id="unused",
        locker_name="unused",
        locker_address="unused",
        locker_lat=44.0,
        locker_lng=25.0,
    )
    assert home_tuple == ("sameday", "home", None, None, None, None, None)

    assert (
        orders_api._has_complete_billing_address(
            line1="Street 1",
            city="Bucharest",
            postal_code="010101",
            country="RO",
        )
        is True
    )
    assert (
        orders_api._has_complete_billing_address(
            line1="Street 1",
            city="",
            postal_code="010101",
            country="RO",
        )
        is False
    )

    with pytest.raises(orders_api.HTTPException) as phone_exc:
        orders_api._resolve_checkout_phone(
            payload_phone="",
            fallback_phone=None,
            phone_required=True,
        )
    assert phone_exc.value.status_code == 400
    assert "Phone is required" in str(phone_exc.value.detail)

    resolved = orders_api._resolve_checkout_phone(
        payload_phone="",
        fallback_phone=" +40123 ",
        phone_required=True,
    )
    assert resolved == "+40123"

    monkeypatch.setattr(orders_api.settings, "cors_origins", ["https://shop.example", "https://alt.example"])
    monkeypatch.setattr(orders_api.settings, "frontend_origin", "https://frontend.example/")
    allowed_req = _make_request(headers={"origin": "https://shop.example/"})
    blocked_req = _make_request(headers={"origin": "https://not-allowed.example"})
    assert orders_api._frontend_base_from_request(allowed_req) == "https://shop.example"
    assert orders_api._frontend_base_from_request(blocked_req) == "https://frontend.example"
    assert orders_api._frontend_base_from_request(None) == "https://frontend.example"


def test_orders_mock_payment_netopia_and_export_filter_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orders_api.settings, "netopia_enabled", False)
    with pytest.raises(orders_api.HTTPException) as disabled_exc:
        orders_api._assert_netopia_enabled_and_configured()
    assert disabled_exc.value.status_code == 400

    monkeypatch.setattr(orders_api.settings, "netopia_enabled", True)
    monkeypatch.setattr(orders_api.netopia_service, "netopia_configuration_status", lambda: (False, "missing"))
    with pytest.raises(orders_api.HTTPException) as config_exc:
        orders_api._assert_netopia_enabled_and_configured()
    assert config_exc.value.status_code == 500
    assert config_exc.value.detail == "missing"

    monkeypatch.setattr(orders_api.netopia_service, "netopia_configuration_status", lambda: (True, None))
    orders_api._assert_netopia_enabled_and_configured()

    assert orders_api._netopia_error_details({"error": {"code": "12", "message": "Denied"}}) == ("12", "Denied")
    assert orders_api._netopia_error_details({"error": "bad-shape"}) == ("", "")

    with pytest.raises(orders_api.HTTPException) as status_exc:
        orders_api._assert_netopia_status_completed({"payment": {"status": 2}})
    assert status_exc.value.status_code == 400

    with pytest.raises(orders_api.HTTPException) as code_exc:
        orders_api._assert_netopia_error_success({"error": {"code": "12", "message": "Declined by processor"}})
    assert code_exc.value.status_code == 400
    assert code_exc.value.detail == "Declined by processor"

    orders_api._assert_netopia_status_completed({"payment": {"status": 5}})
    orders_api._assert_netopia_error_success({"error": {"code": "00"}})

    assert orders_api._parse_admin_status_filter(None) == (False, None, None)
    assert orders_api._parse_admin_status_filter("pending") == (True, None, None)
    assert orders_api._parse_admin_status_filter("sales") == (
        False,
        None,
        [OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered, OrderStatus.refunded],
    )
    assert orders_api._parse_admin_status_filter("paid") == (False, OrderStatus.paid, None)
    with pytest.raises(orders_api.HTTPException) as invalid_status:
        orders_api._parse_admin_status_filter("bad-status")
    assert invalid_status.value.status_code == 400

    assert orders_api._parse_admin_sla_filter("acceptance_overdue") == "accept_overdue"
    assert orders_api._parse_admin_fraud_filter("needs_review") == "queue"
    with pytest.raises(orders_api.HTTPException):
        orders_api._parse_admin_sla_filter("wat")
    with pytest.raises(orders_api.HTTPException):
        orders_api._parse_admin_fraud_filter("wat")

    naive_dt = datetime(2026, 1, 10, 12, 0, 0)
    aware_dt = datetime(2026, 1, 10, 12, 0, 0, tzinfo=timezone(timedelta(hours=2)))
    assert orders_api._ensure_utc_datetime(naive_dt).tzinfo == timezone.utc
    assert orders_api._ensure_utc_datetime(aware_dt) == datetime(2026, 1, 10, 10, 0, 0, tzinfo=timezone.utc)

    now = datetime(2026, 1, 11, 12, 0, 0, tzinfo=timezone.utc)
    due_accept, overdue_accept = orders_api._admin_order_sla_due(
        sla_kind="accept",
        sla_started_at=now - timedelta(hours=25),
        now=now,
        accept_hours=24,
        ship_hours=48,
    )
    assert due_accept == now - timedelta(hours=1)
    assert overdue_accept is True

    due_ship, overdue_ship = orders_api._admin_order_sla_due(
        sla_kind="ship",
        sla_started_at=now - timedelta(hours=20),
        now=now,
        accept_hours=24,
        ship_hours=48,
    )
    assert due_ship == now + timedelta(hours=28)
    assert overdue_ship is False
    assert orders_api._admin_order_sla_due(
        sla_kind="unknown",
        sla_started_at=now,
        now=now,
        accept_hours=24,
        ship_hours=48,
    ) == (None, False)

    monkeypatch.setattr(orders_api.pii_service, "mask_email", lambda value: f"MASK:{value}")
    allowed_masked = orders_api._order_export_allowed_columns(include_pii=False)
    allowed_pii = orders_api._order_export_allowed_columns(include_pii=True)
    sample_order = SimpleNamespace(customer_email="buyer@example.com")
    assert allowed_masked["customer_email"](sample_order) == "MASK:buyer@example.com"
    assert allowed_pii["customer_email"](sample_order) == "buyer@example.com"

    assert orders_api._selected_export_columns(None, allowed=allowed_pii) == [
        "id",
        "reference_code",
        "status",
        "total_amount",
        "currency",
        "user_id",
        "created_at",
    ]
    parsed = orders_api._selected_export_columns(["id, status", "customer_email"], allowed=allowed_pii)
    assert parsed == ["id", "status", "customer_email"]
    with pytest.raises(orders_api.HTTPException) as invalid_cols:
        orders_api._selected_export_columns(["id,unknown_col"], allowed=allowed_pii)
    assert invalid_cols.value.status_code == 400
    assert "Invalid export columns" in str(invalid_cols.value.detail)


def test_auth_identifier_extractors_and_state_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_api, "decode_token", lambda token: {"sub": "user-99"} if token == "good" else None)

    req_user = _make_request(headers={"authorization": "Bearer good"}, client_host="10.10.10.1")
    req_ip = _make_request(headers={"authorization": "Bearer bad"}, client_host=None)
    assert auth_api._user_or_ip_identifier(req_user) == "user:user-99"
    assert auth_api._user_or_ip_identifier(req_ip) == "ip:anon"

    assert auth_api._extract_bearer_token(_make_request(headers={"authorization": "Bearer abc123"})) == "abc123"
    assert auth_api._extract_bearer_token(_make_request(headers={"authorization": "basic abc123"})) is None
    assert auth_api._extract_bearer_token(_make_request(headers={"authorization": "Bearer   "} )) is None
    assert auth_api._extract_bearer_token(_make_request()) is None

    monkeypatch.setattr(auth_api.security, "decode_token", lambda _state: {"type": "google_link", "uid": "user-1"})
    auth_api._validate_google_state("state-token", expected_type="google_link", expected_user_id="user-1")

    with pytest.raises(auth_api.HTTPException) as type_exc:
        auth_api._validate_google_state("state-token", expected_type="google_start")
    assert type_exc.value.status_code == 400

    with pytest.raises(auth_api.HTTPException) as uid_exc:
        auth_api._validate_google_state("state-token", expected_type="google_link", expected_user_id="other-user")
    assert uid_exc.value.status_code == 400


def test_auth_cookie_helpers_and_refresh_session_jti(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_api.settings, "secure_cookies", False)
    monkeypatch.setattr(auth_api.settings, "cookie_samesite", "Lax")
    monkeypatch.setattr(auth_api.settings, "refresh_token_exp_days", 7)
    monkeypatch.setattr(auth_api.settings, "admin_ip_bypass_cookie_minutes", 0)

    refresh_response = Response()
    auth_api.set_refresh_cookie(refresh_response, "refresh-token", persistent=True)
    refresh_headers = _set_cookie_headers(refresh_response)
    assert any("refresh_token=refresh-token" in value for value in refresh_headers)
    assert any("Max-Age=604800" in value for value in refresh_headers)

    non_persistent_response = Response()
    auth_api.set_refresh_cookie(non_persistent_response, "refresh-token", persistent=False)
    non_persistent_headers = _set_cookie_headers(non_persistent_response)
    assert any("refresh_token=refresh-token" in value for value in non_persistent_headers)
    assert not any("Max-Age=" in value for value in non_persistent_headers)

    auth_api.clear_refresh_cookie(non_persistent_response)
    cleared_refresh_headers = _set_cookie_headers(non_persistent_response)
    assert any("refresh_token=" in value and "Max-Age=0" in value for value in cleared_refresh_headers)

    bypass_response = Response()
    auth_api.set_admin_ip_bypass_cookie(bypass_response, "bypass-token")
    bypass_headers = _set_cookie_headers(bypass_response)
    assert any("admin_ip_bypass=bypass-token" in value for value in bypass_headers)
    assert any("Max-Age=60" in value for value in bypass_headers)
    auth_api.clear_admin_ip_bypass_cookie(bypass_response)
    cleared_bypass_headers = _set_cookie_headers(bypass_response)
    assert any("admin_ip_bypass=" in value and "Max-Age=0" in value for value in cleared_bypass_headers)

    decode_map = {
        "refresh-good": {"type": "refresh", "jti": "refresh-jti"},
        "refresh-bad": {"type": "access", "jti": "wrong-type"},
        "access-good": {"type": "access", "jti": "access-jti"},
    }
    monkeypatch.setattr(auth_api.security, "decode_token", lambda token: decode_map.get(token))

    req_refresh = _make_request(cookies={"refresh_token": "refresh-good"})
    assert auth_api._extract_refresh_session_jti(req_refresh) == "refresh-jti"

    req_access = _make_request(
        headers={"authorization": "Bearer access-good"},
        cookies={"refresh_token": "refresh-bad"},
    )
    assert auth_api._extract_refresh_session_jti(req_access) == "access-jti"
    assert auth_api._extract_refresh_session_jti(_make_request()) is None


def test_auth_extract_country_code(monkeypatch: pytest.MonkeyPatch) -> None:
    req_priority = _make_request(headers={"cf-ipcountry": "XX", "x-country-code": " ro "})
    assert auth_api._extract_country_code(req_priority) == "RO"

    req_truncate = _make_request(headers={"x-country": "ABCDEFGHIJK"})
    assert auth_api._extract_country_code(req_truncate) == "ABCDEFGH"

    req_invalid = _make_request(headers={"x-country": "us!"})
    assert auth_api._extract_country_code(req_invalid) is None

    monkeypatch.setattr(auth_api.settings, "cookie_samesite", "Lax")


def test_admin_dashboard_range_delta_rate_and_anomalies() -> None:
    now = datetime(2026, 2, 10, 15, 0, 0, tzinfo=timezone.utc)
    start, end, days = admin_dashboard_api._summary_resolve_range(now, 14, None, None)
    assert end == now
    assert start == now - timedelta(days=14)
    assert days == 14

    with pytest.raises(admin_dashboard_api.HTTPException) as missing_range_exc:
        admin_dashboard_api._summary_resolve_range(now, 14, date(2026, 2, 1), None)
    assert missing_range_exc.value.status_code == 400

    with pytest.raises(admin_dashboard_api.HTTPException) as reversed_exc:
        admin_dashboard_api._summary_resolve_range(now, 14, date(2026, 2, 5), date(2026, 2, 1))
    assert reversed_exc.value.status_code == 400

    start2, end2, days2 = admin_dashboard_api._summary_resolve_range(
        now,
        99,
        date(2026, 2, 1),
        date(2026, 2, 3),
    )
    assert start2 == datetime(2026, 2, 1, 0, 0, tzinfo=timezone.utc)
    assert end2 == datetime(2026, 2, 4, 0, 0, tzinfo=timezone.utc)
    assert days2 == 3

    assert admin_dashboard_api._summary_delta_pct(10.0, 0.0) is None
    assert admin_dashboard_api._summary_delta_pct(15.0, 10.0) == pytest.approx(50.0)
    assert admin_dashboard_api._summary_rate_pct(5.0, 0.0) is None
    assert admin_dashboard_api._summary_rate_pct(2.0, 8.0) == pytest.approx(25.0)

    anomalies = admin_dashboard_api._summary_anomalies_payload(
        anomaly_inputs={
            "failed_payments": 10,
            "failed_payments_prev": 5,
            "refund_requests": 4,
            "refund_requests_prev": 1,
            "refund_window_orders": 10,
            "refund_window_orders_prev": 10,
            "stockouts": 3,
        },
        thresholds_payload={
            "failed_payments_min_count": 5,
            "failed_payments_min_delta_pct": 110.0,
            "refund_requests_min_count": 2,
            "refund_requests_min_rate_pct": 50.0,
            "stockouts_min_count": 2,
        },
    )
    assert anomalies["failed_payments"]["is_alert"] is False
    assert anomalies["refund_requests"]["is_alert"] is False
    assert anomalies["stockouts"]["is_alert"] is True


def test_admin_dashboard_refund_channel_audit_and_security_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert admin_dashboard_api._normalize_refund_reason_text(" Curier întârziat ") == "curier intarziat"
    assert admin_dashboard_api._refund_reason_category("Curier întârziat") == "delivery_issue"
    assert admin_dashboard_api._refund_reason_category("") == "other"

    reasons = admin_dashboard_api._refund_reasons_payload(
        current_reasons={"damaged": 3, "other": 1},
        previous_reasons={"damaged": 1, "other": 0},
    )
    assert reasons[0]["category"] == "damaged"
    assert reasons[0]["current"] == 3

    order_a = uuid4()
    order_b = uuid4()
    session_payload = {
        "s-1": {"utm_source": "  Instagram ", "utm_medium": "Social", "utm_campaign": "spring"},
        "s-2": None,
    }
    channels, tracked_orders, tracked_sales = admin_dashboard_api._channel_aggregate(
        order_to_session={order_a: "s-1", order_b: "s-2"},
        order_amounts={order_a: 100.0, order_b: 50.0},
        session_payload=session_payload,
    )
    assert tracked_orders == 2
    assert tracked_sales == pytest.approx(150.0)
    assert channels[0]["source"] == "instagram"
    assert admin_dashboard_api._channel_extract(None) == ("direct", None, None)
    assert admin_dashboard_api._channel_normalize_value(None) == ""
    assert admin_dashboard_api._channel_normalize_value("  abc ") == "abc"

    payload = admin_dashboard_api._channel_attribution_response(
        effective_range_days=2,
        start=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end=datetime(2026, 1, 3, tzinfo=timezone.utc),
        total_orders=0,
        total_gross_sales=0.0,
        tracked_orders=0,
        tracked_gross_sales=0.0,
        coverage_pct=None,
        channels=[],
    )
    assert payload["coverage_pct"] is None

    assert admin_dashboard_api._audit_mask_email("a@example.com") == "*@example.com"
    assert admin_dashboard_api._audit_mask_email("alexandria@example.com") == "a********@example.com"
    redacted = admin_dashboard_api._audit_redact_text(
        "mail test@example.com from 127.0.0.1 and 2001:0db8:85a3:0000:0000:8a2e:0370:7334"
    )
    assert "test@example.com" not in redacted
    assert "***.***.***.***" in redacted
    assert "****:****:****:****" in redacted
    assert admin_dashboard_api._audit_csv_cell("=2+2") == "'=2+2"
    assert admin_dashboard_api._audit_csv_cell("line1\nline2") == "line1 line2"

    now = datetime(2026, 2, 10, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(admin_dashboard_api.settings, "audit_retention_days_product", 30)
    monkeypatch.setattr(admin_dashboard_api.settings, "audit_retention_days_content", 0)
    monkeypatch.setattr(admin_dashboard_api.settings, "audit_retention_days_security", 7)
    policies = admin_dashboard_api._audit_retention_policies(now)
    assert policies["product"]["enabled"] is True
    assert policies["content"]["enabled"] is False
    assert policies["security"]["cutoff"] is not None
    assert admin_dashboard_api._iso_to_dt(policies["product"]["cutoff"]) is not None
    assert admin_dashboard_api._iso_to_dt("not-a-date") is None

    user = SimpleNamespace(
        id=uuid4(),
        role=UserRole.customer,
        deleted_at=None,
        locked_until=datetime(2026, 2, 15, 12, 0, 0),
        locked_reason="initial",
        password_reset_required=False,
    )
    current_user = SimpleNamespace(id=uuid4(), role=UserRole.admin)
    assert admin_dashboard_api._require_security_update_target(user, current_user) is user

    with pytest.raises(admin_dashboard_api.HTTPException):
        admin_dashboard_api._require_security_update_target(
            SimpleNamespace(id=uuid4(), role=UserRole.owner, deleted_at=None),
            current_user,
        )
    with pytest.raises(admin_dashboard_api.HTTPException):
        admin_dashboard_api._require_security_update_target(
            SimpleNamespace(id=current_user.id, role=UserRole.customer, deleted_at=None),
            current_user,
        )

    before = admin_dashboard_api._user_security_snapshot(user)
    now_lock = datetime(2026, 2, 10, 12, 0, tzinfo=timezone.utc)
    admin_dashboard_api._apply_user_security_update(
        user,
        {
            "locked_until": datetime(2026, 2, 9, 0, 0, 0),
            "locked_reason": "  should clear ",
            "password_reset_required": True,
        },
        now=now_lock,
    )
    assert user.locked_until is None
    assert user.locked_reason is None
    assert user.password_reset_required is True

    admin_dashboard_api._apply_user_security_update(
        user,
        {
            "locked_until": datetime(2026, 2, 20, 12, 0, 0),
            "locked_reason": "x" * 300,
        },
        now=now_lock,
    )
    assert user.locked_until == datetime(2026, 2, 20, 12, 0, 0, tzinfo=timezone.utc)
    assert user.locked_reason == ("x" * 255)
    assert admin_dashboard_api._as_utc(datetime(2026, 3, 1, 10, 0, 0)).tzinfo == timezone.utc

    after = admin_dashboard_api._user_security_snapshot(user)
    changes = admin_dashboard_api._user_security_changes(before, after)
    assert "locked_until" in changes
    assert "locked_reason" in changes
    assert "password_reset_required" in changes
