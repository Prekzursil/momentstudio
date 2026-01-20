import asyncio
import uuid
from datetime import datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductStatus
from app.models.order import Order, OrderItem, OrderStatus
from app.models.user import User, UserRole


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


async def _seed_admin(session_factory) -> None:
    settings.maintenance_mode = False
    async with session_factory() as session:
        existing = (await session.execute(select(User).where(User.email == "admin@example.com"))).scalar_one_or_none()
        if existing:
            return
        admin = User(
            email="admin@example.com",
            username="admin",
            hashed_password=security.hash_password("Password123"),
            name="Admin",
            role=UserRole.admin,
            email_verified=True,
        )
        session.add(admin)
        await session.commit()


def _auth_headers(client: TestClient, session_factory) -> dict[str, str]:
    asyncio.run(_seed_admin(session_factory))
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}


async def _seed_order(session_factory) -> tuple[uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        suffix = uuid.uuid4().hex[:8]
        user = User(
            email=f"user-{suffix}@example.com",
            username=f"user_{suffix}",
            hashed_password=security.hash_password("Password123"),
            name=f"Customer {suffix}",
            role=UserRole.customer,
            email_verified=True,
        )
        session.add(user)

        cat = Category(slug=f"cat-{suffix}", name="Cat", description="d", sort_order=1)
        session.add(cat)
        product = Product(
            slug=f"p-{suffix}",
            name="Product 1",
            base_price=100,
            currency="RON",
            category=cat,
            stock_quantity=10,
            status=ProductStatus.published,
        )
        session.add(product)
        await session.flush()

        order = Order(
            user_id=user.id,
            status=OrderStatus.paid,
            total_amount=100,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            customer_email=user.email,
            customer_name=user.name or user.email,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        session.add(order)
        await session.flush()

        item = OrderItem(
            order_id=order.id,
            product_id=product.id,
            quantity=2,
            shipped_quantity=0,
            unit_price=100,
            subtotal=200,
            created_at=datetime.now(timezone.utc),
        )
        session.add(item)
        await session.commit()

        return order.id, item.id


async def _seed_order_for_user(session_factory, *, email: str, status: OrderStatus) -> tuple[uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        suffix = uuid.uuid4().hex[:8]
        user = User(
            email=email,
            username=f"user_{suffix}",
            hashed_password=security.hash_password("Password123"),
            name=f"Customer {suffix}",
            role=UserRole.customer,
            email_verified=True,
        )
        session.add(user)

        cat = Category(slug=f"cat-{suffix}", name="Cat", description="d", sort_order=1)
        session.add(cat)
        product = Product(
            slug=f"p-{suffix}",
            name="Product 1",
            base_price=100,
            currency="RON",
            category=cat,
            stock_quantity=10,
            status=ProductStatus.published,
        )
        session.add(product)
        await session.flush()

        order = Order(
            user_id=user.id,
            status=status,
            total_amount=100,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            customer_email=user.email,
            customer_name=user.name or user.email,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        session.add(order)
        await session.flush()

        item = OrderItem(
            order_id=order.id,
            product_id=product.id,
            quantity=2,
            shipped_quantity=0,
            unit_price=100,
            subtotal=200,
            created_at=datetime.now(timezone.utc),
        )
        session.add(item)
        await session.commit()

        return order.id, item.id


def test_admin_can_create_list_and_update_return_request(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]

    headers = _auth_headers(client, session_factory)
    order_id, order_item_id = asyncio.run(_seed_order(session_factory))

    created = client.post(
        "/api/v1/returns/admin",
        headers=headers,
        json={
            "order_id": str(order_id),
            "reason": "Arrived damaged",
            "customer_message": "Box was crushed",
            "items": [{"order_item_id": str(order_item_id), "quantity": 1}],
        },
    )
    assert created.status_code == 201, created.text
    return_id = created.json()["id"]
    assert created.json()["status"] == "requested"

    listed = client.get("/api/v1/returns/admin", headers=headers)
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()["items"]}
    assert return_id in ids

    detail = client.get(f"/api/v1/returns/admin/{return_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["order_id"] == str(order_id)
    assert detail.json()["items"][0]["order_item_id"] == str(order_item_id)

    updated = client.patch(
        f"/api/v1/returns/admin/{return_id}",
        headers=headers,
        json={"status": "approved", "admin_note": "Approved for return"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["status"] == "approved"

def test_create_return_request_rejects_duplicate_order_items(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]

    headers = _auth_headers(client, session_factory)
    order_id, order_item_id = asyncio.run(_seed_order(session_factory))

    created = client.post(
        "/api/v1/returns/admin",
        headers=headers,
        json={
            "order_id": str(order_id),
            "reason": "Too many duplicates",
            "customer_message": "Trying to exceed quantity",
            "items": [
                {"order_item_id": str(order_item_id), "quantity": 1},
                {"order_item_id": str(order_item_id), "quantity": 2},
            ],
        },
    )
    assert created.status_code == 400, created.text


def test_customer_can_request_return_for_delivered_order(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]

    email = f"cust-{uuid.uuid4().hex[:8]}@example.com"
    order_id, order_item_id = asyncio.run(_seed_order_for_user(session_factory, email=email, status=OrderStatus.delivered))

    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    user_headers = {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}

    created = client.post(
        "/api/v1/returns",
        headers=user_headers,
        json={
            "order_id": str(order_id),
            "reason": "Not as expected",
            "customer_message": "Too small",
            "items": [{"order_item_id": str(order_item_id), "quantity": 1}],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["order_id"] == str(order_id)
    assert created.json()["status"] == "requested"
    assert created.json()["items"][0]["order_item_id"] == str(order_item_id)

    duplicate = client.post(
        "/api/v1/returns",
        headers=user_headers,
        json={
            "order_id": str(order_id),
            "reason": "Second request",
            "items": [{"order_item_id": str(order_item_id), "quantity": 1}],
        },
    )
    assert duplicate.status_code == 409, duplicate.text


def test_customer_return_request_rejects_non_delivered(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]

    email = f"cust-{uuid.uuid4().hex[:8]}@example.com"
    order_id, order_item_id = asyncio.run(_seed_order_for_user(session_factory, email=email, status=OrderStatus.paid))

    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    user_headers = {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}

    created = client.post(
        "/api/v1/returns",
        headers=user_headers,
        json={
            "order_id": str(order_id),
            "reason": "Too early",
            "items": [{"order_item_id": str(order_item_id), "quantity": 1}],
        },
    )
    assert created.status_code == 400, created.text


def test_returns_admin_endpoints_require_admin(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]

    async def _seed_customer() -> None:
        async with session_factory() as session:
            user = User(
                email="cust@example.com",
                username="cust",
                hashed_password=security.hash_password("Password123"),
                name="Cust",
                role=UserRole.customer,
                email_verified=True,
            )
            session.add(user)
            await session.commit()

    asyncio.run(_seed_customer())
    common_headers = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "cust@example.com", "password": "Password123"},
        headers=common_headers,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    user_headers = {"Authorization": f"Bearer {token}", "X-Maintenance-Bypass": settings.maintenance_bypass_token}

    forbidden = client.get("/api/v1/returns/admin", headers=user_headers)
    assert forbidden.status_code == 403, forbidden.text
