import asyncio
import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.cart import Cart, CartItem
from app.models.user import UserRole
from app.models.catalog import BackInStockRequest, Category, CategoryTranslation, Product, ProductAuditLog, ProductTranslation
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


def create_admin_token(session_factory, email="admin@example.com"):
    async def create_admin():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="adminpass", name="Admin"))
            user.role = UserRole.admin
            await session.commit()
            from app.services.auth import issue_tokens_for_user

            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_admin())


def create_user_token(session_factory, email: str = "user@example.com") -> tuple[str, str]:
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="password123", name="User"))
            await session.commit()
            from app.services.auth import issue_tokens_for_user

            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], str(user.id)

    return asyncio.run(create_and_token())


def _jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1, 1), color=(255, 0, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def test_catalog_admin_and_public_flows(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal)

    # Create category
    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Cups"},
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
            "currency": "RON",
            "stock_quantity": 3,
            "images": [{"url": "http://example.com/cup.jpg", "alt_text": "Cup", "sort_order": 1}],
            "variants": [{"name": "Large", "additional_price_delta": 2.5, "stock_quantity": 2}],
        },
        headers=auth_headers(admin_token),
    )
    assert first.status_code == 201, first.text
    assert first.json()["sku"]
    assert first.json()["status"] == "draft"

    second = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "blue-cup",
            "name": "Blue Cup",
            "base_price": 25.0,
            "currency": "RON",
            "stock_quantity": 10,
            "is_featured": True,
            "short_description": "Bright blue",
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert second.status_code == 201, second.text
    assert second.json()["status"] == "published"

    # Public list should only include published + active products
    res = client.get("/api/v1/catalog/products?sort=name_asc")
    assert res.status_code == 200
    body = res.json()
    assert body["meta"]["total_items"] == 1
    assert len(body["items"]) == 1
    assert body["bounds"]["min_price"] == 25.0
    assert body["bounds"]["max_price"] == 25.0
    assert body["bounds"]["currency"] == "RON"
    assert body["items"][0]["slug"] == "blue-cup"

    # Add translations directly
    async def add_translations():
        async with SessionLocal() as session:
            category = (await session.execute(select(Category).where(Category.slug == "cups"))).scalar_one()
            product = (await session.execute(select(Product).where(Product.slug == "blue-cup"))).scalar_one()
            session.add(CategoryTranslation(category_id=category.id, lang="ro", name="Căni", description="Colecție de căni"))
            session.add(
                ProductTranslation(
                    product_id=product.id,
                    lang="ro",
                    name="Cană Albastră",
                    short_description="Albastru intens",
                    long_description="Cană ceramică albastră",
                )
            )
            await session.commit()

    asyncio.run(add_translations())

    ro_list = client.get("/api/v1/catalog/products?lang=ro&sort=name_asc")
    assert ro_list.status_code == 200
    ro_items = ro_list.json()["items"]
    assert ro_items[0]["name"] == "Cană Albastră"
    assert ro_items[0]["category"]["name"] == "Căni"

    # Draft is not visible publicly, but visible to admins
    res = client.get("/api/v1/catalog/products/white-cup")
    assert res.status_code == 404

    admin_detail = client.get("/api/v1/catalog/products/white-cup", headers=auth_headers(admin_token))
    assert admin_detail.status_code == 200
    assert admin_detail.json()["slug"] == "white-cup"

    # Publish the draft so it becomes publicly visible
    publish = client.patch(
        "/api/v1/catalog/products/white-cup",
        json={"status": "published"},
        headers=auth_headers(admin_token),
    )
    assert publish.status_code == 200
    assert publish.json()["status"] == "published"

    # Public list now includes both
    res = client.get("/api/v1/catalog/products?sort=name_asc")
    assert res.status_code == 200
    body = res.json()
    assert body["meta"]["total_items"] == 2
    assert len(body["items"]) == 2
    assert body["bounds"]["min_price"] == 10.5
    assert body["bounds"]["max_price"] == 25.0
    assert body["items"][0]["slug"] == "blue-cup"
    assert body["items"][1]["slug"] == "white-cup"

    # Public detail (published)
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
    filtered = res.json()
    assert len(filtered["items"]) == 1
    assert filtered["items"][0]["slug"] == "blue-cup"

    res = client.get("/api/v1/catalog/products", params={"min_price": 20, "max_price": 30})
    price_filtered = res.json()
    assert len(price_filtered["items"]) == 1 and price_filtered["items"][0]["slug"] == "blue-cup"

    res = client.get("/api/v1/catalog/products", params={"search": "white"})
    search_filtered = res.json()
    assert len(search_filtered["items"]) == 1 and search_filtered["items"][0]["slug"] == "white-cup"

    res = client.get("/api/v1/catalog/products", params={"limit": 1, "page": 2})
    paged = res.json()
    assert len(paged["items"]) == 1
    assert paged["meta"]["total_pages"] == 2

    # Soft delete hides product
    res = client.delete("/api/v1/catalog/products/white-cup", headers=auth_headers(admin_token))
    assert res.status_code == 204
    res = client.get("/api/v1/catalog/products/white-cup")
    assert res.status_code == 404
    res = client.get("/api/v1/catalog/products")
    assert all(p["slug"] != "white-cup" for p in res.json()["items"])


