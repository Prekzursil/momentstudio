import asyncio
from decimal import Decimal
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.cart import Cart
from app.models.catalog import Category, Product, ProductImage, ProductStatus
from app.models.order import Order
from app.models.user import User
from app.core import security
from app.services import cart as cart_service
from app.services import order as order_service
from app.services import payments
from app.services import email as email_service
from app.core.config import settings
from app.schemas.order import ShippingMethodCreate
from app.schemas.promo import PromoCodeCreate
from app.models.user import UserRole


@pytest.fixture
def checkout_app() -> Dict[str, object]:
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


def test_guest_checkout_requires_email_verification(checkout_app: Dict[str, object]) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> str:
        async with SessionLocal() as session:
            category = Category(slug="guest", name="Guest")
            product = Product(
                category=category,
                slug="guest-prod",
                sku="GUEST-1",
                name="Guest Product",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)
            return str(product.id)

    product_id = asyncio.run(seed())

    add = client.post(
        "/api/v1/cart/items",
        headers={"X-Session-Id": "guest-abc"},
        json={"product_id": product_id, "quantity": 1},
    )
    assert add.status_code in (200, 201), add.text

    res = client.post(
        "/api/v1/orders/guest-checkout",
        headers={"X-Session-Id": "guest-abc"},
        json={
            "name": "Guest User",
            "email": "guest@example.com",
            "password": None,
            "create_account": False,
            "line1": "123 Test St",
            "line2": None,
            "city": "Testville",
            "region": "TS",
            "postal_code": "12345",
            "country": "US",
            "shipping_method_id": None,
            "promo_code": None,
            "save_address": False,
        },
    )
    assert res.status_code == 403, res.text
    assert res.json().get("detail") == "Email verification required"


