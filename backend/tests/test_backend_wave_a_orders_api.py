from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException, status

from app.api.v1 import orders as orders_api
from app.schemas.checkout import PayPalCaptureRequest
from app.schemas.order import OrderCreate


class _ScalarResult:
    def __init__(self, *, value: object | None = None, values: list[object] | None = None) -> None:
        self._value = value
        self._values = list(values or [])

    def scalar_one_or_none(self) -> object | None:
        return self._value

    def scalar_one(self) -> object | None:
        return self._value

    def scalars(self) -> SimpleNamespace:
        return SimpleNamespace(unique=lambda: self._values)


class _OrdersSession:
    def __init__(self, *, execute_results: list[_ScalarResult] | None = None, get_map: dict[object, object] | None = None) -> None:
        self.execute_results = list(execute_results or [])
        self.get_map = dict(get_map or {})
        self.added: list[object] = []
        self.commits = 0
        self.refresh_calls: list[object] = []

    async def execute(self, _stmt: object) -> _ScalarResult:
        if not self.execute_results:
            raise AssertionError("Unexpected execute() call")
        return self.execute_results.pop(0)

    async def get(self, _model: object, key: object) -> object | None:
        return self.get_map.get(key)

    async def scalar(self, _stmt: object) -> object | None:
        if not self.execute_results:
            raise AssertionError("Unexpected scalar() call")
        return self.execute_results.pop(0).scalar_one_or_none()

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, value: object) -> None:
        self.refresh_calls.append(value)


def _request(headers: dict[str, str] | None = None, client_host: str | None = "127.0.0.1"):
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
        "scheme": "http",
    }
    from starlette.requests import Request

    return Request(scope)


def test_orders_batch_and_receipt_access_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException, match="No orders selected"):
        orders_api._normalize_batch_order_ids([], max_selected=3)
    with pytest.raises(HTTPException, match="Too many orders selected"):
        orders_api._normalize_batch_order_ids([uuid4(), uuid4(), uuid4()], max_selected=2)

    deduped = orders_api._normalize_batch_order_ids([UUID(int=1), UUID(int=1), UUID(int=2)], max_selected=5)
    assert deduped == [UUID(int=1), UUID(int=2)]

    order_id = uuid4()
    admin_user = SimpleNamespace(id=uuid4(), role=SimpleNamespace(value="admin"))
    owner_user = SimpleNamespace(id=order_id, role=SimpleNamespace(value="customer"))
    stranger = SimpleNamespace(id=uuid4(), role=SimpleNamespace(value="customer"))
    order = SimpleNamespace(user_id=order_id)

    assert orders_api._can_manage_receipt_share(order, admin_user) is True
    assert orders_api._can_manage_receipt_share(order, owner_user) is True
    assert orders_api._can_manage_receipt_share(order, stranger) is False

    with pytest.raises(HTTPException, match="Not allowed"):
        orders_api._require_receipt_share_access(order, stranger)

    monkeypatch.setattr(orders_api, "decode_receipt_token", lambda _token: None)
    with pytest.raises(HTTPException, match="Invalid receipt token"):
        orders_api._decode_receipt_token_order("bad")

    monkeypatch.setattr(orders_api, "decode_receipt_token", lambda _token: ("not-a-uuid", "x"))
    with pytest.raises(HTTPException, match="Invalid receipt token"):
        orders_api._decode_receipt_token_order("bad")


@pytest.mark.anyio
async def test_orders_receipt_loading_and_token_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    order_id = uuid4()
    base_order = SimpleNamespace(id=order_id, receipt_token_version=2)

    monkeypatch.setattr(orders_api, "decode_receipt_token", lambda _token: (str(order_id), "2"))

    async def _get_order(_session: object, _order_id: UUID):
        return base_order

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _get_order)
    loaded = await orders_api._load_receipt_order_from_token(object(), "token")
    assert loaded is base_order

    async def _get_order_missing(_session: object, _order_id: UUID):
        return None

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _get_order_missing)
    with pytest.raises(HTTPException, match="Receipt not found"):
        await orders_api._load_receipt_order_from_token(object(), "token")

    mismatch_order = SimpleNamespace(id=order_id, receipt_token_version=7)

    async def _get_order_mismatch(_session: object, _order_id: UUID):
        return mismatch_order

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _get_order_mismatch)
    with pytest.raises(HTTPException, match="Invalid receipt token"):
        await orders_api._load_receipt_order_from_token(object(), "token")

    async def _checkout_settings(_session: object):
        return SimpleNamespace(receipt_share_days=5)

    monkeypatch.setattr(orders_api.checkout_settings_service, "get_checkout_settings", _checkout_settings)
    monkeypatch.setattr(orders_api, "create_receipt_token", lambda **_kwargs: "share-token")
    monkeypatch.setattr(orders_api.settings, "frontend_origin", "https://frontend.example/", raising=False)

    token_read = await orders_api._build_receipt_share_token_read(object(), base_order)
    assert token_read.token == "share-token"
    assert token_read.receipt_url == "https://frontend.example/receipt/share-token"
    assert token_read.receipt_pdf_url == "https://frontend.example/api/v1/orders/receipt/share-token/pdf"


