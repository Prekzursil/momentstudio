import asyncio
from datetime import datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductImage, ProductAuditLog, ProductStatus
from app.models.content import ContentAuditLog, ContentBlock, ContentStatus
from app.models.order import Order, OrderStatus
from app.models.promo import PromoCode
from app.models.user import RefreshSession, User, UserRole


@pytest.fixture(scope="module")
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
    yield {"client": client, "session_factory": SessionLocal, "engine": engine}
    client.close()
    app.dependency_overrides.clear()


async def seed_admin(session_factory):
    settings.maintenance_mode = False
    async with session_factory() as session:
        await session.execute(delete(User).where(User.email == "admin@example.com"))
        admin = User(
            email="admin@example.com",
            username="admin",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
        )
        session.add(admin)
        await session.commit()


async def seed_owner(session_factory):
    settings.maintenance_mode = False
    async with session_factory() as session:
        await session.execute(delete(User).where(User.email == "owner@example.com"))
        owner = User(
            email="owner@example.com",
            username="owner",
            hashed_password=security.hash_password("Password123"),
            name="Owner",
            role=UserRole.owner,
        )
        session.add(owner)
        await session.commit()


def auth_headers(client: TestClient, session_factory) -> dict:
    asyncio.run(seed_admin(session_factory))
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


def owner_headers(client: TestClient, session_factory) -> dict:
    asyncio.run(seed_owner(session_factory))
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


async def reset_db(engine) -> None:
    settings.maintenance_mode = False
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def seed_dashboard_data(session_factory):
    async with session_factory() as session:
        cat = Category(slug="art", name="Art", description="desc", sort_order=1)
        session.add(cat)
        product = Product(
            slug="painting",
            name="Painting",
            base_price=100,
            currency="RON",
            category=cat,
            stock_quantity=10,
            status=ProductStatus.published,
        )
        image = ProductImage(url="img.jpg", sort_order=0)
        product.images = [image]
        session.add(product)
        await session.flush()
        session.add(ProductAuditLog(product_id=product.id, action="update"))

        block = ContentBlock(
            key="home-hero",
            title="Hero",
            body_markdown="Hello",
            status=ContentStatus.published,
            version=1,
        )
        session.add(block)
        await session.flush()
        session.add(ContentAuditLog(content_block_id=block.id, action="publish", version=1))

        promo = PromoCode(code="SAVE10", percentage_off=10, currency="RON", active=True, max_uses=5)
        session.add(promo)

        user = User(
            email="user@example.com",
            username="user",
            hashed_password=security.hash_password("Password123"),
            name="Customer",
            role=UserRole.customer,
        )
        session.add(user)
        await session.flush()
        session.add(RefreshSession(user_id=user.id, jti="jti-1", expires_at=datetime.now(timezone.utc)))

        order = Order(
            user_id=user.id,
            status=OrderStatus.pending,
            total_amount=50,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
        )
        session.add(order)
        await session.commit()

        return {
            "product_slug": product.slug,
            "image_id": str(image.id),
            "category_slug": cat.slug,
            "user_id": user.id,
        }


