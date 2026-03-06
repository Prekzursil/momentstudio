from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.api.v1 import admin_dashboard
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api


async def _yield_once() -> None:
    await asyncio.sleep(0)


def _request(*, headers: dict[str, str] | None = None, client_host: str = "127.0.0.1") -> Request:
    header_map = {k.lower(): v for k, v in (headers or {}).items()}
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in header_map.items()],
        "client": (client_host, 12345),
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


class _AddressRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[object | None, object]] = []

    async def create_address(self, _session: object, user_id: object | None, payload: object) -> object:
        await _yield_once()
        self.calls.append((user_id, payload))
        return SimpleNamespace(id=uuid4(), payload=payload)


class _ScalarQueueSession:
    def __init__(self, values: list[object | None]) -> None:
        self._values = list(values)

    async def execute(self, _statement: object) -> object:
        await _yield_once()
        value = self._values.pop(0) if self._values else None
        return SimpleNamespace(scalar_one_or_none=lambda: value)


class _RefreshRotateSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flush_count = 0
        self.commit_count = 0
        self.refresh_count = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        await _yield_once()
        self.flush_count += 1

    async def commit(self) -> None:
        await _yield_once()
        self.commit_count += 1

    async def refresh(self, _value: object) -> None:
        await _yield_once()
        self.refresh_count += 1


@pytest.mark.anyio
async def test_wave_j_orders_checkout_address_creation_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _AddressRecorder()
    monkeypatch.setattr(orders_api.address_service, "create_address", recorder.create_address)

    user_id = uuid4()
    payload_without_billing = SimpleNamespace(
        save_address=True,
        default_shipping=None,
        default_billing=None,
        line1="Street 1",
        line2=None,
        city="City",
        region="Region",
        postal_code="100000",
        country="RO",
        billing_line1="   ",
        billing_line2=None,
        billing_city=None,
        billing_region=None,
        billing_postal_code=None,
        billing_country=None,
    )

    shipping_addr, billing_addr = await orders_api._create_checkout_addresses(
        object(),
        payload=payload_without_billing,
        current_user=SimpleNamespace(id=user_id),
        phone="+40720000000",
    )
    assert shipping_addr is billing_addr
    assert recorder.calls[0][0] == user_id

    payload_incomplete_billing = SimpleNamespace(
        save_address=False,
        default_shipping=True,
        default_billing=True,
        line1="Street 2",
        line2=None,
        city="City",
        region=None,
        postal_code="200000",
        country="RO",
        billing_line1="Billing street",
        billing_line2=None,
        billing_city=None,
        billing_region=None,
        billing_postal_code="300000",
        billing_country="RO",
    )
    with pytest.raises(HTTPException) as exc_info:
        await orders_api._create_checkout_addresses(
            object(),
            payload=payload_incomplete_billing,
            current_user=SimpleNamespace(id=user_id),
            phone=None,
        )
    assert exc_info.value.status_code == 400

    payload_with_billing = SimpleNamespace(
        save_address=False,
        default_shipping=True,
        default_billing=True,
        line1="Street 3",
        line2=None,
        city="City",
        region=None,
        postal_code="300000",
        country="RO",
        billing_line1="Billing 3",
        billing_line2="Apt 2",
        billing_city="Billing City",
        billing_region="BR",
        billing_postal_code="400000",
        billing_country="RO",
    )
    shipping_addr, billing_addr = await orders_api._create_checkout_addresses(
        object(),
        payload=payload_with_billing,
        current_user=SimpleNamespace(id=user_id),
        phone=None,
    )
    assert shipping_addr is not billing_addr
    assert recorder.calls[-2][0] is None
    assert recorder.calls[-1][0] is None


