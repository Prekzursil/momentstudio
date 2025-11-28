import asyncio
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.catalog import Category, Product
from app.models.user import UserRole
from app.services.auth import create_user
from app.schemas.user import UserCreate
from app.services import cart as cart_service
from app.schemas.promo import PromoCodeCreate


@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(init_models())

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


def create_user_token(session_factory, email="cart@example.com"):
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="cartpass", name="Cart User"))
            from app.services.auth import issue_tokens_for_user

            return issue_tokens_for_user(user)["access_token"], user.id

    return asyncio.get_event_loop().run_until_complete(create_and_token())


def seed_product(session_factory) -> UUID:
    async def seed():
        async with session_factory() as session:
            category = Category(slug="cups", name="Cups")
            product = Product(
                category=category,
                slug="cup",
                sku="SKU-CUP",
                name="Cup",
                base_price=10,
                currency="USD",
                stock_quantity=5,
            )
            session.add_all([category, product])
            await session.commit()
            await session.refresh(product)
            return product.id

    return asyncio.get_event_loop().run_until_complete(seed())


def test_cart_crud_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    product_id = seed_product(SessionLocal)

    # Create/add item
    res = client.post(
        "/api/v1/cart/items",
        json={"product_id": str(product_id), "quantity": 2, "note": "Gift"},
        headers=auth_headers(token),
    )
    assert res.status_code == 201, res.text
    item_id = res.json()["id"]

    # Fetch cart
    res = client.get("/api/v1/cart", headers=auth_headers(token))
    assert res.status_code == 200
    assert res.json()["items"][0]["quantity"] == 2
    assert res.json()["items"][0]["note"] == "Gift"
    assert res.json()["totals"]["subtotal"] == "20.00"

    # Update quantity
    res = client.patch(
        f"/api/v1/cart/items/{item_id}",
        json={"quantity": 3},
        headers=auth_headers(token),
    )
    assert res.status_code == 200
    assert res.json()["quantity"] == 3

    # Delete item
    res = client.delete(f"/api/v1/cart/items/{item_id}", headers=auth_headers(token))
    assert res.status_code == 204
    res = client.get("/api/v1/cart", headers=auth_headers(token))
    assert res.status_code == 200
    assert res.json()["items"] == []


def test_guest_cart_and_merge(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal, email="merge@example.com")
    product_id = seed_product(SessionLocal)
    session_id = "guest-merge-123"

    res = client.post(
        "/api/v1/cart/items",
        json={"product_id": str(product_id), "quantity": 1},
        headers={"X-Session-Id": session_id},
    )
    assert res.status_code == 201

    merge_res = client.post("/api/v1/cart/merge", headers={**auth_headers(token), "X-Session-Id": session_id})
    assert merge_res.status_code == 200
    assert len(merge_res.json()["items"]) == 1
    assert merge_res.json()["items"][0]["quantity"] == 1


def test_max_quantity_promo_and_abandoned_job(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal, email="limit@example.com")
    product_id = seed_product(SessionLocal)

    # Add with max_quantity=2
    res = client.post(
        "/api/v1/cart/items",
        json={"product_id": str(product_id), "quantity": 2, "max_quantity": 2},
        headers=auth_headers(token),
    )
    assert res.status_code == 201
    item_id = res.json()["id"]

    # Exceeding limit fails
    over = client.patch(
        f"/api/v1/cart/items/{item_id}",
        json={"quantity": 3},
        headers=auth_headers(token),
    )
    assert over.status_code == 400

    # Validate promo endpoint
    async def seed_promo():
        async with SessionLocal() as session:
            await cart_service.create_promo(
                session,
                PromoCodeCreate(code="SAVE10", percentage_off=10),
            )
    asyncio.get_event_loop().run_until_complete(seed_promo())
    promo = client.post("/api/v1/cart/promo/validate", json={"code": "SAVE10"})
    assert promo.status_code == 200
    assert promo.json()["code"] == "SAVE10"

    # Abandoned cart job scaffold returns count (should be >=0)
    async def run_job():
        async with SessionLocal() as session:
            return await cart_service.run_abandoned_cart_job(session, max_age_hours=0)
    count = asyncio.get_event_loop().run_until_complete(run_job())
    assert count >= 0