def test_admin_summary(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    headers = auth_headers(client, session_factory)
    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "products" in data and "orders" in data and "users" in data


def test_admin_maintenance_toggle(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    headers = auth_headers(client, session_factory)
    resp = client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": True}, headers=headers)
    assert resp.status_code == 200
    assert resp.json().get("enabled") is True
    resp_off = client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers)
    assert resp_off.status_code == 200
    assert resp_off.json().get("enabled") is False
    resp_get = client.get("/api/v1/admin/dashboard/maintenance", headers=headers)
    assert resp_get.status_code == 200
    assert resp_get.json().get("enabled") is False


def test_sitemap_and_robots(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    headers = auth_headers(client, test_app["session_factory"])  # type: ignore[arg-type]
    client.post("/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers)
    resp = client.get("/api/v1/sitemap.xml")
    assert resp.status_code == 200
    assert "<urlset" in resp.text
    robots = client.get("/api/v1/robots.txt")
    assert robots.status_code == 200
    assert "Sitemap:" in robots.text


def test_admin_lists_and_audit_and_feed(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_dashboard_data(session_factory))

    products = client.get("/api/v1/admin/dashboard/products", headers=headers)
    assert products.status_code == 200
    assert products.json()[0]["category"] == "Art"

    orders = client.get("/api/v1/admin/dashboard/orders", headers=headers)
    assert orders.status_code == 200
    assert orders.json()[0]["customer"] == "user@example.com"

    users = client.get("/api/v1/admin/dashboard/users", headers=headers)
    assert users.status_code == 200
    emails = [u["email"] for u in users.json()]
    assert "admin@example.com" in emails and "user@example.com" in emails

    content = client.get("/api/v1/admin/dashboard/content", headers=headers)
    assert content.status_code == 200
    assert content.json()[0]["key"] == "home-hero"

    coupons = client.get("/api/v1/admin/dashboard/coupons", headers=headers)
    assert coupons.status_code == 200
    assert coupons.json()[0]["code"] == "SAVE10"

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200
    assert audit.json()["products"]
    assert audit.json()["content"]

    feed = client.get("/api/v1/feeds/products.json")
    assert feed.status_code == 200
    assert any(item["slug"] == data["product_slug"] for item in feed.json())


def test_category_and_image_reorder(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_dashboard_data(session_factory))

    reorder = client.post(
        "/api/v1/catalog/categories/reorder",
        headers=headers,
        json=[{"slug": data["category_slug"], "sort_order": 5}],
    )
    assert reorder.status_code == 200
    assert reorder.json()[0]["sort_order"] == 5

    image_reorder = client.patch(
        f"/api/v1/catalog/products/{data['product_slug']}/images/{data['image_id']}/sort",
        headers=headers,
        params={"sort_order": 2},
    )
    assert image_reorder.status_code == 200
    images = image_reorder.json()["images"]
    assert any(img["sort_order"] == 2 for img in images)


def test_revoke_sessions_and_update_role(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_dashboard_data(session_factory))

    revoke = client.post(f"/api/v1/admin/dashboard/sessions/{data['user_id']}/revoke", headers=headers)
    assert revoke.status_code == 204
    role_update = client.patch(
        f"/api/v1/admin/dashboard/users/{data['user_id']}/role",
        headers=headers,
        json={"role": UserRole.admin.value},
    )
    assert role_update.status_code == 200
    assert role_update.json()["role"] == UserRole.admin.value

    async def _check_revoked() -> bool:
        async with session_factory() as session:
            result = await session.execute(
                select(RefreshSession.revoked).where(RefreshSession.user_id == data["user_id"])
            )
            flags = [row[0] for row in result.all()]
            return all(flags) if flags else False

    assert asyncio.run(_check_revoked())


def test_owner_can_access_admin_dashboard(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = owner_headers(client, session_factory)

    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200, resp.text


def test_owner_role_cannot_be_changed_via_admin_role_endpoint(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = owner_headers(client, session_factory)

    async def _owner_id() -> str:
        async with session_factory() as session:
            owner = (await session.execute(select(User).where(User.email == "owner@example.com"))).scalar_one()
            return str(owner.id)

    owner_id = asyncio.run(_owner_id())
    update = client.patch(
        f"/api/v1/admin/dashboard/users/{owner_id}/role",
        headers=headers,
        json={"role": UserRole.customer.value},
    )
    assert update.status_code == 400


def test_owner_can_transfer_ownership(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = owner_headers(client, session_factory)

    async def _seed_target() -> None:
        async with session_factory() as session:
            user = User(
                email="target@example.com",
                username="target",
                hashed_password=security.hash_password("Password123"),
                name="Target",
                role=UserRole.customer,
            )
            session.add(user)
            await session.commit()

    asyncio.run(_seed_target())

    transfer = client.post(
        "/api/v1/admin/dashboard/owner/transfer",
        headers=headers,
        json={"identifier": "target"},
    )
    assert transfer.status_code == 200, transfer.text

    async def _roles() -> tuple[UserRole, UserRole]:
        async with session_factory() as session:
            owner = (await session.execute(select(User).where(User.email == "owner@example.com"))).scalar_one()
            target = (await session.execute(select(User).where(User.email == "target@example.com"))).scalar_one()
            return owner.role, target.role

    old_role, new_role = asyncio.run(_roles())
    assert old_role == UserRole.admin
    assert new_role == UserRole.owner
