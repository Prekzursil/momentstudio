import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductImage, ProductStatus, ProductAuditLog
from app.models.content import ContentBlock, ContentStatus, ContentAuditLog
from app.models.order import Order, OrderStatus
from app.models.promo import PromoCode
from app.models.user import User, UserRole


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


async def seed(session_factory):
    async with session_factory() as session:
        await session.execute(delete(User))
        await session.execute(delete(Category))
        await session.execute(delete(Product))
        await session.execute(delete(Order))
        await session.execute(delete(PromoCode))
        await session.execute(delete(ProductAuditLog))
        await session.execute(delete(ContentBlock))
        await session.execute(delete(ContentAuditLog))

        admin = User(
            email="admin@example.com",
            username="admin",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
        )
        customer = User(
            email="customer@example.com",
            username="customer",
            hashed_password=security.hash_password("Password123"),
            name="Customer",
            role=UserRole.customer,
        )
        session.add_all([admin, customer])
        category = Category(slug="art", name="Art", sort_order=1)
        session.add(category)
        await session.flush()

        product = Product(
            slug="painting",
            name="Painting",
            base_price=50,
            currency="USD",
            category_id=category.id,
            stock_quantity=2,
            status=ProductStatus.published,
        )
        session.add(product)
        await session.flush()
        image = ProductImage(product_id=product.id, url="img.jpg", sort_order=0)
        session.add(image)
        session.add(ProductAuditLog(product_id=product.id, action="create", user_id=admin.id))

        order = Order(
            user_id=customer.id,
            status=OrderStatus.pending,
            total_amount=50,
            currency="USD",
            tax_amount=0,
            shipping_amount=0,
        )
        session.add(order)

        promo = PromoCode(code="SAVE5", percentage_off=5, currency="USD", active=True, max_uses=10)
        session.add(promo)

        block = ContentBlock(
            key="hero",
            title="Hero",
            body_markdown="Body",
            status=ContentStatus.published,
            version=1,
        )
        session.add(block)
        await session.flush()
        session.add(ContentAuditLog(content_block_id=block.id, action="publish", version=1, user_id=admin.id))

        await session.commit()
        return {"product_slug": product.slug, "image_id": str(image.id), "category_slug": category.slug}


def auth_headers(client: TestClient) -> dict:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123", "name": "Admin"},
        headers={"X-Maintenance-Bypass": settings.maintenance_bypass_token},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


def test_admin_filters_and_low_stock(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    orders = client.get("/api/v1/orders/admin", params={"status": "pending"}, headers=headers)
    assert orders.status_code == 200
    assert orders.json()[0]["status"] == "pending"

    low_stock = client.get("/api/v1/admin/dashboard/low-stock", headers=headers)
    assert low_stock.status_code == 200
    assert low_stock.json()[0]["stock_quantity"] == 2


def test_coupon_lifecycle_and_audit(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    created = client.post("/api/v1/admin/dashboard/coupons", headers=headers, json={"code": "NEW", "active": True})
    assert created.status_code == 201
    updated = client.patch(
        f"/api/v1/admin/dashboard/coupons/{created.json()['id']}",
        headers=headers,
        json={"active": False, "code": "NEW2"},
    )
    assert updated.status_code == 200
    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200
    assert audit.json()["products"]  # seeded audit exists
    assert audit.json()["content"]  # seeded content audit exists


def test_image_reorder(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    data = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    resp = client.patch(
        f"/api/v1/catalog/products/{data['product_slug']}/images/{data['image_id']}/sort",
        headers=headers,
        params={"sort_order": 5},
    )
    assert resp.status_code == 200
    assert any(img["sort_order"] == 5 for img in resp.json()["images"])
