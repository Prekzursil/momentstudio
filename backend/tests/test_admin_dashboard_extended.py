from decimal import Decimal
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
from app.models.order import Order, OrderEvent, OrderItem, OrderRefund, OrderStatus, OrderTag
from app.models.address import Address
from app.models.cart import Cart, CartItem
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.returns import ReturnRequest, ReturnRequestStatus
from app.models.support import ContactSubmission, ContactSubmissionTopic, ContactSubmissionStatus
from app.models.passkeys import UserPasskey
from app.models.user import PasswordResetToken, User, UserRole
from app.models.user import UserSecurityEvent
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from app.models.analytics_event import AnalyticsEvent


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
    headers = {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


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
    assert data["gross_sales_30d"] == pytest.approx(210.0)
    assert data["net_sales_30d"] == pytest.approx(175.0)
    assert data["sales_range"] == pytest.approx(175.0)
    assert data["gross_sales_range"] == pytest.approx(210.0)
    assert data["net_sales_range"] == pytest.approx(175.0)
    assert data["today_sales"] == pytest.approx(175.0)
    assert data["gross_today_sales"] == pytest.approx(210.0)
    assert data["net_today_sales"] == pytest.approx(175.0)


def test_admin_summary_net_sales_subtracts_partial_refunds(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_order_and_refund() -> None:
        async with session_factory() as session:
            customer = (
                await session.execute(select(User).where(User.email == "customer@example.com"))
            ).scalar_one()
            now = datetime.now(timezone.utc)
            email = customer.email
            name = customer.name or customer.email

            order = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("100.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )
            session.add(order)
            await session.flush()
            session.add(
                OrderRefund(
                    order_id=order.id,
                    amount=Decimal("30.00"),
                    currency="RON",
                    provider="manual",
                    note="test partial refund",
                    created_at=now,
                )
            )
            await session.commit()

    asyncio.run(add_order_and_refund())

    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["gross_today_sales"] == pytest.approx(100.0)
    assert data["net_today_sales"] == pytest.approx(70.0)


def test_admin_summary_excludes_test_orders_from_kpis(test_app: Dict[str, object]) -> None:
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

            live_order = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("100.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )
            test_order = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("200.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )
            session.add_all([live_order, test_order])
            await session.flush()
            session.add(OrderTag(order_id=test_order.id, tag="test", actor_user_id=None))
            await session.commit()

    asyncio.run(add_orders())

    resp = client.get("/api/v1/admin/dashboard/summary", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["gross_today_sales"] == pytest.approx(100.0)
    assert data["net_today_sales"] == pytest.approx(100.0)


def test_admin_channel_breakdown_groups_and_excludes_test_orders(test_app: Dict[str, object]) -> None:
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

            stripe_paid = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("100.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                payment_method="stripe",
                courier="fan_courier",
                delivery_type="home",
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )
            paypal_paid = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("50.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                payment_method="paypal",
                courier="sameday",
                delivery_type="locker",
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )
            stripe_refunded = Order(
                user_id=customer.id,
                status=OrderStatus.refunded,
                total_amount=Decimal("30.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                payment_method="stripe",
                courier="fan_courier",
                delivery_type="home",
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )
            stripe_test = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("999.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                payment_method="stripe",
                courier="fan_courier",
                delivery_type="home",
                customer_email=email,
                customer_name=name,
                created_at=now,
                updated_at=now,
            )

            session.add_all([stripe_paid, paypal_paid, stripe_refunded, stripe_test])
            await session.flush()

            session.add(OrderTag(order_id=stripe_test.id, tag="test", actor_user_id=None))
            session.add(
                OrderRefund(
                    order_id=stripe_paid.id,
                    amount=Decimal("20.00"),
                    currency="RON",
                    provider="manual",
                    note="partial",
                    created_at=now,
                )
            )
            await session.commit()

    asyncio.run(add_orders())

    resp = client.get("/api/v1/admin/dashboard/channel-breakdown", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    payment = {row["key"]: row for row in data["payment_methods"]}
    assert payment["stripe"]["orders"] == 2
    assert payment["stripe"]["gross_sales"] == pytest.approx(130.0)
    assert payment["stripe"]["net_sales"] == pytest.approx(80.0)
    assert payment["paypal"]["orders"] == 1
    assert payment["paypal"]["gross_sales"] == pytest.approx(50.0)
    assert payment["paypal"]["net_sales"] == pytest.approx(50.0)

    couriers = {row["key"]: row for row in data["couriers"]}
    assert couriers["fan_courier"]["gross_sales"] == pytest.approx(130.0)
    assert couriers["fan_courier"]["net_sales"] == pytest.approx(80.0)
    assert couriers["sameday"]["gross_sales"] == pytest.approx(50.0)

    delivery = {row["key"]: row for row in data["delivery_types"]}
    assert delivery["home"]["gross_sales"] == pytest.approx(130.0)
    assert delivery["home"]["net_sales"] == pytest.approx(80.0)
    assert delivery["locker"]["gross_sales"] == pytest.approx(50.0)


def test_admin_payments_health_widget(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_data() -> None:
        async with session_factory() as session:
            customer = (await session.execute(select(User).where(User.email == "customer@example.com"))).scalar_one()
            now = datetime.now(timezone.utc)
            email = customer.email
            name = customer.name or customer.email

            session.add_all(
                [
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.paid,
                        total_amount=Decimal("100.00"),
                        currency="RON",
                        tax_amount=Decimal("0.00"),
                        shipping_amount=Decimal("0.00"),
                        customer_email=email,
                        customer_name=name,
                        payment_method="stripe",
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.pending_payment,
                        total_amount=Decimal("80.00"),
                        currency="RON",
                        tax_amount=Decimal("0.00"),
                        shipping_amount=Decimal("0.00"),
                        customer_email=email,
                        customer_name=name,
                        payment_method="stripe",
                        created_at=now,
                        updated_at=now,
                    ),
                    Order(
                        user_id=customer.id,
                        status=OrderStatus.delivered,
                        total_amount=Decimal("50.00"),
                        currency="RON",
                        tax_amount=Decimal("0.00"),
                        shipping_amount=Decimal("0.00"),
                        customer_email=email,
                        customer_name=name,
                        payment_method="paypal",
                        created_at=now,
                        updated_at=now,
                    ),
                ]
            )

            session.add(
                StripeWebhookEvent(
                    stripe_event_id="evt_test_error",
                    event_type="payment_intent.succeeded",
                    attempts=2,
                    last_attempt_at=now,
                    last_error="boom",
                )
            )
            session.add(
                StripeWebhookEvent(
                    stripe_event_id="evt_test_backlog",
                    event_type="checkout.session.completed",
                    attempts=1,
                    last_attempt_at=now,
                )
            )
            session.add(
                PayPalWebhookEvent(
                    paypal_event_id="wh_test_error",
                    event_type="PAYMENT.CAPTURE.COMPLETED",
                    attempts=1,
                    last_attempt_at=now,
                    last_error="oops",
                )
            )
            await session.commit()

    asyncio.run(add_data())

    resp = client.get("/api/v1/admin/dashboard/payments-health", headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["window_hours"] == 24
    providers = {row["provider"]: row for row in payload["providers"]}
    assert providers["stripe"]["successful_orders"] >= 1
    assert providers["stripe"]["pending_payment_orders"] >= 1
    assert providers["stripe"]["webhook_errors"] == 1
    assert providers["stripe"]["webhook_backlog"] == 1
    assert providers["paypal"]["successful_orders"] >= 1
    assert providers["paypal"]["webhook_errors"] == 1
    assert any(evt["provider"] == "stripe" for evt in payload["recent_webhook_errors"])


def test_admin_refunds_breakdown_widget(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_data() -> None:
        async with session_factory() as session:
            customer = (await session.execute(select(User).where(User.email == "customer@example.com"))).scalar_one()
            now = datetime.now(timezone.utc)
            current_time = now - timedelta(hours=2)
            previous_time = now - timedelta(hours=36)
            email = customer.email
            name = customer.name or customer.email

            missing_order = Order(
                user_id=customer.id,
                status=OrderStatus.refunded,
                total_amount=Decimal("100.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                payment_method="stripe",
                created_at=previous_time,
                updated_at=current_time,
            )
            refund_order = Order(
                user_id=customer.id,
                status=OrderStatus.delivered,
                total_amount=Decimal("50.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                payment_method="stripe",
                created_at=current_time,
                updated_at=current_time,
            )
            manual_order = Order(
                user_id=customer.id,
                status=OrderStatus.shipped,
                total_amount=Decimal("70.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                payment_method="stripe",
                created_at=current_time,
                updated_at=current_time,
            )
            previous_refund_order = Order(
                user_id=customer.id,
                status=OrderStatus.paid,
                total_amount=Decimal("30.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                payment_method="stripe",
                created_at=previous_time,
                updated_at=previous_time,
            )

            session.add_all([missing_order, refund_order, manual_order, previous_refund_order])
            await session.flush()

            session.add(
                OrderRefund(
                    order_id=refund_order.id,
                    amount=Decimal("10.00"),
                    currency="RON",
                    provider="stripe",
                    created_at=current_time,
                )
            )
            session.add(
                OrderRefund(
                    order_id=manual_order.id,
                    amount=Decimal("5.00"),
                    currency="RON",
                    provider="manual",
                    created_at=current_time,
                )
            )
            session.add(
                OrderRefund(
                    order_id=previous_refund_order.id,
                    amount=Decimal("3.00"),
                    currency="RON",
                    provider="stripe",
                    created_at=previous_time,
                )
            )

            session.add(
                ReturnRequest(
                    order_id=refund_order.id,
                    user_id=customer.id,
                    status=ReturnRequestStatus.refunded,
                    reason="Produs spart la livrare",
                    created_at=current_time,
                    updated_at=current_time,
                )
            )
            session.add(
                ReturnRequest(
                    order_id=previous_refund_order.id,
                    user_id=customer.id,
                    status=ReturnRequestStatus.refunded,
                    reason="wrong item sent",
                    created_at=previous_time,
                    updated_at=previous_time,
                )
            )
            await session.commit()

    asyncio.run(add_data())

    resp = client.get("/api/v1/admin/dashboard/refunds-breakdown", params={"window_days": 1}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["window_days"] == 1
    assert data["missing_refunds"]["current"]["count"] == 1
    assert data["missing_refunds"]["current"]["amount"] == 100.0

    providers = {row["provider"]: row for row in data["providers"]}
    assert providers["stripe"]["current"]["count"] == 1
    assert providers["stripe"]["current"]["amount"] == 10.0
    assert providers["manual"]["current"]["count"] == 1

    reasons = {row["category"]: row for row in data["reasons"]}
    assert reasons["damaged"]["current"] == 1
    assert reasons["wrong_item"]["previous"] == 1


def test_admin_shipping_performance_widget(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_data() -> None:
        async with session_factory() as session:
            customer = (await session.execute(select(User).where(User.email == "customer@example.com"))).scalar_one()
            now = datetime.now(timezone.utc)
            email = customer.email
            name = customer.name or customer.email

            current_order = Order(
                user_id=customer.id,
                status=OrderStatus.delivered,
                total_amount=Decimal("10.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                payment_method="stripe",
                courier="fan_courier",
                created_at=now - timedelta(hours=10),
                updated_at=now - timedelta(hours=10),
            )
            prev_order = Order(
                user_id=customer.id,
                status=OrderStatus.delivered,
                total_amount=Decimal("20.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=email,
                customer_name=name,
                payment_method="stripe",
                courier="fan_courier",
                created_at=now - timedelta(hours=40),
                updated_at=now - timedelta(hours=40),
            )
            session.add_all([current_order, prev_order])
            await session.flush()

            session.add_all(
                [
                    OrderEvent(
                        order_id=current_order.id,
                        event="status_change",
                        note="paid -> shipped",
                        created_at=now - timedelta(hours=2),
                    ),
                    OrderEvent(
                        order_id=current_order.id,
                        event="status_change",
                        note="shipped -> delivered",
                        created_at=now - timedelta(hours=1),
                    ),
                    OrderEvent(
                        order_id=prev_order.id,
                        event="status_change",
                        note="paid -> shipped",
                        created_at=now - timedelta(hours=30),
                    ),
                    OrderEvent(
                        order_id=prev_order.id,
                        event="status_change",
                        note="shipped -> delivered",
                        created_at=now - timedelta(hours=28),
                    ),
                ]
            )
            await session.commit()

    asyncio.run(add_data())

    resp = client.get("/api/v1/admin/dashboard/shipping-performance", params={"window_days": 1}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    time_to_ship = {row["courier"]: row for row in data["time_to_ship"]}
    assert time_to_ship["fan_courier"]["current"]["count"] == 1
    assert time_to_ship["fan_courier"]["current"]["avg_hours"] == pytest.approx(8.0)

    delivery = {row["courier"]: row for row in data["delivery_time"]}
    assert delivery["fan_courier"]["current"]["count"] == 1
    assert delivery["fan_courier"]["current"]["avg_hours"] == pytest.approx(1.0)


def test_admin_stockout_impact_widget(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_data() -> None:
        async with session_factory() as session:
            customer = (await session.execute(select(User).where(User.email == "customer@example.com"))).scalar_one()
            category = (await session.execute(select(Category).where(Category.slug == "art"))).scalar_one()
            now = datetime.now(timezone.utc)

            product = Product(
                slug="stockout-item",
                name="Stockout Item",
                base_price=Decimal("20.00"),
                currency="RON",
                category_id=category.id,
                stock_quantity=0,
                status=ProductStatus.published,
            )
            session.add(product)
            await session.flush()

            cart = Cart(session_id="sess-stockout", updated_at=now, created_at=now)
            session.add(cart)
            await session.flush()
            session.add(
                CartItem(
                    cart_id=cart.id,
                    product_id=product.id,
                    quantity=2,
                    unit_price_at_add=Decimal("20.00"),
                )
            )

            order = Order(
                user_id=customer.id,
                status=OrderStatus.delivered,
                total_amount=Decimal("40.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=customer.email,
                customer_name=customer.name or customer.email,
                payment_method="stripe",
                created_at=now - timedelta(days=2),
                updated_at=now - timedelta(days=2),
            )
            session.add(order)
            await session.flush()
            session.add(
                OrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    quantity=2,
                    shipped_quantity=2,
                    unit_price=Decimal("20.00"),
                    subtotal=Decimal("40.00"),
                    created_at=order.created_at,
                )
            )
            await session.commit()

    asyncio.run(add_data())

    resp = client.get("/api/v1/admin/dashboard/stockout-impact", params={"window_days": 30, "limit": 5}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["items"], "Expected stockout items"
    item = data["items"][0]
    assert item["product_slug"] == "stockout-item"
    assert item["reserved_in_carts"] == 2
    assert item["demand_units"] == 2
    assert item["demand_revenue"] == pytest.approx(40.0)
    assert item["estimated_missed_revenue"] == pytest.approx(40.0)


def test_admin_channel_attribution_widget(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    async def add_data() -> None:
        async with session_factory() as session:
            customer = (await session.execute(select(User).where(User.email == "customer@example.com"))).scalar_one()
            now = datetime.now(timezone.utc)

            order = Order(
                user_id=customer.id,
                status=OrderStatus.delivered,
                total_amount=Decimal("100.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email=customer.email,
                customer_name=customer.name or customer.email,
                payment_method="stripe",
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
            )
            session.add(order)
            await session.flush()

            session_id = "sess-utm"
            session.add(
                AnalyticsEvent(
                    session_id=session_id,
                    event="session_start",
                    path="/",
                    payload={"utm_source": "google", "utm_medium": "cpc", "utm_campaign": "spring"},
                    created_at=now - timedelta(days=2),
                )
            )
            session.add(
                AnalyticsEvent(
                    session_id=session_id,
                    event="checkout_success",
                    path="/checkout/success",
                    payload={"order_id": str(order.id)},
                    order_id=order.id,
                    created_at=now - timedelta(days=1),
                )
            )
            await session.commit()

    asyncio.run(add_data())

    resp = client.get("/api/v1/admin/dashboard/channel-attribution", params={"range_days": 30}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["tracked_orders"] == 1
    channels = {(row["source"], row["medium"]): row for row in data["channels"]}
    assert ("google", "cpc") in channels
    assert channels[("google", "cpc")]["orders"] == 1
    assert channels[("google", "cpc")]["gross_sales"] == pytest.approx(100.0)


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
        json={"password": "Password123"},
    )
    assert override.status_code == 200, override.text
    assert override.json()["email_verified"] is True

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    security_logs = audit.json().get("security", [])
    assert any(item.get("action") == "user.email_verification.resend" for item in security_logs)
    assert any(item.get("action") == "user.email_verification.override" for item in security_logs)


def test_admin_user_password_reset_resend_creates_token_and_audit(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    engine = test_app["engine"]
    session_factory = test_app["session_factory"]
    asyncio.run(reset_db(engine))
    seeded = asyncio.run(seed(session_factory))
    headers = auth_headers(client)

    resend = client.post(
        f"/api/v1/admin/dashboard/users/{seeded['customer_id']}/password-reset/resend",
        headers=headers,
        json={},
    )
    assert resend.status_code == 202, resend.text

    async def _count_tokens() -> int:
        async with session_factory() as session:
            rows = (
                await session.execute(
                    select(PasswordResetToken).where(
                        PasswordResetToken.user_id == seeded["customer_id"]
                    )
                )
            ).scalars().all()
            return len(rows)

    assert asyncio.run(_count_tokens()) == 1

    audit = client.get("/api/v1/admin/dashboard/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    security_logs = audit.json().get("security", [])
    assert any(item.get("action") == "user.password_reset.resend" for item in security_logs)
