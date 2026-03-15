from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response

from app.api.v1 import admin_dashboard
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api


def test_backend_wave_g_orders_delivery_branch_and_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    real_locker_delivery_payload = orders_api._locker_delivery_payload
    captured: dict[str, object] = {}

    def _fake_locker_delivery_payload(**kwargs: object):
        captured.update(kwargs)
        return ("fan", "locker", "locker-1", "Locker 1", None, 44.1, 26.1)

    monkeypatch.setattr(orders_api, "_locker_delivery_payload", _fake_locker_delivery_payload)

    locker_payload = orders_api._delivery_from_payload(
        courier=" fan ",
        delivery_type=" locker ",
        locker_id=" locker-1 ",
        locker_name=" Locker 1 ",
        locker_address=" ",
        locker_lat=44.1,
        locker_lng=26.1,
    )
    assert locker_payload == ("fan", "locker", "locker-1", "Locker 1", None, 44.1, 26.1)
    assert captured["courier_clean"] == "fan"
    assert captured["delivery_clean"] == "locker"
    assert captured["locker_id"] == " locker-1 "
    assert captured["locker_name"] == " Locker 1 "

    home_payload = orders_api._delivery_from_payload(
        courier=" ",
        delivery_type=" ",
        locker_id="ignored",
        locker_name="ignored",
        locker_address="ignored",
        locker_lat=44.0,
        locker_lng=26.0,
    )
    assert home_payload == ("sameday", "home", None, None, None, None, None)

    with pytest.raises(HTTPException, match="Locker selection is required"):
        real_locker_delivery_payload(
            courier_clean="fan",
            delivery_clean="locker",
            locker_id="locker-1",
            locker_name="",
            locker_address=None,
            locker_lat=44.0,
            locker_lng=26.0,
        )


def test_backend_wave_g_orders_serialization_and_payment_contact_helpers() -> None:
    serialized = orders_api._serialize_netopia_products(
        [
            {
                "name": "Line A",
                "code": "A",
                "category": "Category",
                "price": Decimal("10.25"),
                "vat": Decimal("0.00"),
            }
        ]
    )
    assert serialized == [
        {"name": "Line A", "code": "A", "category": "Category", "price": 10.25, "vat": 0.0}
    ]

    order_with_user = SimpleNamespace(
        user=SimpleNamespace(email="user@example.com", preferred_language="ro"),
        customer_email="fallback@example.com",
    )
    assert orders_api._payment_capture_contact(order_with_user) == ("user@example.com", "ro")

    order_without_user_email = SimpleNamespace(
        user=SimpleNamespace(email="", preferred_language="en"),
        customer_email="fallback@example.com",
    )
    assert orders_api._payment_capture_contact(order_without_user_email) == ("fallback@example.com", "en")

    order_without_any_email = SimpleNamespace(user=None, customer_email=None)
    assert orders_api._payment_capture_contact(order_without_any_email) == (None, None)


def test_backend_wave_g_admin_coupon_owner_transfer_and_date_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert admin_dashboard._normalized_coupon_currency(None) is None
    assert admin_dashboard._normalized_coupon_currency(" ron ") == "RON"
    with pytest.raises(HTTPException, match="Only RON currency is supported"):
        admin_dashboard._normalized_coupon_currency("usd")

    assert admin_dashboard._coupon_should_invalidate_stripe({"expires_at": "2026-03-01"}) is False
    assert admin_dashboard._coupon_should_invalidate_stripe({"active": False}) is True

    normalized_currency_inputs: list[object] = []

    def _fake_normalized_coupon_currency(value: object | None) -> str | None:
        normalized_currency_inputs.append(value)
        return "RON"

    monkeypatch.setattr(admin_dashboard, "_normalized_coupon_currency", _fake_normalized_coupon_currency)
    promo = SimpleNamespace(
        percentage_off=None,
        amount_off=None,
        expires_at=None,
        max_uses=None,
        active=True,
        code="OLD",
        currency=None,
    )
    admin_dashboard._apply_coupon_updates(
        promo,
        {
            "code": "NEW",
            "active": False,
            "currency": " ron ",
        },
    )
    assert promo.code == "NEW"
    assert promo.active is False
    assert promo.currency == "RON"
    assert normalized_currency_inputs == [" ron "]

    assert admin_dashboard._owner_transfer_identifier(SimpleNamespace(identifier=" owner@example.com ")) == "owner@example.com"
    with pytest.raises(HTTPException, match="Identifier is required"):
        admin_dashboard._owner_transfer_identifier(SimpleNamespace(identifier="   "))

    admin_dashboard._validate_stock_adjustments_date_range(from_date=date(2026, 3, 1), to_date=date(2026, 3, 1))
    with pytest.raises(HTTPException, match="Invalid date range"):
        admin_dashboard._validate_stock_adjustments_date_range(from_date=date(2026, 3, 2), to_date=date(2026, 3, 1))

    assert admin_dashboard._iso_to_dt("2026-03-01T00:00:00+00:00") is not None
    assert admin_dashboard._iso_to_dt("not-a-date") is None
    assert admin_dashboard._iso_to_dt(None) is None


def test_backend_wave_g_auth_refresh_identity_internal_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    cleared: list[Response] = []
    monkeypatch.setattr(auth_api, "clear_refresh_cookie", lambda response: cleared.append(response))

    silent_response = auth_api._silent_or_unauthorized_response(
        silent_refresh_probe=True,
        response=Response(),
        detail="ignored",
    )
    assert silent_response.status_code == 204
    assert len(cleared) == 1

    with pytest.raises(HTTPException, match="explicit-detail"):
        auth_api._silent_or_unauthorized_response(
            silent_refresh_probe=False,
            response=None,
            detail="explicit-detail",
        )

    user_id = uuid4()
    token_payloads = {
        "missing": None,
        "wrong-type": {"type": "access", "jti": "jti-1", "sub": str(user_id)},
        "good": {"type": "refresh", "jti": "jti-1", "sub": str(user_id)},
    }
    monkeypatch.setattr(auth_api.security, "decode_token", lambda token: token_payloads.get(token))

    invalid_silent = auth_api._decode_refresh_payload_for_identity(
        "missing",
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(invalid_silent, Response)
    assert invalid_silent.status_code == 204

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        auth_api._decode_refresh_payload_for_identity(
            "wrong-type",
            silent_refresh_probe=False,
            response=None,
        )

    valid_payload = auth_api._decode_refresh_payload_for_identity(
        "good",
        silent_refresh_probe=False,
        response=None,
    )
    assert isinstance(valid_payload, dict)
    assert valid_payload["type"] == "refresh"

    missing_jti = auth_api._refresh_identity_from_payload(
        {"sub": str(user_id)},
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(missing_jti, Response)
    assert missing_jti.status_code == 204

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        auth_api._refresh_identity_from_payload(
            {"jti": "jti-2", "sub": "not-a-uuid"},
            silent_refresh_probe=False,
            response=None,
        )

    assert auth_api._refresh_identity_from_payload(
        {"jti": " jti-3 ", "sub": str(user_id)},
        silent_refresh_probe=False,
        response=None,
    ) == ("jti-3", user_id)