def test_guest_checkout_email_verification_and_create_account(
    checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> str:
        async with SessionLocal() as session:
            category = Category(slug="guest2", name="Guest2")
            owner = User(
                email="owner2@example.com",
                username="owner2",
                hashed_password=security.hash_password("Password123"),
                name="Owner",
                role=UserRole.owner,
                email_verified=True,
            )
            product = Product(
                category=category,
                slug="guest2-prod",
                sku="GUEST-2",
                name="Guest Product 2",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add_all([owner, product])
            await session.commit()
            await session.refresh(product)
            return str(product.id)

    product_id = asyncio.run(seed())

    add = client.post(
        "/api/v1/cart/items",
        headers={"X-Session-Id": "guest-def"},
        json={"product_id": product_id, "quantity": 2},
    )
    assert add.status_code in (200, 201), add.text

    captured: dict[str, object] = {}

    async def fake_create_checkout_session(
        *,
        amount_cents: int,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        lang: str | None = None,
        metadata: dict[str, str] | None = None,
        line_items: list[dict[str, object]] | None = None,
        discount_cents: int | None = None,
    ) -> dict:
        captured["amount_cents"] = amount_cents
        captured["stripe_customer_email"] = customer_email
        captured["stripe_success_url"] = success_url
        captured["stripe_cancel_url"] = cancel_url
        captured["stripe_lang"] = lang
        captured["stripe_metadata"] = metadata or {}
        captured["stripe_line_items"] = line_items or []
        captured["stripe_discount_cents"] = discount_cents
        return {"session_id": "cs_test", "checkout_url": "https://stripe.example/checkout"}

    async def fake_send_order_confirmation(to_email, order, items=None, lang=None, *, receipt_share_days=None):
        captured["email"] = to_email
        return True

    async def fake_send_new_order_notification(to_email, order, customer_email=None, lang=None):
        captured["admin_email"] = to_email
        captured["admin_customer_email"] = customer_email
        return True

    async def fake_send_verification_email(to_email, token, lang=None):
        captured["verification_to"] = to_email
        captured["verification_token"] = token
        return True

    async def fake_send_welcome_email(to_email, first_name=None, lang=None):
        captured["welcome_email"] = to_email
        captured["welcome_lang"] = lang
        captured["welcome_first_name"] = first_name
        return True

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)
    monkeypatch.setattr(email_service, "send_order_confirmation", fake_send_order_confirmation)
    monkeypatch.setattr(email_service, "send_new_order_notification", fake_send_new_order_notification)
    monkeypatch.setattr(email_service, "send_verification_email", fake_send_verification_email)
    monkeypatch.setattr(email_service, "send_welcome_email", fake_send_welcome_email)

    req = client.post(
        "/api/v1/orders/guest-checkout/email/request",
        headers={"X-Session-Id": "guest-def"},
        json={"email": "guest2@example.com"},
    )
    assert req.status_code == 200, req.text
    assert req.json()["sent"] is True

    async def fetch_token() -> str:
        async with SessionLocal() as session:
            cart = (await session.execute(select(Cart).where(Cart.session_id == "guest-def"))).scalar_one()
            assert cart.guest_email_verification_token
            return cart.guest_email_verification_token

    token = asyncio.run(fetch_token())
    assert token == captured.get("verification_token")

    confirm = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        headers={"X-Session-Id": "guest-def"},
        json={"email": "guest2@example.com", "token": token},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["verified"] is True

    checkout = client.post(
        "/api/v1/orders/guest-checkout",
        headers={"X-Session-Id": "guest-def"},
        json={
            "name": "Guest User",
            "email": "guest2@example.com",
            "password": "secret123",
            "create_account": True,
            "username": "guest2",
            "first_name": "Guest",
            "middle_name": None,
            "last_name": "User",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
            "preferred_language": "en",
            "line1": "123 Test St",
            "line2": None,
            "city": "Testville",
            "region": "TS",
            "postal_code": "12345",
            "country": "US",
            "shipping_method_id": None,
            "promo_code": None,
            "save_address": True,
        },
    )
    assert checkout.status_code == 201, checkout.text
    line_items = captured.get("stripe_line_items")
    assert isinstance(line_items, list)
    assert len(line_items) >= 2
    assert any(
        li.get("price_data", {}).get("product_data", {}).get("name") == "Guest Product 2" and li.get("quantity") == 2
        for li in line_items
        if isinstance(li, dict)
    )
    assert any(
        li.get("price_data", {}).get("product_data", {}).get("name") == "Shipping" for li in line_items if isinstance(li, dict)
    )
    body = checkout.json()
    assert body["payment_method"] == "stripe"
    assert body["stripe_session_id"] == "cs_test"
    assert body["stripe_checkout_url"] == "https://stripe.example/checkout"
    # Order confirmations are sent only after payment capture.
    assert captured.get("email") is None
    assert captured.get("admin_email") is None
    assert captured.get("admin_customer_email") is None
    # Subtotal 20.00 RON + tax 2.00 RON + shipping 20.00 RON (flat, CMS-configurable) => 42.00 RON
    assert captured.get("amount_cents") == 4200
    assert captured.get("welcome_email") == "guest2@example.com"
    assert captured.get("welcome_lang") == "en"
    assert captured.get("welcome_first_name") == "Guest"

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(
        "app.services.payments.stripe.Webhook.construct_event",
        lambda payload, sig_header, secret: {
            "id": "evt_guest_checkout_1",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_test", "payment_intent": "pi_test", "payment_status": "paid"}},
        },
    )
    webhook = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert webhook.status_code == 200, webhook.text
    assert captured.get("email") == "guest2@example.com"
    assert captured.get("admin_email") == "owner2@example.com"
    assert captured.get("admin_customer_email") == "guest2@example.com"

    async def fetch_user() -> User:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "guest2@example.com"))).scalar_one()
            return user

    user = asyncio.run(fetch_user())
    assert user.email_verified is True
    assert user.username == "guest2"


