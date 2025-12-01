import asyncio
from decimal import Decimal
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.catalog import Category, Product, ProductImage
from app.models.cart import Cart, CartItem
from app.models.order import Order
from app.services import cart as cart_service
from app.services import order as order_service
from app.services import payments
from app.services import email as email_service
from app.schemas.order import ShippingMethodCreate
from app.schemas.promo import PromoCodeCreate


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


def test_guest_checkout_promo_and_shipping(checkout_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = checkout_app["client"]  # type: ignore[assignment]
    SessionLocal = checkout_app["session_factory"]  # type: ignore[assignment]

    # Seed product, cart, shipping method, and promo
    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="checkout", name="Checkout")
            product = Product(
                category=category,
                slug="checkout-prod",
                sku="CHK-1",
                name="Checkout Product",
                base_price=Decimal("50.00"),
                currency="USD",
                stock_quantity=10,
                images=[ProductImage(url="/media/img1.png", alt_text="img")],
            )
            cart = Cart(session_id="guest-abc")
            cart.items = [
                CartItem(product=product, quantity=2, unit_price_at_add=Decimal("50.00")),
            ]
            shipping_method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Express", rate_flat=10.0, rate_per_kg=0)
            )
            await cart_service.create_promo(
                session,
                PromoCodeCreate(code="SAVE10", percentage_off=10, currency="USD"),
            )
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            return shipping_method.id

    shipping_method_id = asyncio.run(seed())

    captured: dict[str, object] = {}

    async def fake_create_payment_intent(session, cart, amount_cents=None):
        captured["amount_cents"] = amount_cents
        return {"client_secret": "secret_test", "intent_id": "pi_test"}

    async def fake_send_password_reset(to_email: str, token: str) -> bool:
        captured["reset_token"] = token
        captured["reset_email"] = to_email
        return True

    monkeypatch.setattr(payments, "create_payment_intent", fake_create_payment_intent)
    monkeypatch.setattr(email_service, "send_password_reset", fake_send_password_reset)

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
        "shipping_method_id": str(shipping_method_id),
        "promo_code": "SAVE10",
        "save_address": True,
    }
    res = client.post("/api/v1/orders/guest-checkout", json=payload, headers={"X-Session-Id": "guest-abc"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["client_secret"] == "secret_test"
    assert "order_id" in body
    # Subtotal: 2 * 50 = 100; discount 10% => 10; taxable 90; tax 9; shipping 10 => total 109 => cents 10900
    assert captured.get("amount_cents") == 10900
    assert captured.get("reset_email") == "guest@example.com"

    # Verify order totals stored in DB
    async def fetch_order():
        async with SessionLocal() as session:
            result = await session.execute(select(Order).order_by(Order.created_at.desc()))
            return result.scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert float(order.total_amount) == pytest.approx(109.0)
    assert order.stripe_payment_intent_id == "pi_test"
    assert captured.get("reset_token")