@pytest.mark.anyio
async def test_wave_j_orders_guest_checkout_and_payment_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = _AddressRecorder()
    monkeypatch.setattr(orders_api.address_service, "create_address", recorder.create_address)

    guest_payload = SimpleNamespace(
        create_account=True,
        save_address=True,
        line1="Guest Street",
        line2=None,
        city="City",
        region=None,
        postal_code="500000",
        country="RO",
        billing_line1=None,
        billing_line2=None,
        billing_city=None,
        billing_region=None,
        billing_postal_code=None,
        billing_country=None,
    )
    shipping_addr, billing_addr = await orders_api._create_guest_checkout_addresses(
        object(),
        payload=guest_payload,
        user_id=uuid4(),
        phone=None,
    )
    assert shipping_addr is billing_addr

    invalid_guest_payload = SimpleNamespace(
        create_account=False,
        save_address=False,
        line1="Guest Street 2",
        line2=None,
        city="City",
        region=None,
        postal_code="510000",
        country="RO",
        billing_line1="Billing Guest",
        billing_line2=None,
        billing_city=None,
        billing_region=None,
        billing_postal_code="520000",
        billing_country="RO",
    )
    with pytest.raises(HTTPException) as exc_info:
        await orders_api._create_guest_checkout_addresses(
            object(),
            payload=invalid_guest_payload,
            user_id=None,
            phone="+40730000000",
        )
    assert exc_info.value.status_code == 400

    cart = SimpleNamespace(id=uuid4(), items=[SimpleNamespace(name="Item")])
    totals = SimpleNamespace(
        total=Decimal("120.50"),
        subtotal=Decimal("100.00"),
        shipping=Decimal("10.00"),
        tax=Decimal("8.00"),
        fee=Decimal("2.50"),
    )

    calculate_calls: list[dict[str, object]] = []

    async def _fake_calculate_totals_async(
        _session: object,
        _cart: object,
        *,
        shipping_method: object,
        promo: object,
        checkout_settings: object,
        country_code: str | None,
    ) -> tuple[object, object]:
        await _yield_once()
        calculate_calls.append(
            {
                "shipping_method": shipping_method,
                "promo": promo,
                "checkout_settings": checkout_settings,
                "country_code": country_code,
            }
        )
        return totals, None

    monkeypatch.setattr(orders_api.cart_service, "calculate_totals_async", _fake_calculate_totals_async)

    discounted = SimpleNamespace(totals=SimpleNamespace(total=Decimal("99.99")), discount_ron=Decimal("20.51"))
    resolved_totals, resolved_discount = await orders_api._resolve_checkout_totals(
        object(),
        cart=cart,
        shipping_method=SimpleNamespace(id="ship-1"),
        promo=SimpleNamespace(code="SAVE"),
        checkout_settings=SimpleNamespace(receipt_share_days=7),
        country_code="RO",
        applied_coupon=SimpleNamespace(id="coupon-1"),
        applied_discount=discounted,
    )
    assert resolved_totals.total == Decimal("99.99")
    assert resolved_discount == Decimal("20.51")

    resolved_totals, resolved_discount = await orders_api._resolve_checkout_totals(
        object(),
        cart=cart,
        shipping_method=SimpleNamespace(id="ship-2"),
        promo=None,
        checkout_settings=SimpleNamespace(receipt_share_days=10),
        country_code="RO",
        applied_coupon=None,
        applied_discount=None,
    )
    assert resolved_totals.total == Decimal("120.50")
    assert resolved_discount is None
    assert len(calculate_calls) == 1

    monkeypatch.setattr(orders_api, "_build_stripe_line_items", lambda _cart, _totals, *, lang=None: [{"sku": "x"}])

    async def _fake_checkout_session(**kwargs: object) -> dict[str, object]:
        await _yield_once()
        return {"session_id": "stripe-session", "checkout_url": "https://checkout.example.test"}

    monkeypatch.setattr(orders_api.payments, "create_checkout_session", _fake_checkout_session)
    stripe_result = await orders_api._initialize_checkout_payment(
        session=object(),
        cart=cart,
        totals=totals,
        discount_val=Decimal("5.00"),
        payment_method="stripe",
        base="https://momentstudio.test",
        lang="ro",
        customer_email="buyer@example.test",
        user_id=uuid4(),
        promo_code="SAVE5",
    )
    assert stripe_result[:3] == ("stripe", "stripe-session", "https://checkout.example.test")

    monkeypatch.setattr(orders_api, "_build_paypal_items", lambda _cart, *, lang=None: [{"name": "item"}])

    async def _fake_paypal_create_order(**kwargs: object) -> tuple[str, str]:
        await _yield_once()
        return "paypal-order", "https://approve.example.test"

    monkeypatch.setattr(orders_api.paypal_service, "create_order", _fake_paypal_create_order)
    paypal_result = await orders_api._initialize_checkout_payment(
        session=object(),
        cart=cart,
        totals=totals,
        discount_val=Decimal("0"),
        payment_method="paypal",
        base="https://momentstudio.test",
        lang="en",
        customer_email="buyer@example.test",
        user_id=uuid4(),
        promo_code=None,
    )
    assert paypal_result[0] == "paypal"
    assert paypal_result[3:] == ("paypal-order", "https://approve.example.test")

    cod_result = await orders_api._initialize_checkout_payment(
        session=object(),
        cart=cart,
        totals=totals,
        discount_val=Decimal("0"),
        payment_method="cod",
        base="https://momentstudio.test",
        lang="en",
        customer_email="buyer@example.test",
        user_id=None,
        promo_code=None,
    )
    assert cod_result == ("cod", None, None, None, None)


