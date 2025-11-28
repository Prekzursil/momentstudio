import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.user import UserRole
from app.services.auth import create_user
from app.schemas.user import UserCreate


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


def create_admin_token(session_factory, email="admin@example.com"):
    async def create_admin():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="adminpass", name="Admin"))
            user.role = UserRole.admin
            await session.commit()
            from app.services.auth import issue_tokens_for_user

            return issue_tokens_for_user(user)["access_token"]

    return asyncio.get_event_loop().run_until_complete(create_admin())


def test_catalog_admin_and_public_flows(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal)

    # Create category
    res = client.post(
        "/api/v1/catalog/categories",
        json={"slug": "cups", "name": "Cups"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201, res.text

    # Create product
    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": res.json()["id"],
            "slug": "white-cup",
            "name": "White Cup",
            "base_price": 10.5,
            "currency": "USD",
            "stock_quantity": 3,
            "images": [{"url": "http://example.com/cup.jpg", "alt_text": "Cup", "sort_order": 1}],
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201, res.text

    # Public list
    res = client.get("/api/v1/catalog/products")
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["slug"] == "white-cup"

    # Public detail
    res = client.get("/api/v1/catalog/products/white-cup")
    assert res.status_code == 200
    assert res.json()["slug"] == "white-cup"
    assert res.json()["images"][0]["url"].endswith("cup.jpg")

    # Update product
    res = client.patch(
        "/api/v1/catalog/products/white-cup",
        json={"stock_quantity": 10},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 200
    assert res.json()["stock_quantity"] == 10
