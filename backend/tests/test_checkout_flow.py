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
from app.models.catalog import Category, Product, ProductImage
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


def test_guest_checkout_disabled(checkout_app: Dict[str, object]) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]

    payload = {
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
        "save_address": True,
    }
    res = client.post("/api/v1/orders/guest-checkout", json=payload, headers={"X-Session-Id": "guest-abc"})
    assert res.status_code == 410, res.text
    assert res.json().get("detail") == "Guest checkout disabled; please sign in"


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

    async def fake_create_payment_intent(session, cart, amount_cents=None):
        captured["amount_cents"] = amount_cents
        return {"client_secret": "secret_test", "intent_id": "pi_test"}

    async def fake_send_order_confirmation(to_email, order, items=None):
        captured["email"] = to_email
        return True

    async def fake_send_new_order_notification(to_email, order, customer_email=None, lang=None):
        captured["admin_email"] = to_email
        captured["admin_lang"] = lang
        captured["admin_customer_email"] = customer_email
        return True

    monkeypatch.setattr(payments, "create_payment_intent", fake_create_payment_intent)
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
    assert body["client_secret"] == "secret_test"
    # Subtotal: 2 * 50 = 100; discount 10% => 10; taxable 90; tax 9; shipping 10 => total 109 => cents 10900
    assert captured.get("amount_cents") == 10900
    assert captured.get("email") == "buyer@example.com"
    assert captured.get("admin_email") == "owner@example.com"
    assert captured.get("admin_customer_email") == "buyer@example.com"

    async def fetch_order():
        async with SessionLocal() as session:
            result = await session.execute(select(Order).order_by(Order.created_at.desc()))
            return result.scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert float(order.total_amount) == pytest.approx(109.0)
    assert order.stripe_payment_intent_id == "pi_test"


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

    async def fake_create_payment_intent(session, cart, amount_cents=None):
        captured["amount_cents"] = amount_cents
        return {"client_secret": "secret_test", "intent_id": "pi_test"}

    async def fake_send_new_order_notification(to_email, order, customer_email=None, lang=None):
        captured["admin_email"] = to_email
        captured["admin_customer_email"] = customer_email
        return True

    monkeypatch.setattr(payments, "create_payment_intent", fake_create_payment_intent)
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
            "promo_code": None,
            "save_address": False,
        },
    )
    assert res.status_code == 201, res.text
    assert captured.get("admin_email") == "ops@example.com"
    assert captured.get("admin_customer_email") == "buyer2@example.com"