def test_guest_checkout_email_verification_rate_limited(
    checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> str:
        async with SessionLocal() as session:
            category = Category(slug="guest3", name="Guest3")
            product = Product(
                category=category,
                slug="guest3-prod",
                sku="GUEST-3",
                name="Guest Product 3",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)
            return str(product.id)

    product_id = asyncio.run(seed())

    add = client.post(
        "/api/v1/cart/items",
        headers={"X-Session-Id": "guest-ghi"},
        json={"product_id": product_id, "quantity": 1},
    )
    assert add.status_code in (200, 201), add.text

    async def fake_send_verification_email(to_email, token, lang=None):
        return True

    monkeypatch.setattr(email_service, "send_verification_email", fake_send_verification_email)

    req = client.post(
        "/api/v1/orders/guest-checkout/email/request",
        headers={"X-Session-Id": "guest-ghi"},
        json={"email": "guest3@example.com"},
    )
    assert req.status_code == 200, req.text
    assert req.json()["sent"] is True

    async def fetch_token() -> str:
        async with SessionLocal() as session:
            cart = (await session.execute(select(Cart).where(Cart.session_id == "guest-ghi"))).scalar_one()
            assert cart.guest_email_verification_token
            return cart.guest_email_verification_token

    token = asyncio.run(fetch_token())
    wrong_token = "000000" if token != "000000" else "111111"

    # Allow up to 10 failed attempts; the next attempt should be blocked.
    for _ in range(10):
        confirm = client.post(
            "/api/v1/orders/guest-checkout/email/confirm",
            headers={"X-Session-Id": "guest-ghi"},
            json={"email": "guest3@example.com", "token": wrong_token},
        )
        assert confirm.status_code == 400, confirm.text

    blocked = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        headers={"X-Session-Id": "guest-ghi"},
        json={"email": "guest3@example.com", "token": wrong_token},
    )
    assert blocked.status_code == 429, blocked.text

    # Requesting a new code should reset the attempt counter.
    req2 = client.post(
        "/api/v1/orders/guest-checkout/email/request",
        headers={"X-Session-Id": "guest-ghi"},
        json={"email": "guest3@example.com"},
    )
    assert req2.status_code == 200, req2.text
    assert req2.json()["sent"] is True

    token2 = asyncio.run(fetch_token())
    confirm2 = client.post(
        "/api/v1/orders/guest-checkout/email/confirm",
        headers={"X-Session-Id": "guest-ghi"},
        json={"email": "guest3@example.com", "token": token2},
    )
    assert confirm2.status_code == 200, confirm2.text
    assert confirm2.json()["verified"] is True