def test_catalog_slug_autogen_and_slug_reuse_after_delete(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal, email="slugadmin@example.com")

    # Category slug should be auto-generated when omitted.
    category_res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Cups"},
        headers=auth_headers(admin_token),
    )
    assert category_res.status_code == 201, category_res.text
    assert category_res.json()["slug"] == "cups"
    category_id = category_res.json()["id"]

    # Category slug should be immutable.
    category_update = client.patch(
        "/api/v1/catalog/categories/cups",
        json={"slug": "mugs"},
        headers=auth_headers(admin_token),
    )
    assert category_update.status_code == 400, category_update.text

    # Product slug should be auto-generated when omitted.
    first = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "name": "White Cup",
            "base_price": 10.5,
            "currency": "RON",
            "stock_quantity": 3,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert first.status_code == 201, first.text
    assert first.json()["slug"] == "white-cup"

    # Product slug should be immutable.
    attempt_slug_change = client.patch(
        "/api/v1/catalog/products/white-cup",
        json={"slug": "changed-slug"},
        headers=auth_headers(admin_token),
    )
    assert attempt_slug_change.status_code == 400, attempt_slug_change.text

    # Deleted products should free their old slug for reuse.
    deleted = client.delete("/api/v1/catalog/products/white-cup", headers=auth_headers(admin_token))
    assert deleted.status_code == 204

    second = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "name": "White Cup",
            "base_price": 12.0,
            "currency": "RON",
            "stock_quantity": 1,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert second.status_code == 201, second.text
    assert second.json()["slug"] == "white-cup"


def test_catalog_translation_admin_endpoints(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal, email="translations-admin@example.com")

    category_res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "T Cups"},
        headers=auth_headers(admin_token),
    )
    assert category_res.status_code == 201, category_res.text
    category_id = category_res.json()["id"]

    product_res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "t-blue-cup",
            "name": "Blue Cup",
            "base_price": 25.0,
            "currency": "RON",
            "stock_quantity": 10,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert product_res.status_code == 201, product_res.text

    upsert_cat = client.put(
        "/api/v1/catalog/categories/t-cups/translations/ro",
        json={"name": "Căni", "description": "Colecție de căni"},
        headers=auth_headers(admin_token),
    )
    assert upsert_cat.status_code == 200, upsert_cat.text
    assert upsert_cat.json()["lang"] == "ro"
    assert upsert_cat.json()["name"] == "Căni"

    upsert_prod = client.put(
        "/api/v1/catalog/products/t-blue-cup/translations/ro",
        json={"name": "Cană Albastră", "short_description": "Albastru intens"},
        headers=auth_headers(admin_token),
    )
    assert upsert_prod.status_code == 200, upsert_prod.text
    assert upsert_prod.json()["lang"] == "ro"
    assert upsert_prod.json()["name"] == "Cană Albastră"

    list_prod_tr = client.get("/api/v1/catalog/products/t-blue-cup/translations", headers=auth_headers(admin_token))
    assert list_prod_tr.status_code == 200, list_prod_tr.text
    assert [t["lang"] for t in list_prod_tr.json()] == ["ro"]

    ro_list = client.get("/api/v1/catalog/products?lang=ro&sort=name_asc")
    assert ro_list.status_code == 200, ro_list.text
    ro_items = ro_list.json()["items"]
    assert ro_items[0]["slug"] == "t-blue-cup"
    assert ro_items[0]["name"] == "Cană Albastră"
    assert ro_items[0]["category"]["name"] == "Căni"

    delete_prod = client.delete(
        "/api/v1/catalog/products/t-blue-cup/translations/ro",
        headers=auth_headers(admin_token),
    )
    assert delete_prod.status_code == 204, delete_prod.text

    ro_list_after = client.get("/api/v1/catalog/products?lang=ro&sort=name_asc")
    assert ro_list_after.status_code == 200
    ro_items_after = ro_list_after.json()["items"]
    assert ro_items_after[0]["name"] == "Blue Cup"

