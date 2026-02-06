import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import (
    Category,
    Product,
    ProductImage,
    ProductAuditLog,
    ProductStatus,
)
from app.models.cart import Cart, CartItem
from app.models.content import ContentAuditLog, ContentBlock, ContentStatus
from app.models.coupons_v2 import Promotion, PromotionDiscountType
from app.models.order import Order, OrderItem, OrderStatus
from app.models.promo import PromoCode
from app.models.passkeys import UserPasskey
from app.models.user import AdminAuditLog, RefreshSession, User, UserRole


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
        await session.flush()
        session.add(
            UserPasskey(
                user_id=admin.id,
                name="Test Passkey",
                credential_id=f"cred-{admin.id}",
                public_key=b"test",
                sign_count=0,
                backed_up=False,
            )
        )
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
        await session.flush()
        session.add(
            UserPasskey(
                user_id=owner.id,
                name="Test Passkey",
                credential_id=f"cred-{owner.id}",
                public_key=b"test",
                sign_count=0,
                backed_up=False,
            )
        )
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
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Maintenance-Bypass": settings.maintenance_bypass_token,
    }
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


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
    return {
        "Authorization": f"Bearer {token}",
        "X-Maintenance-Bypass": settings.maintenance_bypass_token,
    }


async def reset_db(engine) -> None:
    settings.maintenance_mode = False
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def seed_dashboard_data(session_factory):
    async with session_factory() as session:
        admin = (
            await session.execute(select(User).where(User.email == "admin@example.com"))
        ).scalar_one_or_none()
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
        session.add(
            ProductAuditLog(
                product_id=product.id,
                action="update",
                user_id=getattr(admin, "id", None),
            )
        )

        block = ContentBlock(
            key="home-hero",
            title="Hero",
            body_markdown="Hello",
            status=ContentStatus.published,
            version=1,
        )
        session.add(block)
        await session.flush()
        session.add(
            ContentAuditLog(
                content_block_id=block.id,
                action="publish",
                version=1,
                user_id=getattr(admin, "id", None),
            )
        )

        promo = PromoCode(
            code="SAVE10", percentage_off=10, currency="RON", active=True, max_uses=5
        )
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
        session.add(
            RefreshSession(
                user_id=user.id, jti="jti-1", expires_at=datetime.now(timezone.utc)
            )
        )

        order = Order(
            user_id=user.id,
            status=OrderStatus.pending_acceptance,
            total_amount=50,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            customer_email=user.email,
            customer_name=user.name or user.email,
        )
        session.add(order)
        if admin:
            session.add(
                AdminAuditLog(
                    action="test",
                    actor_user_id=admin.id,
                    subject_user_id=user.id,
                    data={"identifier": user.email},
                )
            )
        await session.commit()

        return {
            "product_slug": product.slug,
            "image_id": str(image.id),
            "category_slug": cat.slug,
            "user_id": user.id,
        }


async def seed_inventory_data(session_factory):
    async with session_factory() as session:
        cat = Category(
            slug="inventory",
            name="Inventory",
            description="desc",
            sort_order=1,
            low_stock_threshold=5,
        )
        session.add(cat)

        product_a = Product(
            slug="inventory-product-a",
            name="Inventory product A",
            base_price=Decimal("100.00"),
            currency="RON",
            category=cat,
            stock_quantity=10,
            status=ProductStatus.published,
        )
        product_b = Product(
            slug="inventory-product-b",
            name="Inventory product B",
            base_price=Decimal("50.00"),
            currency="RON",
            category=cat,
            stock_quantity=20,
            status=ProductStatus.published,
        )
        session.add_all([product_a, product_b])
        await session.flush()

        cart = Cart(session_id="session-1", updated_at=datetime.now(timezone.utc))
        cart.items.append(
            CartItem(
                product_id=product_a.id,
                variant_id=None,
                quantity=2,
                unit_price_at_add=float(product_a.base_price),
            )
        )
        session.add(cart)

        order = Order(
            user_id=None,
            status=OrderStatus.pending_acceptance,
            total_amount=Decimal("0.00"),
            currency="RON",
            tax_amount=Decimal("0.00"),
            shipping_amount=Decimal("0.00"),
            customer_email="buyer@example.com",
            customer_name="Buyer",
        )
        order.items.append(
            OrderItem(
                product_id=product_a.id,
                variant_id=None,
                quantity=5,
                shipped_quantity=1,
                unit_price=Decimal("100.00"),
                subtotal=Decimal("500.00"),
            )
        )
        session.add(order)
        await session.commit()

        return {
            "product_a_id": str(product_a.id),
            "product_a_slug": product_a.slug,
            "product_b_id": str(product_b.id),
            "product_b_slug": product_b.slug,
        }


