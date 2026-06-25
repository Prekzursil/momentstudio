"""Lean-gate unit coverage for ``app.api.v1.wishlist`` route handlers.

Drives the list/add/remove endpoints through a TestClient with a complete-
profile authenticated user so each handler body (the previously under-counted
async return lines) executes. Disjoint from the existing ``test_wishlist_api``.
"""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductStatus
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user


@pytest.fixture
def ctx() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    async def _override():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = _override
    c = TestClient(app)
    yield {"client": c, "factory": SessionLocal}
    c.close()
    app.dependency_overrides.clear()


def _seed_user_token(factory) -> str:
    async def _seed() -> str:
        async with factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="wl@example.com", password="wlpass123", name="WL User"
                ),
            )
            # Complete the profile so require_complete_profile passes.
            user.first_name = "WL"
            user.last_name = "User"
            user.username = "wluser"
            user.phone = "+40700000000"
            user.date_of_birth = date(1990, 1, 1)
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_seed())


def _seed_product(factory) -> UUID:
    async def _seed() -> UUID:
        async with factory() as session:
            cat = Category(slug="wl-cat", name="WL Cat")
            product = Product(
                category=cat,
                slug="wl-product",
                sku="SKU-WL",
                name="WL Product",
                base_price=15,
                currency="RON",
                stock_quantity=5,
                status=ProductStatus.published,
            )
            session.add_all([cat, product])
            await session.commit()
            await session.refresh(product)
            return product.id

    return asyncio.run(_seed())


def test_wishlist_endpoints_full_flow(ctx) -> None:
    client = ctx["client"]
    token = _seed_user_token(ctx["factory"])
    product_id = _seed_product(ctx["factory"])
    headers = {"Authorization": f"Bearer {token}"}

    # Empty list (covers the list handler return).
    res = client.get("/api/v1/wishlist", headers=headers)
    assert res.status_code == 200
    assert res.json() == []

    # Add (covers the add handler return).
    res = client.post(f"/api/v1/wishlist/{product_id}", headers=headers)
    assert res.status_code == 201
    assert res.json()["slug"] == "wl-product"

    res = client.get("/api/v1/wishlist", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 1

    # Remove (covers the remove handler return).
    res = client.delete(f"/api/v1/wishlist/{product_id}", headers=headers)
    assert res.status_code == 204

    res = client.get("/api/v1/wishlist", headers=headers)
    assert res.json() == []