def test_authenticated_checkout_promo_and_shipping(checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="checkout", name="Checkout")
            owner = User(
                email="owner@example.com",
                username="owner",
                hashed_password=security.hash_password("Password123"),
                name="Owner",
                role=UserRole.owner,
                email_verified=True,
            )
            product = Product(
                category=category,
                slug="checkout-prod",
                sku="CHK-1",
                name="Checkout Product",
                base_price=Decimal("50.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            shipping_method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Express", rate_flat=10.0, rate_per_kg=0)
            )
            await cart_service.create_promo(session, PromoCodeCreate(code="SAVE10", percentage_off=10, currency="RON"))
            session.add(owner)
            session.add(product)
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id, "shipping_method_id": shipping_method.id}

    seeded = asyncio.run(seed())

    # Register, verify email, and add items to cart.
    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "buyer@example.com",
            "username": "buyer",
            "password": "secret123",
            "name": "Buyer",
            "first_name": "Buyer",
            "last_name": "User",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert register.status_code == 201, register.text
    token = register.json()["tokens"]["access_token"]
    user_id = register.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 2},
    )
    assert add_res.status_code in (200, 201), add_res.text

    captured: dict[str, object] = {}

    async def fake_create_checkout_session(
        *,
        amount_cents: int,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        lang: str | None = None,
        metadata: dict[str, str] | None = None,
        line_items: list[dict[str, object]] | None = None,
        discount_cents: int | None = None,
    ) -> dict:
        captured["amount_cents"] = amount_cents
        captured["stripe_customer_email"] = customer_email
        captured["stripe_line_items"] = line_items or []
        captured["stripe_discount_cents"] = discount_cents
        return {"session_id": "cs_test", "checkout_url": "https://stripe.example/checkout"}

    async def fake_send_order_confirmation(to_email, order, items=None, lang=None, *, receipt_share_days=None):
        captured["email"] = to_email
        return True

    async def fake_send_new_order_notification(to_email, order, customer_email=None, lang=None):
        captured["admin_email"] = to_email
        captured["admin_lang"] = lang
        captured["admin_customer_email"] = customer_email
        return True

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)
    monkeypatch.setattr(email_service, "send_order_confirmation", fake_send_order_confirmation)
    monkeypatch.setattr(email_service, "send_new_order_notification", fake_send_new_order_notification)

    res = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "line1": "123 Test St",
            "line2": None,
            "city": "Testville",
            "region": "TS",
            "postal_code": "12345",
            "country": "US",
            "shipping_method_id": str(seeded["shipping_method_id"]),
            "promo_code": "SAVE10",
            "save_address": True,
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["payment_method"] == "stripe"
    assert body["stripe_session_id"] == "cs_test"
    assert body["stripe_checkout_url"] == "https://stripe.example/checkout"
    # Subtotal: 2 * 50 = 100; discount 10% => 10; taxable 90; tax 9; shipping 20 => total 119 => cents 11900
    assert captured.get("amount_cents") == 11900
    assert captured.get("stripe_discount_cents") == 1000
    line_items = captured.get("stripe_line_items")
    assert isinstance(line_items, list)
    assert any(
        li.get("price_data", {}).get("product_data", {}).get("name") == "Checkout Product" and li.get("quantity") == 2
        for li in line_items
        if isinstance(li, dict)
    )
    assert any(
        li.get("price_data", {}).get("product_data", {}).get("name") == "Shipping" for li in line_items if isinstance(li, dict)
    )
    assert any(li.get("price_data", {}).get("product_data", {}).get("name") == "VAT" for li in line_items if isinstance(li, dict))
    assert captured.get("email") is None
    assert captured.get("admin_email") is None
    assert captured.get("admin_customer_email") is None

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(
        "app.services.payments.stripe.Webhook.construct_event",
        lambda payload, sig_header, secret: {
            "id": "evt_auth_checkout_1",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_test", "payment_intent": "pi_test", "payment_status": "paid"}},
        },
    )
    webhook = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert webhook.status_code == 200, webhook.text
    assert captured.get("email") == "buyer@example.com"
    assert captured.get("admin_email") == "owner@example.com"
    assert captured.get("admin_customer_email") == "buyer@example.com"

    async def fetch_order():
        async with SessionLocal() as session:
            result = await session.execute(select(Order).order_by(Order.created_at.desc()))
            return result.scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert float(order.total_amount) == pytest.approx(119.0)
    assert order.stripe_checkout_session_id == "cs_test"


def test_authenticated_checkout_creates_separate_billing_address(
    checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="bill", name="Billing")
            product = Product(
                category=category,
                slug="bill-prod",
                sku="BILL-1",
                name="Billing Product",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id}

    seeded = asyncio.run(seed())

    async def fake_create_checkout_session(*args, **kwargs) -> dict:
        return {"session_id": "cs_test", "checkout_url": "https://stripe.example/checkout"}

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)

    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "billbuyer@example.com",
            "username": "billbuyer",
            "password": "secret123",
            "name": "Bill Buyer",
            "first_name": "Bill",
            "last_name": "Buyer",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert register.status_code == 201, register.text
    token = register.json()["tokens"]["access_token"]
    user_id = register.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 1},
    )
    assert add_res.status_code in (200, 201), add_res.text

    res = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "line1": "Ship St",
            "city": "Ship City",
            "postal_code": "12345",
            "country": "US",
            "billing_line1": "Bill St",
            "billing_city": "Bill City",
            "billing_postal_code": "54321",
            "billing_country": "US",
            "save_address": False,
        },
    )
    assert res.status_code == 201, res.text

    async def fetch_order() -> Order | None:
        async with SessionLocal() as session:
            return (await session.execute(select(Order).order_by(Order.created_at.desc()))).scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert order.shipping_address_id is not None
    assert order.billing_address_id is not None
    assert order.billing_address_id != order.shipping_address_id