@pytest.mark.anyio
async def test_wave_j_orders_netopia_payment_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _RefreshRotateSession()
    order = SimpleNamespace(netopia_ntp_id=None, netopia_payment_url=None)

    async def _fake_start_netopia_payment_for_order(*args: object, **kwargs: object) -> tuple[str, str] | None:
        await _yield_once()
        order_ref = args[0] if args else kwargs.get("order")
        if getattr(order_ref, "skip_netopia", False):
            return None
        return "ntp-id-1", "https://pay.example.test"

    monkeypatch.setattr(orders_api, "_assert_netopia_enabled_and_configured", lambda: None)
    monkeypatch.setattr(orders_api, "_start_netopia_payment_for_order", _fake_start_netopia_payment_for_order)

    result = await orders_api._maybe_start_new_order_netopia_payment(
        session,
        order,
        payment_method="cod",
        base="https://momentstudio.test",
        email="buyer@example.test",
        phone=None,
        lang="en",
        shipping_fallback=None,
        billing_fallback=None,
        commit=True,
    )
    assert result == (None, None)

    order.skip_netopia = True
    result = await orders_api._maybe_start_new_order_netopia_payment(
        session,
        order,
        payment_method="netopia",
        base="https://momentstudio.test",
        email="buyer@example.test",
        phone=None,
        lang="en",
        shipping_fallback=None,
        billing_fallback=None,
        commit=False,
    )
    assert result == (None, None)

    order.skip_netopia = False
    result = await orders_api._maybe_start_new_order_netopia_payment(
        session,
        order,
        payment_method="netopia",
        base="https://momentstudio.test",
        email="buyer@example.test",
        phone="+40740000000",
        lang="ro",
        shipping_fallback=SimpleNamespace(),
        billing_fallback=SimpleNamespace(),
        commit=True,
    )
    assert result == ("ntp-id-1", "https://pay.example.test")
    assert order.netopia_ntp_id == "ntp-id-1"
    assert order.netopia_payment_url == "https://pay.example.test"
    assert session.flush_count == 0
    assert session.commit_count == 1


