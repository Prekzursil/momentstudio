import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductImage, ProductStatus, ProductAuditLog, ProductTranslation
from app.models.content import ContentBlock, ContentStatus, ContentAuditLog
from app.models.order import Order, OrderStatus
from app.models.address import Address
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.support import ContactSubmission, ContactSubmissionTopic, ContactSubmissionStatus
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.models.user import UserSecurityEvent


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
            role=UserRole.owner,
        )
        customer = User(
            email="customer@example.com",
            username="customer",
            hashed_password=security.hash_password("Password123"),
            name="Customer",
            role=UserRole.customer,
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
        session.add(customer)
        category = Category(slug="art", name="Art", sort_order=1)
        session.add(category)
        await session.flush()

        product = Product(
            slug="painting",
            name="Painting",
            base_price=50,
            currency="RON",
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
            status=OrderStatus.pending_acceptance,
            total_amount=50,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            customer_email=customer.email,
            customer_name=customer.name or customer.email,
        )
        session.add(order)

        promo = PromoCode(code="SAVE5", percentage_off=5, currency="RON", active=True, max_uses=10)
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
        return {
            "product_slug": product.slug,
            "image_id": str(image.id),
            "category_slug": category.slug,
            "customer_id": customer.id,
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


def test_admin_filters_and_low_stock(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    orders = client.get("/api/v1/orders/admin", params={"status": "pending_acceptance"}, headers=headers)
    assert orders.status_code == 200
    assert orders.json()[0]["status"] == "pending_acceptance"

    low_stock = client.get("/api/v1/admin/dashboard/low-stock", headers=headers)
    assert low_stock.status_code == 200
    assert low_stock.json()[0]["stock_quantity"] == 2


def test_admin_summary_sales_excludes_cancelled_and_pending(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_orders() -> None:
        async with session_factory() as session:
            customer = (
                await session.execute(select(User).where(User.email == "customer@example.com"))
            ).scalar_one()
            now = datetime.now(timezone.utc)
            email = customer.email
            name = customer.name or customer.email

            session.add_all(
                [
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.paid,
                        total_amount=100,
                        currency="RON",
                        tax_amount=0,
                        shipping_amount=0,
                        customer_email=email,
                        customer_name=name,
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.shipped,
                        total_amount=50,
                        currency="RON",
                        tax_amount=0,
                        shipping_amount=0,
                        customer_email=email,
                        customer_name=name,
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.delivered,
                        total_amount=25,
                        currency="RON",
                        tax_amount=0,
                        shipping_amount=0,
                        customer_email=email,
                        customer_name=name,
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.pending_acceptance,
                        total_amount=75,
                        currency="RON",
                        tax_amount=0,
                        shipping_amount=0,
                        customer_email=email,
                        customer_name=name,
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.cancelled,
                        total_amount=500,
                        currency="RON",
                        tax_amount=0,
                        shipping_amount=0,
                        customer_email=email,
                        customer_name=name,
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.refunded,
                        total_amount=35,
                        currency="RON",
                        tax_amount=0,
                        shipping_amount=0,
                        customer_email=email,
                        customer_name=name,
                        created_at=now,
                        updated_at=now,
                    ),
                ]
            )
            await session.commit()

    asyncio.run(add_orders())

    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["sales_30d"] == pytest.approx(175.0)
    assert data["sales_range"] == pytest.approx(175.0)
    assert data["today_sales"] == pytest.approx(175.0)


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


def test_coupon_stripe_mapping_invalidation(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    created = client.post("/api/v1/admin/dashboard/coupons", headers=headers, json={"code": "NEW", "percentage_off": 10, "active": True})
    assert created.status_code == 201, created.text
    coupon_id = created.json()["id"]
    coupon_uuid = UUID(coupon_id)

    async def add_mapping(stripe_coupon_id: str) -> None:
        async with session_factory() as session:
            session.add(
                StripeCouponMapping(
                    promo_code_id=coupon_uuid,
                    discount_cents=500,
                    currency="RON",
                    stripe_coupon_id=stripe_coupon_id,
                )
            )
            await session.commit()

    async def count_mappings() -> int:
        async with session_factory() as session:
            total = await session.scalar(
                select(func.count())
                .select_from(StripeCouponMapping)
                .where(StripeCouponMapping.promo_code_id == coupon_uuid)
            )
            return int(total or 0)

    asyncio.run(add_mapping("stripe-coupon-1"))
    assert asyncio.run(count_mappings()) == 1

    updated = client.patch(f"/api/v1/admin/dashboard/coupons/{coupon_id}", headers=headers, json={"percentage_off": 15})
    assert updated.status_code == 200, updated.text
    assert asyncio.run(count_mappings()) == 0

    asyncio.run(add_mapping("stripe-coupon-2"))
    assert asyncio.run(count_mappings()) == 1

    invalidated = client.post(f"/api/v1/admin/dashboard/coupons/{coupon_id}/stripe/invalidate", headers=headers, json={})
    assert invalidated.status_code == 200, invalidated.text
    assert invalidated.json()["deleted_mappings"] == 1
    assert asyncio.run(count_mappings()) == 0


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


def test_product_trash_and_image_restore(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    product_slug = seeded["product_slug"]
    image_id = seeded["image_id"]

    deleted_image = client.delete(f"/api/v1/catalog/products/{product_slug}/images/{image_id}", headers=headers)
    assert deleted_image.status_code == 200, deleted_image.text
    assert all(img["id"] != image_id for img in deleted_image.json().get("images", []))

    deleted_list = client.get(f"/api/v1/catalog/products/{product_slug}/images/deleted", headers=headers)
    assert deleted_list.status_code == 200, deleted_list.text
    assert any(img["id"] == image_id for img in deleted_list.json())

    restored_image = client.post(f"/api/v1/catalog/products/{product_slug}/images/{image_id}/restore", headers=headers)
    assert restored_image.status_code == 200, restored_image.text
    assert any(img["id"] == image_id for img in restored_image.json().get("images", []))

    delete_product = client.delete(f"/api/v1/catalog/products/{product_slug}", headers=headers)
    assert delete_product.status_code == 204, delete_product.text

    deleted_products = client.get("/api/v1/admin/dashboard/products/search", params={"deleted": True}, headers=headers)
    assert deleted_products.status_code == 200, deleted_products.text
    match = next((item for item in deleted_products.json().get("items", []) if item["deleted_slug"] == product_slug), None)
    assert match is not None
    product_id = match["id"]

    restored_product = client.post(f"/api/v1/admin/dashboard/products/{product_id}/restore", headers=headers)
    assert restored_product.status_code == 200, restored_product.text
    assert restored_product.json()["slug"] == product_slug

    active_products = client.get("/api/v1/admin/dashboard/products/search", headers=headers)
    assert active_products.status_code == 200, active_products.text
    assert any(item["id"] == product_id for item in active_products.json().get("items", []))


def test_admin_products_search_translation_filters(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_translation_data() -> None:
        async with session_factory() as session:
            category = (await session.execute(select(Category).where(Category.slug == "art"))).scalar_one()
            painting = (await session.execute(select(Product).where(Product.slug == "painting"))).scalar_one()
            session.add(ProductTranslation(product_id=painting.id, lang="en", name="Painting EN"))

            session.add(
                Product(
                    slug="sculpture",
                    name="Sculpture",
                    base_price=75,
                    currency="RON",
                    category_id=category.id,
                    stock_quantity=1,
                    status=ProductStatus.published,
                )
            )
            await session.commit()

    asyncio.run(add_translation_data())

    missing_en = client.get(
        "/api/v1/admin/dashboard/products/search",
        params={"missing_translation_lang": "en"},
        headers=headers,
    )
    assert missing_en.status_code == 200, missing_en.text
    items = missing_en.json().get("items", [])
    assert any(item["slug"] == "sculpture" for item in items)
    assert all(item["slug"] != "painting" for item in items)

    missing_any = client.get(
        "/api/v1/admin/dashboard/products/search",
        params={"missing_translations": True},
        headers=headers,
    )
    assert missing_any.status_code == 200, missing_any.text
    any_items = missing_any.json().get("items", [])
    assert {item["slug"] for item in any_items} >= {"painting", "sculpture"}

    missing_ro = client.get(
        "/api/v1/admin/dashboard/products/search",
        params={"missing_translation_lang": "ro"},
        headers=headers,
    )
    assert missing_ro.status_code == 200, missing_ro.text
    ro_items = missing_ro.json().get("items", [])
    assert {item["slug"] for item in ro_items} >= {"painting", "sculpture"}
    assert any("ro" in (item.get("missing_translations") or []) for item in ro_items)


def test_product_audit_trail_records_field_changes(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    product_slug = seeded["product_slug"]

    patched = client.patch(
        f"/api/v1/catalog/products/{product_slug}",
        headers=headers,
        json={
            "name": "Painting updated",
            "tags": ["bestseller"],
            "options": [{"option_name": "Size", "option_value": "Large"}],
        },
    )
    assert patched.status_code == 200, patched.text

    audit = client.get(f"/api/v1/catalog/products/{product_slug}/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    entries = audit.json()
    update_entry = next((e for e in entries if e.get("action") == "update"), None)
    assert update_entry is not None
    payload = update_entry.get("payload") or {}
    changes = payload.get("changes") or {}
    assert "name" in changes
    assert "tags" in changes
    assert changes["name"]["before"] == "Painting"
    assert changes["name"]["after"] == "Painting updated"
    assert changes["tags"]["after"] == ["bestseller"]


def test_admin_user_profile_endpoint(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_profile_data() -> None:
        async with session_factory() as session:
            customer = await session.get(User, seeded["customer_id"])
            assert customer is not None
            session.add(
                Address(
                    user_id=customer.id,
                    label="Home",
                    phone="+40700000000",
                    line1="Street 1",
                    line2=None,
                    city="Cluj",
                    region="CJ",
                    postal_code="400000",
                    country="RO",
                    is_default_shipping=True,
                    is_default_billing=False,
                )
            )
            session.add(
                ContactSubmission(
                    topic=ContactSubmissionTopic.support,
                    status=ContactSubmissionStatus.new,
                    name=customer.name or "Customer",
                    email=customer.email,
                    message="Need help",
                    order_reference=None,
                    user_id=customer.id,
                )
            )
            session.add(
                UserSecurityEvent(
                    user_id=customer.id,
                    event_type="login",
                    ip_address="127.0.0.1",
                    user_agent="pytest",
                )
            )
            await session.commit()

    asyncio.run(add_profile_data())

    resp = client.get(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/profile",
        headers=headers,
        params={"include_pii": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["email"] == "customer@example.com"
    assert len(body["orders"]) == 1  # seeded order
    assert len(body["addresses"]) == 1
    assert len(body["tickets"]) == 1
    assert len(body["security_events"]) == 1


def test_admin_user_internal_update_creates_audit(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    updated = client.patch(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/internal",
        headers=headers,
        json={"vip": True, "admin_note": "VIP customer"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["vip"] is True
    assert updated.json()["admin_note"] == "VIP customer"

    profile = client.get(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/profile",
        headers=headers,
        params={"include_pii": True},
    )
    assert profile.status_code == 200, profile.text
    assert profile.json()["user"]["vip"] is True
    assert profile.json()["user"]["admin_note"] == "VIP customer"

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    security_logs = audit.json().get("security", [])
    assert any(item.get("action") == "user.internal.update" for item in security_logs)


def test_admin_user_impersonation_is_read_only(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    started = client.post(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/impersonate",
        headers=headers,
    )
    assert started.status_code == 200, started.text
    token = started.json().get("access_token")
    assert isinstance(token, str) and token

    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200, me.text
    assert me.json()["id"] == str(seeded["customer_id"])

    read_only = client.post(
        "/api/v1/auth/verify/request",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert read_only.status_code == 403, read_only.text

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    security_logs = audit.json().get("security", [])
    assert any(item.get("action") == "user.impersonation.start" for item in security_logs)


def test_admin_user_security_update_blocks_login(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    locked_until = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    updated = client.patch(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/security",
        headers=headers,
        json={"locked_until": locked_until, "locked_reason": "fraud review", "password_reset_required": True},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["password_reset_required"] is True
    assert updated.json()["locked_until"]

    blocked = client.post("/api/v1/auth/login", json={"email": "customer@example.com", "password": "Password123"})
    assert blocked.status_code == 403, blocked.text

    unlocked = client.patch(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/security",
        headers=headers,
        json={"locked_until": None, "locked_reason": None, "password_reset_required": False},
    )
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["locked_until"] is None
    assert unlocked.json()["locked_reason"] is None
    assert unlocked.json()["password_reset_required"] is False

    ok = client.post("/api/v1/auth/login", json={"email": "customer@example.com", "password": "Password123"})
    assert ok.status_code == 200, ok.text

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    security_logs = audit.json().get("security", [])
    assert any(item.get("action") == "user.security.update" for item in security_logs)


def test_admin_user_email_verification_controls(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    before = client.get(f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/email/verification", headers=headers)
    assert before.status_code == 200, before.text
    assert before.json()["tokens"] == []

    resend = client.post(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/email/verification/resend",
        headers=headers,
    )
    assert resend.status_code == 202, resend.text

    after = client.get(f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/email/verification", headers=headers)
    assert after.status_code == 200, after.text
    assert len(after.json()["tokens"]) == 1

    override = client.post(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/email/verification/override",
        headers=headers,
    )
    assert override.status_code == 200, override.text
    assert override.json()["email_verified"] is True

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    security_logs = audit.json().get("security", [])
    assert any(item.get("action") == "user.email_verification.resend" for item in security_logs)
    assert any(item.get("action") == "user.email_verification.override" for item in security_logs)
