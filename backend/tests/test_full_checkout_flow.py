import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductImage, ProductStatus
from app.models.content import ContentBlock, ContentStatus
from app.models.order import Order
from app.models.promo import PromoCode
from app.models.user import User
from app.schemas.order import ShippingMethodCreate
from app.schemas.promo import PromoCodeCreate
from app.services import cart as cart_service
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
        async with SessionLocal() as session:
            session.add_all(
                [
                    ContentBlock(
                        key="page.terms-and-conditions",
                        title="Terms",
                        body_markdown="Terms",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                    ContentBlock(
                        key="page.privacy-policy",
                        title="Privacy",
                        body_markdown="Privacy",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                ]
            )
            await session.commit()

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
                status=ProductStatus.published,
                images=[ProductImage(url="/media/flow.png", alt_text="flow")],
            )
            shipping = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Standard", rate_flat=5.0, rate_per_kg=0)
            )
            await cart_service.create_promo(session, PromoCodeCreate(code="SAVE10", percentage_off=10, currency="RON"))
            session.add_all([product])
            await session.commit()
            await session.refresh(product)
            return {"product_id": product.id, "shipping_id": shipping.id}

    seeded = asyncio.run(seed())

    captured: dict[str, object] = {}

    async def fake_create_checkout_session(
        *,
        session: object,
        amount_cents: int,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        lang: str | None = None,
        metadata: dict[str, str] | None = None,
        line_items: list[dict[str, object]] | None = None,
        discount_cents: int | None = None,
        promo_code: str | None = None,
    ) -> dict:
        captured["stripe_session_calls"] = int(captured.get("stripe_session_calls") or 0) + 1
        captured["promo_code"] = promo_code
        captured["amount_cents"] = amount_cents
        captured["customer_email"] = customer_email
        captured["success_url"] = success_url
        captured["cancel_url"] = cancel_url
        captured["lang"] = lang
        captured["metadata"] = metadata
        captured["line_items"] = line_items or []
        captured["discount_cents"] = discount_cents
        return {"session_id": "cs_test_logged", "checkout_url": "https://checkout.stripe.test/session/cs_test_logged"}

    async def fake_order_email(*args, **kwargs):
        captured["email_sent"] = True
        return True

    monkeypatch.setattr(payments, "create_checkout_session", fake_create_checkout_session)
    monkeypatch.setattr(email_service, "send_order_confirmation", fake_order_email)

    # Register and login
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "flow@example.com",
            "username": "flow",
            "password": "secret123",
            "name": "Flow",
            "first_name": "Flow",
            "last_name": "User",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
            "accept_terms": True,
            "accept_privacy": True,
        },
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["tokens"]["access_token"]
    user_id = reg.json()["user"]["id"]

    async def mark_verified() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, UUID(user_id))
            assert user is not None
            user.email_verified = True
            session.add(user)
            await session.commit()

    asyncio.run(mark_verified())

    # Add to cart
    add_res = client.post(
        "/api/v1/cart/items",
        headers={"Authorization": f"Bearer {token}"},
        json={"product_id": str(seeded["product_id"]), "quantity": 2},
    )
    assert add_res.status_code in (200, 201), add_res.text

    # Checkout as authenticated user (returns order_id + Stripe checkout URL)
    order_res = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shipping_method_id": str(seeded["shipping_id"]),
            "save_address": True,
            "line1": "123 Flow St",
            "city": "Flowtown",
            "region": "FT",
            "postal_code": "12345",
            "country": "US",
            "promo_code": "SAVE10",
        },
    )
    assert order_res.status_code == 201, order_res.text
    body = order_res.json()
    assert body["order_id"]
    assert body["payment_method"] == "stripe"
    assert body["stripe_session_id"] == "cs_test_logged"
    assert body["stripe_checkout_url"].startswith("https://")
    assert captured.get("stripe_session_calls") == 1
    assert captured.get("email_sent") is None

    # Re-submitting checkout should be idempotent (no duplicate order/session creation).
    order_res_2 = client.post(
        "/api/v1/orders/checkout",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shipping_method_id": str(seeded["shipping_id"]),
            "save_address": True,
            "line1": "123 Flow St",
            "city": "Flowtown",
            "region": "FT",
            "postal_code": "12345",
            "country": "US",
            "promo_code": "SAVE10",
        },
    )
    assert order_res_2.status_code == 200, order_res_2.text
    body_2 = order_res_2.json()
    assert body_2["order_id"] == body["order_id"]
    assert body_2["stripe_session_id"] == body["stripe_session_id"]
    assert body_2["stripe_checkout_url"] == body["stripe_checkout_url"]
    assert captured.get("stripe_session_calls") == 1

    async def promo_times_used() -> int:
        async with SessionLocal() as session:
            promo = (await session.execute(select(PromoCode).where(PromoCode.code == "SAVE10"))).scalar_one()
            return int(promo.times_used)

    assert asyncio.run(promo_times_used()) == 0

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(
        "app.services.payments.stripe.Webhook.construct_event",
        lambda payload, sig_header, secret: {
            "id": "evt_full_flow_1",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_test_logged", "payment_intent": "pi_test", "payment_status": "paid"}},
        },
    )
    webhook = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert webhook.status_code == 200, webhook.text
    assert captured.get("email_sent") is True
    assert asyncio.run(promo_times_used()) == 1

    # Verify order is visible via API endpoints
    list_res = client.get("/api/v1/orders", headers={"Authorization": f"Bearer {token}"})
    assert list_res.status_code == 200, list_res.text
    ids = {o["id"] for o in list_res.json()}
    assert body["order_id"] in ids

    detail_res = client.get(f"/api/v1/orders/{body['order_id']}", headers={"Authorization": f"Bearer {token}"})
    assert detail_res.status_code == 200, detail_res.text
    assert detail_res.json()["id"] == body["order_id"]

    # Verify order persisted and tied to user
    async def fetch_order():
        async with SessionLocal() as session:
            result = await session.execute(select(Order).order_by(Order.created_at.desc()))
            return result.scalars().first()

    order = asyncio.run(fetch_order())
    assert order is not None
    assert order.user_id is not None
    assert float(order.total_amount) > 0