def test_product_price_bounds(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="boundsadmin@example.com")

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Bounds Cups"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201
    cup_category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Bounds Plates"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201
    plate_category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": cup_category_id,
            "slug": "cheap-cup",
            "name": "Cheap Cup",
            "base_price": 10,
            "currency": "RON",
            "stock_quantity": 10,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": cup_category_id,
            "slug": "fancy-cup",
            "name": "Fancy Cup",
            "base_price": 25,
            "currency": "RON",
            "stock_quantity": 5,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": plate_category_id,
            "slug": "luxury-plate",
            "name": "Luxury Plate",
            "base_price": 100,
            "currency": "RON",
            "stock_quantity": 2,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    all_bounds = client.get("/api/v1/catalog/products/price-bounds")
    assert all_bounds.status_code == 200
    data = all_bounds.json()
    assert data["min_price"] == 10
    assert data["max_price"] == 100
    assert data["currency"] == "RON"

    cup_bounds = client.get("/api/v1/catalog/products/price-bounds", params={"category_slug": "bounds-cups"})
    assert cup_bounds.status_code == 200
    data = cup_bounds.json()
    assert data["min_price"] == 10
    assert data["max_price"] == 25
    assert data["currency"] == "RON"


def test_sale_filter_and_effective_price_bounds(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="saleadmin@example.com")

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Sale Cat"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201, res.text
    category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "sale-prod",
            "name": "Sale Product",
            "base_price": 100,
            "sale_type": "percent",
            "sale_value": 10,
            "currency": "RON",
            "stock_quantity": 1,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201, res.text
    sale_id = res.json()["id"]
    assert float(res.json()["sale_price"]) == 90.0

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "base-prod",
            "name": "Base Product",
            "base_price": 50,
            "currency": "RON",
            "stock_quantity": 1,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201, res.text

    bounds = client.get("/api/v1/catalog/products/price-bounds")
    assert bounds.status_code == 200
    data = bounds.json()
    assert data["min_price"] == 50
    assert data["max_price"] == 90

    listed = client.get("/api/v1/catalog/products", params={"category_slug": "sale"})
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == sale_id


