import asyncio
from decimal import Decimal
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductImage
from app.models.order import Order
from app.schemas.order import ShippingMethodCreate
from app.services import payments
from app.services import email as email_service
from app.services import order as order_service


@pytest.fixture
def full_app() -> Dict[str, object]:
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


def test_register_login_checkout_flow(full_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = full_app["client"]  # type: ignore[assignment]
    SessionLocal = full_app["session_factory"]  # type: ignore[assignment]

    # Seed catalog and shipping
    async def seed():
        async with SessionLocal() as session:
            category = Category(slug="flow", name="Flow")
            product = Product(
                category=category,
                slug="flow-prod",
                sku="FLOW-1",
                name="Flow Product",
                base_price=Decimal("25.00"),
                currency="RON",
                stock_quantity=5,
                images=[ProductImage(url="/media/flow.png", alt_text="flow")],
            )
            shipping = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Standard", rate_flat=5.0, rate_per_kg=0)
            )
            session.add_all([product])
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id, "shipping_id": shipping.id}

    seeded = asyncio.run(seed())

    captured: dict[str, object] = {}

    async def fake_create_payment_intent(session, cart, amount_cents=None):
        captured["amount_cents"] = amount_cents
        return {"client_secret": "secret_logged", "intent_id": "pi_logged"}

    async def fake_order_email(*args, **kwargs):
        captured["email_sent"] = True
        return True

    monkeypatch.setattr(payments, "create_payment_intent", fake_create_payment_intent)
    monkeypatch.setattr(email_service, "send_order_confirmation", fake_order_email)

    # Register and login
    reg = client.post(
        "/api/v1/auth/register",
        json={"email": "flow@example.com", "username": "flow", "password": "secret123", "name": "Flow"},
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["tokens"]["access_token"]

    # Add to cart
    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 2},
    )
    assert add_res.status_code in (200, 201), add_res.text

    # Create PaymentIntent (mocked)
    intent_res = client.post("/api/v1/payments/intent", headers={"Authorization": f"Bearer {token}"})
    assert intent_res.status_code == 200, intent_res.text
    assert intent_res.json().get("client_secret")

    # Checkout as authenticated user
    order_res = client.post(
        "/api/v1/orders",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shipping_method_id": str(seeded["shipping_id"]),
            "save_address": True,
            "line1": "123 Flow St",
            "city": "Flowtown",
            "region": "FT",
            "postal_code": "12345",
            "country": "US",
            "promo_code": None,
        },
    )
    assert order_res.status_code == 201, order_res.text
    body = order_res.json()
    assert body["id"]
    assert captured.get("email_sent") is True

    # Verify order is visible via API endpoints
    list_res = client.get("/api/v1/orders", headers={"Authorization": f"Bearer {token}"})
    assert list_res.status_code == 200, list_res.text
    ids = {o["id"] for o in list_res.json()}
    assert body["id"] in ids

    detail_res = client.get(f"/api/v1/orders/{body['id']}", headers={"Authorization": f"Bearer {token}"})
    assert detail_res.status_code == 200, detail_res.text
    assert detail_res.json()["id"] == body["id"]

    # Verify order persisted and tied to user
    async def fetch_order():
        async with SessionLocal() as session:
            result = await session.execute(select(Order).order_by(Order.created_at.desc()))
            return result.scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert order.user_id is not None
    assert float(order.total_amount) > 0
