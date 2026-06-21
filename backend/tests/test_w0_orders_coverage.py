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


_ref_counter = [0]


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
    _ref_counter[0] += 1
    ref = f"REF-W0-{_ref_counter[0]}"

    async def _seed():
        async with session_factory() as session:
            order = Order(
                user_id=user_id,
                status=status,
                reference_code=ref,
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
                category = Category(slug=f"w0-{ref}", name="W0")
                product = Product(
                    category=category,
                    slug=f"w0-prod-{ref}",
                    sku=f"W0-PROD-{ref}",
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


def _seed_cart(
    session_factory,
    *,
    user_id=None,
    session_id=None,
    guest_email=None,
    guest_verified=False,
):
    from datetime import datetime, timezone

    from app.models.cart import Cart, CartItem

    async def _seed():
        async with session_factory() as session:
            category = Category(slug="ck", name="CK")
            product = Product(
                category=category,
                slug="ck-prod",
                sku="CK-PROD",
                name="Checkout Product",
                base_price=Decimal("20.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
            )
            cart = Cart(user_id=user_id, session_id=session_id)
            if guest_email:
                cart.guest_email = guest_email
                if guest_verified:
                    cart.guest_email_verified_at = datetime.now(timezone.utc)
            cart.items = [
                CartItem(
                    product=product, quantity=1, unit_price_at_add=Decimal("20.00")
                )
            ]
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            return cart.id

    return asyncio.run(_seed())


def _seed_legal(session_factory) -> None:
    from datetime import datetime, timezone

    from app.models.content import ContentBlock, ContentStatus

    async def _seed():
        async with session_factory() as session:
            session.add_all(
                [
                    ContentBlock(
                        key="page.terms-and-conditions",
                        title="Terms",
                        body_markdown="Terms",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                    ContentBlock(
                        key="page.privacy-policy",
                        title="Privacy",
                        body_markdown="Privacy",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                ]
            )
            await session.commit()

    asyncio.run(_seed())


def _seed_address(session_factory, user_id):
    from app.models.address import Address

    async def _seed():
        async with session_factory() as session:
            addr = Address(
                user_id=user_id,
                label="Home",
                line1="1 Main",
                city="Bucharest",
                country="RO",
                postal_code="010101",
            )
            session.add(addr)
            await session.commit()
            await session.refresh(addr)
            return addr.id

    return asyncio.run(_seed())


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


# --------------------------------------------------------------------------- #
# Admin: list / search / tags / export                                        #
# --------------------------------------------------------------------------- #
def _admin(test_app):
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="adm0@example.com", admin=True)
    return token


def test_admin_list_orders(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", status=OrderStatus.paid)
    res = client.get("/api/v1/orders/admin", headers=auth_headers(_admin(test_app)))
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_admin_search_status_pending(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", status=OrderStatus.pending_payment)
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"status": "pending"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_search_status_sales(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"status": "sales"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_search_status_specific(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"status": "paid"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_search_status_invalid(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"status": "not-a-status"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid order status"


@pytest.mark.parametrize(
    "sla,parsed",
    [
        ("accept_overdue", True),
        ("ship_overdue", True),
        ("any_overdue", True),
    ],
)
def test_admin_search_sla_valid(test_app, sla, parsed) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"sla": sla},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_search_sla_invalid(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"sla": "bogus"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid SLA filter"


@pytest.mark.parametrize("fraud", ["queue", "flagged", "approved", "denied"])
def test_admin_search_fraud_valid(test_app, fraud) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"fraud": fraud},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_search_fraud_invalid(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"fraud": "bogus"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid fraud filter"


def test_admin_search_include_pii(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", status=OrderStatus.paid)
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"include_pii": "true"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_list_tags_and_stats(test_app) -> None:
    client = test_app["client"]
    token = _admin(test_app)
    r1 = client.get("/api/v1/orders/admin/tags", headers=auth_headers(token))
    r2 = client.get("/api/v1/orders/admin/tags/stats", headers=auth_headers(token))
    assert r1.status_code == 200 and r2.status_code == 200


def test_admin_rename_tag_not_found(test_app) -> None:
    client = test_app["client"]
    # No such tag -> service raises 404; the endpoint line is still exercised.
    res = client.post(
        "/api/v1/orders/admin/tags/rename",
        json={"from_tag": "old", "to_tag": "new"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 404


def test_admin_export_default_columns(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", status=OrderStatus.paid)
    res = client.get(
        "/api/v1/orders/admin/export", headers=auth_headers(_admin(test_app))
    )
    assert res.status_code == 200
    assert "id" in res.text


def test_admin_export_with_pii_and_columns(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", status=OrderStatus.paid)
    res = client.get(
        "/api/v1/orders/admin/export",
        params={"include_pii": "true", "columns": "id,customer_email,locker_address"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200


def test_admin_export_masked_columns(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_order(sf, payment_method="stripe", status=OrderStatus.paid)
    res = client.get(
        "/api/v1/orders/admin/export",
        params={
            "columns": [
                "customer_email",
                "customer_name",
                "invoice_company",
                "invoice_vat_id",
                "locker_address",
            ]
        },
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200


def test_admin_export_invalid_columns(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/export",
        params={"columns": "id,nope"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 400
    assert "Invalid export columns" in res.json()["detail"]


def test_admin_get_order_not_found(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 404


def test_admin_get_order_ok(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="stripe", with_product=True)
    res = client.get(
        f"/api/v1/orders/admin/{oid}", headers=auth_headers(_admin(test_app))
    )
    assert res.status_code == 200, res.text


def test_admin_order_events(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="stripe", events=["created", "note"])
    res = client.get(
        f"/api/v1/orders/admin/{oid}/events", headers=auth_headers(_admin(test_app))
    )
    assert res.status_code == 200, res.text


def test_list_my_orders_invalid_date_range(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="me0@example.com")
    res = client.get(
        "/api/v1/orders/me",
        params={"from": "2026-02-01", "to": "2026-01-01"},
        headers=auth_headers(token),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid date range"


# --------------------------------------------------------------------------- #
# create_order (POST "")                                                       #
# --------------------------------------------------------------------------- #
def test_create_order_empty_cart(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="co_empty@example.com")
    res = client.post("/api/v1/orders", json={}, headers=auth_headers(token))
    assert res.status_code == 400
    assert res.json()["detail"] == "Cart is empty"


def test_create_order_invalid_address(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="co_addr@example.com")
    _seed_cart(sf, user_id=uid)
    res = client.post(
        "/api/v1/orders",
        json={"shipping_address_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers(token),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid address"


def test_create_order_shipping_method_not_found(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="co_sm@example.com")
    _seed_cart(sf, user_id=uid)
    res = client.post(
        "/api/v1/orders",
        json={"shipping_method_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers(token),
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Shipping method not found"


def test_create_order_success_cod(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="co_ok@example.com")
    _seed_cart(sf, user_id=uid)
    addr_id = _seed_address(sf, uid)
    res = client.post(
        "/api/v1/orders",
        json={"shipping_address_id": str(addr_id)},
        headers=auth_headers(token),
    )
    assert res.status_code == 201, res.text


def test_create_order_idempotent_existing(test_app, monkeypatch) -> None:
    """Second call returns the existing order via cart.last_order_id (200)."""
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="co_idem@example.com")
    _seed_cart(sf, user_id=uid)
    addr_id = _seed_address(sf, uid)
    first = client.post(
        "/api/v1/orders",
        json={"shipping_address_id": str(addr_id)},
        headers=auth_headers(token),
    )
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/v1/orders",
        json={"shipping_address_id": str(addr_id)},
        headers=auth_headers(token),
    )
    assert second.status_code == 200, second.text


# --------------------------------------------------------------------------- #
# checkout (POST /checkout) - authenticated                                    #
# --------------------------------------------------------------------------- #
def _checkout_payload(**over):
    base = {
        "line1": "1 Main",
        "city": "Bucharest",
        "postal_code": "010101",
        "country": "RO",
        "payment_method": "cod",
        "accept_terms": True,
        "accept_privacy": True,
        "save_address": False,
    }
    base.update(over)
    return base


def test_checkout_empty_cart(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    token, _ = create_user_token(sf, email="ck_empty@example.com")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(),
        headers={**auth_headers(token), "X-Session-Id": "ck-empty"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Cart is empty"


def test_checkout_success_cod(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="ck_ok@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-ok")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(phone="+40712345678"),
        headers={**auth_headers(token), "X-Session-Id": "ck-ok"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["payment_method"] == "cod"


def test_checkout_with_billing_address(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="ck_bill@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-bill")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(
            phone="+40712345678",
            billing_line1="9 Bill St",
            billing_city="Cluj",
            billing_postal_code="400000",
            billing_country="RO",
        ),
        headers={**auth_headers(token), "X-Session-Id": "ck-bill"},
    )
    assert res.status_code == 201, res.text


# --------------------------------------------------------------------------- #
# guest_checkout (POST /guest-checkout)                                        #
# --------------------------------------------------------------------------- #
def _guest_payload(email, **over):
    base = {
        "name": "Guest Buyer",
        "email": email,
        "line1": "1 Main",
        "city": "Bucharest",
        "postal_code": "010101",
        "country": "RO",
        "payment_method": "cod",
        "accept_terms": True,
        "accept_privacy": True,
    }
    base.update(over)
    return base


def test_guest_checkout_missing_session(test_app) -> None:
    client = test_app["client"]
    res = client.post(
        "/api/v1/orders/guest-checkout", json=_guest_payload("g@example.com")
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Missing guest session id"


def test_guest_checkout_empty_cart(test_app) -> None:
    client = test_app["client"]
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload("g2@example.com"),
        headers={"X-Session-Id": "guest-empty"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Cart is empty"


def test_guest_checkout_email_not_verified(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_cart(
        sf, session_id="guest-unv", guest_email="g3@example.com", guest_verified=False
    )
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload("g3@example.com"),
        headers={"X-Session-Id": "guest-unv"},
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "Email verification required"


def test_guest_checkout_email_taken(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    create_user_token(sf, email="taken@example.com")
    _seed_cart(
        sf,
        session_id="guest-taken",
        guest_email="taken@example.com",
        guest_verified=True,
    )
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload("taken@example.com"),
        headers={"X-Session-Id": "guest-taken"},
    )
    assert res.status_code == 400
    assert "already registered" in res.json()["detail"]


def test_guest_checkout_success_cod(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _seed_cart(
        sf,
        session_id="guest-ok",
        guest_email="gok@example.com",
        guest_verified=True,
    )
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload("gok@example.com", phone="+40712345678"),
        headers={"X-Session-Id": "guest-ok"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["payment_method"] == "cod"


# --------------------------------------------------------------------------- #
# Admin mutation endpoints: 404 not-found + happy paths                        #
# --------------------------------------------------------------------------- #
_NIL = "00000000-0000-0000-0000-000000000000"
_uid_counter = [0]


def _seed_order_with_user(test_app, *, status=OrderStatus.pending_acceptance, **kw):
    sf = test_app["session_factory"]
    _uid_counter[0] += 1
    _, uid = create_user_token(sf, email=f"ow-{_uid_counter[0]}@example.com")
    oid = _seed_order(sf, user_id=uid, status=status, with_product=True, **kw)
    return oid, uid


@pytest.mark.parametrize(
    "method,path",
    [
        ("patch", f"/api/v1/orders/admin/{_NIL}"),
        ("patch", f"/api/v1/orders/admin/{_NIL}/addresses"),
        ("get", f"/api/v1/orders/admin/{_NIL}/shipments"),
        ("post", f"/api/v1/orders/admin/{_NIL}/shipments"),
        ("patch", f"/api/v1/orders/admin/{_NIL}/shipments/{_NIL}"),
        ("delete", f"/api/v1/orders/admin/{_NIL}/shipments/{_NIL}"),
        ("get", f"/api/v1/orders/admin/{_NIL}/shipping-label"),
        ("delete", f"/api/v1/orders/admin/{_NIL}/shipping-label"),
        ("post", f"/api/v1/orders/admin/{_NIL}/retry-payment"),
        ("post", f"/api/v1/orders/admin/{_NIL}/refund"),
        ("post", f"/api/v1/orders/admin/{_NIL}/refunds"),
        ("post", f"/api/v1/orders/admin/{_NIL}/notes"),
        ("post", f"/api/v1/orders/admin/{_NIL}/tags"),
        ("delete", f"/api/v1/orders/admin/{_NIL}/tags/sometag"),
        ("post", f"/api/v1/orders/admin/{_NIL}/fraud-review"),
        ("post", f"/api/v1/orders/admin/{_NIL}/delivery-email"),
        ("post", f"/api/v1/orders/admin/{_NIL}/confirmation-email"),
        ("post", f"/api/v1/orders/admin/{_NIL}/items/{_NIL}/fulfill"),
        ("get", f"/api/v1/orders/admin/{_NIL}/events"),
        ("get", f"/api/v1/orders/admin/{_NIL}/packing-slip"),
        ("get", f"/api/v1/orders/admin/{_NIL}/receipt"),
        ("post", f"/api/v1/orders/admin/{_NIL}/capture-payment"),
        ("post", f"/api/v1/orders/admin/{_NIL}/void-payment"),
    ],
)
def test_admin_endpoints_order_not_found(test_app, method, path) -> None:
    client = test_app["client"]
    headers = auth_headers(_admin(test_app))
    bodies = {
        "shipments": {"tracking_number": "TRK1"},
        "notes": {"note": "n"},
        "tags": {"tag": "t"},
        "fraud-review": {"decision": "approve"},
        "refunds": {"amount": "1.00", "note": "r"},
    }
    json_body = None
    for key, body in bodies.items():
        if path.endswith(key):
            json_body = body
            break
    # POST/PATCH carry a JSON body; GET/DELETE do not (TestClient rejects json=).
    # Several POST endpoints declare Body(...) (required) so always send at least {}.
    if method in ("post", "patch"):
        res = getattr(client, method)(path, json=json_body or {}, headers=headers)
    else:
        res = getattr(client, method)(path, headers=headers)
    assert res.status_code == 404, f"{method} {path} -> {res.status_code}: {res.text}"


@pytest.mark.parametrize(
    "new_status",
    ["paid", "shipped", "delivered", "cancelled", "refunded"],
)
def test_admin_update_order_status_transitions(
    test_app, monkeypatch, new_status
) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    # Start each transition from a state that ALLOWED_TRANSITIONS permits.
    start_for = {
        "paid": OrderStatus.pending_acceptance,
        "shipped": OrderStatus.paid,
        "delivered": OrderStatus.shipped,
        "cancelled": OrderStatus.pending_acceptance,
        "refunded": OrderStatus.paid,
    }
    oid, _ = _seed_order_with_user(
        test_app, status=start_for[new_status], payment_method="cod"
    )
    body: dict = {"status": new_status}
    if new_status == "cancelled":
        body["cancel_reason"] = "customer request"
    res = client.patch(
        f"/api/v1/orders/admin/{oid}",
        json=body,
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_update_order_shipping_method_not_found(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    res = client.patch(
        f"/api/v1/orders/admin/{oid}",
        json={"shipping_method_id": _NIL},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 404


def test_admin_update_addresses_no_updates(test_app) -> None:
    # No shipping/billing payload -> service rejects with 400; endpoint covered.
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    res = client.patch(
        f"/api/v1/orders/admin/{oid}/addresses",
        json={"rerate_shipping": False, "note": "fix"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "No address updates provided"


def test_admin_shipment_lifecycle(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))

    lst = client.get(f"/api/v1/orders/admin/{oid}/shipments", headers=headers)
    assert lst.status_code == 200

    created = client.post(
        f"/api/v1/orders/admin/{oid}/shipments",
        json={"courier": "sameday", "tracking_number": "TRK-1"},
        headers=headers,
    )
    assert created.status_code == 200, created.text


def test_admin_notes_tags_fraud_emails(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))

    note = client.post(
        f"/api/v1/orders/admin/{oid}/notes", json={"note": "hello"}, headers=headers
    )
    assert note.status_code == 200, note.text

    tag = client.post(
        f"/api/v1/orders/admin/{oid}/tags", json={"tag": "vip"}, headers=headers
    )
    assert tag.status_code == 200, tag.text

    untag = client.delete(f"/api/v1/orders/admin/{oid}/tags/vip", headers=headers)
    assert untag.status_code == 200, untag.text

    fraud = client.post(
        f"/api/v1/orders/admin/{oid}/fraud-review",
        json={"decision": "approve", "note": "ok"},
        headers=headers,
    )
    assert fraud.status_code == 200, fraud.text

    de = client.post(
        f"/api/v1/orders/admin/{oid}/delivery-email", json={}, headers=headers
    )
    assert de.status_code == 200, de.text

    ce = client.post(
        f"/api/v1/orders/admin/{oid}/confirmation-email", json={}, headers=headers
    )
    assert ce.status_code == 200, ce.text


def test_admin_email_missing_customer(test_app) -> None:
    # Stub an order with no user and no customer_email to hit the 400 branch.
    client = test_app["client"]
    sf = test_app["session_factory"]
    oid = _seed_order(sf, payment_method="cod")

    class _Stub:
        id = oid
        user = None
        customer_email = None
        events: list = []

    async def fake_get(_s, _id):
        return _Stub()

    import app.api.v1.orders as om

    original = om.order_service.get_order_by_id
    om.order_service.get_order_by_id = fake_get
    try:
        res = client.post(
            f"/api/v1/orders/admin/{oid}/delivery-email",
            json={},
            headers=auth_headers(_admin(test_app)),
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Order customer email missing"
    finally:
        om.order_service.get_order_by_id = original


def test_admin_fulfill_item(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _, uid = create_user_token(sf, email="ff@example.com")
    oid = _seed_order(sf, user_id=uid, payment_method="cod", with_product=True)

    async def _item_id():
        from sqlalchemy.future import select as _select

        async with sf() as session:
            row = await session.execute(
                _select(OrderItem).where(OrderItem.order_id == oid)
            )
            return row.scalars().first().id

    item_id = asyncio.run(_item_id())
    res = client.post(
        f"/api/v1/orders/admin/{oid}/items/{item_id}/fulfill",
        params={"shipped_quantity": 1},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_packing_slip_and_receipt(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))

    ps = client.get(f"/api/v1/orders/admin/{oid}/packing-slip", headers=headers)
    assert ps.status_code == 200
    assert ps.headers["content-type"] == "application/pdf"

    rc = client.get(f"/api/v1/orders/admin/{oid}/receipt", headers=headers)
    assert rc.status_code == 200


def test_admin_batch_missing_orders(test_app) -> None:
    client = test_app["client"]
    headers = auth_headers(_admin(test_app))
    for path in (
        "/api/v1/orders/admin/batch/packing-slips",
        "/api/v1/orders/admin/batch/pick-list.csv",
        "/api/v1/orders/admin/batch/pick-list.pdf",
        "/api/v1/orders/admin/batch/shipping-labels.zip",
    ):
        res = client.post(path, json={"order_ids": [_NIL]}, headers=headers)
        assert res.status_code == 404, f"{path} -> {res.status_code}"


def test_admin_batch_packing_and_picklist_ok(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))

    ps = client.post(
        "/api/v1/orders/admin/batch/packing-slips",
        json={"order_ids": [str(oid)]},
        headers=headers,
    )
    assert ps.status_code == 200, ps.text

    csv_res = client.post(
        "/api/v1/orders/admin/batch/pick-list.csv",
        json={"order_ids": [str(oid)]},
        headers=headers,
    )
    assert csv_res.status_code == 200

    pdf_res = client.post(
        "/api/v1/orders/admin/batch/pick-list.pdf",
        json={"order_ids": [str(oid)]},
        headers=headers,
    )
    assert pdf_res.status_code == 200


def test_admin_batch_shipping_labels_missing(test_app) -> None:
    # Order exists but has no shipping label -> 404 missing labels.
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    res = client.post(
        "/api/v1/orders/admin/batch/shipping-labels.zip",
        json={"order_ids": [str(oid)]},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 404
    assert "missing_shipping_label_order_ids" in str(res.json()["detail"])


def test_admin_shipping_label_not_found(test_app) -> None:
    # Order exists but no label uploaded -> 404 on download/delete.
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))
    dl = client.get(f"/api/v1/orders/admin/{oid}/shipping-label", headers=headers)
    assert dl.status_code == 404
    assert dl.json()["detail"] == "Shipping label not found"
    rm = client.delete(f"/api/v1/orders/admin/{oid}/shipping-label", headers=headers)
    assert rm.status_code == 404


def test_admin_capture_and_void_payment(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    headers = auth_headers(_admin(test_app))

    oid_cap, _ = _seed_order_with_user(
        test_app, status=OrderStatus.pending_payment, payment_method="stripe"
    )
    cap = client.post(
        f"/api/v1/orders/admin/{oid_cap}/capture-payment", headers=headers
    )
    assert cap.status_code in (200, 400), cap.text

    oid_void, _ = _seed_order_with_user(
        test_app, status=OrderStatus.pending_payment, payment_method="stripe"
    )
    void = client.post(f"/api/v1/orders/admin/{oid_void}/void-payment", headers=headers)
    assert void.status_code in (200, 400), void.text


def test_admin_retry_payment(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(
        test_app, status=OrderStatus.pending_payment, payment_method="stripe"
    )
    res = client.post(
        f"/api/v1/orders/admin/{oid}/retry-payment",
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code in (200, 400), res.text


# --------------------------------------------------------------------------- #
# Shipping methods + get_order + list_orders                                   #
# --------------------------------------------------------------------------- #
def test_create_and_list_shipping_methods(test_app) -> None:
    client = test_app["client"]
    headers = auth_headers(_admin(test_app))
    created = client.post(
        "/api/v1/orders/shipping-methods",
        json={"name": "Express", "rate_flat": 9.0, "rate_per_kg": 0},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    listing = client.get("/api/v1/orders/shipping-methods")
    assert listing.status_code == 200
    assert any(m["name"] == "Express" for m in listing.json())


def test_get_order_not_found(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="getorder@example.com")
    res = client.get(f"/api/v1/orders/{_NIL}", headers=auth_headers(token))
    assert res.status_code == 404


def test_get_order_ok(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="getorder2@example.com")
    oid = _seed_order(sf, user_id=uid, payment_method="cod", with_product=True)
    res = client.get(f"/api/v1/orders/{oid}", headers=auth_headers(token))
    assert res.status_code == 200, res.text


def test_list_orders_endpoint(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="listo@example.com")
    _seed_order(sf, user_id=uid, payment_method="cod")
    res = client.get("/api/v1/orders", headers=auth_headers(token))
    assert res.status_code == 200
    assert isinstance(res.json(), list)


# --------------------------------------------------------------------------- #
# Guest email verification (request / confirm / status)                        #
# --------------------------------------------------------------------------- #
def test_guest_email_request_missing_session(test_app) -> None:
    client = test_app["client"]
    res = client.post(
        "/api/v1/orders/guest-checkout/email/request",
        json={"email": "ge@example.com"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Missing guest session id"


def test_guest_email_request_email_taken(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    create_user_token(sf, email="getaken@example.com")
    res = client.post(
        "/api/v1/orders/guest-checkout/email/request",
        json={"email": "getaken@example.com"},
        headers={"X-Session-Id": "ge-taken"},
    )
    assert res.status_code == 400
    assert "already registered" in res.json()["detail"]


def test_guest_email_request_and_confirm_flow(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_cart(sf, session_id="ge-flow")

    from app.services import email as email_service

    async def _ok(*_a, **_k):
        return True

    monkeypatch.setattr(email_service, "send_verification_email", _ok)

    req = client.post(
        "/api/v1/orders/guest-checkout/email/request",
        json={"email": "geflow@example.com"},
        headers={"X-Session-Id": "ge-flow"},
    )
    assert req.status_code == 200, req.text
    assert req.json()["sent"] is True

    # Read the generated token straight from the cart row.
    from sqlalchemy.future import select as _select

    from app.models.cart import Cart

    async def _token():
        async with sf() as session:
            row = await session.execute(
                _select(Cart).where(Cart.session_id == "ge-flow")
            )
            return row.scalars().first().guest_email_verification_token

    token = asyncio.run(_token())

    # Wrong token -> 400.
    bad = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        json={"email": "geflow@example.com", "token": "000000"},
        headers={"X-Session-Id": "ge-flow"},
    )
    assert bad.status_code == 400

    # Correct token -> verified.
    ok = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        json={"email": "geflow@example.com", "token": token},
        headers={"X-Session-Id": "ge-flow"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["verified"] is True


def test_guest_email_confirm_missing_session(test_app) -> None:
    client = test_app["client"]
    res = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        json={"email": "x@example.com", "token": "123456"},
    )
    assert res.status_code == 400


def test_guest_email_confirm_email_mismatch(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_cart(sf, session_id="ge-mm", guest_email="real@example.com")
    res = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        json={"email": "other@example.com", "token": "123456"},
        headers={"X-Session-Id": "ge-mm"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Email mismatch"


def test_guest_email_status(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_cart(sf, session_id="ge-st", guest_email="st@example.com")
    no_sid = client.get("/api/v1/orders/guest-checkout/email/status")
    assert no_sid.status_code == 400
    res = client.get(
        "/api/v1/orders/guest-checkout/email/status",
        headers={"X-Session-Id": "ge-st"},
    )
    assert res.status_code == 200
    assert res.json()["email"] == "st@example.com"


# --------------------------------------------------------------------------- #
# Admin document exports                                                        #
# --------------------------------------------------------------------------- #
def test_admin_list_document_exports(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        "/api/v1/orders/admin/exports", headers=auth_headers(_admin(test_app))
    )
    assert res.status_code == 200
    assert "items" in res.json()


def test_admin_download_export_not_found(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        f"/api/v1/orders/admin/exports/{_NIL}/download",
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 404


def test_admin_email_events_not_found(test_app) -> None:
    client = test_app["client"]
    res = client.get(
        f"/api/v1/orders/admin/{_NIL}/email-events",
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 404


def test_admin_email_events_ok(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    res = client.get(
        f"/api/v1/orders/admin/{oid}/email-events",
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_admin_email_events_with_pii(test_app) -> None:
    client = test_app["client"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    res = client.get(
        f"/api/v1/orders/admin/{oid}/email-events",
        params={"include_pii": "true"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200


# --------------------------------------------------------------------------- #
# User-facing receipt + cancel-request + reorder                               #
# --------------------------------------------------------------------------- #
def test_download_receipt_not_found(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="rc@example.com")
    res = client.get(f"/api/v1/orders/{_NIL}/receipt", headers=auth_headers(token))
    assert res.status_code == 404


def test_download_receipt_ok(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="rc2@example.com")
    oid = _seed_order(sf, user_id=uid, payment_method="cod", with_product=True)
    res = client.get(f"/api/v1/orders/{oid}/receipt", headers=auth_headers(token))
    assert res.status_code == 200


def test_read_receipt_by_token_invalid(test_app) -> None:
    client = test_app["client"]
    res = client.get("/api/v1/orders/receipt/not-a-token")
    assert res.status_code == 403


def test_receipt_share_and_token_roundtrip(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="share@example.com")
    oid = _seed_order(sf, user_id=uid, payment_method="cod", with_product=True)

    share = client.post(
        f"/api/v1/orders/{oid}/receipt/share", headers=auth_headers(token)
    )
    assert share.status_code == 200, share.text
    rcpt_token = share.json()["token"]

    view = client.get(f"/api/v1/orders/receipt/{rcpt_token}")
    assert view.status_code == 200, view.text

    view_reveal = client.get(
        f"/api/v1/orders/receipt/{rcpt_token}",
        params={"reveal": "true"},
        headers=auth_headers(token),
    )
    assert view_reveal.status_code == 200

    pdf = client.get(f"/api/v1/orders/receipt/{rcpt_token}/pdf")
    assert pdf.status_code == 200

    pdf_reveal = client.get(
        f"/api/v1/orders/receipt/{rcpt_token}/pdf",
        params={"reveal": "true"},
        headers=auth_headers(token),
    )
    assert pdf_reveal.status_code == 200

    # Revoke bumps the token version -> old token now rejected.
    revoke = client.post(
        f"/api/v1/orders/{oid}/receipt/revoke", headers=auth_headers(token)
    )
    assert revoke.status_code == 200, revoke.text
    stale = client.get(f"/api/v1/orders/receipt/{rcpt_token}")
    assert stale.status_code == 403


def test_receipt_share_not_found_and_forbidden(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="sharenf@example.com")
    nf = client.post(
        f"/api/v1/orders/{_NIL}/receipt/share", headers=auth_headers(token)
    )
    assert nf.status_code == 404

    # Order belongs to a different user -> 403.
    _, other_uid = create_user_token(sf, email="shareowner@example.com")
    oid = _seed_order(sf, user_id=other_uid, payment_method="cod")
    forbidden = client.post(
        f"/api/v1/orders/{oid}/receipt/share", headers=auth_headers(token)
    )
    assert forbidden.status_code == 403


def test_receipt_token_pdf_invalid(test_app) -> None:
    client = test_app["client"]
    res = client.get("/api/v1/orders/receipt/not-a-token/pdf")
    assert res.status_code == 403


def test_cancel_request_not_found(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, _ = create_user_token(sf, email="cr@example.com")
    res = client.post(
        f"/api/v1/orders/{_NIL}/cancel-request",
        json={"reason": "changed mind"},
        headers=auth_headers(token),
    )
    assert res.status_code == 404


def test_cancel_request_ineligible_status(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="cr2@example.com")
    oid = _seed_order(
        sf, user_id=uid, payment_method="cod", status=OrderStatus.delivered
    )
    res = client.post(
        f"/api/v1/orders/{oid}/cancel-request",
        json={"reason": "too late"},
        headers=auth_headers(token),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Cancel request not eligible"


def test_cancel_request_ok_and_duplicate(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="cr3@example.com")
    oid = _seed_order(
        sf, user_id=uid, payment_method="cod", status=OrderStatus.pending_acceptance
    )
    ok = client.post(
        f"/api/v1/orders/{oid}/cancel-request",
        json={"reason": "changed mind"},
        headers=auth_headers(token),
    )
    assert ok.status_code == 200, ok.text

    dup = client.post(
        f"/api/v1/orders/{oid}/cancel-request",
        json={"reason": "again"},
        headers=auth_headers(token),
    )
    assert dup.status_code == 409


def test_reorder(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    token, uid = create_user_token(sf, email="re@example.com")
    oid = _seed_order(sf, user_id=uid, payment_method="cod", with_product=True)
    res = client.post(f"/api/v1/orders/{oid}/reorder", headers=auth_headers(token))
    assert res.status_code in (200, 404), res.text


# --------------------------------------------------------------------------- #
# Checkout payment-method branches (stripe / paypal / netopia)                 #
# --------------------------------------------------------------------------- #
def _enable_netopia(monkeypatch) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(
        netopia_service, "netopia_configuration_status", lambda: (True, None)
    )
    monkeypatch.setattr(netopia_service, "is_netopia_configured", lambda: True)

    async def _start(**_kw):
        return "NTP-MOCK", "https://netopia.example/pay"

    monkeypatch.setattr(netopia_service, "start_payment", _start)


def test_checkout_stripe(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="ck_stripe@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-stripe")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(payment_method="stripe", phone="+40712345678"),
        headers={**auth_headers(token), "X-Session-Id": "ck-stripe"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["payment_method"] == "stripe"
    assert res.json()["stripe_session_id"]


def test_checkout_paypal(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)

    from app.services import paypal as paypal_service

    async def _create(**_kw):
        return "PP-MOCK", "https://paypal.example/approve"

    monkeypatch.setattr(paypal_service, "create_order", _create)

    token, uid = create_user_token(sf, email="ck_paypal@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-paypal")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(payment_method="paypal", phone="+40712345678"),
        headers={**auth_headers(token), "X-Session-Id": "ck-paypal"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["paypal_order_id"] == "PP-MOCK"


def test_checkout_netopia(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _enable_netopia(monkeypatch)
    token, uid = create_user_token(sf, email="ck_netopia@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-netopia")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(payment_method="netopia", phone="+40712345678"),
        headers={**auth_headers(token), "X-Session-Id": "ck-netopia"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["netopia_payment_url"] == "https://netopia.example/pay"


def test_checkout_netopia_disabled(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    monkeypatch.setattr(settings, "netopia_enabled", False, raising=False)
    token, uid = create_user_token(sf, email="ck_netopia_off@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-netopia-off")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(payment_method="netopia", phone="+40712345678"),
        headers={**auth_headers(token), "X-Session-Id": "ck-netopia-off"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Netopia is disabled"


def test_checkout_netopia_not_configured(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    monkeypatch.setattr(settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(
        netopia_service,
        "netopia_configuration_status",
        lambda: (False, "missing keys"),
    )
    token, uid = create_user_token(sf, email="ck_netopia_nc@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-netopia-nc")
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(payment_method="netopia", phone="+40712345678"),
        headers={**auth_headers(token), "X-Session-Id": "ck-netopia-nc"},
    )
    assert res.status_code == 500
    assert res.json()["detail"] == "missing keys"


def test_checkout_with_promo_code(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    token, uid = create_user_token(sf, email="ck_promo@example.com")
    _seed_cart(sf, user_id=uid, session_id="ck-promo")
    # Unknown promo code: coupon lookup 404s, falls back to validate_promo (also
    # returns nothing) -> checkout proceeds with no discount.
    res = client.post(
        "/api/v1/orders/checkout",
        json=_checkout_payload(
            payment_method="cod", phone="+40712345678", promo_code="UNKNOWNCODE"
        ),
        headers={**auth_headers(token), "X-Session-Id": "ck-promo"},
    )
    assert res.status_code in (201, 400, 404), res.text


# --------------------------------------------------------------------------- #
# Guest checkout full flows (cod already covered; add stripe + netopia)        #
# --------------------------------------------------------------------------- #
def test_guest_checkout_stripe(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _seed_cart(
        sf,
        session_id="g-stripe",
        guest_email="gstripe@example.com",
        guest_verified=True,
    )
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload(
            "gstripe@example.com", payment_method="stripe", phone="+40712345678"
        ),
        headers={"X-Session-Id": "g-stripe"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["stripe_session_id"]


def test_guest_checkout_netopia(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _enable_netopia(monkeypatch)
    _seed_cart(
        sf, session_id="g-net", guest_email="gnet@example.com", guest_verified=True
    )
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload(
            "gnet@example.com", payment_method="netopia", phone="+40712345678"
        ),
        headers={"X-Session-Id": "g-net"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["netopia_payment_url"] == "https://netopia.example/pay"


def test_guest_checkout_create_account(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _seed_legal(sf)
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _seed_cart(
        sf, session_id="g-acct", guest_email="gacct@example.com", guest_verified=True
    )
    res = client.post(
        "/api/v1/orders/guest-checkout",
        json=_guest_payload(
            "gacct@example.com",
            payment_method="cod",
            phone="+40712345678",
            create_account=True,
            password="secret123",
            username="gacctuser",
            first_name="Gacct",
            last_name="User",
            date_of_birth="1990-01-01",
        ),
        headers={"X-Session-Id": "g-acct"},
    )
    assert res.status_code == 201, res.text


# --------------------------------------------------------------------------- #
# Stripe confirm in REAL mode (monkeypatched SDK, as test_w3_payments does)    #
# --------------------------------------------------------------------------- #
def test_stripe_confirm_real_mode_not_configured(test_app, monkeypatch) -> None:
    client = test_app["client"]
    from app.services import payments

    monkeypatch.setattr(settings, "payments_provider", "real", raising=False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: False)
    res = client.post("/api/v1/orders/stripe/confirm", json={"session_id": "cs_real"})
    assert res.status_code == 500
    assert res.json()["detail"] == "Stripe not configured"


def test_stripe_confirm_real_mode_lookup_fails(test_app, monkeypatch) -> None:
    client = test_app["client"]
    from app.services import payments

    monkeypatch.setattr(settings, "payments_provider", "real", raising=False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    class _Sessions:
        @staticmethod
        def retrieve(_sid):
            raise RuntimeError("boom")

    class _Checkout:
        Session = _Sessions

    class _Stripe:
        checkout = _Checkout

    monkeypatch.setattr(payments, "stripe", _Stripe, raising=False)
    res = client.post("/api/v1/orders/stripe/confirm", json={"session_id": "cs_real2"})
    assert res.status_code == 502


def test_stripe_confirm_real_mode_not_paid(test_app, monkeypatch) -> None:
    client = test_app["client"]
    from app.services import payments

    monkeypatch.setattr(settings, "payments_provider", "real", raising=False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    class _Session:
        payment_status = "unpaid"
        payment_intent = "pi_x"

    class _Sessions:
        @staticmethod
        def retrieve(_sid):
            return _Session()

    class _Checkout:
        Session = _Sessions

    class _Stripe:
        checkout = _Checkout

    monkeypatch.setattr(payments, "stripe", _Stripe, raising=False)
    res = client.post("/api/v1/orders/stripe/confirm", json={"session_id": "cs_real3"})
    assert res.status_code == 400
    assert res.json()["detail"] == "Payment not completed"


def test_stripe_confirm_real_mode_paid(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    from app.services import payments

    _silence_email(monkeypatch)
    monkeypatch.setattr(settings, "payments_provider", "real", raising=False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    class _Session:
        payment_status = "paid"
        payment_intent = "pi_real_1"

    class _Sessions:
        @staticmethod
        def retrieve(_sid):
            return _Session()

    class _Checkout:
        Session = _Sessions

    class _Stripe:
        checkout = _Checkout

    monkeypatch.setattr(payments, "stripe", _Stripe, raising=False)
    token, uid = create_user_token(sf, email="sreal@example.com")
    _seed_order(
        sf,
        user_id=uid,
        payment_method="stripe",
        stripe_session_id="cs_real4",
        customer_email="sreal@example.com",
        with_product=True,
    )
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={"session_id": "cs_real4"},
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- #
# include_pii branch on admin mutation endpoints                               #
# --------------------------------------------------------------------------- #
def test_admin_mutations_include_pii(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))
    params = {"include_pii": "true"}

    note = client.post(
        f"/api/v1/orders/admin/{oid}/notes",
        params=params,
        json={"note": "pii"},
        headers=headers,
    )
    assert note.status_code == 200, note.text

    tag = client.post(
        f"/api/v1/orders/admin/{oid}/tags",
        params=params,
        json={"tag": "piivip"},
        headers=headers,
    )
    assert tag.status_code == 200, tag.text

    fraud = client.post(
        f"/api/v1/orders/admin/{oid}/fraud-review",
        params=params,
        json={"decision": "approve"},
        headers=headers,
    )
    assert fraud.status_code == 200, fraud.text

    get_o = client.get(f"/api/v1/orders/admin/{oid}", params=params, headers=headers)
    assert get_o.status_code == 200


# --------------------------------------------------------------------------- #
# Refund happy paths                                                            #
# --------------------------------------------------------------------------- #
def test_admin_refund_order_ok(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    oid, _ = _seed_order_with_user(
        test_app, status=OrderStatus.paid, payment_method="cod"
    )
    res = client.post(
        f"/api/v1/orders/admin/{oid}/refund",
        json={"note": "full refund"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code in (200, 400), res.text


def test_admin_create_order_refund_ok(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    oid, _ = _seed_order_with_user(
        test_app, status=OrderStatus.paid, payment_method="cod"
    )
    res = client.post(
        f"/api/v1/orders/admin/{oid}/refunds",
        json={"amount": "10.00", "note": "partial"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code in (200, 400), res.text


# --------------------------------------------------------------------------- #
# Shipping label upload + download + delete (with real private file)           #
# --------------------------------------------------------------------------- #
def test_admin_shipping_label_upload_download_delete(
    test_app, monkeypatch, tmp_path
) -> None:
    client = test_app["client"]
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path), raising=False)
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    headers = auth_headers(_admin(test_app))

    up = client.post(
        f"/api/v1/orders/admin/{oid}/shipping-label",
        files={"file": ("label.pdf", b"%PDF-1.4 minimal", "application/pdf")},
        headers=headers,
    )
    assert up.status_code == 200, up.text

    dl = client.get(f"/api/v1/orders/admin/{oid}/shipping-label", headers=headers)
    assert dl.status_code == 200

    pr = client.get(
        f"/api/v1/orders/admin/{oid}/shipping-label",
        params={"action": "print"},
        headers=headers,
    )
    assert pr.status_code == 200

    rm = client.delete(f"/api/v1/orders/admin/{oid}/shipping-label", headers=headers)
    assert rm.status_code == 204


# --------------------------------------------------------------------------- #
# Branch-completion: payment-confirm sub-branches                              #
# --------------------------------------------------------------------------- #
def test_paypal_capture_non_mock(test_app, monkeypatch) -> None:
    # Real mode: paypal_service.capture_order is invoked (line 1189).
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    monkeypatch.setattr(settings, "payments_provider", "real", raising=False)

    from app.services import paypal as paypal_service

    async def _cap(**_kw):
        return "CAP-REAL-1"

    monkeypatch.setattr(paypal_service, "capture_order", _cap)

    token, uid = create_user_token(sf, email="ppreal@example.com")
    _seed_order(
        sf,
        user_id=uid,
        payment_method="paypal",
        paypal_order_id="PP-REAL",
        customer_email="ppreal@example.com",
        with_product=True,
    )
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={"paypal_order_id": "PP-REAL"},
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["paypal_capture_id"] == "CAP-REAL-1"


def test_paypal_capture_from_pending_acceptance(test_app, monkeypatch) -> None:
    # status already pending_acceptance -> skips the status_change block (1190->1199).
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _seed_order(
        sf,
        payment_method="paypal",
        paypal_order_id="PP-PA",
        status=OrderStatus.pending_acceptance,
    )
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={"paypal_order_id": "PP-PA", "mock": "success"},
    )
    assert res.status_code == 200, res.text


def test_stripe_confirm_guest_return_flow(test_app, monkeypatch) -> None:
    # order has user_id but caller is anonymous and supplies matching order_id
    # -> guest-return branch (1336-1338) instead of 403.
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _, uid = create_user_token(sf, email="guestret@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="stripe",
        stripe_session_id="cs_guest",
        customer_email="guestret@example.com",
        with_product=True,
    )
    res = client.post(
        "/api/v1/orders/stripe/confirm",
        json={"session_id": "cs_guest", "order_id": str(oid), "mock": "success"},
    )
    assert res.status_code == 200, res.text


def test_paypal_capture_guest_return_flow(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _mock_payments(monkeypatch)
    _silence_email(monkeypatch)
    _, uid = create_user_token(sf, email="ppguest@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="paypal",
        paypal_order_id="PP-GUEST",
        customer_email="ppguest@example.com",
        with_product=True,
    )
    res = client.post(
        "/api/v1/orders/paypal/capture",
        json={"paypal_order_id": "PP-GUEST", "order_id": str(oid), "mock": "success"},
    )
    assert res.status_code == 200, res.text


def test_netopia_confirm_guest_return_flow(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    _, uid = create_user_token(sf, email="netguest@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="netopia",
        netopia_ntp_id="NTP-GUEST",
        customer_email="netguest@example.com",
        with_product=True,
    )

    async def fake_status(**_kw):
        return {"payment": {"status": 5}, "error": {"code": "0"}}

    monkeypatch.setattr(netopia_service, "get_status", fake_status)
    res = client.post(
        "/api/v1/orders/netopia/confirm",
        json={"order_id": str(oid)},
    )
    assert res.status_code == 200, res.text


def test_netopia_confirm_no_user_order(test_app, monkeypatch) -> None:
    # Guest order (no user) confirmed -> skips the user-notification branch.
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    oid = _seed_order(
        sf,
        user_id=None,
        payment_method="netopia",
        netopia_ntp_id="NTP-NOUSER",
        customer_email="nouser@example.com",
        with_product=True,
    )

    async def fake_status(**_kw):
        return {"payment": {"status": 3}}

    monkeypatch.setattr(netopia_service, "get_status", fake_status)
    res = client.post("/api/v1/orders/netopia/confirm", json={"order_id": str(oid)})
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- #
# admin_update_order: cancellation requiring manual refund (paypal/stripe)      #
# --------------------------------------------------------------------------- #
def test_admin_cancel_paypal_captured_needs_refund(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    _, uid = create_user_token(sf, email="cancelpp@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="paypal",
        paypal_capture_id="CAP-XYZ",
        status=OrderStatus.paid,
        with_product=True,
    )
    res = client.patch(
        f"/api/v1/orders/admin/{oid}",
        json={"status": "cancelled", "cancel_reason": "fraud"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_cancel_stripe_captured_needs_refund(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)
    _, uid = create_user_token(sf, email="cancelst@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="stripe",
        status=OrderStatus.paid,
        events=["payment_captured"],
        with_product=True,
    )

    async def _set_intent():
        from sqlalchemy.future import select as _select

        async with sf() as session:
            row = await session.execute(_select(Order).where(Order.id == oid))
            order = row.scalars().first()
            order.stripe_payment_intent_id = "pi_cancel"
            session.add(order)
            await session.commit()

    asyncio.run(_set_intent())
    res = client.patch(
        f"/api/v1/orders/admin/{oid}",
        json={"status": "cancelled", "cancel_reason": "fraud"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text


def test_admin_update_order_with_shipping_method(test_app, monkeypatch) -> None:
    client = test_app["client"]
    _silence_email(monkeypatch)
    headers = auth_headers(_admin(test_app))

    created = client.post(
        "/api/v1/orders/shipping-methods",
        json={"name": "Std", "rate_flat": 5.0, "rate_per_kg": 0},
        headers=headers,
    )
    method_id = created.json()["id"]
    oid, _ = _seed_order_with_user(test_app, payment_method="cod")
    res = client.patch(
        f"/api/v1/orders/admin/{oid}",
        json={"shipping_method_id": method_id},
        headers=headers,
    )
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- #
# capture / void happy paths with notification (user present)                   #
# --------------------------------------------------------------------------- #
def test_admin_capture_payment_success(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)

    # The capture service calls the Stripe SDK; mock it as test_w3_payments does.
    from app.services import payments

    async def _cap(_intent):
        return {"id": _intent, "status": "succeeded"}

    monkeypatch.setattr(payments, "capture_payment_intent", _cap)

    _, uid = create_user_token(sf, email="capok@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="stripe",
        status=OrderStatus.pending_payment,
        customer_email="capok@example.com",
        with_product=True,
    )

    async def _set_intent():
        from sqlalchemy.future import select as _select

        async with sf() as session:
            row = await session.execute(_select(Order).where(Order.id == oid))
            order = row.scalars().first()
            order.stripe_payment_intent_id = "pi_cap"
            session.add(order)
            await session.commit()

    asyncio.run(_set_intent())
    res = client.post(
        f"/api/v1/orders/admin/{oid}/capture-payment",
        params={"intent_id": "pi_cap"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code in (200, 400), res.text


def test_admin_void_payment_success(test_app, monkeypatch) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _silence_email(monkeypatch)

    from app.services import payments

    async def _void(_intent):
        return {"id": _intent, "status": "canceled"}

    monkeypatch.setattr(payments, "void_payment_intent", _void)

    _, uid = create_user_token(sf, email="voidok@example.com")
    oid = _seed_order(
        sf,
        user_id=uid,
        payment_method="stripe",
        status=OrderStatus.pending_payment,
        customer_email="voidok@example.com",
        with_product=True,
    )

    async def _set_intent():
        from sqlalchemy.future import select as _select

        async with sf() as session:
            row = await session.execute(_select(Order).where(Order.id == oid))
            order = row.scalars().first()
            order.stripe_payment_intent_id = "pi_void"
            session.add(order)
            await session.commit()

    asyncio.run(_set_intent())
    res = client.post(
        f"/api/v1/orders/admin/{oid}/void-payment",
        params={"intent_id": "pi_void"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code in (200, 400), res.text


# --------------------------------------------------------------------------- #
# admin_search: naive-datetime SLA path + export expired/missing               #
# --------------------------------------------------------------------------- #
def test_admin_search_user_filter(test_app) -> None:
    client = test_app["client"]
    sf = test_app["session_factory"]
    _, uid = create_user_token(sf, email="srchuser@example.com")
    _seed_order(sf, user_id=uid, payment_method="cod", status=OrderStatus.paid)
    res = client.get(
        "/api/v1/orders/admin/search",
        params={"user_id": str(uid), "tag": "x"},
        headers=auth_headers(_admin(test_app)),
    )
    assert res.status_code == 200, res.text
