import asyncio
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.address import Address
from app.models.catalog import Category, Product, ProductStatus
from app.models.cart import Cart, CartItem
from app.models.coupons_v2 import Coupon, CouponRedemption, CouponReservation, CouponVisibility, Promotion, PromotionDiscountType
from app.models.email_event import EmailDeliveryEvent
from app.models.order import Order, OrderEvent, OrderStatus, OrderItem
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.services.auth import create_user, issue_tokens_for_user
from app.schemas.user import UserCreate
from app.services import order as order_service
from app.services import payments as payments_service
from app.services import email as email_service
from app.schemas.order import ShippingMethodCreate
from app.core.config import settings
from app.core import security
from app.core.security import create_receipt_token


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
    headers = {"Authorization": f"Bearer {token}"}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def create_user_token(session_factory, email="buyer@example.com", admin: bool = False):
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="orderpass", name="Buyer"))
            user.email_verified = True
            if admin:
                user.role = UserRole.admin
                session.add(
                    UserPasskey(
                        user_id=user.id,
                        name="Test Passkey",
                        credential_id=f"cred-{user.id}",
                        public_key=b"test",
                        sign_count=0,
                        backed_up=False,
                    )
                )
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(create_and_token())


def test_order_create_requires_verified_email(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    async def create_unverified_user():
        async with SessionLocal() as session:
            user = await create_user(session, UserCreate(email="unverified@example.com", password="orderpass", name="Buyer"))
            # Ensure user is not verified
            user.email_verified = False
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    token, user_id = asyncio.run(create_unverified_user())
    seed_cart_with_product(SessionLocal, user_id)

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
    assert res.status_code == 403, res.text
    assert res.json().get("detail") == "Email verification required"


def test_list_my_orders_pagination_and_filters(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal, email="buyer-me@example.com")
    _, other_user_id = create_user_token(SessionLocal, email="buyer-other@example.com")

    async def seed_orders() -> list[UUID]:
        async with SessionLocal() as session:
            o1 = Order(
                user_id=user_id,
                status=OrderStatus.pending_payment,
                reference_code="REF-AAA",
                customer_email="buyer-me@example.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                payment_method="stripe",
                currency="RON",
                created_at=datetime(2026, 1, 5, tzinfo=timezone.utc),
            )
            o2 = Order(
                user_id=user_id,
                status=OrderStatus.paid,
                reference_code="REF-BBB",
                customer_email="buyer-me@example.com",
                customer_name="Buyer",
                total_amount=Decimal("20.00"),
                payment_method="paypal",
                currency="RON",
                created_at=datetime(2026, 1, 10, tzinfo=timezone.utc),
            )
            o3 = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="XYZ",
                customer_email="buyer-me@example.com",
                customer_name="Buyer",
                total_amount=Decimal("30.00"),
                payment_method="cod",
                currency="RON",
                created_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
            )
            other = Order(
                user_id=other_user_id,
                status=OrderStatus.paid,
                reference_code="OTHER",
                customer_email="buyer-other@example.com",
                customer_name="Other",
                total_amount=Decimal("40.00"),
                payment_method="stripe",
                currency="RON",
            )
            session.add_all([o1, o2, o3, other])
            await session.commit()
            for order in (o1, o2, o3):
                await session.refresh(order)
            return [o1.id, o2.id, o3.id]

    order_ids = asyncio.run(seed_orders())

    page1 = client.get("/api/v1/orders/me", params={"page": 1, "limit": 2}, headers=auth_headers(token))
    assert page1.status_code == 200, page1.text
    body = page1.json()
    assert body["meta"]["total_items"] == 3
    assert body["meta"]["total_pages"] == 2
    assert body["meta"]["page"] == 1
    assert body["meta"]["limit"] == 2
    assert body["meta"]["pending_count"] == 2
    assert len(body["items"]) == 2
    assert body["items"][0]["id"] == str(order_ids[2])  # newest

    page2 = client.get("/api/v1/orders/me", params={"page": 2, "limit": 2}, headers=auth_headers(token))
    assert page2.status_code == 200, page2.text
    body2 = page2.json()
    assert body2["meta"]["total_items"] == 3
    assert body2["meta"]["total_pages"] == 2
    assert body2["meta"]["page"] == 2
    assert len(body2["items"]) == 1
    assert body2["items"][0]["id"] == str(order_ids[0])

    status_filtered = client.get("/api/v1/orders/me", params={"status": "paid"}, headers=auth_headers(token))
    assert status_filtered.status_code == 200, status_filtered.text
    status_body = status_filtered.json()
    assert status_body["meta"]["total_items"] == 1
    assert status_body["meta"]["total_pages"] == 1
    assert status_body["meta"]["pending_count"] == 2
    assert len(status_body["items"]) == 1
    assert status_body["items"][0]["reference_code"] == "REF-BBB"

    q_filtered = client.get("/api/v1/orders/me", params={"q": "XYZ"}, headers=auth_headers(token))
    assert q_filtered.status_code == 200, q_filtered.text
    q_body = q_filtered.json()
    assert q_body["meta"]["total_items"] == 1
    assert len(q_body["items"]) == 1
    assert q_body["items"][0]["reference_code"] == "XYZ"

    date_filtered = client.get(
        "/api/v1/orders/me",
        params={"from": "2026-01-06", "to": "2026-01-31"},
        headers=auth_headers(token),
    )
    assert date_filtered.status_code == 200, date_filtered.text
    date_body = date_filtered.json()
    assert date_body["meta"]["total_items"] == 1
    assert len(date_body["items"]) == 1
    assert date_body["items"][0]["reference_code"] == "REF-BBB"

    invalid_date = client.get(
        "/api/v1/orders/me",
        params={"from": "2026-02-01", "to": "2026-01-01"},
        headers=auth_headers(token),
    )
    assert invalid_date.status_code == 400, invalid_date.text


def test_order_cancel_request_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal, email="buyer-cancelreq@example.com")

    async def seed_order(status: OrderStatus) -> UUID:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=status,
                reference_code=f"CANCELREQ-{status.value}".upper(),
                customer_email="buyer-cancelreq@example.com",
                customer_name="Buyer Cancel",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return order.id

    eligible_order_id = asyncio.run(seed_order(OrderStatus.pending_acceptance))
    eligible_order_id_str = str(eligible_order_id)

    first = client.post(
        f"/api/v1/orders/{eligible_order_id_str}/cancel-request",
        headers=auth_headers(token),
        json={"reason": "Please cancel"},
    )
    assert first.status_code == 200, first.text
    assert any(evt["event"] == "cancel_requested" for evt in first.json().get("events", []))

    duplicate = client.post(
        f"/api/v1/orders/{eligible_order_id_str}/cancel-request",
        headers=auth_headers(token),
        json={"reason": "Please cancel again"},
    )
    assert duplicate.status_code == 409, duplicate.text

    ineligible_order_id = asyncio.run(seed_order(OrderStatus.shipped))
    ineligible = client.post(
        f"/api/v1/orders/{ineligible_order_id}/cancel-request",
        headers=auth_headers(token),
        json={"reason": "Too late"},
    )
    assert ineligible.status_code == 400, ineligible.text


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
                currency="RON",
                stock_quantity=5,
                status=ProductStatus.published,
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


