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
from app.core.config import settings


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
    category_id = res.json()["id"]

    # Create product
    first = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "white-cup",
            "name": "White Cup",
            "base_price": 10.5,
            "currency": "USD",
            "stock_quantity": 3,
            "images": [{"url": "http://example.com/cup.jpg", "alt_text": "Cup", "sort_order": 1}],
            "variants": [{"name": "Large", "additional_price_delta": 2.5, "stock_quantity": 2}],
        },
        headers=auth_headers(admin_token),
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "blue-cup",
            "name": "Blue Cup",
            "base_price": 25.0,
            "currency": "USD",
            "stock_quantity": 10,
            "is_featured": True,
            "short_description": "Bright blue",
        },
        headers=auth_headers(admin_token),
    )
    assert second.status_code == 201, second.text

    # Public list
    res = client.get("/api/v1/catalog/products")
    assert res.status_code == 200
    assert len(res.json()) == 2
    assert res.json()[0]["slug"] == "white-cup"

    # Public detail
    res = client.get("/api/v1/catalog/products/white-cup")
    assert res.status_code == 200
    assert res.json()["slug"] == "white-cup"
    assert res.json()["images"][0]["url"].endswith("cup.jpg")
    assert res.json()["variants"][0]["name"] == "Large"

    # Update product
    res = client.patch(
        "/api/v1/catalog/products/white-cup",
        json={"stock_quantity": 10},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 200
    assert res.json()["stock_quantity"] == 10

    # Filters: category + featured + price + search
    res = client.get("/api/v1/catalog/products", params={"category_slug": "cups", "is_featured": True})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["slug"] == "blue-cup"

    res = client.get("/api/v1/catalog/products", params={"min_price": 20, "max_price": 30})
    assert len(res.json()) == 1 and res.json()[0]["slug"] == "blue-cup"

    res = client.get("/api/v1/catalog/products", params={"search": "white"})
    assert len(res.json()) == 1 and res.json()[0]["slug"] == "white-cup"

    res = client.get("/api/v1/catalog/products", params={"limit": 1, "offset": 1})
    assert len(res.json()) == 1

    # Soft delete hides product
    res = client.delete("/api/v1/catalog/products/white-cup", headers=auth_headers(admin_token))
    assert res.status_code == 204
    res = client.get("/api/v1/catalog/products/white-cup")
    assert res.status_code == 404
    res = client.get("/api/v1/catalog/products")
    assert all(p["slug"] != "white-cup" for p in res.json())


def test_product_image_upload_and_delete(tmp_path, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="imgadmin@example.com")

    # point media root to temp
    original_media = settings.media_root
    settings.media_root = str(tmp_path)

    res = client.post(
        "/api/v1/catalog/categories",
        json={"slug": "plates", "name": "Plates"},
        headers=auth_headers(admin_token),
    )
    category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "plate",
            "name": "Plate",
            "base_price": 12,
            "currency": "USD",
            "stock_quantity": 2,
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    upload_res = client.post(
        "/api/v1/catalog/products/plate/images",
        files={"file": ("pic.jpg", b"fakeimagecontent", "image/jpeg")},
        headers=auth_headers(admin_token),
    )
    assert upload_res.status_code == 200
    assert upload_res.json()["images"][0]["url"]

    image_id = upload_res.json()["images"][0]["id"]
    delete_res = client.delete(
        f"/api/v1/catalog/products/plate/images/{image_id}",
        headers=auth_headers(admin_token),
    )
    assert delete_res.status_code == 200
    assert delete_res.json()["images"] == []

    settings.media_root = original_media
