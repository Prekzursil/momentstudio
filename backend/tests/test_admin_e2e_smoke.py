import asyncio
import io
import uuid
from typing import Dict
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.address import Address
from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product, ProductImage, ProductStatus
from app.models.order import Order, OrderEvent, OrderItem, OrderStatus
from app.models.promo import PromoCode
from app.models.user import User, UserRole
from app.services import storage
from sqlalchemy import select


@pytest.fixture(scope="module")
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal, "engine": engine}
    client.close()
    app.dependency_overrides.clear()


async def reset_db(engine) -> None:
    settings.maintenance_mode = False
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def seed_data(session_factory):
    async with session_factory() as session:
        await session.execute(delete(User))
        await session.execute(delete(Category))
        await session.execute(delete(Product))
        await session.execute(delete(Order))

        admin = User(
            email="admin@example.com",
            username="admin",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
        )
        session.add(admin)

        customer = User(
            email="customer@example.com",
            username="customer",
            hashed_password=security.hash_password("Password123"),
            name="Customer",
            role=UserRole.customer,
        )
        session.add(customer)

        category = Category(slug="art", name="Art", description="desc", sort_order=1)
        session.add(category)
        await session.flush()

        product = Product(
            slug="painting",
            name="Painting",
            base_price=100,
            currency="RON",
            category_id=category.id,
            stock_quantity=10,
            status=ProductStatus.published,
        )
        session.add(product)
        await session.flush()

        image = ProductImage(product_id=product.id, url="img1.jpg", sort_order=0)
        session.add(image)

        address = Address(user_id=customer.id, line1="123", city="City", country="US", postal_code="00000", label="Home")
        session.add(address)
        await session.flush()

        cart = Cart(user_id=customer.id)
        session.add(cart)
        await session.flush()
        session.add(CartItem(cart_id=cart.id, product_id=product.id, quantity=1, unit_price_at_add=product.base_price))

        order = Order(
            user_id=customer.id,
            status=OrderStatus.pending_acceptance,
            total_amount=100,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            customer_email=customer.email,
            customer_name=customer.name or customer.email,
            shipping_address_id=address.id,
        )
        session.add(order)
        await session.flush()
        session.add(OrderEvent(order_id=order.id, event="payment_captured", note="seed"))
        session.add(OrderItem(order_id=order.id, product_id=product.id, quantity=1, unit_price=100, subtotal=100))

        await session.commit()
        return {
            "product_slug": product.slug,
            "image_id": str(image.id),
            "order_id": str(order.id),
            "category_slug": category.slug,
        }


def auth_headers(client: TestClient) -> dict:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123", "name": "Admin"},
        headers={"X-Maintenance-Bypass": settings.maintenance_bypass_token},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


def test_admin_e2e_smoke(test_app: Dict[str, object], monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]

    asyncio.run(reset_db(engine))
    data = asyncio.run(seed_data(session_factory))
    headers = auth_headers(client)

    # Summary reachable
    summary = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert summary.status_code == 200

    # Change order status
    update = client.patch(f"/api/v1/orders/admin/{data['order_id']}", json={"status": "paid"}, headers=headers)
    assert update.status_code == 200
    assert update.json()["status"] == "paid"

    # Maintenance toggle on/off
    on = client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": True}, headers=headers)
    assert on.status_code == 200 and on.json()["enabled"] is True
    off = client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers)
    assert off.status_code == 200 and off.json()["enabled"] is False

    # Reorder category
    reorder = client.post(
        "/api/v1/catalog/categories/reorder",
        headers=headers,
        json=[{"slug": data["category_slug"], "sort_order": 3}],
    )
    assert reorder.status_code == 200
    assert reorder.json()[0]["sort_order"] == 3

    # Upload/delete product image (stub storage)
    def fake_save_upload(file, **kwargs):
        return (f"/media/{uuid4()}.jpg", "image.jpg")

    monkeypatch.setattr(storage, "save_upload", fake_save_upload)
    upload = client.post(
        f"/api/v1/catalog/products/{data['product_slug']}/images",
        headers=headers,
        files={"file": ("demo.jpg", io.BytesIO(b"img"), "image/jpeg")},
    )
    assert upload.status_code == 200
    new_images = upload.json()["images"]
    assert len(new_images) >= 2
    new_id = new_images[-1]["id"]

    delete_resp = client.delete(
        f"/api/v1/catalog/products/{data['product_slug']}/images/{new_id}", headers=headers
    )
    assert delete_resp.status_code == 200

    # Feed still reachable
    feed = client.get("/api/v1/feeds/products.json")
    assert feed.status_code == 200


def test_admin_coupon_usage_reflected(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed_data(session_factory))
    headers = auth_headers(client)

    created = client.post(
        "/api/v1/admin/dashboard/coupons",
        json={"code": "SAVE20", "active": True, "currency": "RON"},
        headers=headers,
    )
    assert created.status_code == 201
    coupon_id = uuid.UUID(created.json()["id"])

    async def _increment_usage():
        async with session_factory() as session:
            result = await session.execute(select(PromoCode).where(PromoCode.id == coupon_id))
            coupon = result.scalar_one_or_none()
            assert coupon is not None
            coupon.times_used = (coupon.times_used or 0) + 1
            await session.commit()

    asyncio.run(_increment_usage())

    coupons = client.get("/api/v1/admin/dashboard/coupons", headers=headers)
    assert coupons.status_code == 200
    body = coupons.json()
    match = next((c for c in body if c["code"] == "SAVE20"), None)
    assert match is not None
    assert match["times_used"] >= 1