def test_product_image_upload_and_delete(tmp_path, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="imgadmin@example.com")

    # point media root to temp
    original_media = settings.media_root
    settings.media_root = str(tmp_path)

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Plates"},
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
            "currency": "RON",
            "stock_quantity": 2,
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    upload_res = client.post(
        "/api/v1/catalog/products/plate/images",
        files={"file": ("pic.jpg", _jpeg_bytes(), "image/jpeg")},
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


def test_product_image_translations_and_stats(tmp_path, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="imgmetaadmin@example.com")

    original_media = settings.media_root
    settings.media_root = str(tmp_path)

    try:
        res = client.post(
            "/api/v1/catalog/categories",
            json={"name": "Plates"},
            headers=auth_headers(admin_token),
        )
        category_id = res.json()["id"]

        res = client.post(
            "/api/v1/catalog/products",
            json={
                "category_id": category_id,
                "slug": "meta-plate",
                "name": "Meta Plate",
                "base_price": 12,
                "currency": "RON",
                "stock_quantity": 2,
            },
            headers=auth_headers(admin_token),
        )
        assert res.status_code == 201

        upload_res = client.post(
            "/api/v1/catalog/products/meta-plate/images",
            files={"file": ("pic.jpg", _jpeg_bytes(), "image/jpeg")},
            headers=auth_headers(admin_token),
        )
        assert upload_res.status_code == 200
        image_id = upload_res.json()["images"][0]["id"]
        image_url = upload_res.json()["images"][0]["url"]

        stats_res = client.get(
            f"/api/v1/catalog/products/meta-plate/images/{image_id}/stats",
            headers=auth_headers(admin_token),
        )
        assert stats_res.status_code == 200, stats_res.text
        stats = stats_res.json()
        assert stats["original_bytes"] is not None
        assert stats["thumb_sm_bytes"] is not None
        assert stats["width"] == 1
        assert stats["height"] == 1

        ro_res = client.put(
            f"/api/v1/catalog/products/meta-plate/images/{image_id}/translations/ro",
            json={"alt_text": "Farfurie", "caption": "Legendă"},
            headers=auth_headers(admin_token),
        )
        assert ro_res.status_code == 200, ro_res.text
        en_res = client.put(
            f"/api/v1/catalog/products/meta-plate/images/{image_id}/translations/en",
            json={"alt_text": "Plate", "caption": "Caption"},
            headers=auth_headers(admin_token),
        )
        assert en_res.status_code == 200, en_res.text

        translations = client.get(
            f"/api/v1/catalog/products/meta-plate/images/{image_id}/translations",
            headers=auth_headers(admin_token),
        )
        assert translations.status_code == 200
        rows = translations.json()
        langs = {row["lang"]: row for row in rows}
        assert langs["ro"]["alt_text"] == "Farfurie"
        assert langs["en"]["caption"] == "Caption"

        ro_product = client.get(
            "/api/v1/catalog/products/meta-plate",
            params={"lang": "ro"},
            headers=auth_headers(admin_token),
        )
        assert ro_product.status_code == 200, ro_product.text
        assert ro_product.json()["images"][0]["alt_text"] == "Farfurie"
        assert ro_product.json()["images"][0]["caption"] == "Legendă"

        from pathlib import Path

        if image_url.startswith("/media/"):
            rel = image_url.removeprefix("/media/")
            original_path = Path(settings.media_root) / rel
            thumb_sm = original_path.with_name(f"{original_path.stem}-sm{original_path.suffix}")
            if thumb_sm.exists():
                thumb_sm.unlink()

        reprocess_res = client.post(
            f"/api/v1/catalog/products/meta-plate/images/{image_id}/reprocess",
            headers=auth_headers(admin_token),
        )
        assert reprocess_res.status_code == 200, reprocess_res.text
        assert reprocess_res.json()["thumb_sm_bytes"] is not None
    finally:
        settings.media_root = original_media


def test_bulk_update_and_publish(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="bulkadmin@example.com")

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Bulk Cat"},
        headers=auth_headers(admin_token),
    )
    category_id = res.json()["id"]
    prods = []
    for slug in ["p1", "p2"]:
        resp = client.post(
            "/api/v1/catalog/products",
            json={
                "category_id": category_id,
                "slug": slug,
                "name": slug.upper(),
                "base_price": 10,
                "currency": "RON",
                "stock_quantity": 1,
            },
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 201
        prods.append(resp.json())

    bulk_res = client.post(
        "/api/v1/catalog/products/bulk-update",
        json=[
            {"product_id": prods[0]["id"], "base_price": 15.5, "stock_quantity": 5, "status": "published"},
            {"product_id": prods[1]["id"], "base_price": 20.0, "stock_quantity": 2},
        ],
        headers=auth_headers(admin_token),
    )
    assert bulk_res.status_code == 200, bulk_res.text
    body = bulk_res.json()
    updated = {item["id"]: item for item in body}
    assert float(updated[prods[0]["id"]]["base_price"]) == 15.5
    assert updated[prods[0]["id"]]["stock_quantity"] == 5
    assert updated[prods[0]["id"]]["status"] == "published"
    assert updated[prods[0]["id"]]["publish_at"] is not None


def test_bulk_category_assignment_and_publish_scheduling(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="scheduleadmin@example.com")

    cat1 = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Schedule Cat 1"},
        headers=auth_headers(admin_token),
    ).json()["id"]
    cat2 = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Schedule Cat 2"},
        headers=auth_headers(admin_token),
    ).json()["id"]

    prod = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": cat1,
            "slug": "sched-prod",
            "name": "Sched Prod",
            "base_price": 10.0,
            "currency": "RON",
            "stock_quantity": 1,
        },
        headers=auth_headers(admin_token),
    ).json()

    bulk_res = client.post(
        "/api/v1/catalog/products/bulk-update",
        json=[{"product_id": prod["id"], "category_id": cat2}],
        headers=auth_headers(admin_token),
    )
    assert bulk_res.status_code == 200, bulk_res.text

    admin_view = client.get("/api/v1/catalog/products/sched-prod", headers=auth_headers(admin_token))
    assert admin_view.status_code == 200, admin_view.text
    assert admin_view.json()["category"]["id"] == cat2

    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    schedule_res = client.post(
        "/api/v1/catalog/products/bulk-update",
        json=[{"product_id": prod["id"], "publish_scheduled_for": past}],
        headers=auth_headers(admin_token),
    )
    assert schedule_res.status_code == 200, schedule_res.text

    public_view = client.get("/api/v1/catalog/products/sched-prod")
    assert public_view.status_code == 200, public_view.text
    assert public_view.json()["status"] == "published"

    unpublish_past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    unpublish_res = client.post(
        "/api/v1/catalog/products/bulk-update",
        json=[{"product_id": prod["id"], "unpublish_scheduled_for": unpublish_past}],
        headers=auth_headers(admin_token),
    )
    assert unpublish_res.status_code == 200, unpublish_res.text

    public_after_unpublish = client.get("/api/v1/catalog/products/sched-prod")
    assert public_after_unpublish.status_code == 404


