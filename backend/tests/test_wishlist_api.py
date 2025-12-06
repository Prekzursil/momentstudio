import asyncio
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.catalog import Category, Product, ProductStatus
from app.models.wishlist import WishlistItem
from app.services.auth import create_user, issue_tokens_for_user
from app.schemas.user import UserCreate


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_user_token(session_factory, email="wish@example.com"):
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="wishpass", name="Wish User"))
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(create_and_token())


def seed_product(session_factory) -> UUID:
    async def seed():
        async with session_factory() as session:
            category = Category(slug="bowls", name="Bowls")
            product = Product(
                category=category,
                slug="bowl",
                sku="SKU-BOWL",
                name="Bowl",
                base_price=12,
                currency="USD",
                stock_quantity=10,
                status=ProductStatus.published,
            )
            session.add_all([category, product])
            await session.commit()
            await session.refresh(product)
            return product.id

    return asyncio.run(seed())


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


def test_wishlist_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    product_id = seed_product(SessionLocal)

    res = client.post(f"/api/v1/wishlist/{product_id}", headers=auth_headers(token))
    assert res.status_code == 201

    res = client.get("/api/v1/wishlist", headers=auth_headers(token))
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    assert items[0]["slug"] == "bowl"

    res = client.delete(f"/api/v1/wishlist/{product_id}", headers=auth_headers(token))
    assert res.status_code == 204
    res = client.get("/api/v1/wishlist", headers=auth_headers(token))
    assert res.status_code == 200
    assert res.json() == []