def test_admin_summary(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    headers = auth_headers(client, session_factory)
    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "products" in data and "orders" in data and "users" in data


def test_admin_dashboard_alert_thresholds_endpoints(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    admin_headers = auth_headers(client, session_factory)
    owner = owner_headers(client, session_factory)

    resp = client.get("/api/v1/admin/dashboard/alert-thresholds", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["failed_payments_min_count"] == 1
    assert payload["refund_requests_min_count"] == 1
    assert payload["stockouts_min_count"] == 1

    denied = client.put(
        "/api/v1/admin/dashboard/alert-thresholds",
        headers=admin_headers,
        json={
            "failed_payments_min_count": 3,
            "failed_payments_min_delta_pct": 150,
            "refund_requests_min_count": 2,
            "refund_requests_min_rate_pct": 25,
            "stockouts_min_count": 4,
        },
    )
    assert denied.status_code in (401, 403), denied.text

    updated = client.put(
        "/api/v1/admin/dashboard/alert-thresholds",
        headers=owner,
        json={
            "failed_payments_min_count": 3,
            "failed_payments_min_delta_pct": 150,
            "refund_requests_min_count": 2,
            "refund_requests_min_rate_pct": 25,
            "stockouts_min_count": 4,
        },
    )
    assert updated.status_code == 200, updated.text
    updated_payload = updated.json()
    assert updated_payload["failed_payments_min_count"] == 3
    assert updated_payload["refund_requests_min_count"] == 2
    assert updated_payload["stockouts_min_count"] == 4

    summary = client.get("/api/v1/admin/dashboard/summary", headers=admin_headers)
    assert summary.status_code == 200, summary.text
    summary_payload = summary.json()
    assert summary_payload["alert_thresholds"]["failed_payments_min_count"] == 3
    assert "is_alert" in summary_payload["anomalies"]["failed_payments"]
    assert "is_alert" in summary_payload["anomalies"]["refund_requests"]
    assert "is_alert" in summary_payload["anomalies"]["stockouts"]


def test_admin_maintenance_toggle(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    headers = auth_headers(client, session_factory)
    resp = client.post(
        "/api/v1/admin/dashboard/maintenance", json={"enabled": True}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json().get("enabled") is True
    resp_off = client.post(
        "/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers
    )
    assert resp_off.status_code == 200
    assert resp_off.json().get("enabled") is False
    resp_get = client.get("/api/v1/admin/dashboard/maintenance", headers=headers)
    assert resp_get.status_code == 200
    assert resp_get.json().get("enabled") is False


def test_sitemap_and_robots(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    headers = auth_headers(client, test_app["session_factory"])  # type: ignore[arg-type]
    client.post(
        "/api/v1/admin/dashboard/maintenance", json={"enabled": False}, headers=headers
    )
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

    masked_orders = client.get("/api/v1/admin/dashboard/orders", headers=headers)
    assert masked_orders.status_code == 200
    assert masked_orders.json()[0]["customer"] != "user@example.com"
    assert "*" in masked_orders.json()[0]["customer"]

    orders = client.get("/api/v1/admin/dashboard/orders", headers=headers, params={"include_pii": True})
    assert orders.status_code == 200
    assert orders.json()[0]["customer"] == "user@example.com"

    masked_users = client.get("/api/v1/admin/dashboard/users", headers=headers)
    assert masked_users.status_code == 200
    assert "user@example.com" not in [u["email"] for u in masked_users.json()]

    users = client.get("/api/v1/admin/dashboard/users", headers=headers, params={"include_pii": True})
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


def test_admin_global_search(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_dashboard_data(session_factory))

    resp_products = client.get(
        "/api/v1/admin/dashboard/search",
        params={"q": data["product_slug"]},
        headers=headers,
    )
    assert resp_products.status_code == 200
    items = resp_products.json()["items"]
    assert any(
        item["type"] == "product" and item.get("slug") == data["product_slug"]
        for item in items
    )

    resp_users_masked = client.get(
        "/api/v1/admin/dashboard/search",
        params={"q": "user@example.com"},
        headers=headers,
    )
    assert resp_users_masked.status_code == 200
    masked_user_items = resp_users_masked.json()["items"]
    masked_email = next((item.get("email") for item in masked_user_items if item["type"] == "user"), None)
    assert masked_email is not None and masked_email != "user@example.com"
    assert "*" in masked_email

    resp_users = client.get(
        "/api/v1/admin/dashboard/search",
        params={"q": "user@example.com", "include_pii": True},
        headers=headers,
    )
    assert resp_users.status_code == 200
    user_items = resp_users.json()["items"]
    assert any(
        item["type"] == "user" and item.get("email") == "user@example.com"
        for item in user_items
    )
    assert any(item["type"] == "order" for item in user_items)

    async def _order_id() -> str:
        async with session_factory() as session:
            order = (
                await session.execute(
                    select(Order).where(Order.customer_email == "user@example.com")
                )
            ).scalar_one()
            return str(order.id)

    order_id = asyncio.run(_order_id())
    resp_order = client.get(
        "/api/v1/admin/dashboard/search", params={"q": order_id}, headers=headers
    )
    assert resp_order.status_code == 200
    order_items = resp_order.json()["items"]
    assert any(
        item["type"] == "order" and item["id"] == order_id for item in order_items
    )


def test_admin_audit_entries_filters_and_export(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    asyncio.run(seed_dashboard_data(session_factory))

    entries = client.get("/api/v1/admin/dashboard/audit/entries", headers=headers)
    assert entries.status_code == 200, entries.text
    payload = entries.json()
    assert payload["items"]
    assert payload["meta"]["total_items"] >= len(payload["items"])

    only_products = client.get(
        "/api/v1/admin/dashboard/audit/entries",
        headers=headers,
        params={"entity": "product"},
    )
    assert only_products.status_code == 200, only_products.text
    assert all(item["entity"] == "product" for item in only_products.json()["items"])

    only_security = client.get(
        "/api/v1/admin/dashboard/audit/entries",
        headers=headers,
        params={"entity": "security"},
    )
    assert only_security.status_code == 200, only_security.text
    assert all(item["entity"] == "security" for item in only_security.json()["items"])

    by_actor = client.get(
        "/api/v1/admin/dashboard/audit/entries",
        headers=headers,
        params={"user": "admin@example.com"},
    )
    assert by_actor.status_code == 200, by_actor.text
    assert by_actor.json()["items"]

    by_action = client.get(
        "/api/v1/admin/dashboard/audit/entries",
        headers=headers,
        params={"action": "update,test"},
    )
    assert by_action.status_code == 200, by_action.text
    items = by_action.json()["items"]
    assert items
    assert all(
        any(token in (item.get("action") or "").lower() for token in ["update", "test"]) for item in items
    )

    csv_resp = client.get(
        "/api/v1/admin/dashboard/audit/export.csv",
        headers=headers,
        params={"entity": "security"},
    )
    assert csv_resp.status_code == 200, csv_resp.text
    assert "text/csv" in csv_resp.headers.get("content-type", "")
    assert csv_resp.text.splitlines()[0].startswith("created_at,entity,action")
    assert "admin@example.com" not in csv_resp.text
    assert "user@example.com" not in csv_resp.text


def test_admin_audit_retention_status_and_purge(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))

    headers_admin = auth_headers(client, session_factory)
    headers_owner = owner_headers(client, session_factory)
    asyncio.run(seed_dashboard_data(session_factory))

    async def _seed_old_audit_rows() -> None:
        async with session_factory() as session:
            admin = (
                await session.execute(select(User).where(User.email == "admin@example.com"))
            ).scalar_one()
            product = (await session.execute(select(Product).where(Product.slug == "painting"))).scalar_one()
            block = (await session.execute(select(ContentBlock).where(ContentBlock.key == "home-hero"))).scalar_one()

            old_at = datetime.now(timezone.utc) - timedelta(days=10)
            session.add(
                ProductAuditLog(product_id=product.id, action="retention-old", user_id=admin.id, created_at=old_at)
            )
            session.add(
                ContentAuditLog(
                    content_block_id=block.id,
                    action="retention-old",
                    version=block.version,
                    user_id=admin.id,
                    created_at=old_at,
                )
            )
            session.add(
                AdminAuditLog(action="retention-old", actor_user_id=admin.id, data={"note": "user@example.com"}, created_at=old_at)
            )
            await session.commit()

    asyncio.run(_seed_old_audit_rows())

    old_product_days = getattr(settings, "audit_retention_days_product", 0)
    old_content_days = getattr(settings, "audit_retention_days_content", 0)
    old_security_days = getattr(settings, "audit_retention_days_security", 0)
    settings.audit_retention_days_product = 1
    settings.audit_retention_days_content = 1
    settings.audit_retention_days_security = 1
    try:
        status_resp = client.get("/api/v1/admin/dashboard/audit/retention", headers=headers_admin)
        assert status_resp.status_code == 200, status_resp.text
        status_payload = status_resp.json()
        assert status_payload["counts"]["product"]["expired"] >= 1
        assert status_payload["counts"]["content"]["expired"] >= 1
        assert status_payload["counts"]["security"]["expired"] >= 1

        dry_run = client.post(
            "/api/v1/admin/dashboard/audit/retention/purge",
            headers=headers_owner,
            json={"confirm": "PURGE", "dry_run": True},
        )
        assert dry_run.status_code == 200, dry_run.text
        assert dry_run.json()["deleted"]["product"] == 0

        purge_resp = client.post(
            "/api/v1/admin/dashboard/audit/retention/purge",
            headers=headers_owner,
            json={"confirm": "PURGE"},
        )
        assert purge_resp.status_code == 200, purge_resp.text
        assert purge_resp.json()["deleted"]["product"] >= 1

        post_status = client.get("/api/v1/admin/dashboard/audit/retention", headers=headers_admin)
        assert post_status.status_code == 200, post_status.text
        post_payload = post_status.json()
        assert post_payload["counts"]["product"]["expired"] == 0
        assert post_payload["counts"]["content"]["expired"] == 0
        assert post_payload["counts"]["security"]["expired"] == 0
    finally:
        settings.audit_retention_days_product = old_product_days
        settings.audit_retention_days_content = old_content_days
        settings.audit_retention_days_security = old_security_days


def test_admin_scheduled_tasks_overview(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    asyncio.run(seed_dashboard_data(session_factory))

    async def _seed_scheduled() -> tuple[str, str]:
        async with session_factory() as session:
            cat = (
                await session.execute(select(Category).where(Category.slug == "art"))
            ).scalar_one()
            now = datetime.now(timezone.utc)
            scheduled_product = Product(
                slug="scheduled-product",
                name="Scheduled Product",
                base_price=Decimal("10.00"),
                currency="RON",
                category=cat,
                stock_quantity=10,
                status=ProductStatus.draft,
                sale_type="percent",
                sale_value=Decimal("10.00"),
                sale_price=Decimal("9.00"),
                sale_start_at=now + timedelta(days=1),
                sale_end_at=now + timedelta(days=2),
                sale_auto_publish=True,
            )
            session.add(scheduled_product)

            promo = Promotion(
                name="Scheduled promo",
                description="desc",
                discount_type=PromotionDiscountType.percent,
                percentage_off=Decimal("5.00"),
                allow_on_sale_items=True,
                is_active=True,
                starts_at=now + timedelta(days=3),
                ends_at=now + timedelta(days=4),
                is_automatic=False,
            )
            session.add(promo)
            await session.commit()
            return scheduled_product.slug, str(promo.id)

    product_slug, promo_id = asyncio.run(_seed_scheduled())

    resp = client.get("/api/v1/admin/dashboard/scheduled-tasks", headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert any(item["slug"] == product_slug for item in payload["publish_schedules"])
    assert any(item["id"] == promo_id for item in payload["promo_schedules"])


def test_low_stock_threshold_overrides(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)

    async def _seed_thresholds() -> None:
        async with session_factory() as session:
            cat = Category(
                slug="thresholds",
                name="Thresholds",
                low_stock_threshold=10,
                sort_order=1,
            )
            session.add(cat)
            session.add(
                Product(
                    slug="cat-threshold",
                    name="Cat threshold",
                    base_price=Decimal("10.00"),
                    currency="RON",
                    category=cat,
                    stock_quantity=9,
                    status=ProductStatus.published,
                )
            )
            session.add(
                Product(
                    slug="product-override",
                    name="Product override",
                    base_price=Decimal("10.00"),
                    currency="RON",
                    category=cat,
                    stock_quantity=4,
                    low_stock_threshold=3,
                    status=ProductStatus.published,
                )
            )
            await session.commit()

    asyncio.run(_seed_thresholds())

    summary = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json()["low_stock"] == 1

    low_stock = client.get("/api/v1/admin/dashboard/low-stock", headers=headers)
    assert low_stock.status_code == 200, low_stock.text
    items = low_stock.json()
    assert len(items) == 1
    assert items[0]["slug"] == "cat-threshold"
    assert items[0]["threshold"] == 10


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

    revoke = client.post(
        f"/api/v1/admin/dashboard/sessions/{data['user_id']}/revoke", headers=headers
    )
    assert revoke.status_code == 204
    role_update = client.patch(
        f"/api/v1/admin/dashboard/users/{data['user_id']}/role",
        headers=headers,
        json={"role": UserRole.admin.value, "password": "Password123"},
    )
    assert role_update.status_code == 200
    assert role_update.json()["role"] == UserRole.admin.value

    async def _check_revoked() -> bool:
        async with session_factory() as session:
            result = await session.execute(
                select(RefreshSession.revoked).where(
                    RefreshSession.user_id == data["user_id"]
                )
            )
            flags = [row[0] for row in result.all()]
            return all(flags) if flags else False

    assert asyncio.run(_check_revoked())


def test_inventory_restock_list_shows_reserved_stock(
    test_app: Dict[str, object],
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_inventory_data(session_factory))

    resp = client.get(
        "/api/v1/admin/dashboard/inventory/restock-list",
        headers=headers,
        params={"include_variants": False, "default_threshold": 5},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    items = body["items"]
    match = next(
        (
            item
            for item in items
            if item["product_slug"] == data["product_a_slug"]
            and item["kind"] == "product"
        ),
        None,
    )
    assert match is not None
    assert match["reserved_in_carts"] == 2
    assert match["reserved_in_orders"] == 4
    assert match["available_quantity"] == 4
    assert match["threshold"] == 5


def test_inventory_reserved_carts_drilldown_masks_email_by_default(
    test_app: Dict[str, object],
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_inventory_data(session_factory))

    async def _seed_cart_with_guest_email() -> None:
        async with session_factory() as session:
            product = (
                await session.execute(
                    select(Product).where(Product.slug == data["product_a_slug"])
                )
            ).scalar_one()
            cart = Cart(
                session_id="session-with-email",
                guest_email="guestbuyer@example.com",
                updated_at=datetime.now(timezone.utc),
            )
            cart.items.append(
                CartItem(
                    product_id=product.id,
                    variant_id=None,
                    quantity=1,
                    unit_price_at_add=float(product.base_price),
                )
            )
            session.add(cart)
            await session.commit()

    asyncio.run(_seed_cart_with_guest_email())

    resp = client.get(
        "/api/v1/admin/dashboard/inventory/reservations/carts",
        headers=headers,
        params={"product_id": data["product_a_id"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["cutoff"]
    items = body["items"]
    assert len(items) >= 1

    cart_with_email = next(
        (item for item in items if item.get("customer_email")), None
    )
    assert cart_with_email is not None
    assert cart_with_email["customer_email"] != "guestbuyer@example.com"
    assert cart_with_email["customer_email"].endswith("@example.com")

    resp_pii = client.get(
        "/api/v1/admin/dashboard/inventory/reservations/carts",
        headers=headers,
        params={"product_id": data["product_a_id"], "include_pii": True},
    )
    assert resp_pii.status_code == 200, resp_pii.text
    pii_items = resp_pii.json()["items"]
    pii_match = next(
        (item for item in pii_items if item.get("cart_id") == cart_with_email["cart_id"]),
        None,
    )
    assert pii_match is not None
    assert pii_match["customer_email"] == "guestbuyer@example.com"


def test_inventory_reserved_orders_drilldown_masks_email_by_default(
    test_app: Dict[str, object],
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_inventory_data(session_factory))

    resp = client.get(
        "/api/v1/admin/dashboard/inventory/reservations/orders",
        headers=headers,
        params={"product_id": data["product_a_id"]},
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["quantity"] == 4
    assert item["status"] == OrderStatus.pending_acceptance.value
    assert item["customer_email"] != "buyer@example.com"
    assert item["customer_email"].endswith("@example.com")

    resp_pii = client.get(
        "/api/v1/admin/dashboard/inventory/reservations/orders",
        headers=headers,
        params={"product_id": data["product_a_id"], "include_pii": True},
    )
    assert resp_pii.status_code == 200, resp_pii.text
    pii_items = resp_pii.json()["items"]
    assert pii_items[0]["customer_email"] == "buyer@example.com"

    invalid_variant = client.get(
        "/api/v1/admin/dashboard/inventory/reservations/orders",
        headers=headers,
        params={"product_id": data["product_a_id"], "variant_id": str(uuid.uuid4())},
    )
    assert invalid_variant.status_code == 400, invalid_variant.text


def test_inventory_restock_note_queue_and_clear(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_inventory_data(session_factory))

    upsert = client.put(
        "/api/v1/admin/dashboard/inventory/restock-notes",
        headers=headers,
        json={
            "product_id": data["product_b_id"],
            "variant_id": None,
            "supplier": "Supplier A",
            "desired_quantity": 12,
            "note": "Call before ordering",
        },
    )
    assert upsert.status_code == 200, upsert.text
    note = upsert.json()
    assert note["supplier"] == "Supplier A"
    assert note["desired_quantity"] == 12

    restock_list = client.get(
        "/api/v1/admin/dashboard/inventory/restock-list",
        headers=headers,
        params={"include_variants": False, "default_threshold": 5},
    )
    assert restock_list.status_code == 200, restock_list.text
    assert any(
        item["product_slug"] == data["product_b_slug"]
        for item in restock_list.json()["items"]
    )

    clear = client.put(
        "/api/v1/admin/dashboard/inventory/restock-notes",
        headers=headers,
        json={
            "product_id": data["product_b_id"],
            "variant_id": None,
            "supplier": None,
            "desired_quantity": None,
            "note": None,
        },
    )
    assert clear.status_code == 200, clear.text
    assert clear.json() is None

    after = client.get(
        "/api/v1/admin/dashboard/inventory/restock-list",
        headers=headers,
        params={"include_variants": False, "default_threshold": 5},
    )
    assert after.status_code == 200, after.text
    assert not any(
        item["product_slug"] == data["product_b_slug"] for item in after.json()["items"]
    )


def test_inventory_restock_list_export_csv(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = auth_headers(client, session_factory)
    data = asyncio.run(seed_inventory_data(session_factory))

    resp = client.get(
        "/api/v1/admin/dashboard/inventory/restock-list/export",
        headers=headers,
        params={"include_variants": False, "default_threshold": 5},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type", "").startswith("text/csv")
    assert "restock-list.csv" in resp.headers.get("content-disposition", "")
    assert data["product_a_slug"] in resp.text


def test_owner_can_access_admin_dashboard(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = owner_headers(client, session_factory)

    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200, resp.text


def test_owner_role_cannot_be_changed_via_admin_role_endpoint(
    test_app: Dict[str, object],
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    engine = test_app["engine"]
    asyncio.run(reset_db(engine))
    headers = owner_headers(client, session_factory)

    async def _owner_id() -> str:
        async with session_factory() as session:
            owner = (
                await session.execute(
                    select(User).where(User.email == "owner@example.com")
                )
            ).scalar_one()
            return str(owner.id)

    owner_id = asyncio.run(_owner_id())
    update = client.patch(
        f"/api/v1/admin/dashboard/users/{owner_id}/role",
        headers=headers,
        json={"role": UserRole.customer.value, "password": "Password123"},
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
        json={"identifier": "target", "confirm": "TRANSFER", "password": "Password123"},
    )
    assert transfer.status_code == 200, transfer.text

    async def _roles() -> tuple[UserRole, UserRole]:
        async with session_factory() as session:
            owner = (
                await session.execute(
                    select(User).where(User.email == "owner@example.com")
                )
            ).scalar_one()
            target = (
                await session.execute(
                    select(User).where(User.email == "target@example.com")
                )
            ).scalar_one()
            return owner.role, target.role

    old_role, new_role = asyncio.run(_roles())
    assert old_role == UserRole.admin
    assert new_role == UserRole.owner

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    assert any(
        item.get("action") == "owner_transfer"
        for item in audit.json().get("security", [])
    )

    async def _audit_count() -> int:
        async with session_factory() as session:
            return int(
                await session.scalar(
                    select(func.count())
                    .select_from(AdminAuditLog)
                    .where(AdminAuditLog.action == "owner_transfer")
                )
            )

    assert asyncio.run(_audit_count()) == 1