@pytest.mark.anyio
async def test_wave_j_auth_refresh_session_rotation_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    user_id = uuid4()
    valid_row = SimpleNamespace(user_id=user_id, expires_at=now + timedelta(minutes=10), jti="stored-jti", revoked=False)
    stored, expires_at = await auth_api._load_valid_stored_refresh_session(
        _ScalarQueueSession([valid_row]),
        jti="stored-jti",
        token_user_id=user_id,
        now=now,
    )
    assert stored is valid_row
    assert expires_at >= now

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        await auth_api._load_valid_stored_refresh_session(
            _ScalarQueueSession([None]),
            jti="missing",
            token_user_id=user_id,
            now=now,
        )

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        await auth_api._load_valid_stored_refresh_session(
            _ScalarQueueSession([SimpleNamespace(user_id=uuid4(), expires_at=now + timedelta(minutes=5))]),
            jti="wrong-user",
            token_user_id=user_id,
            now=now,
        )

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        await auth_api._load_valid_stored_refresh_session(
            _ScalarQueueSession([SimpleNamespace(user_id=user_id, expires_at=now - timedelta(seconds=1))]),
            jti="expired",
            token_user_id=user_id,
            now=now,
        )

    class _UserSession:
        def __init__(self, user: object | None) -> None:
            self._user = user

        async def get(self, _model: object, _id: object) -> object | None:
            await _yield_once()
            return self._user

    async def _ensure_active(_session: object, _user: object) -> None:
        await _yield_once()
        return None

    monkeypatch.setattr(auth_api, "_ensure_user_account_active", _ensure_active)

    with pytest.raises(HTTPException, match="User not found"):
        await auth_api._load_refresh_user_for_rotation(_UserSession(None), user_id=user_id, now=now)

    with pytest.raises(HTTPException, match="temporarily locked"):
        await auth_api._load_refresh_user_for_rotation(
            _UserSession(SimpleNamespace(locked_until=now + timedelta(minutes=1), password_reset_required=False)),
            user_id=user_id,
            now=now,
        )

    with pytest.raises(HTTPException, match="Password reset required"):
        await auth_api._load_refresh_user_for_rotation(
            _UserSession(SimpleNamespace(locked_until=None, password_reset_required=True)),
            user_id=user_id,
            now=now,
        )

    loaded_user = await auth_api._load_refresh_user_for_rotation(
        _UserSession(SimpleNamespace(locked_until=None, password_reset_required=False)),
        user_id=user_id,
        now=now,
    )
    assert loaded_user is not None

    replacement = SimpleNamespace(user_id=user_id, revoked=False, expires_at=now + timedelta(minutes=5), jti="replacement")
    loaded = await auth_api._load_valid_replacement_refresh_session(
        _ScalarQueueSession([replacement]),
        replacement_jti="replacement",
        user_id=user_id,
        now=now,
    )
    assert loaded is replacement
    assert await auth_api._load_valid_replacement_refresh_session(
        _ScalarQueueSession([SimpleNamespace(user_id=user_id, revoked=True, expires_at=now + timedelta(minutes=5))]),
        replacement_jti="revoked",
        user_id=user_id,
        now=now,
    ) is None