def test_authenticated_checkout_cod_skips_payment_intent(checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="cod", name="COD")
            product = Product(
                category=category,
                slug="cod-prod",
                sku="COD-1",
                name="COD Product",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id}

    seeded = asyncio.run(seed())

    called: dict[str, object] = {"stripe_called": False}

    async def fake_create_checkout_session(*args, **kwargs) -> dict:
        called["stripe_called"] = True
        return {"session_id": "cs_test", "checkout_url": "https://stripe.example/checkout"}

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)

    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "codbuyer@example.com",
            "username": "codbuyer",
            "password": "secret123",
            "name": "COD Buyer",
            "first_name": "COD",
            "last_name": "Buyer",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert register.status_code == 201, register.text
    token = register.json()["tokens"]["access_token"]
    user_id = register.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 1},
    )
    assert add_res.status_code in (200, 201), add_res.text

    res = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "line1": "123 Test St",
            "city": "Testville",
            "postal_code": "12345",
            "country": "US",
            "save_address": False,
            "payment_method": "cod",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["payment_method"] == "cod"
    assert body["stripe_checkout_url"] is None
    assert body["paypal_approval_url"] is None
    assert called["stripe_called"] is False

    async def fetch_order() -> Order | None:
        async with SessionLocal() as session:
            return (await session.execute(select(Order).order_by(Order.created_at.desc()))).scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert order.payment_method == "cod"
    assert order.stripe_checkout_session_id is None


def test_authenticated_checkout_paypal_flow_requires_auth_to_capture(
    checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="pp", name="PayPal")
            owner = User(
                email="ownerpp@example.com",
                username="ownerpp",
                hashed_password=security.hash_password("Password123"),
                name="Owner",
                role=UserRole.owner,
                email_verified=True,
            )
            product = Product(
                category=category,
                slug="pp-prod",
                sku="PP-1",
                name="PayPal Product",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add_all([owner, product])
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id}

    seeded = asyncio.run(seed())

    called: dict[str, object] = {
        "stripe_called": False,
        "paypal_created": False,
        "paypal_captured": False,
        "order_email_sent": False,
        "admin_email_sent": False,
    }

    async def fake_create_checkout_session(*args, **kwargs) -> dict:
        called["stripe_called"] = True
        return {"session_id": "cs_test", "checkout_url": "https://stripe.example/checkout"}

    async def fake_paypal_create_order(*, total_ron, reference, return_url, cancel_url, **_kwargs):
        called["paypal_created"] = True
        assert str(reference)
        assert str(return_url).startswith("http")
        assert str(cancel_url).startswith("http")
        return "PAYPAL-ORDER-1", "https://paypal.example/approve"

    async def fake_paypal_capture_order(*, paypal_order_id: str) -> str:
        called["paypal_captured"] = True
        assert paypal_order_id == "PAYPAL-ORDER-1"
        return "CAPTURE-1"

    async def fake_send_order_confirmation(*args, **kwargs):
        called["order_email_sent"] = True
        return True

    async def fake_send_new_order_notification(*args, **kwargs):
        called["admin_email_sent"] = True
        return True

    from app.services import paypal as paypal_service  # imported by orders API

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)
    monkeypatch.setattr(paypal_service, "create_order", fake_paypal_create_order)
    monkeypatch.setattr(paypal_service, "capture_order", fake_paypal_capture_order)
    monkeypatch.setattr(email_service, "send_order_confirmation", fake_send_order_confirmation)
    monkeypatch.setattr(email_service, "send_new_order_notification", fake_send_new_order_notification)

    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "ppbuyer@example.com",
            "username": "ppbuyer",
            "password": "secret123",
            "name": "PP Buyer",
            "first_name": "PP",
            "last_name": "Buyer",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert register.status_code == 201, register.text
    token = register.json()["tokens"]["access_token"]
    user_id = register.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 1},
    )
    assert add_res.status_code in (200, 201), add_res.text

    checkout = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "line1": "123 Test St",
            "city": "Testville",
            "postal_code": "12345",
            "country": "US",
            "save_address": False,
            "payment_method": "paypal",
        },
    )
    assert checkout.status_code == 201, checkout.text
    body = checkout.json()
    assert body["payment_method"] == "paypal"
    assert body["paypal_order_id"] == "PAYPAL-ORDER-1"
    assert body["paypal_approval_url"] == "https://paypal.example/approve"
    assert called["stripe_called"] is False
    assert called["paypal_created"] is True
    assert called["order_email_sent"] is False
    assert called["admin_email_sent"] is False

    async def fetch_order() -> Order | None:
        async with SessionLocal() as session:
            return (await session.execute(select(Order).order_by(Order.created_at.desc()))).scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert order.payment_method == "paypal"
    assert order.paypal_order_id == "PAYPAL-ORDER-1"
    assert order.stripe_checkout_session_id is None

    # Capturing a signed-in order requires authentication.
    capture_anon = client.post("/api/v1/orders/paypal/capture", json={"paypal_order_id": "PAYPAL-ORDER-1"})
    assert capture_anon.status_code == 403, capture_anon.text

    capture = client.post(
        "/api/v1/orders/paypal/capture",
        headers={"Authorization": f"Bearer {token}"},
        json={"paypal_order_id": "PAYPAL-ORDER-1"},
    )
    assert capture.status_code == 200, capture.text
    # PayPal capture confirms payment, but order acceptance is still an admin action.
    assert capture.json()["status"] == "pending_acceptance"
    assert capture.json()["paypal_capture_id"] == "CAPTURE-1"
    assert called["paypal_captured"] is True
    assert called["order_email_sent"] is True
    assert called["admin_email_sent"] is True

    order2 = asyncio.run(fetch_order())
    assert order2 is not None
    assert order2.status.value == "pending_acceptance"
    assert order2.paypal_capture_id == "CAPTURE-1"