@pytest.mark.anyio
async def test_orders_checkout_resolution_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    cart = SimpleNamespace(last_order_id=None)
    session = _OrdersSession()
    assert await orders_api._resolve_existing_cart_order(session, cart) is None

    missing_id = uuid4()
    cart_missing = SimpleNamespace(last_order_id=missing_id)

    async def _missing_order(_session: object, _order_id: UUID):
        return None

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _missing_order)
    assert await orders_api._resolve_existing_cart_order(session, cart_missing) is None
    assert cart_missing.last_order_id is None
    assert session.added[-1] is cart_missing

    existing_order = SimpleNamespace(id=uuid4())

    async def _existing_order(_session: object, _order_id: UUID):
        return existing_order

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _existing_order)
    cart_existing = SimpleNamespace(last_order_id=uuid4())
    assert await orders_api._resolve_existing_cart_order(session, cart_existing) is existing_order

    shipping_id = uuid4()
    billing_id = uuid4()
    user_id = uuid4()
    payload = OrderCreate(shipping_address_id=shipping_id, billing_address_id=billing_id, shipping_method_id=None)
    good_shipping = SimpleNamespace(id=shipping_id, user_id=user_id, country="RO")
    good_billing = SimpleNamespace(id=billing_id, user_id=user_id, country="US")
    bad_shipping = SimpleNamespace(id=shipping_id, user_id=uuid4(), country="RO")

    invalid_session = _OrdersSession(get_map={shipping_id: bad_shipping, billing_id: good_billing})
    with pytest.raises(HTTPException, match="Invalid address"):
        await orders_api._resolve_shipping_country_for_create_order(invalid_session, payload, user_id)

    valid_session = _OrdersSession(get_map={shipping_id: good_shipping, billing_id: good_billing})
    shipping_country = await orders_api._resolve_shipping_country_for_create_order(valid_session, payload, user_id)
    assert shipping_country == "RO"

    assert await orders_api._resolve_shipping_method_for_create_order(valid_session, None) is None

    async def _missing_method(_session: object, _method_id: UUID):
        return None

    monkeypatch.setattr(orders_api.order_service, "get_shipping_method", _missing_method)
    with pytest.raises(HTTPException, match="Shipping method not found"):
        await orders_api._resolve_shipping_method_for_create_order(valid_session, uuid4())

    shipping_method = SimpleNamespace(id=uuid4())

    async def _existing_method(_session: object, _method_id: UUID):
        return shipping_method

    monkeypatch.setattr(orders_api.order_service, "get_shipping_method", _existing_method)
    resolved = await orders_api._resolve_shipping_method_for_create_order(valid_session, uuid4())
    assert resolved is shipping_method