def test_product_reviews_and_related(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="reviewadmin@example.com")

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Pots"},
        headers=auth_headers(admin_token),
    )
    category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "teapot",
            "name": "Teapot",
            "base_price": 40,
            "currency": "RON",
            "stock_quantity": 2,
            "tags": ["ceramic", "teaware"],
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "teapot-2",
            "name": "Teapot 2",
            "base_price": 45,
            "currency": "RON",
            "stock_quantity": 2,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    review_res = client.post(
        "/api/v1/catalog/products/teapot/reviews",
        json={"author_name": "Alice", "rating": 5, "title": "Great", "body": "Loved it"},
    )
    assert review_res.status_code == 201
    review_id = review_res.json()["id"]

    approve = client.post(
        f"/api/v1/catalog/products/teapot/reviews/{review_id}/approve",
        headers=auth_headers(admin_token),
    )
    assert approve.status_code == 200

    detail = client.get("/api/v1/catalog/products/teapot")
    assert float(detail.json()["rating_average"]) == 5.0
    assert detail.json()["rating_count"] == 1

    related = client.get("/api/v1/catalog/products/teapot/related")
    assert related.status_code == 200
    assert len(related.json()) >= 1


def test_slug_history_recently_viewed_and_csv(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="slugadmin@example.com")

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "History"},
        headers=auth_headers(admin_token),
    )
    category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "new-slug",
            "name": "Old Name",
            "base_price": 5,
            "currency": "RON",
            "stock_quantity": 1,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201

    async def _seed_slug_history(product_id: str) -> None:
        from app.models.catalog import ProductSlugHistory
        import uuid

        async with SessionLocal() as session:
            session.add(ProductSlugHistory(product_id=uuid.UUID(product_id), slug="old-slug"))
            await session.commit()

    asyncio.run(_seed_slug_history(res.json()["id"]))

    # Old slug should redirect to current product
    from_history = client.get("/api/v1/catalog/products/old-slug", params={"session_id": "sess-123"})
    assert from_history.status_code == 200
    assert from_history.json()["slug"] == "new-slug"

    # Recently viewed for the session
    recent = client.get("/api/v1/catalog/products/recently-viewed", params={"session_id": "sess-123"})
    assert recent.status_code == 200
    assert recent.json()[0]["slug"] == "new-slug"

    # Export CSV
    export_res = client.get("/api/v1/catalog/products/export", headers=auth_headers(admin_token))
    assert export_res.status_code == 200
    assert "slug" in export_res.text.splitlines()[0]

    # Import CSV dry-run
    csv_content = export_res.text
    import_res = client.post(
        "/api/v1/catalog/products/import",
        params={"dry_run": True},
        files={"file": ("products.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
        headers=auth_headers(admin_token),
    )
    assert import_res.status_code == 200
    body = import_res.json()
    assert body["errors"] == []
    assert body["created"] >= 0


def test_preorder_shipping_meta_and_sort(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="metaadmin@example.com")

    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Logistics"},
        headers=auth_headers(admin_token),
    )
    category_id = res.json()["id"]

    res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "ship-a",
            "name": "Ship A",
            "base_price": 10,
            "currency": "RON",
            "stock_quantity": 0,
            "allow_backorder": True,
            "restock_at": "2030-01-01T00:00:00Z",
            "weight_grams": 500,
            "width_cm": 10.5,
            "height_cm": 5.5,
            "depth_cm": 3.0,
            "meta_title": "Meta A",
            "meta_description": "Meta desc",
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["allow_backorder"] is True
    assert body["restock_at"] is not None
    assert body["weight_grams"] == 500
    assert float(body["width_cm"]) == 10.5
    assert body["meta_title"] == "Meta A"

    # sorting by name desc should put Ship B first
    client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "ship-b",
            "name": "Ship B",
            "base_price": 20,
            "currency": "RON",
            "stock_quantity": 1,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    sorted_res = client.get("/api/v1/catalog/products", params={"sort": "name_desc"})
    assert sorted_res.status_code == 200
    names = [p["name"] for p in sorted_res.json()["items"]]
    assert names[0] == "Ship B"

    # rich text validation blocks scripts
    bad_res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "bad-rich",
            "name": "Bad",
            "base_price": 1,
            "currency": "RON",
            "stock_quantity": 1,
            "long_description": "<script>alert(1)</script>",
        },
        headers=auth_headers(admin_token),
    )
    assert bad_res.status_code == 422


