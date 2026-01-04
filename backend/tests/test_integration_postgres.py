import os
import uuid

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.catalog import Category, Product, ProductStatus


if os.environ.get("RUN_POSTGRES_INTEGRATION") != "1":
    pytest.skip("Postgres integration tests are opt-in", allow_module_level=True)

if not settings.database_url.startswith("postgresql"):
    pytest.skip("Postgres integration test requires DATABASE_URL pointing to Postgres", allow_module_level=True)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_postgres_core_flow_wishlist() -> None:
    async with AsyncClient(app=app, base_url="http://testserver") as client:
        email = f"pg-{uuid.uuid4().hex[:8]}@example.com"
        register = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "supersecret", "name": "PG"},
        )
        assert register.status_code == 201, register.text
        token = register.json()["tokens"]["access_token"]

        category_slug = f"cat-{uuid.uuid4().hex[:6]}"
        product_slug = f"prod-{uuid.uuid4().hex[:6]}"

        async def seed() -> str:
            async with SessionLocal() as session:
                category = Category(slug=category_slug, name="Postgres Category")
                product = Product(
                    category=category,
                    slug=product_slug,
                    name="Postgres Product",
                    base_price=12.5,
                    currency="USD",
                    stock_quantity=5,
                    status=ProductStatus.published,
                )
                session.add_all([category, product])
                await session.commit()
                await session.refresh(product)
                return str(product.id)

        product_id = await seed()

        # Public catalog endpoints should work under Postgres
        products = await client.get("/api/v1/catalog/products", params={"search": "Postgres"})
        assert products.status_code == 200, products.text
        assert any(item["id"] == product_id for item in products.json()["items"])

        # Wishlist API flow under Postgres
        add = await client.post(f"/api/v1/wishlist/{product_id}", headers=auth_headers(token))
        assert add.status_code == 201, add.text

        listed = await client.get("/api/v1/wishlist", headers=auth_headers(token))
        assert listed.status_code == 200, listed.text
        assert any(item["id"] == product_id for item in listed.json())

        removed = await client.delete(f"/api/v1/wishlist/{product_id}", headers=auth_headers(token))
        assert removed.status_code == 204, removed.text