@pytest.mark.anyio
async def test_orders_notification_and_netopia_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    background = BackgroundTasks()
    session = _OrdersSession()

    owner = SimpleNamespace(email="owner@example.com", preferred_language="ro")

    async def _get_owner(_session: object):
        return owner

    monkeypatch.setattr(orders_api.auth_service, "get_owner_user", _get_owner)
    monkeypatch.setattr(orders_api.settings, "admin_alert_email", None, raising=False)

    order = SimpleNamespace(id=uuid4())
    await orders_api._queue_create_order_admin_notification(
        session,
        background,
        order=order,
        customer_email="buyer@example.com",
    )
    assert len(background.tasks) == 1

    background_no_target = BackgroundTasks()

    async def _no_owner(_session: object):
        return SimpleNamespace(email=None, preferred_language=None)

    monkeypatch.setattr(orders_api.auth_service, "get_owner_user", _no_owner)
    await orders_api._queue_create_order_admin_notification(
        session,
        background_no_target,
        order=order,
        customer_email="buyer@example.com",
    )
    assert len(background_no_target.tasks) == 0

    monkeypatch.setattr(orders_api.settings, "netopia_enabled", False, raising=False)
    with pytest.raises(HTTPException) as disabled_exc:
        orders_api._assert_netopia_enabled_and_configured()
    assert disabled_exc.value.status_code == status.HTTP_400_BAD_REQUEST

    monkeypatch.setattr(orders_api.settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(orders_api.netopia_service, "netopia_configuration_status", lambda: (False, "missing cert"))
    with pytest.raises(HTTPException) as missing_exc:
        orders_api._assert_netopia_enabled_and_configured()
    assert missing_exc.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    monkeypatch.setattr(orders_api.netopia_service, "netopia_configuration_status", lambda: (True, None))
    orders_api._assert_netopia_enabled_and_configured()

    order_no_addr = SimpleNamespace(
        id=uuid4(),
        customer_name="Buyer",
        customer_email="buyer@example.com",
        total_amount=Decimal("10.00"),
        reference_code="R-1",
        items=[],
        shipping_amount=Decimal("0.00"),
        fee_amount=Decimal("0.00"),
        tax_amount=Decimal("0.00"),
        shipping_address=None,
        billing_address=None,
    )
    started_none = await orders_api._start_netopia_payment_for_order(
        order_no_addr,
        email="buyer@example.com",
        phone=None,
        lang="en",
        base="https://frontend.example",
    )
    assert started_none is None

    shipping_addr = SimpleNamespace(
        line1="Line 1",
        line2="",
        city="Bucharest",
        country="RO",
        region="",
        postal_code="010101",
        phone="+40123456789",
    )
    order_with_addr = SimpleNamespace(
        id=uuid4(),
        customer_name="Buyer Name",
        customer_email="buyer@example.com",
        total_amount=Decimal("11.00"),
        reference_code="R-2",
        items=[],
        shipping_amount=Decimal("0.00"),
        fee_amount=Decimal("0.00"),
        tax_amount=Decimal("0.00"),
        shipping_address=shipping_addr,
        billing_address=shipping_addr,
    )

    async def _start_payment(**_kwargs):
        return ("ntp-1", "https://pay.example")

    monkeypatch.setattr(orders_api.netopia_service, "start_payment", _start_payment)
    started = await orders_api._start_netopia_payment_for_order(
        order_with_addr,
        email="buyer@example.com",
        phone="+40123456789",
        lang="ro",
        base="https://frontend.example",
    )
    assert started == ("ntp-1", "https://pay.example")


@pytest.mark.anyio
async def test_orders_checkout_response_and_capture_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    scalar_session = _OrdersSession(execute_results=[_ScalarResult(value=None)])
    assert (
        await orders_api._resolve_existing_checkout_response(
            scalar_session,
            cart_id=uuid4(),
            base="https://frontend.example",
            email="buyer@example.com",
            phone=None,
            lang="en",
        )
        is None
    )

    last_order_id = uuid4()
    missing_order_session = _OrdersSession(execute_results=[_ScalarResult(value=last_order_id)])
    cleared: list[tuple[UUID, object | None]] = []

    async def _clear_cart(_session: object, *, cart_id: UUID, cart_row: object | None = None) -> None:
        cleared.append((cart_id, cart_row))

    async def _missing_order(_session: object, _order_id: UUID):
        return None

    monkeypatch.setattr(orders_api, "_clear_cart_last_order_pointer", _clear_cart)
    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _missing_order)

    assert (
        await orders_api._resolve_existing_checkout_response(
            missing_order_session,
            cart_id=uuid4(),
            base="https://frontend.example",
            email="buyer@example.com",
            phone=None,
            lang="en",
            cart_row=SimpleNamespace(id=uuid4()),
        )
        is None
    )
    assert len(cleared) == 1

    existing = SimpleNamespace(id=uuid4())
    existing_session = _OrdersSession(execute_results=[_ScalarResult(value=existing.id)])
    refreshed: list[object] = []

    async def _existing_order(_session: object, _order_id: UUID):
        return existing

    async def _refresh_order(*_args, **_kwargs):
        refreshed.append(True)

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _existing_order)
    monkeypatch.setattr(orders_api, "_refresh_existing_order_netopia_payment", _refresh_order)
    monkeypatch.setattr(orders_api, "_guest_checkout_response_from_order", lambda _order: "checkout-response")

    checkout_response = await orders_api._resolve_existing_checkout_response(
        existing_session,
        cart_id=uuid4(),
        base="https://frontend.example",
        email="buyer@example.com",
        phone=None,
        lang="en",
    )
    assert checkout_response == "checkout-response"
    assert refreshed == [True]

    with pytest.raises(HTTPException, match="Phone is required"):
        orders_api._resolve_checkout_phone(payload_phone=None, fallback_phone=None, phone_required=True)
    assert orders_api._resolve_checkout_phone(payload_phone="  ", fallback_phone="+40123", phone_required=True) == "+40123"

    user = SimpleNamespace(id=uuid4())
    cart = SimpleNamespace(id=uuid4())
    checkout_settings = SimpleNamespace()
    payload_no_promo = SimpleNamespace(promo_code=None, country="RO")

    promo, applied_discount, applied_coupon, shipping_discount = await orders_api._resolve_logged_checkout_discount(
        object(),
        payload=payload_no_promo,
        current_user=user,
        cart=cart,
        checkout_settings=checkout_settings,
        shipping_method=None,
    )
    assert promo is None and applied_discount is None and applied_coupon is None
    assert shipping_discount == Decimal("0.00")

    async def _raise_404(*_args, **_kwargs):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")

    async def _validate_promo(_session: object, code: str, currency: object):
        assert code == "SAVE10"
        return "promo-model"

    monkeypatch.setattr(orders_api.coupons_service, "apply_discount_code_to_cart", _raise_404)
    monkeypatch.setattr(orders_api.cart_service, "validate_promo", _validate_promo)

    payload_with_promo = SimpleNamespace(promo_code="SAVE10", country="RO")
    promo, applied_discount, applied_coupon, shipping_discount = await orders_api._resolve_logged_checkout_discount(
        object(),
        payload=payload_with_promo,
        current_user=user,
        cart=cart,
        checkout_settings=checkout_settings,
        shipping_method=SimpleNamespace(rate_flat=Decimal("7.00"), rate_per_kg=Decimal("1.00")),
    )
    assert promo == "promo-model"
    assert applied_discount is None
    assert applied_coupon is None
    assert shipping_discount == Decimal("0.00")

    payload_decline = PayPalCaptureRequest(paypal_order_id="pp-1", mock="decline")
    with pytest.raises(HTTPException) as decline_exc:
        await orders_api._resolve_paypal_capture_id(payload_decline, paypal_order_id="pp-1", mock_mode=True)
    assert decline_exc.value.status_code == status.HTTP_402_PAYMENT_REQUIRED

    monkeypatch.setattr(orders_api.secrets, "token_hex", lambda _n: "abc123")
    payload_success = PayPalCaptureRequest(paypal_order_id="pp-2", mock="success")
    capture_id = await orders_api._resolve_paypal_capture_id(payload_success, paypal_order_id="pp-2", mock_mode=True)
    assert capture_id == "paypal_mock_capture_abc123"

    with pytest.raises(HTTPException, match="Order cannot be captured"):
        orders_api._assert_paypal_capture_status(SimpleNamespace(status="cancelled"))

    protected_order = SimpleNamespace(id=uuid4(), user_id=uuid4())
    with pytest.raises(HTTPException, match="Not allowed"):
        orders_api._assert_confirmation_access(protected_order, current_user=None, payload_order_id=None)

    orders_api._assert_confirmation_access(
        protected_order,
        current_user=None,
        payload_order_id=protected_order.id,
    )

    background = BackgroundTasks()
    order_for_email = SimpleNamespace(items=[SimpleNamespace()])
    orders_api._queue_payment_capture_customer_email(
        background,
        order_for_email,
        customer_to=None,
        customer_lang="en",
        receipt_share_days=None,
    )
    assert len(background.tasks) == 0

    orders_api._queue_payment_capture_customer_email(
        background,
        order_for_email,
        customer_to="buyer@example.com",
        customer_lang="en",
        receipt_share_days=None,
    )
    assert len(background.tasks) == 1

    orders_api._queue_payment_capture_customer_email(
        background,
        order_for_email,
        customer_to="buyer@example.com",
        customer_lang="en",
        receipt_share_days=3,
    )
    assert len(background.tasks) == 2