def test_paypal_webhook_captures_order_without_return(
    checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="ppwh", name="PayPal Webhook")
            owner = User(
                email="ownerwh@example.com",
                username="ownerwh",
                hashed_password=security.hash_password("Password123"),
                name="Owner",
                role=UserRole.owner,
                email_verified=True,
            )
            product = Product(
                category=category,
                slug="ppwh-prod",
                sku="PPWH-1",
                name="PayPal Webhook Product",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            session.add_all([owner, product])
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id}

    seeded = asyncio.run(seed())

    called: dict[str, int] = {"captured": 0, "order_email": 0, "admin_email": 0}

    async def fake_paypal_create_order(*, total_ron, reference, return_url, cancel_url, **_kwargs):
        assert str(reference)
        assert str(return_url).startswith("http")
        assert str(cancel_url).startswith("http")
        return "PAYPAL-ORDER-WH-1", "https://paypal.example/approve"

    async def fake_verify_webhook_signature(*, headers, event):
        return True

    async def fake_paypal_capture_order(*, paypal_order_id: str) -> str:
        called["captured"] += 1
        assert paypal_order_id == "PAYPAL-ORDER-WH-1"
        return "CAPTURE-WH-1"

    async def fake_send_order_confirmation(*args, **kwargs):
        called["order_email"] += 1
        return True

    async def fake_send_new_order_notification(*args, **kwargs):
        called["admin_email"] += 1
        return True

    from app.services import paypal as paypal_service  # imported by orders/payments APIs

    monkeypatch.setattr(paypal_service, "create_order", fake_paypal_create_order)
    monkeypatch.setattr(paypal_service, "verify_webhook_signature", fake_verify_webhook_signature)
    monkeypatch.setattr(paypal_service, "capture_order", fake_paypal_capture_order)
    monkeypatch.setattr(email_service, "send_order_confirmation", fake_send_order_confirmation)
    monkeypatch.setattr(email_service, "send_new_order_notification", fake_send_new_order_notification)

    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "ppwhbuyer@example.com",
            "username": "ppwhbuyer",
            "password": "secret123",
            "name": "PPWH Buyer",
            "first_name": "PPWH",
            "last_name": "Buyer",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert register.status_code == 201, register.text
    token = register.json()["tokens"]["access_token"]
    user_id = register.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 1},
    )
    assert add_res.status_code in (200, 201), add_res.text

    checkout = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "line1": "123 Test St",
            "city": "Testville",
            "postal_code": "12345",
            "country": "US",
            "save_address": False,
            "payment_method": "paypal",
        },
    )
    assert checkout.status_code == 201, checkout.text
    assert checkout.json()["paypal_order_id"] == "PAYPAL-ORDER-WH-1"

    async def fetch_order() -> Order | None:
        async with SessionLocal() as session:
            return (await session.execute(select(Order).order_by(Order.created_at.desc()))).scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert order.status.value == "pending_payment"
    assert order.paypal_capture_id is None

    evt = {"id": "WH-EVT-1", "event_type": "CHECKOUT.ORDER.APPROVED", "resource": {"id": "PAYPAL-ORDER-WH-1"}}
    webhook = client.post("/api/v1/payments/paypal/webhook", json=evt)
    assert webhook.status_code == 200, webhook.text
    assert called["captured"] == 1
    assert called["order_email"] == 1
    assert called["admin_email"] == 1

    order2 = asyncio.run(fetch_order())
    assert order2 is not None
    assert order2.status.value == "pending_acceptance"
    assert order2.paypal_capture_id == "CAPTURE-WH-1"

    # Idempotent: duplicates should not re-capture or resend.
    webhook2 = client.post("/api/v1/payments/paypal/webhook", json=evt)
    assert webhook2.status_code == 200, webhook2.text
    assert called["captured"] == 1
    assert called["order_email"] == 1
    assert called["admin_email"] == 1


