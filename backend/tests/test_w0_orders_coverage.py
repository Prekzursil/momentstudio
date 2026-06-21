"""Worker-0 coverage closure for ``app.api.v1.orders``.

Targets the uncovered branches of the orders API: pure pricing/address/delivery
helpers, the payment-confirm flows (Stripe / PayPal / Netopia) driven through
the module's built-in mock-payment mode, the guest-checkout surface, and the
scattered error branches (404 / 403 / 400 / validation) across the admin
endpoints.

Payment gateways, e-mail, and external services are mocked exactly as the rest
of the suite does it: in-memory SQLite via ``get_session`` override, mock-payment
mode via ``settings.payments_provider``, and ``monkeypatch`` on the relevant
service entry points. No real network / DB / gateway calls are made.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any, Dict

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import orders as orders_api
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductStatus
from app.models.order import Order, OrderEvent, OrderItem, OrderStatus
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services import netopia as netopia_service
from app.services.auth import create_user, issue_tokens_for_user


# --------------------------------------------------------------------------- #
# Fixtures / helpers (mirror test_orders_api.py)                              #
# --------------------------------------------------------------------------- #
@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def create_user_token(session_factory, email="buyer0@example.com", admin: bool = False):
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(
                session, UserCreate(email=email, password="orderpass", name="Buyer")
            )
            user.email_verified = True
            if admin:
                user.role = UserRole.admin
                session.add(
                    UserPasskey(
                        user_id=user.id,
                        name="Test Passkey",
                        credential_id=f"cred-{user.id}",
                        public_key=b"test",
                        sign_count=0,
                        backed_up=False,
                    )
                )
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(create_and_token())


class _Obj:
    """Lightweight attribute bag used for pure-helper inputs."""

    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


def _mock_payments(monkeypatch) -> None:
    monkeypatch.setattr(settings, "payments_provider", "mock", raising=False)
    monkeypatch.setattr(settings, "environment", "test", raising=False)


def _seed_order(
    session_factory,
    *,
    user_id=None,
    payment_method="paypal",
    status=OrderStatus.pending_payment,
    paypal_order_id=None,
    paypal_capture_id=None,
    stripe_session_id=None,
    netopia_ntp_id=None,
    customer_email="buyer0@example.com",
    events=None,
    with_product=False,
):
    async def _seed():
        async with session_factory() as session:
            order = Order(
                user_id=user_id,
                status=status,
                reference_code="REF-W0",
                customer_email=customer_email,
                customer_name="Buyer Zero",
                total_amount=Decimal("25.00"),
                payment_method=payment_method,
                currency="RON",
                paypal_order_id=paypal_order_id,
                paypal_capture_id=paypal_capture_id,
                stripe_checkout_session_id=stripe_session_id,
                netopia_ntp_id=netopia_ntp_id,
            )
            session.add(order)
            await session.flush()
            if with_product:
                category = Category(slug="w0", name="W0")
                product = Product(
                    category=category,
                    slug="w0-prod",
                    sku="W0-PROD",
                    name="W0 Product",
                    base_price=Decimal("25.00"),
                    currency="RON",
                    stock_quantity=5,
                    status=ProductStatus.published,
                )
                session.add(
                    OrderItem(
                        order_id=order.id,
                        product=product,
                        quantity=1,
                        unit_price=Decimal("25.00"),
                        subtotal=Decimal("25.00"),
                    )
                )
            for evt in events or []:
                session.add(OrderEvent(order_id=order.id, event=evt, note=evt))
            await session.commit()
            await session.refresh(order)
            return order.id

    return asyncio.run(_seed())


def _silence_email(monkeypatch) -> None:
    from app.services import email as email_service

    async def _ok(*_a, **_k):
        return True

    monkeypatch.setattr(email_service, "send_order_confirmation", _ok)
    monkeypatch.setattr(email_service, "send_new_order_notification", _ok)


# --------------------------------------------------------------------------- #
# Pure helpers (no HTTP)                                                       #
# --------------------------------------------------------------------------- #
def test_user_or_session_or_ip_identifier_variants() -> None:
    def _req(headers: dict[str, str], client_host: str | None = "1.2.3.4") -> Request:
        scope: dict[str, Any] = {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        }
        scope["client"] = (client_host, 5000) if client_host else None
        return Request(scope)

    # Valid bearer token -> user identifier.
    real_token = security.create_access_token("user-123")
    assert orders_api._user_or_session_or_ip_identifier(
        _req({"authorization": f"Bearer {real_token}"})
    ).startswith("user:")

    # Bearer present but undecodable -> falls through to session id.
    assert (
        orders_api._user_or_session_or_ip_identifier(
            _req({"authorization": "Bearer garbage", "X-Session-Id": "sess-9"})
        )
        == "sid:sess-9"
    )

    # No auth, no session -> ip identifier.
    assert orders_api._user_or_session_or_ip_identifier(_req({})) == "ip:1.2.3.4"

    # No client at all -> anon.
    assert (
        orders_api._user_or_session_or_ip_identifier(_req({}, client_host=None))
        == "ip:anon"
    )


def test_normalize_email_and_account_url_and_token() -> None:
    assert orders_api._normalize_email("  Foo@Bar.COM ") == "foo@bar.com"
    assert orders_api._normalize_email(None) == ""  # type: ignore[arg-type]

    order = _Obj(reference_code="REF-1", id="oid")
    assert "REF-1" in orders_api._account_orders_url(order)
    order2 = _Obj(reference_code=None, id="oid-2")
    assert "oid-2" in orders_api._account_orders_url(order2)

    tok = orders_api._generate_guest_email_token()
    assert len(tok) == 6 and tok.isdigit()


def test_as_decimal_and_money_to_cents() -> None:
    assert orders_api._as_decimal(Decimal("1.5")) == Decimal("1.5")
    assert orders_api._as_decimal("2.25") == Decimal("2.25")
    assert orders_api._as_decimal(3) == Decimal("3")
    assert orders_api._money_to_cents(Decimal("12.34")) == 1234


def test_charge_label_all_kinds() -> None:
    assert orders_api._charge_label("shipping", "ro") == "Livrare"
    assert orders_api._charge_label("shipping", "en") == "Shipping"
    assert orders_api._charge_label("fee", "ro") == "Taxă"
    assert orders_api._charge_label("fee", None) == "Fee"
    assert orders_api._charge_label("vat", "ro") == "TVA"
    assert orders_api._charge_label("vat", "en") == "VAT"
    assert orders_api._charge_label("discount", "ro") == "Reducere"
    assert orders_api._charge_label("discount", "en") == "Discount"
    assert orders_api._charge_label("other", "en") == "other"


def test_cart_item_name_with_and_without_variant() -> None:
    item = _Obj(product=_Obj(name="Mug"), variant=_Obj(name="Blue"))
    assert orders_api._cart_item_name(item, "en") == "Mug (Blue)"
    plain = _Obj(product=_Obj(name="Mug"), variant=None)
    assert orders_api._cart_item_name(plain, "en") == "Mug"
    empty = _Obj(product=None, variant=None)
    assert orders_api._cart_item_name(empty, "en") == "Item"


def test_build_stripe_line_items_includes_charges() -> None:
    cart = _Obj(
        items=[
            _Obj(
                unit_price_at_add=Decimal("10.00"),
                quantity=2,
                product=_Obj(name="A"),
                variant=None,
            ),
            _Obj(
                unit_price_at_add=Decimal("5.00"),
                quantity=0,
                product=_Obj(name="Z"),
                variant=None,
            ),  # skipped (qty 0)
        ]
    )
    totals = _Obj(shipping=Decimal("7.50"), fee=Decimal("1.00"), tax=Decimal("3.00"))
    items = orders_api._build_stripe_line_items(cart, totals, lang="en")
    names = [it["price_data"]["product_data"]["name"] for it in items]
    assert "A" in names and "Shipping" in names and "Fee" in names and "VAT" in names
    # Zero-quantity item excluded.
    assert "Z" not in names


def test_build_stripe_line_items_no_charges() -> None:
    cart = _Obj(
        items=[
            _Obj(
                unit_price_at_add=Decimal("9.00"),
                quantity=1,
                product=_Obj(name="Solo"),
                variant=None,
            )
        ]
    )
    totals = _Obj(shipping=Decimal("0.00"), fee=Decimal("0.00"), tax=Decimal("0.00"))
    items = orders_api._build_stripe_line_items(cart, totals, lang="en")
    assert len(items) == 1


def test_build_paypal_items_with_and_without_sku() -> None:
    cart = _Obj(
        items=[
            _Obj(
                quantity=2,
                unit_price_at_add=Decimal("4.00"),
                product=_Obj(name="P", sku="SKU1"),
                variant=None,
            ),
            _Obj(
                quantity=1,
                unit_price_at_add=Decimal("2.00"),
                product=_Obj(name="Q", sku=""),
                variant=None,
            ),
            _Obj(
                quantity=0,
                unit_price_at_add=Decimal("1.00"),
                product=_Obj(name="Skip", sku="X"),
                variant=None,
            ),  # skipped
        ]
    )
    items = orders_api._build_paypal_items(cart, lang="en")
    assert len(items) == 2
    assert items[0].get("sku") == "SKU1"
    assert "sku" not in items[1]


def test_split_customer_name_variants() -> None:
    assert orders_api._split_customer_name("") == ("Customer", "Customer")
    assert orders_api._split_customer_name("Madonna") == ("Madonna", "Madonna")
    assert orders_api._split_customer_name("John Q Public") == ("John", "Q Public")


def test_netopia_address_payload_ro_and_foreign() -> None:
    addr_ro = _Obj(
        country="ro",
        line1="Str 1",
        line2="Apt 2",
        city="Buc",
        region="B",
        postal_code="010101",
    )
    payload = orders_api._netopia_address_payload(
        email=" a@b.com ",
        phone=" 0712 ",
        first_name="",
        last_name="",
        addr=addr_ro,
    )
    assert payload["country"] == 642 and payload["countryName"] == "Romania"
    assert payload["details"] == "Str 1, Apt 2"
    assert payload["firstName"] == "Customer" and payload["lastName"] == "Customer"

    addr_fr = _Obj(
        country="FR",
        line1="",
        line2="Only2",
        city="Paris",
        region="",
        postal_code="75000",
    )
    payload2 = orders_api._netopia_address_payload(
        email="x@y.com",
        phone=None,
        first_name="A",
        last_name="B",
        addr=addr_fr,
    )
    assert payload2["country"] == 0 and payload2["countryName"] == "FR"
    assert payload2["details"] == "Only2"

    # No line2 -> details is just line1 (line 329 False branch).
    addr_no2 = _Obj(
        country="RO", line1="Main St", line2="", city="C", region="R", postal_code="111"
    )
    payload3 = orders_api._netopia_address_payload(
        email="z@z.com",
        phone="0700",
        first_name="A",
        last_name="B",
        addr=addr_no2,
    )
    assert payload3["details"] == "Main St"


def test_build_netopia_products_with_rounding_adjustment() -> None:
    cat = _Obj(name="Cat")
    order = _Obj(
        items=[
            _Obj(
                product=_Obj(name="Big", sku="S1", id=1, category=cat),
                subtotal=Decimal("100.00"),
            ),
            _Obj(
                product=_Obj(name="Small", sku="", id=2, category=None),
                subtotal=Decimal("0.00"),
            ),  # skipped (<= 0)
        ],
        shipping_amount=Decimal("10.00"),
        fee_amount=Decimal("5.00"),
        tax_amount=Decimal("2.00"),
        total_amount=Decimal("100.00"),  # < sum -> triggers diff reduction
    )
    rows = orders_api._build_netopia_products(order, lang="en")
    names = [r["name"] for r in rows]
    assert "Big" in names and "Shipping" in names and "Fee" in names and "VAT" in names
    assert all(isinstance(r["price"], float) for r in rows)


def test_build_netopia_products_empty_items() -> None:
    order = _Obj(
        items=None,
        shipping_amount=Decimal("0.00"),
        fee_amount=Decimal("0.00"),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal("0.00"),
    )
    assert orders_api._build_netopia_products(order, lang="ro") == []


def test_delivery_from_payload_home_and_locker() -> None:
    # Home delivery returns no locker fields.
    out = orders_api._delivery_from_payload(
        courier="sameday",
        delivery_type="home",
        locker_id=None,
        locker_name=None,
        locker_address=None,
        locker_lat=None,
        locker_lng=None,
    )
    assert out == ("sameday", "home", None, None, None, None, None)

    # Valid locker.
    out2 = orders_api._delivery_from_payload(
        courier="",
        delivery_type="locker",
        locker_id="L1",
        locker_name="Locker 1",
        locker_address="Addr",
        locker_lat=1.0,
        locker_lng=2.0,
    )
    assert out2[1] == "locker" and out2[2] == "L1" and out2[5] == 1.0

    # Missing locker selection raises 400.
    with pytest.raises(Exception):
        orders_api._delivery_from_payload(
            courier="sameday",
            delivery_type="locker",
            locker_id=None,
            locker_name=None,
            locker_address=None,
            locker_lat=None,
            locker_lng=None,
        )


def test_sanitize_filename_variants() -> None:
    assert orders_api._sanitize_filename(None) == "shipping-label"
    assert orders_api._sanitize_filename("   ") == "shipping-label"
    assert orders_api._sanitize_filename("/a/b/label.pdf") == "label.pdf"
    long = "x" * 300
    assert len(orders_api._sanitize_filename(long)) == 255


def test_frontend_base_from_request(monkeypatch) -> None:
    monkeypatch.setattr(
        settings, "cors_origins", ["https://shop.example"], raising=False
    )
    monkeypatch.setattr(
        settings, "frontend_origin", "https://fallback.example/", raising=False
    )

    def _req(origin: str | None) -> Request:
        headers = [(b"origin", origin.encode())] if origin else []
        return Request({"type": "http", "headers": headers})

    # Allowed origin echoed back.
    assert (
        orders_api._frontend_base_from_request(_req("https://shop.example/"))
        == "https://shop.example"
    )
    # Disallowed origin -> fallback.
    assert (
        orders_api._frontend_base_from_request(_req("https://evil.example"))
        == "https://fallback.example"
    )
    # No request -> fallback.
    assert orders_api._frontend_base_from_request(None) == "https://fallback.example"


# --------------------------------------------------------------------------- #
# PayPal capture endpoint                                                      #
# --------------------------------------------------------------------------- #
def test_paypal_capture_missing_id(test_app) -> None:
    client = test_app["client"]
    # Whitespace passes schema min_length=1 but strips to empty in the handler.
    res = client.post("/api/v1/orders/paypal/capture", json={"paypal_order_id": "   "})
    assert res.status_code == 400
    assert res.json()["detail"] == "PayPal order id is required"


def test_paypal_capture_order_not_found(test_app) -> None:
    client = test_app["client"]
    res = client.post(
        "/api/v1/orders/paypal/capture", json={"paypal_order_id": "PP-NONE"}
    )
    assert res.status_code == 404


def test_paypal_capture_order_mismatch(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="paypal", paypal_order_id="PP-1")
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={
            "paypal_order_id": "PP-1",
            "order_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Order mismatch"


def test_paypal_capture_not_paypal_order(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", paypal_order_id="PP-2")
    res = client.post("/api/v1/orders/paypal/capture", json={"paypal_order_id": "PP-2"})
    assert res.status_code == 400
    assert res.json()["detail"] == "Order is not a PayPal order"


def test_paypal_capture_forbidden_other_user(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, owner_id = create_user_token(sf, email="owner@example.com")
    other_token, _ = create_user_token(sf, email="intruder@example.com")
    _seed_order(sf, user_id=owner_id, payment_method="paypal", paypal_order_id="PP-3")
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={"paypal_order_id": "PP-3"},
        headers=auth_headers(other_token),
    )
    assert res.status_code == 403


def test_paypal_capture_already_captured(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(
        sf, payment_method="paypal", paypal_order_id="PP-4", paypal_capture_id="CAP-1"
    )
    res = client.post("/api/v1/orders/paypal/capture", json={"paypal_order_id": "PP-4"})
    assert res.status_code == 200
    assert res.json()["paypal_capture_id"] == "CAP-1"


def test_paypal_capture_wrong_status(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(
        sf,
        payment_method="paypal",
        paypal_order_id="PP-5",
        status=OrderStatus.cancelled,
    )
    res = client.post("/api/v1/orders/paypal/capture", json={"paypal_order_id": "PP-5"})
    assert res.status_code == 400
    assert res.json()["detail"] == "Order cannot be captured"


def test_paypal_capture_mock_decline(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _seed_order(sf, payment_method="paypal", paypal_order_id="PP-6")
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={"paypal_order_id": "PP-6", "mock": "decline"},
    )
    assert res.status_code == 402


def test_paypal_capture_mock_success(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="ppbuyer@example.com")
    _seed_order(
        sf,
        user_id=uid,
        payment_method="paypal",
        paypal_order_id="PP-7",
        customer_email="ppbuyer@example.com",
        with_product=True,
    )
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={"paypal_order_id": "PP-7", "mock": "success"},
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["paypal_capture_id"].startswith("paypal_mock_capture_")


# --------------------------------------------------------------------------- #
# Stripe confirm endpoint                                                      #
# --------------------------------------------------------------------------- #
def test_stripe_confirm_missing_session(test_app) -> None:
    client = test_app["client"]
    # Whitespace passes schema min_length=1 but strips to empty in the handler.
    res = client.post("/api/v1/orders/stripe/confirm", json={"session_id": "   "})
    assert res.status_code == 400


def test_stripe_confirm_not_found(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _mock_payments(monkeypatch)
    res = client.post("/api/v1/orders/stripe/confirm", json={"session_id": "cs_none"})
    assert res.status_code == 404


def test_stripe_confirm_mismatch(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _seed_order(sf, payment_method="stripe", stripe_session_id="cs_1")
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={
            "session_id": "cs_1",
            "order_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert res.status_code == 400


def test_stripe_confirm_forbidden(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    token, owner_id = create_user_token(sf, email="sowner@example.com")
    other, _ = create_user_token(sf, email="sother@example.com")
    _seed_order(sf, user_id=owner_id, payment_method="stripe", stripe_session_id="cs_2")
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={"session_id": "cs_2"},
        headers=auth_headers(other),
    )
    assert res.status_code == 403


def test_stripe_confirm_mock_decline(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _seed_order(sf, payment_method="stripe", stripe_session_id="cs_3")
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={"session_id": "cs_3", "mock": "decline"},
    )
    assert res.status_code == 402


def test_stripe_confirm_mock_success(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="sbuyer@example.com")
    _seed_order(
        sf,
        user_id=uid,
        payment_method="stripe",
        stripe_session_id="cs_4",
        customer_email="sbuyer@example.com",
        with_product=True,
    )
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={"session_id": "cs_4", "mock": "success"},
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending_acceptance"


def test_stripe_confirm_already_captured_idempotent(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _seed_order(
        sf,
        payment_method="stripe",
        stripe_session_id="cs_5",
        status=OrderStatus.paid,
        events=["payment_captured"],
    )
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={"session_id": "cs_5", "mock": "success"},
    )
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- #
# Netopia confirm endpoint                                                     #
# --------------------------------------------------------------------------- #
def test_netopia_confirm_not_found(test_app) -> None:
    client = test_app["client"]
    res = client.post(
        "/api/v1/orders/netopia/confirm",
        json={"order_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 404


def test_netopia_confirm_not_netopia_order(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="stripe")
    res = client.post("/api/v1/orders/netopia/confirm", json={"order_id": str(oid)})
    assert res.status_code == 400
    assert res.json()["detail"] == "Order is not a Netopia order"


def test_netopia_confirm_transaction_mismatch(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="netopia", netopia_ntp_id="NTP-1")
    res = client.post(
        "/api/v1/orders/netopia/confirm",
        json={"order_id": str(oid), "ntp_id": "NTP-OTHER"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Transaction mismatch"


def test_netopia_confirm_missing_ntp(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="netopia", netopia_ntp_id="")
    res = client.post("/api/v1/orders/netopia/confirm", json={"order_id": str(oid)})
    assert res.status_code == 400
    assert res.json()["detail"] == "Missing Netopia transaction id"


def test_netopia_confirm_already_captured(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(
        sf,
        payment_method="netopia",
        netopia_ntp_id="NTP-2",
        status=OrderStatus.paid,
        events=["payment_captured"],
    )
    res = client.post("/api/v1/orders/netopia/confirm", json={"order_id": str(oid)})
    assert res.status_code == 200


def test_netopia_confirm_payment_not_completed(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="netopia", netopia_ntp_id="NTP-3")

    async def fake_status(**_kw):
        return {"payment": {"status": 1}}  # not in paid set {3,5}

    monkeypatch.setattr(netopia_service, "get_status", fake_status)
    res = client.post("/api/v1/orders/netopia/confirm", json={"order_id": str(oid)})
    assert res.status_code == 400
    assert res.json()["detail"] == "Payment not completed"


def test_netopia_confirm_error_code(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="netopia", netopia_ntp_id="NTP-4")

    async def fake_status(**_kw):
        return {"payment": {"status": 3}, "error": {"code": "99", "message": "bad"}}

    monkeypatch.setattr(netopia_service, "get_status", fake_status)
    res = client.post("/api/v1/orders/netopia/confirm", json={"order_id": str(oid)})
    assert res.status_code == 400
    assert res.json()["detail"] == "bad"


def test_netopia_confirm_success(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="nbuyer@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="netopia",
        netopia_ntp_id="NTP-5",
        customer_email="nbuyer@example.com",
        with_product=True,
    )

    async def fake_status(**_kw):
        return {"payment": {"status": 3}, "error": {"code": "00", "message": ""}}

    monkeypatch.setattr(netopia_service, "get_status", fake_status)
    res = client.post(
        "/api/v1/orders/netopia/confirm",
        json={"order_id": str(oid), "ntp_id": "NTP-5"},
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending_acceptance"