@pytest.mark.anyio
async def test_wave_j_auth_reused_rotated_token_pair_and_rotate(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    user = SimpleNamespace(id=uuid4())
    stored = SimpleNamespace(user_id=user.id, revoked_reason="rotated", rotated_at=now, replaced_by_jti="replacement-jti")

    async def _load_replacement(
        _session: object,
        *,
        replacement_jti: str,
        user_id: Any,
        now: datetime,
    ) -> object | None:
        await _yield_once()
        if replacement_jti == "replacement-jti":
            return SimpleNamespace(jti="replacement-jti", expires_at=now + timedelta(minutes=20), persistent=False, revoked=False, user_id=user_id)
        return None

    monkeypatch.setattr(auth_api, "_load_valid_replacement_refresh_session", _load_replacement)
    monkeypatch.setattr(auth_api, "_build_refresh_token_pair", lambda **kwargs: SimpleNamespace(**kwargs))
    monkeypatch.setattr(auth_api, "_rotated_replacement_jti_within_grace", lambda _stored, *, now: "replacement-jti")

    pair = await auth_api._reused_rotated_refresh_token_pair(
        object(),
        stored=stored,
        user=user,
        now=now,
        response=Response(),
    )
    assert pair is not None
    assert pair.refresh_jti == "replacement-jti"
    assert pair.persistent is False

    monkeypatch.setattr(auth_api, "_rotated_replacement_jti_within_grace", lambda _stored, *, now: None)
    assert (
        await auth_api._reused_rotated_refresh_token_pair(
            object(),
            stored=stored,
            user=user,
            now=now,
            response=Response(),
        )
        is None
    )

    session = _RefreshRotateSession()
    replacement_session = SimpleNamespace(jti="new-jti", expires_at=now + timedelta(minutes=30))
    cookie_calls: list[tuple[str, bool]] = []

    async def _create_refresh_session(
        _session: object,
        _user_id: object,
        *,
        persistent: bool,
        user_agent: str | None,
        ip_address: str | None,
        country_code: str | None,
    ) -> object:
        await _yield_once()
        assert persistent is True
        assert user_agent == "CLI/2.0"
        assert ip_address == "198.51.100.99"
        assert country_code == "RO"
        return replacement_session

    monkeypatch.setattr(auth_api.auth_service, "create_refresh_session", _create_refresh_session)
    monkeypatch.setattr(auth_api.security, "create_access_token", lambda sub, jti: f"access:{sub}:{jti}")
    monkeypatch.setattr(auth_api.security, "create_refresh_token", lambda sub, jti, _exp: f"refresh:{sub}:{jti}")
    monkeypatch.setattr(auth_api, "set_refresh_cookie", lambda _resp, token, *, persistent: cookie_calls.append((token, persistent)))

    rotating_stored = SimpleNamespace(revoked=False, revoked_reason=None, rotated_at=None, replaced_by_jti=None)
    rotated_pair = await auth_api._rotate_refresh_session(
        session,
        _request(headers={"user-agent": "CLI/2.0", "cf-ipcountry": "RO"}, client_host="198.51.100.99"),
        user=user,
        stored=rotating_stored,
        now=now,
        persistent=True,
        response=Response(),
    )
    assert rotating_stored.revoked is True
    assert rotating_stored.revoked_reason == "rotated"
    assert rotating_stored.replaced_by_jti == "new-jti"
    assert session.flush_count == 1
    assert session.commit_count == 1
    assert rotated_pair.access_token.endswith(":new-jti")
    assert cookie_calls[0][1] is True


def test_wave_j_admin_audit_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert admin_dashboard._audit_mask_email("user@example.test").startswith("u")
    assert admin_dashboard._audit_mask_email("bad-email") == "bad-email"
    redacted = admin_dashboard._audit_redact_text(
        "Contact user@example.test from 198.51.100.1 and 2001:db8::1"
    )
    assert "***.***.***.***" in redacted
    assert "****:****:****:****" in redacted

    assert admin_dashboard._audit_csv_cell("=1+1").startswith("'=")
    assert admin_dashboard._audit_csv_cell("hello\nworld") == "hello world"
    assert admin_dashboard._audit_total_pages(0, 25) == 1
    assert admin_dashboard._audit_total_pages(51, 25) == 3

    created_at = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)
    row = {
        "created_at": created_at,
        "entity": "security",
        "action": "session.revoke",
        "actor_email": "owner@example.test",
        "subject_email": "subject@example.test",
        "ref_key": "user:1",
        "ref_id": "1",
        "actor_user_id": "owner-id",
        "subject_user_id": "subject-id",
        "data": "ip=198.51.100.4 email=subject@example.test",
    }
    csv_row = admin_dashboard._audit_export_csv_row(row, redact=True)
    assert csv_row[0] == created_at.isoformat()
    assert csv_row[3].startswith("o")
    assert "***.***.***.***" in csv_row[9]

    csv_content = admin_dashboard._audit_export_csv_content([row], redact=False)
    assert "created_at,entity,action,actor_email" in csv_content
    assert "owner@example.test" in csv_content

    now = datetime(2026, 3, 3, tzinfo=timezone.utc)
    monkeypatch.setattr(admin_dashboard.settings, "audit_retention_days_product", 30, raising=False)
    monkeypatch.setattr(admin_dashboard.settings, "audit_retention_days_content", 0, raising=False)
    monkeypatch.setattr(admin_dashboard.settings, "audit_retention_days_security", 7, raising=False)
    policies = admin_dashboard._audit_retention_policies(now)
    assert policies["product"]["enabled"] is True
    assert policies["content"]["enabled"] is False
    assert policies["security"]["enabled"] is True
    cutoffs = admin_dashboard._audit_retention_cutoffs(policies)
    assert cutoffs["product"] is not None
    assert cutoffs["content"] is None
    assert admin_dashboard._iso_to_dt("invalid-date") is None
    assert admin_dashboard._audit_retention_deleted_template() == {"product": 0, "content": 0, "security": 0}
    assert admin_dashboard._audit_export_filename("SECURITY").startswith("audit-security-")