def test_admin_order_search_and_detail(test_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    async def fake_email(*_args, **_kwargs):
        return True

    monkeypatch.setattr(email_service, "send_order_confirmation", fake_email)
    monkeypatch.setattr(email_service, "send_new_order_notification", fake_email)

    token, user_id = create_user_token(SessionLocal, email="buyer@example.com")
    admin_token, _ = create_user_token(SessionLocal, email="admin@example.com", admin=True)
    seed_cart_with_product(SessionLocal, user_id)

    async def seed_addresses() -> tuple[UUID, UUID]:
        async with SessionLocal() as session:
            shipping = Address(
                user_id=user_id,
                label="Shipping",
                line1="123 Main",
                city="Bucharest",
                country="RO",
                postal_code="000000",
            )
            billing = Address(
                user_id=user_id,
                label="Billing",
                line1="456 Billing",
                city="Bucharest",
                country="US",
                postal_code="000000",
            )
            session.add(shipping)
            session.add(billing)
            await session.commit()
            await session.refresh(shipping)
            await session.refresh(billing)
            return shipping.id, billing.id

    shipping_address_id, billing_address_id = asyncio.run(seed_addresses())

    async def seed_shipping():
        async with SessionLocal() as session:
            method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Standard", rate_flat=5.0, rate_per_kg=0)
            )
            return method.id

    shipping_method_id = asyncio.run(seed_shipping())

    create = client.post(
        "/api/v1/orders",
        json={
            "shipping_address_id": str(shipping_address_id),
            "billing_address_id": str(billing_address_id),
            "shipping_method_id": str(shipping_method_id),
        },
        headers=auth_headers(token),
    )
    assert create.status_code == 201, create.text
    order = create.json()
    order_id = order["id"]
    ref = order["reference_code"]

    async def clear_cart_idempotency() -> None:
        async with SessionLocal() as session:
            cart = (
                (await session.execute(select(Cart).where(Cart.user_id == user_id)))
                .scalars()
                .first()
            )
            assert cart is not None
            cart.last_order_id = None
            session.add(cart)
            await session.commit()

    asyncio.run(clear_cart_idempotency())

    create_two = client.post(
        "/api/v1/orders",
        json={
            "shipping_address_id": str(shipping_address_id),
            "billing_address_id": str(billing_address_id),
            "shipping_method_id": str(shipping_method_id),
        },
        headers=auth_headers(token),
    )
    assert create_two.status_code == 201, create_two.text
    order_two_id = create_two.json()["id"]

    forbidden = client.get("/api/v1/orders/admin/search", headers=auth_headers(token))
    assert forbidden.status_code == 403

    search = client.get(
        "/api/v1/orders/admin/search",
        params={"q": ref, "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert search.status_code == 200, search.text
    payload = search.json()
    assert payload["meta"]["total_items"] >= 1
    assert any(item["id"] == order_id for item in payload["items"])
    matching = next((item for item in payload["items"] if item["id"] == order_id), None)
    assert matching is not None
    assert matching.get("payment_method") in {"stripe", "paypal", "netopia", "cod"}

    by_user = client.get(
        "/api/v1/orders/admin/search",
        params={"user_id": str(user_id), "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert by_user.status_code == 200, by_user.text
    by_user_payload = by_user.json()
    assert by_user_payload["meta"]["total_items"] >= 2
    assert any(item["id"] == order_id for item in by_user_payload["items"])
    assert any(item["id"] == order_two_id for item in by_user_payload["items"])

    masked_detail = client.get(f"/api/v1/orders/admin/{order_id}", headers=auth_headers(admin_token))
    assert masked_detail.status_code == 200, masked_detail.text
    masked = masked_detail.json()
    assert masked["customer_email"] != "buyer@example.com"
    assert "*" in masked["customer_email"]
    assert masked["shipping_address"]["line1"] == "***"
    assert masked["billing_address"]["line1"] == "***"

    detail = client.get(
        f"/api/v1/orders/admin/{order_id}", headers=auth_headers(admin_token), params={"include_pii": True}
    )
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["customer_email"] == "buyer@example.com"
    assert data["customer_username"] == "buyer"
    assert data["shipping_address"]["line1"] == "123 Main"
    assert data["billing_address"]["line1"] == "456 Billing"

    signals = {signal["code"]: signal for signal in (data.get("fraud_signals") or [])}
    assert signals["velocity_email"]["data"]["count"] >= 2
    assert signals["country_mismatch"]["data"]["billing_country"] == "US"

    updated = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "paid", "tracking_number": "TRACK999"},
        headers=auth_headers(admin_token),
        params={"include_pii": True},
    )
    assert updated.status_code == 200, updated.text
    updated_data = updated.json()
    assert updated_data["status"] == "paid"
    assert updated_data["tracking_number"] == "TRACK999"
    assert updated_data["customer_email"] == "buyer@example.com"
    assert updated_data["shipping_address"]["line1"] == "123 Main"

    sales_search = client.get(
        "/api/v1/orders/admin/search",
        params={"status": "sales", "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert sales_search.status_code == 200, sales_search.text
    sales_payload = sales_search.json()
    assert any(item["id"] == order_id for item in sales_payload["items"])
    assert not any(item["id"] == order_two_id for item in sales_payload["items"])

    updated_address = client.patch(
        f"/api/v1/orders/admin/{order_id}/addresses",
        json={
            "shipping_address": {
                "line1": "999 New Street",
                "city": "Cluj",
                "postal_code": "400000",
                "country": "RO",
            },
            "rerate_shipping": True,
            "note": "Fix shipping address",
        },
        headers=auth_headers(admin_token),
        params={"include_pii": True},
    )
    assert updated_address.status_code == 200, updated_address.text
    updated_address_data = updated_address.json()
    assert updated_address_data["shipping_address"]["line1"] == "999 New Street"
    assert updated_address_data["shipping_address"]["id"] != str(shipping_address_id)

    async def assert_address_snapshot() -> None:
        async with SessionLocal() as session:
            original = await session.get(Address, shipping_address_id)
            assert original is not None
            assert original.line1 == "123 Main"

            db_order = await session.get(Order, UUID(order_id))
            assert db_order is not None
            await session.refresh(db_order, attribute_names=["shipping_address"])
            assert db_order.shipping_address_id != shipping_address_id
            assert db_order.shipping_address is not None
            assert db_order.shipping_address.user_id is None
            assert db_order.shipping_address.line1 == "999 New Street"

    asyncio.run(assert_address_snapshot())

    async def seed_payment_retries() -> None:
        async with SessionLocal() as session:
            db_order = (await session.execute(select(Order).where(Order.id == UUID(order_id)))).scalar_one()
            db_order.payment_retry_count = 2
            session.add(db_order)
            await session.commit()

    asyncio.run(seed_payment_retries())
    detail_retry = client.get(f"/api/v1/orders/admin/{order_id}", headers=auth_headers(admin_token))
    assert detail_retry.status_code == 200, detail_retry.text
    retry_signals = {signal["code"]: signal for signal in (detail_retry.json().get("fraud_signals") or [])}
    assert retry_signals["payment_retries"]["data"]["count"] == 2

    tagged = client.post(
        f"/api/v1/orders/admin/{order_id}/tags",
        json={"tag": "VIP"},
        headers=auth_headers(admin_token),
    )
    assert tagged.status_code == 200, tagged.text
    tagged_data = tagged.json()
    assert tagged_data["tags"] == ["vip"]

    tags_list = client.get("/api/v1/orders/admin/tags", headers=auth_headers(admin_token))
    assert tags_list.status_code == 200, tags_list.text
    assert "vip" in tags_list.json()["items"]

    tagged_search = client.get(
        "/api/v1/orders/admin/search",
        params={"tag": "vip", "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert tagged_search.status_code == 200, tagged_search.text
    tagged_payload = tagged_search.json()
    assert any(item["id"] == order_id for item in tagged_payload["items"])

    removed = client.delete(
        f"/api/v1/orders/admin/{order_id}/tags/vip",
        headers=auth_headers(admin_token),
    )
    assert removed.status_code == 200, removed.text
    removed_data = removed.json()
    assert removed_data["tags"] == []

    tagged_search_after = client.get(
        "/api/v1/orders/admin/search",
        params={"tag": "vip", "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert tagged_search_after.status_code == 200, tagged_search_after.text
    tagged_payload_after = tagged_search_after.json()
    assert not any(item["id"] == order_id for item in tagged_payload_after["items"])

    test_tagged = client.post(
        f"/api/v1/orders/admin/{order_id}/tags",
        json={"tag": "test"},
        headers=auth_headers(admin_token),
    )
    assert test_tagged.status_code == 200, test_tagged.text

    exclude_test = client.get(
        "/api/v1/orders/admin/search",
        params={"page": 1, "limit": 10, "include_test": False},
        headers=auth_headers(admin_token),
    )
    assert exclude_test.status_code == 200, exclude_test.text
    assert not any(item["id"] == order_id for item in exclude_test.json()["items"])

    tag_test = client.get(
        "/api/v1/orders/admin/search",
        params={"tag": "test", "page": 1, "limit": 10, "include_test": False},
        headers=auth_headers(admin_token),
    )
    assert tag_test.status_code == 200, tag_test.text
    assert any(item["id"] == order_id for item in tag_test.json()["items"])


def test_order_create_and_admin_updates(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    admin_token, _ = create_user_token(SessionLocal, email="admin@example.com", admin=True)
    _, owner_id = create_user_token(SessionLocal, email="owner@example.com", admin=True)

    async def promote_owner() -> None:
        async with SessionLocal() as session:
            owner = (await session.execute(select(User).where(User.id == owner_id))).scalar_one()
            owner.role = UserRole.owner
            owner.email_verified = True
            owner.preferred_language = "en"
            session.add(owner)
            await session.commit()

    asyncio.run(promote_owner())
    seed_cart_with_product(SessionLocal, user_id)

    async def seed_shipping():
        async with SessionLocal() as session:
            method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Standard", rate_flat=5.0, rate_per_kg=0)
            )
            return method.id

    shipping_method_id = asyncio.run(seed_shipping())

    sent = {"count": 0, "shipped": 0, "delivered": 0, "refund": 0}
    refund_meta: dict[str, str | None] = {"to": None, "requested_by": None, "note": None}

    async def fake_send_order_confirmation(to_email, order, items=None, lang=None, *, receipt_share_days=None):
        sent["count"] += 1
        return True

    async def fake_send_shipping_update(to_email, order, tracking=None, lang=None):
        sent["shipped"] += 1
        return True

    async def fake_send_delivery_confirmation(to_email, order, lang=None):
        sent["delivered"] += 1
        return True

    async def fake_send_refund_requested_notification(
        to_email, order, customer_email=None, requested_by_email=None, note=None, lang=None
    ):
        sent["refund"] += 1
        refund_meta["to"] = to_email
        refund_meta["requested_by"] = requested_by_email
        refund_meta["note"] = note
        return True

    email_service.send_order_confirmation = fake_send_order_confirmation  # type: ignore[assignment]
    email_service.send_shipping_update = fake_send_shipping_update  # type: ignore[assignment]
    email_service.send_delivery_confirmation = fake_send_delivery_confirmation  # type: ignore[assignment]
    email_service.send_refund_requested_notification = fake_send_refund_requested_notification  # type: ignore[assignment]

    res = client.post(
        "/api/v1/orders",
        json={"shipping_method_id": str(shipping_method_id)},
        headers=auth_headers(token),
    )
    assert res.status_code == 201, res.text
    order = res.json()
    assert order["status"] == "pending_acceptance"
    assert order["reference_code"]
    assert float(order["shipping_amount"]) >= 0
    order_id = order["id"]
    item_id = order["items"][0]["id"]
    assert sent["count"] == 1

    async def seed_stripe_pending_payment_order() -> str:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_payment,
                reference_code="RETRY1",
                customer_email="buyer@example.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="stripe",
                stripe_payment_intent_id="pi_retry_1",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return str(order.id)

    stripe_order_id = asyncio.run(seed_stripe_pending_payment_order())
    retry = client.post(f"/api/v1/orders/admin/{stripe_order_id}/retry-payment", headers=auth_headers(admin_token))
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

    async def seed_cod_pending_acceptance_order() -> str:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="CODPEND1",
                customer_email="buyer@example.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return str(order.id)

    cod_pending_id = asyncio.run(seed_cod_pending_acceptance_order())
    cod_ship = client.patch(
        f"/api/v1/orders/admin/{cod_pending_id}",
        json={"status": "shipped"},
        headers=auth_headers(admin_token),
    )
    assert cod_ship.status_code == 200, cod_ship.text
    assert cod_ship.json()["status"] == "shipped"

    # invalid transition pending -> refunded
    bad = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "refunded"},
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

    courier_update = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"courier": "sameday"},
        headers=auth_headers(admin_token),
    )
    assert courier_update.status_code == 200
    assert courier_update.json()["courier"] == "sameday"

    final = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "shipped"},
        headers=auth_headers(admin_token),
    )
    assert final.status_code == 200
    assert final.json()["status"] == "shipped"

    async def attach_coupon_redemption() -> None:
        async with SessionLocal() as session:
            promo = Promotion(
                name="Test coupon",
                description="Test coupon",
                discount_type=PromotionDiscountType.amount,
                amount_off=Decimal("5.00"),
                allow_on_sale_items=True,
                is_active=True,
                is_automatic=False,
            )
            session.add(promo)
            await session.commit()
            await session.refresh(promo)

            coupon = Coupon(
                promotion_id=promo.id,
                code="TEST-REFUND-5",
                visibility=CouponVisibility.public,
                is_active=True,
                per_customer_max_redemptions=1,
            )
            session.add(coupon)
            await session.commit()
            await session.refresh(coupon)

            db_order = await session.get(Order, UUID(order_id))
            assert db_order
            db_order.promo_code = coupon.code
            session.add(db_order)
            await session.commit()

            session.add(
                CouponRedemption(
                    coupon_id=coupon.id,
                    user_id=user_id,
                    order_id=db_order.id,
                    discount_ron=Decimal("5.00"),
                    shipping_discount_ron=Decimal("0.00"),
                )
            )
            await session.commit()

    asyncio.run(attach_coupon_redemption())

    refund = client.post(
        f"/api/v1/orders/admin/{order_id}/refund",
        headers=auth_headers(admin_token),
        json={"password": "orderpass", "note": "Customer requested refund"},
    )
    assert refund.status_code == 200
    assert refund.json()["status"] == "refunded"
    assert any(evt["event"] == "refund_requested" for evt in refund.json()["events"])
    async def assert_coupon_voided() -> None:
        async with SessionLocal() as session:
            redemption = (
                (
                    await session.execute(
                        select(CouponRedemption).where(CouponRedemption.order_id == UUID(order_id))
                    )
                )
                .scalars()
                .first()
            )
            assert redemption is not None
            assert redemption.voided_at is not None
            assert redemption.void_reason == "refunded"

    asyncio.run(assert_coupon_voided())
    assert sent["refund"] == 1
    assert refund_meta["to"] == "owner@example.com"
    assert refund_meta["requested_by"] == "admin@example.com"
    assert refund_meta["note"] == "Customer requested refund"

    events = client.get(f"/api/v1/orders/admin/{order_id}/events", headers=auth_headers(admin_token))
    assert events.status_code == 200
    assert len(events.json()) >= 4

    packing = client.get(f"/api/v1/orders/admin/{order_id}/packing-slip", headers=auth_headers(admin_token))
    assert packing.status_code == 200
    assert packing.headers.get("content-type", "").startswith("application/pdf")
    assert packing.headers.get("content-disposition", "").startswith("attachment;")
    assert packing.content.startswith(b"%PDF")
    assert sent["shipped"] == 2

    batch_packing = client.post(
        "/api/v1/orders/admin/batch/packing-slips",
        headers=auth_headers(admin_token),
        json={"order_ids": [order_id, stripe_order_id]},
    )
    assert batch_packing.status_code == 200
    assert batch_packing.headers.get("content-type", "").startswith("application/pdf")
    assert batch_packing.headers.get("content-disposition", "").startswith("attachment;")
    assert batch_packing.content.startswith(b"%PDF")

    pick_list_csv = client.post(
        "/api/v1/orders/admin/batch/pick-list.csv",
        headers=auth_headers(admin_token),
        json={"order_ids": [order_id, stripe_order_id]},
    )
    assert pick_list_csv.status_code == 200, pick_list_csv.text
    assert pick_list_csv.headers.get("content-type", "").startswith("text/csv")
    assert b"sku,product_name,variant,quantity,orders" in pick_list_csv.content

    pick_list_pdf = client.post(
        "/api/v1/orders/admin/batch/pick-list.pdf",
        headers=auth_headers(admin_token),
        json={"order_ids": [order_id, stripe_order_id]},
    )
    assert pick_list_pdf.status_code == 200, pick_list_pdf.text
    assert pick_list_pdf.headers.get("content-type", "").startswith("application/pdf")
    assert pick_list_pdf.headers.get("content-disposition", "").startswith("attachment;")
    assert pick_list_pdf.content.startswith(b"%PDF")

    receipt = client.get(f"/api/v1/orders/{order_id}/receipt", headers=auth_headers(token))
    assert receipt.status_code == 200
    assert receipt.headers.get("content-type", "").startswith("application/pdf")
    assert receipt.headers.get("content-disposition", "").startswith("attachment;")
    assert receipt.content.startswith(b"%PDF")

    other_token, _ = create_user_token(SessionLocal, email="otherbuyer@example.com")
    forbidden = client.get(f"/api/v1/orders/{order_id}/receipt", headers=auth_headers(other_token))
    assert forbidden.status_code == 404

    token = create_receipt_token(order_id=order_id, expires_at=datetime.now(timezone.utc) + timedelta(days=1))
    public_json = client.get(f"/api/v1/orders/receipt/{token}")
    assert public_json.status_code == 200
    assert public_json.json()["order_id"] == order_id

    public_pdf = client.get(f"/api/v1/orders/receipt/{token}/pdf")
    assert public_pdf.status_code == 200
    assert public_pdf.headers.get("content-type", "").startswith("application/pdf")
    assert public_pdf.content.startswith(b"%PDF")

    bad_token = client.get("/api/v1/orders/receipt/invalid-token")
    assert bad_token.status_code == 403

    delivery = client.post(f"/api/v1/orders/admin/{order_id}/delivery-email", headers=auth_headers(admin_token))
    assert delivery.status_code == 200

    assert sent["delivered"] == 1

    confirm = client.post(
        f"/api/v1/orders/admin/{order_id}/confirmation-email",
        headers=auth_headers(admin_token),
        json={"note": "Resend for customer request"},
    )
    assert confirm.status_code == 200
    assert sent["count"] == 2


def test_admin_order_email_events_endpoint(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin-email-events@example.com", admin=True)
    _, user_id = create_user_token(SessionLocal, email="buyer-email-events@example.com")

    async def seed() -> tuple[str, str]:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="EMAIL1",
                customer_email="buyer-email-events@example.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)

            event = EmailDeliveryEvent(
                to_email="buyer-email-events@example.com",
                subject="Comanda EMAIL1 a fost expediată",
                status="sent",
                error_message=None,
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            return str(order.id), str(event.id)

    order_id, event_id = asyncio.run(seed())

    masked = client.get(f"/api/v1/orders/admin/{order_id}/email-events", headers=auth_headers(admin_token))
    assert masked.status_code == 200, masked.text
    rows = masked.json()
    assert len(rows) == 1
    assert rows[0]["id"] == event_id
    assert rows[0]["to_email"] != "buyer-email-events@example.com"
    assert rows[0]["subject"] == "Comanda EMAIL1 a fost expediată"
    assert rows[0]["status"] == "sent"

    unmasked = client.get(
        f"/api/v1/orders/admin/{order_id}/email-events",
        headers=auth_headers(admin_token),
        params={"include_pii": True},
    )
    assert unmasked.status_code == 200, unmasked.text
    rows_pii = unmasked.json()
    assert rows_pii[0]["to_email"] == "buyer-email-events@example.com"


def test_admin_order_tag_stats_and_rename(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin-tags@example.com", admin=True)
    _, user_id = create_user_token(SessionLocal, email="buyer-tags@example.com")

    async def seed_order() -> str:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="TAG1",
                customer_email="buyer-tags@example.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return str(order.id)

    order_id = asyncio.run(seed_order())

    tagged = client.post(
        f"/api/v1/orders/admin/{order_id}/tags",
        json={"tag": "VIP"},
        headers=auth_headers(admin_token),
    )
    assert tagged.status_code == 200, tagged.text
    assert tagged.json()["tags"] == ["vip"]

    stats = client.get("/api/v1/orders/admin/tags/stats", headers=auth_headers(admin_token))
    assert stats.status_code == 200, stats.text
    items = stats.json()["items"]
    vip_row = next((row for row in items if row.get("tag") == "vip"), None)
    assert vip_row is not None
    assert int(vip_row.get("count") or 0) >= 1

    rename = client.post(
        "/api/v1/orders/admin/tags/rename",
        headers=auth_headers(admin_token),
        json={"from_tag": "vip", "to_tag": "priority"},
    )
    assert rename.status_code == 200, rename.text
    assert rename.json()["from_tag"] == "vip"
    assert rename.json()["to_tag"] == "priority"
    assert int(rename.json()["total"] or 0) >= 1

    detail = client.get(f"/api/v1/orders/admin/{order_id}", headers=auth_headers(admin_token))
    assert detail.status_code == 200, detail.text
    assert detail.json()["tags"] == ["priority"]

    old_search = client.get(
        "/api/v1/orders/admin/search",
        params={"tag": "vip", "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert old_search.status_code == 200, old_search.text
    assert not any(item["id"] == order_id for item in old_search.json()["items"])

    new_search = client.get(
        "/api/v1/orders/admin/search",
        params={"tag": "priority", "page": 1, "limit": 10},
        headers=auth_headers(admin_token),
    )
    assert new_search.status_code == 200, new_search.text
    assert any(item["id"] == order_id for item in new_search.json()["items"])


def test_admin_partial_refunds(test_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin-refunds@example.com", admin=True)
    customer_token, customer_id = create_user_token(SessionLocal, email="buyer-refunds@example.com")

    async def seed_paid_order(*, payment_method: str, intent_id: str | None = None) -> tuple[str, str]:
        async with SessionLocal() as session:
            category = Category(slug=f"refund-cat-{payment_method}", name="Refunds")
            product = Product(
                category=category,
                slug=f"refund-item-{payment_method}",
                sku=f"RFND-{payment_method.upper()}",
                name="Refund Item",
                base_price=Decimal("20.00"),
                currency="RON",
                stock_quantity=5,
                status=ProductStatus.published,
            )
            session.add(product)
            await session.flush()

            order = Order(
                user_id=customer_id,
                status=OrderStatus.paid,
                reference_code=f"REF-{payment_method.upper()}",
                customer_email="buyer-refunds@example.com",
                customer_name="Buyer",
                total_amount=Decimal("100.00"),
                tax_amount=Decimal("0.00"),
                fee_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method=payment_method,
                stripe_payment_intent_id=intent_id,
            )
            session.add(order)
            await session.flush()

            item = OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=5,
                unit_price=Decimal("20.00"),
                subtotal=Decimal("100.00"),
            )
            session.add(item)
            session.add(OrderEvent(order_id=order.id, event="payment_captured", note="seed"))
            await session.commit()
            return str(order.id), str(item.id)

    order_id, item_id = asyncio.run(seed_paid_order(payment_method="cod"))

    # Unauthorized
    forbidden = client.post(
        f"/api/v1/orders/admin/{order_id}/refunds",
        headers=auth_headers(customer_token),
        json={"password": "orderpass", "amount": "10.00", "note": "Nope", "process_payment": False},
    )
    assert forbidden.status_code == 403

    # Manual partial refund record
    partial = client.post(
        f"/api/v1/orders/admin/{order_id}/refunds",
        headers=auth_headers(admin_token),
        json={
            "password": "orderpass",
            "amount": "10.00",
            "note": "Partial refund for one item",
            "items": [{"order_item_id": item_id, "quantity": 1}],
            "process_payment": False,
        },
    )
    assert partial.status_code == 200, partial.text
    assert partial.json()["status"] == "paid"
    assert any(evt["event"] == "refund_partial" for evt in partial.json().get("events", []))
    refunds = partial.json().get("refunds") or []
    assert len(refunds) == 1
    assert refunds[0]["provider"] == "manual"

    # Cannot refund more than the selected items total.
    bad_amount = client.post(
        f"/api/v1/orders/admin/{order_id}/refunds",
        headers=auth_headers(admin_token),
        json={
            "password": "orderpass",
            "amount": "30.00",
            "note": "Too high for one unit",
            "items": [{"order_item_id": item_id, "quantity": 1}],
            "process_payment": False,
        },
    )
    assert bad_amount.status_code == 400

    # Cannot refund more item quantity than remains (cumulative).
    bad_qty = client.post(
        f"/api/v1/orders/admin/{order_id}/refunds",
        headers=auth_headers(admin_token),
        json={
            "password": "orderpass",
            "amount": "10.00",
            "note": "Too many units",
            "items": [{"order_item_id": item_id, "quantity": 5}],
            "process_payment": False,
        },
    )
    assert bad_qty.status_code == 400

    # Cannot refund beyond remaining amount
    too_much = client.post(
        f"/api/v1/orders/admin/{order_id}/refunds",
        headers=auth_headers(admin_token),
        json={"password": "orderpass", "amount": "95.00", "note": "Too much", "process_payment": False},
    )
    assert too_much.status_code == 400

    # Final partial refund completes the order refund
    final = client.post(
        f"/api/v1/orders/admin/{order_id}/refunds",
        headers=auth_headers(admin_token),
        json={"password": "orderpass", "amount": "90.00", "note": "Complete refund", "process_payment": False},
    )
    assert final.status_code == 200
    assert final.json()["status"] == "refunded"
    assert len(final.json().get("refunds") or []) == 2

    # Stripe sync path (monkeypatched)
    stripe_order_id, stripe_item_id = asyncio.run(seed_paid_order(payment_method="stripe", intent_id="pi_test_123"))
    called: dict[str, object] = {}

    async def fake_refund_payment_intent(intent: str, *, amount_cents: int | None = None) -> dict:
        called["intent"] = intent
        called["amount_cents"] = amount_cents
        return {"id": "re_test_123"}

    monkeypatch.setattr(payments_service, "refund_payment_intent", fake_refund_payment_intent)

    stripe_refund = client.post(
        f"/api/v1/orders/admin/{stripe_order_id}/refunds",
        headers=auth_headers(admin_token),
        json={
            "password": "orderpass",
            "amount": "12.34",
            "note": "Stripe partial refund",
            "items": [{"order_item_id": stripe_item_id, "quantity": 1}],
            "process_payment": True,
        },
    )
    assert stripe_refund.status_code == 200, stripe_refund.text
    payload = stripe_refund.json()
    assert called.get("intent") == "pi_test_123"
    assert called.get("amount_cents") == 1234
    assert len(payload.get("refunds") or []) == 1
    assert payload["refunds"][0]["provider"] == "stripe"
    assert payload["refunds"][0]["provider_refund_id"] == "re_test_123"


def test_capture_void_export_and_reorder(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal, email="buyer2@example.com")
    admin_token, _ = create_user_token(SessionLocal, email="admin2@example.com", admin=True)
    seed_cart_with_product(SessionLocal, user_id)

    async def seed_shipping():
        async with SessionLocal() as session:
            method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Express", rate_flat=10.0, rate_per_kg=0)
            )
            return method.id

    shipping_method_id = asyncio.run(seed_shipping())

    async def fake_email(to_email, order, items=None, lang=None, *, receipt_share_days=None):
        return True

    monkeypatch.setattr(email_service, "send_order_confirmation", fake_email)

    res = client.post(
        "/api/v1/orders",
        json={"shipping_method_id": str(shipping_method_id)},
        headers=auth_headers(token),
    )
    assert res.status_code == 201
    order = res.json()
    order_id = order["id"]

    async def attach_intent():
        async with SessionLocal() as session:
            result = await session.execute(select(Order).where(Order.id == UUID(order_id)))
            db_order = result.scalar_one()
            db_order.stripe_payment_intent_id = "pi_test_123"
            await session.commit()

    asyncio.run(attach_intent())

    async def attach_coupon_reservation() -> None:
        async with SessionLocal() as session:
            promo = Promotion(
                name="Test coupon",
                description="Test coupon",
                discount_type=PromotionDiscountType.amount,
                amount_off=Decimal("3.00"),
                allow_on_sale_items=True,
                is_active=True,
                is_automatic=False,
            )
            session.add(promo)
            await session.commit()
            await session.refresh(promo)

            coupon = Coupon(
                promotion_id=promo.id,
                code="TEST-CAPTURE-3",
                visibility=CouponVisibility.public,
                is_active=True,
                per_customer_max_redemptions=1,
            )
            session.add(coupon)
            await session.commit()
            await session.refresh(coupon)

            db_order = await session.get(Order, UUID(order_id))
            assert db_order
            db_order.promo_code = coupon.code
            session.add(db_order)
            await session.commit()

            session.add(
                CouponReservation(
                    coupon_id=coupon.id,
                    user_id=user_id,
                    order_id=db_order.id,
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                    discount_ron=Decimal("3.00"),
                    shipping_discount_ron=Decimal("0.00"),
                )
            )
            await session.commit()

    asyncio.run(attach_coupon_reservation())

    async def fake_capture(intent_id: str):
        return {"id": intent_id, "status": "succeeded"}

    async def fake_void(intent_id: str):
        return {"id": intent_id, "status": "canceled"}

    monkeypatch.setattr(payments_service, "capture_payment_intent", fake_capture)
    monkeypatch.setattr(payments_service, "void_payment_intent", fake_void)

    capture = client.post(
        f"/api/v1/orders/admin/{order_id}/capture-payment",
        headers=auth_headers(admin_token),
    )
    assert capture.status_code == 200
    assert capture.json()["status"] == "pending_acceptance"
    assert capture.json()["stripe_payment_intent_id"] == "pi_test_123"
    assert any(evt["event"] == "payment_captured" for evt in capture.json()["events"])
    async def assert_coupon_redeemed() -> None:
        async with SessionLocal() as session:
            redemption = (
                (
                    await session.execute(
                        select(CouponRedemption).where(CouponRedemption.order_id == UUID(order_id))
                    )
                )
                .scalars()
                .first()
            )
            assert redemption is not None
            assert redemption.discount_ron == Decimal("3.00")
            assert redemption.voided_at is None

            reservation_count = int(
                (
                    await session.execute(
                        select(func.count())
                        .select_from(CouponReservation)
                        .where(CouponReservation.order_id == UUID(order_id))
                    )
                ).scalar_one()
            )
            assert reservation_count == 0

    asyncio.run(assert_coupon_redeemed())

    void = client.post(
        f"/api/v1/orders/admin/{order_id}/void-payment",
        headers=auth_headers(admin_token),
    )
    assert void.status_code == 200
    assert void.json()["status"] == "cancelled"
    assert any(evt["event"] == "payment_voided" for evt in void.json()["events"])
    async def assert_coupon_voided() -> None:
        async with SessionLocal() as session:
            redemption = (
                (
                    await session.execute(
                        select(CouponRedemption).where(CouponRedemption.order_id == UUID(order_id))
                    )
                )
                .scalars()
                .first()
            )
            assert redemption is not None
            assert redemption.voided_at is not None
            assert redemption.void_reason == "payment_voided"

    asyncio.run(assert_coupon_voided())

    export_resp = client.get("/api/v1/orders/admin/export", headers=auth_headers(admin_token))
    assert export_resp.status_code == 200
    assert "text/csv" in export_resp.headers.get("content-type", "")
    assert "reference_code" in export_resp.text

    export_cols = client.get(
        "/api/v1/orders/admin/export",
        params=[("columns", "reference_code"), ("columns", "status")],
        headers=auth_headers(admin_token),
    )
    assert export_cols.status_code == 200
    header = export_cols.text.splitlines()[0]
    assert header == "reference_code,status"

    export_invalid = client.get(
        "/api/v1/orders/admin/export",
        params=[("columns", "nope")],
        headers=auth_headers(admin_token),
    )
    assert export_invalid.status_code == 400

    reorder_resp = client.post(f"/api/v1/orders/{order_id}/reorder", headers=auth_headers(token))
    assert reorder_resp.status_code == 200
    assert len(reorder_resp.json()["items"]) == 1
    assert reorder_resp.json()["items"][0]["product_id"]


def test_admin_order_shipments_crud(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal, email="buyer-shipments@example.com")
    admin_token, _ = create_user_token(SessionLocal, email="admin-shipments@example.com", admin=True)
    seed_cart_with_product(SessionLocal, user_id)

    async def seed_shipping() -> UUID:
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
    order_id = res.json()["id"]

    created = client.post(
        f"/api/v1/orders/admin/{order_id}/shipments",
        json={"tracking_number": "TRACK1", "courier": "sameday", "tracking_url": "https://example.com/track/1"},
        headers=auth_headers(admin_token),
    )
    assert created.status_code == 200, created.text
    assert created.json()["tracking_number"] == "TRACK1"
    assert len(created.json().get("shipments") or []) == 1

    listed = client.get(
        f"/api/v1/orders/admin/{order_id}/shipments",
        headers=auth_headers(admin_token),
    )
    assert listed.status_code == 200, listed.text
    shipments = listed.json()
    assert len(shipments) == 1
    shipment_id = shipments[0]["id"]
    assert shipments[0]["tracking_number"] == "TRACK1"

    updated = client.patch(
        f"/api/v1/orders/admin/{order_id}/shipments/{shipment_id}",
        json={"tracking_url": "https://example.com/track/new"},
        headers=auth_headers(admin_token),
    )
    assert updated.status_code == 200, updated.text
    updated_shipments = updated.json().get("shipments") or []
    assert any(s["id"] == shipment_id and s["tracking_url"] == "https://example.com/track/new" for s in updated_shipments)

    duplicate = client.post(
        f"/api/v1/orders/admin/{order_id}/shipments",
        json={"tracking_number": "TRACK1"},
        headers=auth_headers(admin_token),
    )
    assert duplicate.status_code == 409

    deleted = client.delete(
        f"/api/v1/orders/admin/{order_id}/shipments/{shipment_id}",
        headers=auth_headers(admin_token),
    )
    assert deleted.status_code == 200, deleted.text
    assert all(s["id"] != shipment_id for s in (deleted.json().get("shipments") or []))


def test_admin_accept_requires_payment_capture_and_cancel_reason(
    test_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    async def fake_email(*_args, **_kwargs):
        return True

    monkeypatch.setattr(email_service, "send_order_processing_update", fake_email)
    monkeypatch.setattr(email_service, "send_order_cancelled_update", fake_email)
    monkeypatch.setattr(email_service, "send_order_refunded_update", fake_email)
    monkeypatch.setattr(email_service, "send_shipping_update", fake_email)
    monkeypatch.setattr(email_service, "send_delivery_confirmation", fake_email)

    _token, user_id = create_user_token(SessionLocal, email="buyer-paycap@example.com")
    admin_token, _ = create_user_token(SessionLocal, email="admin-paycap@example.com", admin=True)

    async def seed_stripe_order() -> UUID:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="PAYCAP",
                customer_email="buyer-paycap@example.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="stripe",
                stripe_payment_intent_id="pi_paycap",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return order.id

    stripe_order_id = asyncio.run(seed_stripe_order())
    stripe_order_id_str = str(stripe_order_id)

    accept_without_capture = client.patch(
        f"/api/v1/orders/admin/{stripe_order_id_str}",
        headers=auth_headers(admin_token),
        json={"status": "paid"},
    )
    assert accept_without_capture.status_code == 400, accept_without_capture.text
    assert "Payment is not captured" in accept_without_capture.text

    async def seed_capture_event() -> None:
        async with SessionLocal() as session:
            session.add(OrderEvent(order_id=stripe_order_id, event="payment_captured", note="test"))
            await session.commit()

    asyncio.run(seed_capture_event())

    accept_with_capture = client.patch(
        f"/api/v1/orders/admin/{stripe_order_id_str}",
        headers=auth_headers(admin_token),
        json={"status": "paid"},
    )
    assert accept_with_capture.status_code == 200, accept_with_capture.text
    assert accept_with_capture.json()["status"] == "paid"

    cancel_paid_missing_reason = client.patch(
        f"/api/v1/orders/admin/{stripe_order_id_str}",
        headers=auth_headers(admin_token),
        json={"status": "cancelled"},
    )
    assert cancel_paid_missing_reason.status_code == 400, cancel_paid_missing_reason.text
    assert "Cancel reason is required" in cancel_paid_missing_reason.text

    cancel_paid = client.patch(
        f"/api/v1/orders/admin/{stripe_order_id_str}",
        headers=auth_headers(admin_token),
        json={"status": "cancelled", "cancel_reason": "Customer requested cancellation"},
    )
    assert cancel_paid.status_code == 200, cancel_paid.text
    assert cancel_paid.json()["status"] == "cancelled"
    assert cancel_paid.json()["cancel_reason"] == "Customer requested cancellation"

    async def seed_pending_order() -> UUID:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="CANCEL1",
                customer_email="buyer-paycap@example.com",
                customer_name="Buyer",
                total_amount=Decimal("11.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return order.id

    pending_id = asyncio.run(seed_pending_order())
    pending_id_str = str(pending_id)

    cancel_missing_reason = client.patch(
        f"/api/v1/orders/admin/{pending_id_str}",
        headers=auth_headers(admin_token),
        json={"status": "cancelled"},
    )
    assert cancel_missing_reason.status_code == 400, cancel_missing_reason.text
    assert "Cancel reason is required" in cancel_missing_reason.text

    cancel = client.patch(
        f"/api/v1/orders/admin/{pending_id_str}",
        headers=auth_headers(admin_token),
        json={"status": "cancelled", "cancel_reason": "Out of stock"},
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"
    assert cancel.json()["cancel_reason"] == "Out of stock"

    edit_reason = client.patch(
        f"/api/v1/orders/admin/{pending_id_str}",
        headers=auth_headers(admin_token),
        json={"cancel_reason": "Out of stock (refund issued)"},
    )
    assert edit_reason.status_code == 200, edit_reason.text
    assert edit_reason.json()["cancel_reason"] == "Out of stock (refund issued)"


def test_admin_cancel_restores_stock_for_committed_orders(
    test_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    async def fake_email(*_args, **_kwargs):
        return True

    monkeypatch.setattr(email_service, "send_order_processing_update", fake_email)
    monkeypatch.setattr(email_service, "send_order_cancelled_update", fake_email)

    _, user_id = create_user_token(SessionLocal, email="buyer-stock@example.com")
    admin_token, _ = create_user_token(SessionLocal, email="admin-stock@example.com", admin=True)

    async def seed_order_with_stock() -> tuple[UUID, UUID]:
        async with SessionLocal() as session:
            category = Category(slug="stock", name="Stock")
            product = Product(
                category=category,
                slug="stock-prod",
                sku="STOCK-PROD",
                name="Stock Product",
                base_price=Decimal("20.00"),
                currency="RON",
                stock_quantity=5,
                status=ProductStatus.published,
            )
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="STOCK1",
                customer_email="buyer-stock@example.com",
                customer_name="Buyer Stock",
                total_amount=Decimal("40.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
                payment_method="cod",
            )
            session.add_all([product, order])
            await session.flush()
            session.add(
                OrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    variant_id=None,
                    quantity=2,
                    unit_price=Decimal("20.00"),
                    subtotal=Decimal("40.00"),
                )
            )
            await session.commit()
            await session.refresh(order)
            await session.refresh(product)
            return order.id, product.id

    order_id, product_id = asyncio.run(seed_order_with_stock())

    accept = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        headers=auth_headers(admin_token),
        json={"status": "paid"},
    )
    assert accept.status_code == 200, accept.text
    assert accept.json()["status"] == "paid"

    async def get_stock() -> int:
        async with SessionLocal() as session:
            prod = await session.get(Product, product_id)
            assert prod is not None
            return int(getattr(prod, "stock_quantity", 0) or 0)

    assert asyncio.run(get_stock()) == 3

    cancel = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        headers=auth_headers(admin_token),
        json={"status": "cancelled", "cancel_reason": "Customer requested cancellation"},
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"

    assert asyncio.run(get_stock()) == 5


def test_admin_shipping_label_upload_download_and_delete(
    test_app: Dict[str, object], tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    token, user_id = create_user_token(SessionLocal, email="buyer2@example.com")
    admin_token, _ = create_user_token(SessionLocal, email="admin2@example.com", admin=True)

    async def seed_order() -> UUID:
        async with SessionLocal() as session:
            order = Order(
                user_id=user_id,
                status=OrderStatus.pending_acceptance,
                reference_code="SHIPLABEL",
                customer_email="buyer2@example.com",
                customer_name="Buyer Two",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
            )
            session.add(order)
            await session.commit()
            await session.refresh(order)
            return order.id

    order_id = asyncio.run(seed_order())

    forbidden = client.post(
        f"/api/v1/orders/admin/{order_id}/shipping-label",
        headers=auth_headers(token),
        files={"file": ("label.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert forbidden.status_code == 403

    upload = client.post(
        f"/api/v1/orders/admin/{order_id}/shipping-label",
        headers=auth_headers(admin_token),
        files={"file": ("label.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["has_shipping_label"] is True
    assert body["shipping_label_filename"] == "label.pdf"
    assert body["shipping_label_uploaded_at"]

    async def get_label_path() -> str:
        async with SessionLocal() as session:
            o = (await session.execute(select(Order).where(Order.id == order_id))).scalar_one()
            assert o.shipping_label_path
            return str(o.shipping_label_path)

    first_path = asyncio.run(get_label_path())
    assert (tmp_path / "private_uploads" / first_path).exists()

    download = client.get(
        f"/api/v1/orders/admin/{order_id}/shipping-label",
        headers=auth_headers(admin_token),
    )
    assert download.status_code == 200, download.text
    assert download.content.startswith(b"%PDF")

    upload2 = client.post(
        f"/api/v1/orders/admin/{order_id}/shipping-label",
        headers=auth_headers(admin_token),
        files={"file": ("label2.pdf", b"%PDF-1.7 test2", "application/pdf")},
    )
    assert upload2.status_code == 200, upload2.text
    second_path = asyncio.run(get_label_path())
    assert second_path != first_path
    assert not (tmp_path / "private_uploads" / first_path).exists()
    assert (tmp_path / "private_uploads" / second_path).exists()

    delete = client.delete(
        f"/api/v1/orders/admin/{order_id}/shipping-label",
        headers=auth_headers(admin_token),
    )
    assert delete.status_code == 204, delete.text
    assert not (tmp_path / "private_uploads" / second_path).exists()

    missing = client.get(
        f"/api/v1/orders/admin/{order_id}/shipping-label",
        headers=auth_headers(admin_token),
    )
    assert missing.status_code == 404


def test_admin_batch_shipping_labels_zip(test_app: Dict[str, object], tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    admin_token, _ = create_user_token(SessionLocal, email="admin-batch-labels@example.com", admin=True)

    async def seed_orders() -> tuple[UUID, UUID]:
        async with SessionLocal() as session:
            first = Order(
                user_id=None,
                status=OrderStatus.pending_acceptance,
                reference_code="BATCHLABEL1",
                customer_email="batch1@example.com",
                customer_name="Batch One",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
            )
            second = Order(
                user_id=None,
                status=OrderStatus.pending_acceptance,
                reference_code="BATCHLABEL2",
                customer_email="batch2@example.com",
                customer_name="Batch Two",
                total_amount=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                currency="RON",
            )
            session.add_all([first, second])
            await session.commit()
            await session.refresh(first)
            await session.refresh(second)
            return first.id, second.id

    first_id, second_id = asyncio.run(seed_orders())

    missing_all = client.post(
        "/api/v1/orders/admin/batch/shipping-labels.zip",
        headers=auth_headers(admin_token),
        json={"order_ids": [str(first_id), str(second_id)]},
    )
    assert missing_all.status_code == 404
    assert str(first_id) in (missing_all.json().get("detail") or {}).get("missing_shipping_label_order_ids", [])

    upload_first = client.post(
        f"/api/v1/orders/admin/{first_id}/shipping-label",
        headers=auth_headers(admin_token),
        files={"file": ("label.pdf", b"%PDF-1.4 first", "application/pdf")},
    )
    assert upload_first.status_code == 200, upload_first.text

    missing_one = client.post(
        "/api/v1/orders/admin/batch/shipping-labels.zip",
        headers=auth_headers(admin_token),
        json={"order_ids": [str(first_id), str(second_id)]},
    )
    assert missing_one.status_code == 404
    assert str(second_id) in (missing_one.json().get("detail") or {}).get("missing_shipping_label_order_ids", [])

    upload_second = client.post(
        f"/api/v1/orders/admin/{second_id}/shipping-label",
        headers=auth_headers(admin_token),
        files={"file": ("label2.pdf", b"%PDF-1.4 second", "application/pdf")},
    )
    assert upload_second.status_code == 200, upload_second.text

    download = client.post(
        "/api/v1/orders/admin/batch/shipping-labels.zip",
        headers=auth_headers(admin_token),
        json={"order_ids": [str(first_id), str(second_id)]},
    )
    assert download.status_code == 200, download.text
    assert download.headers.get("content-type", "").startswith("application/zip")
    assert download.content[:2] == b"PK"

    import io
    import zipfile

    with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
        names = zf.namelist()
        assert any("BATCHLABEL1" in name for name in names)
        assert any("BATCHLABEL2" in name for name in names)
        first_file = zf.read(names[0])
        assert first_file.startswith(b"%PDF")
