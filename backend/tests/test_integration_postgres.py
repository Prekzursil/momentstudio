import os
import uuid

import httpx
import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.db.session import SessionLocal, engine as app_engine
from app.main import app
from app.models.catalog import Category, Product, ProductStatus
from app.models.content import ContentBlock, ContentBlockTranslation, ContentStatus


if os.environ.get("RUN_POSTGRES_INTEGRATION") != "1":
    pytest.skip("Postgres integration tests are opt-in", allow_module_level=True)

if not settings.database_url.startswith("postgresql"):
    pytest.skip("Postgres integration test requires DATABASE_URL pointing to Postgres", allow_module_level=True)


@pytest.fixture(autouse=True)
async def _dispose_engine_between_tests():
    yield
    await app_engine.dispose()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_postgres_core_flow_wishlist() -> None:
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        email = f"pg-{uuid.uuid4().hex[:8]}@example.com"
        username = f"pg{uuid.uuid4().hex[:8]}"
        register = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "username": username, "password": "supersecret", "name": "PG"},
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


@pytest.mark.anyio
async def test_postgres_blog_flow() -> None:
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        email = f"pgblog-{uuid.uuid4().hex[:8]}@example.com"
        username = f"pgblog{uuid.uuid4().hex[:8]}"
        register = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "username": username, "password": "supersecret", "name": "PG Blog"},
        )
        assert register.status_code == 201, register.text
        token = register.json()["tokens"]["access_token"]

        slug = f"post-{uuid.uuid4().hex[:6]}"
        scheduled_slug = f"scheduled-{uuid.uuid4().hex[:6]}"

        async def seed_blog() -> None:
            from datetime import datetime, timedelta, timezone

            async with SessionLocal() as session:
                now = datetime.now(timezone.utc)
                block = ContentBlock(
                    key=f"blog.{slug}",
                    title="Salut",
                    body_markdown="RO body",
                    status=ContentStatus.published,
                    lang="ro",
                    published_at=now - timedelta(days=1),
                    meta={"summary": {"ro": "Rezumat", "en": "Summary"}, "tags": ["News"]},
                )
                session.add(block)
                await session.flush()
                session.add(
                    ContentBlockTranslation(
                        content_block_id=block.id,
                        lang="en",
                        title="Hello",
                        body_markdown="EN body",
                    )
                )

                scheduled = ContentBlock(
                    key=f"blog.{scheduled_slug}",
                    title="Scheduled",
                    body_markdown="Future",
                    status=ContentStatus.published,
                    lang="en",
                    published_at=now + timedelta(days=2),
                )
                session.add(scheduled)
                await session.commit()

        await seed_blog()

        listing = await client.get("/api/v1/blog/posts", params={"lang": "en"})
        assert listing.status_code == 200, listing.text
        slugs = {item["slug"] for item in listing.json()["items"]}
        assert slug in slugs
        assert scheduled_slug not in slugs

        detail_en = await client.get(f"/api/v1/blog/posts/{slug}", params={"lang": "en"})
        assert detail_en.status_code == 200, detail_en.text
        assert detail_en.json()["title"] == "Hello"

        detail_ro = await client.get(f"/api/v1/blog/posts/{slug}", params={"lang": "ro"})
        assert detail_ro.status_code == 200, detail_ro.text
        assert detail_ro.json()["title"] == "Salut"

        scheduled_detail = await client.get(f"/api/v1/blog/posts/{scheduled_slug}", params={"lang": "en"})
        assert scheduled_detail.status_code == 404, scheduled_detail.text

        og = await client.get(f"/api/v1/blog/posts/{slug}/og.png", params={"lang": "en"})
        assert og.status_code == 200, og.text
        assert og.headers.get("content-type", "").startswith("image/png")

        scheduled_og = await client.get(f"/api/v1/blog/posts/{scheduled_slug}/og.png", params={"lang": "en"})
        assert scheduled_og.status_code == 404, scheduled_og.text

        created = await client.post(
            f"/api/v1/blog/posts/{slug}/comments",
            json={"body": "Nice"},
            headers=auth_headers(token),
        )
        assert created.status_code == 201, created.text

        comments = await client.get(f"/api/v1/blog/posts/{slug}/comments")
        assert comments.status_code == 200, comments.text
        assert comments.json()["meta"]["total_items"] >= 1