def test_featured_collections_feed_and_audit(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal, email="feedadmin@example.com")

    # category
    res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Feed Cat"},
        headers=auth_headers(admin_token),
    )
    cat_id = res.json()["id"]

    pub = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": cat_id,
            "slug": "feed-slug",
            "name": "Feed Name",
            "base_price": 11.5,
            "currency": "RON",
            "stock_quantity": 1,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    ).json()

    # feed includes published
    feed = client.get("/api/v1/catalog/products/feed")
    assert feed.status_code == 200
    assert any(item["slug"] == "feed-slug" for item in feed.json())

    # featured collection create and update
    coll = client.post(
        "/api/v1/catalog/collections/featured",
        json={"name": "Featured A", "product_ids": [pub["id"]]},
        headers=auth_headers(admin_token),
    )
    assert coll.status_code == 201
    coll_slug = coll.json()["slug"]
    list_coll = client.get("/api/v1/catalog/collections/featured")
    assert list_coll.status_code == 200
    assert list_coll.json()[0]["slug"] == coll_slug

    upd = client.patch(
        f"/api/v1/catalog/collections/featured/{coll_slug}",
        json={"name": "Featured A Updated"},
        headers=auth_headers(admin_token),
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "Featured A Updated"

    # audit log created for product actions
    async def audit_count() -> int:
        async with SessionLocal() as session:
            result = await session.execute(select(ProductAuditLog))
            return len(result.scalars().all())

    count = asyncio.run(audit_count())
    assert count >= 1


def test_back_in_stock_request_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal, email="stockadmin@example.com")
    user_token, _ = create_user_token(SessionLocal, email="bis@example.com")

    category = client.post(
        "/api/v1/catalog/categories",
        json={"name": "BIS Cups"},
        headers=auth_headers(admin_token),
    )
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]

    product = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "bis-cup",
            "name": "Back In Stock Cup",
            "base_price": 10.0,
            "currency": "RON",
            "stock_quantity": 0,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert product.status_code == 201, product.text

    status_res = client.get("/api/v1/catalog/products/bis-cup/back-in-stock", headers=auth_headers(user_token))
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["in_stock"] is False
    assert status_res.json()["request"] is None

    first = client.post("/api/v1/catalog/products/bis-cup/back-in-stock", headers=auth_headers(user_token))
    assert first.status_code == 200, first.text
    req_id = first.json()["id"]

    second = client.post("/api/v1/catalog/products/bis-cup/back-in-stock", headers=auth_headers(user_token))
    assert second.status_code == 200, second.text
    assert second.json()["id"] == req_id

    status_after = client.get("/api/v1/catalog/products/bis-cup/back-in-stock", headers=auth_headers(user_token))
    assert status_after.status_code == 200, status_after.text
    assert status_after.json()["request"]["id"] == req_id

    cancel = client.delete("/api/v1/catalog/products/bis-cup/back-in-stock", headers=auth_headers(user_token))
    assert cancel.status_code == 204, cancel.text

    status_canceled = client.get("/api/v1/catalog/products/bis-cup/back-in-stock", headers=auth_headers(user_token))
    assert status_canceled.status_code == 200, status_canceled.text
    assert status_canceled.json()["request"] is None


