import asyncio
from decimal import Decimal
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.catalog import Category, Product
from app.models.cart import Cart, CartItem
from app.models.order import OrderStatus
from app.models.user import UserRole
from app.services.auth import create_user, issue_tokens_for_user
from app.schemas.user import UserCreate
from app.services import order as order_service
from app.schemas.order import ShippingMethodCreate


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
    return {"Authorization": f"Bearer {token}"}


def create_user_token(session_factory, email="buyer@example.com", admin: bool = False):
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="orderpass", name="Buyer"))
            if admin:
                user.role = UserRole.admin
                await session.commit()
                await session.refresh(user)
            return issue_tokens_for_user(user)["access_token"], user.id

    return asyncio.run(create_and_token())


def seed_cart_with_product(session_factory, user_id: UUID) -> UUID:
    async def seed():
        async with session_factory() as session:
            category = Category(slug="orders", name="Orders")
            product = Product(
                category=category,
                slug="order-prod",
                sku="ORD-PROD",
                name="Order Product",
                base_price=Decimal("20.00"),
                currency="USD",
                stock_quantity=5,
            )
            cart = Cart(user_id=user_id)
            cart.items = [
                CartItem(product=product, quantity=1, unit_price_at_add=Decimal("20.00")),
            ]
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            return cart.id

    return asyncio.run(seed())


def test_order_create_and_admin_updates(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    admin_token, _ = create_user_token(SessionLocal, email="admin@example.com", admin=True)
    cart_id = seed_cart_with_product(SessionLocal, user_id)

    async def seed_shipping():
        async with SessionLocal() as session:
            method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Standard", rate_flat=5.0, rate_per_kg=0)
            )
            return method.id

    shipping_method_id = asyncio.run(seed_shipping())

    res = client.post(
        "/api/v1/orders",
        json={"shipping_method_id": str(shipping_method_id)},
        headers=auth_headers(token),
    )
    assert res.status_code == 201, res.text
    order = res.json()
    assert order["status"] == "pending"
    assert order["reference_code"]
    assert float(order["shipping_amount"]) >= 0
    order_id = order["id"]
    item_id = order["items"][0]["id"]

    retry = client.post(f"/api/v1/orders/admin/{order_id}/retry-payment", headers=auth_headers(admin_token))
    assert retry.status_code == 200
    assert retry.json()["payment_retry_count"] == 1
    assert any(evt["event"] == "payment_retry" for evt in retry.json()["events"])

    admin_list = client.get("/api/v1/orders/admin", headers=auth_headers(admin_token))
    assert admin_list.status_code == 200
    assert len(admin_list.json()) >= 1

    fulfill = client.post(
        f"/api/v1/orders/admin/{order_id}/items/{item_id}/fulfill",
        params={"shipped_quantity": 1},
        headers=auth_headers(admin_token),
    )
    assert fulfill.status_code == 200
    assert fulfill.json()["items"][0]["shipped_quantity"] == 1

    # invalid transition pending -> shipped
    bad = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "shipped"},
        headers=auth_headers(admin_token),
    )
    assert bad.status_code == 400

    ok = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "paid", "tracking_number": "TRACK123"},
        headers=auth_headers(admin_token),
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "paid"
    assert ok.json()["tracking_number"] == "TRACK123"

    final = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "shipped"},
        headers=auth_headers(admin_token),
    )
    assert final.status_code == 200
    assert final.json()["status"] == "shipped"

    refund = client.post(
        f"/api/v1/orders/admin/{order_id}/refund",
        params={"note": "Customer requested refund"},
        headers=auth_headers(admin_token),
    )
    assert refund.status_code == 200
    assert refund.json()["status"] == "refunded"
    assert any(evt["event"] == "refund_requested" for evt in refund.json()["events"])

    events = client.get(f"/api/v1/orders/admin/{order_id}/events", headers=auth_headers(admin_token))
    assert events.status_code == 200
    assert len(events.json()) >= 4

    packing = client.get(f"/api/v1/orders/admin/{order_id}/packing-slip", headers=auth_headers(admin_token))
    assert packing.status_code == 200
    assert "Packing slip for order" in packing.text
    assert "Items:" in packing.text
