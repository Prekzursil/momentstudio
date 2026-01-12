import asyncio
from decimal import Decimal
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.address import Address
from app.models.catalog import Category, Product
from app.models.cart import Cart, CartItem
from app.models.order import Order, OrderStatus
from app.models.user import User, UserRole
from app.services.auth import create_user, issue_tokens_for_user
from app.schemas.user import UserCreate
from app.services import order as order_service
from app.services import payments as payments_service
from app.services import email as email_service
from app.schemas.order import ShippingMethodCreate
from app.core.config import settings


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
            user.email_verified = True
            if admin:
                user.role = UserRole.admin
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
                country="RO",
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

    detail = client.get(f"/api/v1/orders/admin/{order_id}", headers=auth_headers(admin_token))
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["customer_email"] == "buyer@example.com"
    assert data["customer_username"] == "buyer"
    assert data["shipping_address"]["line1"] == "123 Main"
    assert data["billing_address"]["line1"] == "456 Billing"

    updated = client.patch(
        f"/api/v1/orders/admin/{order_id}",
        json={"status": "paid", "tracking_number": "TRACK999"},
        headers=auth_headers(admin_token),
    )
    assert updated.status_code == 200, updated.text
    updated_data = updated.json()
    assert updated_data["status"] == "paid"
    assert updated_data["tracking_number"] == "TRACK999"
    assert updated_data["customer_email"] == "buyer@example.com"
    assert updated_data["shipping_address"]["line1"] == "123 Main"


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

    async def fake_send_order_confirmation(to_email, order, items=None):
        sent["count"] += 1
        return True

    async def fake_send_shipping_update(to_email, order, tracking=None):
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
    assert order["status"] == "pending"
    assert order["reference_code"]
    assert float(order["shipping_amount"]) >= 0
    order_id = order["id"]
    item_id = order["items"][0]["id"]
    assert sent["count"] == 1

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
    assert sent["refund"] == 1
    assert refund_meta["to"] == "owner@example.com"
    assert refund_meta["requested_by"] == "admin@example.com"
    assert refund_meta["note"] == "Customer requested refund"

    events = client.get(f"/api/v1/orders/admin/{order_id}/events", headers=auth_headers(admin_token))
    assert events.status_code == 200
    assert len(events.json()) >= 4

    packing = client.get(f"/api/v1/orders/admin/{order_id}/packing-slip", headers=auth_headers(admin_token))
    assert packing.status_code == 200
    assert "Packing slip for order" in packing.text
    assert "Items:" in packing.text
    assert sent["shipped"] == 1

    receipt = client.get(f"/api/v1/orders/{order_id}/receipt", headers=auth_headers(token))
    assert receipt.status_code == 200
    assert receipt.headers.get("content-type", "").startswith("application/pdf")
    assert receipt.headers.get("content-disposition", "").startswith("attachment;")
    assert "Receipt for order" in receipt.text

    other_token, _ = create_user_token(SessionLocal, email="otherbuyer@example.com")
    forbidden = client.get(f"/api/v1/orders/{order_id}/receipt", headers=auth_headers(other_token))
    assert forbidden.status_code == 404

    delivery = client.post(f"/api/v1/orders/admin/{order_id}/delivery-email", headers=auth_headers(admin_token))
    assert delivery.status_code == 200
    assert sent["delivered"] == 1


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

    async def fake_email(to_email, order, items=None):
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
    assert capture.json()["status"] == "paid"
    assert capture.json()["stripe_payment_intent_id"] == "pi_test_123"

    void = client.post(
        f"/api/v1/orders/admin/{order_id}/void-payment",
        headers=auth_headers(admin_token),
    )
    assert void.status_code == 200
    assert void.json()["status"] == "cancelled"
    assert any(evt["event"] == "payment_voided" for evt in void.json()["events"])

    export_resp = client.get("/api/v1/orders/admin/export", headers=auth_headers(admin_token))
    assert export_resp.status_code == 200
    assert "text/csv" in export_resp.headers.get("content-type", "")
    assert "reference_code" in export_resp.text

    reorder_resp = client.post(f"/api/v1/orders/{order_id}/reorder", headers=auth_headers(token))
    assert reorder_resp.status_code == 200
    assert len(reorder_resp.json()["items"]) == 1
    assert reorder_resp.json()["items"][0]["product_id"]


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
                status=OrderStatus.pending,
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