def test_back_in_stock_fulfilled_on_restock(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal, email="restockadmin@example.com")
    user_token, _ = create_user_token(SessionLocal, email="restock@example.com")

    category = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Restock Cat"},
        headers=auth_headers(admin_token),
    )
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]

    product = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "restock-cup",
            "name": "Restock Cup",
            "base_price": 10.0,
            "currency": "RON",
            "stock_quantity": 0,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert product.status_code == 201, product.text

    req = client.post("/api/v1/catalog/products/restock-cup/back-in-stock", headers=auth_headers(user_token))
    assert req.status_code == 200, req.text

    restock = client.patch(
        "/api/v1/catalog/products/restock-cup",
        json={"stock_quantity": 5},
        headers=auth_headers(admin_token),
    )
    assert restock.status_code == 200, restock.text

    status_res = client.get("/api/v1/catalog/products/restock-cup/back-in-stock", headers=auth_headers(user_token))
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["in_stock"] is True
    assert status_res.json()["request"] is None

    cannot_request = client.post("/api/v1/catalog/products/restock-cup/back-in-stock", headers=auth_headers(user_token))
    assert cannot_request.status_code == 400, cannot_request.text

    async def read_request():
        async with SessionLocal() as session:
            stmt = (
                select(BackInStockRequest)
                .join(Product, Product.id == BackInStockRequest.product_id)
                .where(Product.slug == "restock-cup")
            )
            return (await session.execute(stmt)).scalar_one()

    record = asyncio.run(read_request())
    assert record.fulfilled_at is not None