def test_checkout_sends_admin_alert_fallback_when_no_owner(
    checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    monkeypatch.setattr(settings, "admin_alert_email", "ops@example.com")

    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="checkout2", name="Checkout2")
            product = Product(
                category=category,
                slug="checkout2-prod",
                sku="CHK-2",
                name="Checkout Product 2",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=10,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            shipping_method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Standard", rate_flat=5.0, rate_per_kg=0)
            )
            session.add(product)
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id, "shipping_method_id": shipping_method.id}

    seeded = asyncio.run(seed())

    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "buyer2@example.com",
            "username": "buyer2",
            "password": "secret123",
            "name": "Buyer2",
            "first_name": "Buyer",
            "last_name": "Two",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert register.status_code == 201, register.text
    token = register.json()["tokens"]["access_token"]
    user_id = register.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 1},
    )
    assert add_res.status_code in (200, 201), add_res.text

    captured: dict[str, object] = {}

    async def fake_create_checkout_session(
        *,
        amount_cents: int,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        lang: str | None = None,
        metadata: dict[str, str] | None = None,
        line_items: list[dict[str, object]] | None = None,
        discount_cents: int | None = None,
    ) -> dict:
        captured["amount_cents"] = amount_cents
        captured["stripe_customer_email"] = customer_email
        return {"session_id": "cs_test", "checkout_url": "https://stripe.example/checkout"}

    async def fake_send_new_order_notification(to_email, order, customer_email=None, lang=None):
        captured["admin_email"] = to_email
        captured["admin_customer_email"] = customer_email
        return True

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)
    monkeypatch.setattr(email_service, "send_new_order_notification", fake_send_new_order_notification)
    monkeypatch.setattr(email_service, "send_order_confirmation", lambda *_args, **_kwargs: True)

    res = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "line1": "123 Test St",
            "line2": None,
            "city": "Testville",
            "region": "TS",
            "postal_code": "12345",
            "country": "US",
            "shipping_method_id": str(seeded["shipping_method_id"]),
            "promo_code": None,
            "save_address": False,
        },
    )
    assert res.status_code == 201, res.text
    assert captured.get("admin_email") is None
    assert captured.get("admin_customer_email") is None

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(
        "app.services.payments.stripe.Webhook.construct_event",
        lambda payload, sig_header, secret: {
            "id": "evt_admin_fallback_1",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_test", "payment_intent": "pi_test", "payment_status": "paid"}},
        },
    )
    webhook = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert webhook.status_code == 200, webhook.text
    assert captured.get("admin_email") == "ops@example.com"
    assert captured.get("admin_customer_email") == "buyer2@example.com"