def test_catalog_variant_matrix_update_and_delete_guards(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal, email="variants@example.com")

    category_res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Cups"},
        headers=auth_headers(admin_token),
    )
    assert category_res.status_code == 201, category_res.text
    category_id = category_res.json()["id"]

    create_res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "variant-cup",
            "name": "Variant Cup",
            "base_price": 10.0,
            "currency": "RON",
            "stock_quantity": 3,
            "status": "published",
            "variants": [{"name": "Large", "additional_price_delta": 2.5, "stock_quantity": 2}],
        },
        headers=auth_headers(admin_token),
    )
    assert create_res.status_code == 201, create_res.text
    product_id = create_res.json()["id"]
    large_id = create_res.json()["variants"][0]["id"]

    update_res = client.put(
        "/api/v1/catalog/products/variant-cup/variants",
        json={
            "variants": [
                {"id": large_id, "name": "Large", "additional_price_delta": 3.0, "stock_quantity": 5},
                {"name": "Small", "additional_price_delta": -1.0, "stock_quantity": 1},
            ]
        },
        headers=auth_headers(admin_token),
    )
    assert update_res.status_code == 200, update_res.text
    variants = update_res.json()
    assert len(variants) == 2
    assert next(v for v in variants if v["id"] == large_id)["stock_quantity"] == 5
    small_id = next(v for v in variants if v["name"] == "Small")["id"]

    delete_res = client.put(
        "/api/v1/catalog/products/variant-cup/variants",
        json={
            "variants": [{"id": large_id, "name": "Large", "additional_price_delta": 3.0, "stock_quantity": 5}],
            "delete_variant_ids": [small_id],
        },
        headers=auth_headers(admin_token),
    )
    assert delete_res.status_code == 200, delete_res.text
    assert len(delete_res.json()) == 1

    async def add_cart_item() -> None:
        async with SessionLocal() as session:
            cart = Cart(session_id="session-1")
            session.add(cart)
            await session.flush()
            session.add(
                CartItem(
                    cart_id=cart.id,
                    product_id=uuid.UUID(product_id),
                    variant_id=uuid.UUID(large_id),
                    quantity=1,
                    unit_price_at_add=10.0,
                )
            )
            await session.commit()

    asyncio.run(add_cart_item())

    blocked = client.put(
        "/api/v1/catalog/products/variant-cup/variants",
        json={"variants": [], "delete_variant_ids": [large_id]},
        headers=auth_headers(admin_token),
    )
    assert blocked.status_code == 400, blocked.text
    assert "cart" in blocked.json()["detail"].lower()


def test_stock_adjustment_ledger_records_changes(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_admin_token(SessionLocal, email="stock@example.com")

    category_res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Art"},
        headers=auth_headers(admin_token),
    )
    assert category_res.status_code == 201, category_res.text
    category_id = category_res.json()["id"]

    create_res = client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": category_id,
            "slug": "stock-cup",
            "name": "Stock Cup",
            "base_price": 10.0,
            "currency": "RON",
            "stock_quantity": 3,
            "status": "published",
        },
        headers=auth_headers(admin_token),
    )
    assert create_res.status_code == 201, create_res.text
    product_id = create_res.json()["id"]

    patch_res = client.patch(
        "/api/v1/catalog/products/stock-cup",
        json={"stock_quantity": 10},
        headers=auth_headers(admin_token),
    )
    assert patch_res.status_code == 200, patch_res.text

    list_res = client.get(
        "/api/v1/admin/dashboard/stock-adjustments",
        params={"product_id": product_id},
        headers=auth_headers(admin_token),
    )
    assert list_res.status_code == 200, list_res.text
    rows = list_res.json()
    assert len(rows) == 1
    assert rows[0]["delta"] == 7
    assert rows[0]["before_quantity"] == 3
    assert rows[0]["after_quantity"] == 10

    apply_res = client.post(
        "/api/v1/admin/dashboard/stock-adjustments",
        json={"product_id": product_id, "delta": -2, "reason": "damage", "note": "broken"},
        headers=auth_headers(admin_token),
    )
    assert apply_res.status_code == 201, apply_res.text
    applied = apply_res.json()
    assert applied["delta"] == -2
    assert applied["after_quantity"] == 8

    list_res = client.get(
        "/api/v1/admin/dashboard/stock-adjustments",
        params={"product_id": product_id},
        headers=auth_headers(admin_token),
    )
    assert list_res.status_code == 200, list_res.text
    rows = list_res.json()
    assert len(rows) == 2
    assert any(row["id"] == applied["id"] for row in rows)
