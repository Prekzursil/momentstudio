"""Lean-gate coverage for ``app.api.v1.routes`` health/seo/metrics endpoints."""

from __future__ import annotations

import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole


@pytest.fixture
def routes_app() -> Dict[str, object]:
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


def test_health(routes_app) -> None:
    client: TestClient = routes_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_readiness_ok(routes_app) -> None:
    client: TestClient = routes_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/health/ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ready"}


def test_readiness_db_failure(routes_app) -> None:
    client: TestClient = routes_app["client"]  # type: ignore[assignment]

    class _BrokenSession:
        async def execute(self, *a, **k):  # noqa: ANN002, ANN003
            raise RuntimeError("db down")

    async def broken_session():
        yield _BrokenSession()

    app.dependency_overrides[get_session] = broken_session
    try:
        res = client.get("/api/v1/health/ready")
        assert res.status_code == 503
    finally:
        # Restore handled by the fixture teardown clearing overrides.
        pass


def test_sitemap(routes_app) -> None:
    client: TestClient = routes_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/sitemap.xml")
    assert res.status_code == 200
    assert "urlset" in res.text


def test_robots(routes_app) -> None:
    client: TestClient = routes_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/robots.txt")
    assert res.status_code == 200
    assert "User-agent: *" in res.text
    assert "Sitemap:" in res.text


def test_product_feed(routes_app) -> None:
    SessionLocal = routes_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = routes_app["client"]  # type: ignore[assignment]

    async def seed() -> None:
        from app.models.catalog import Category, Product, ProductStatus

        async with SessionLocal() as session:
            category = Category(slug="c", name="C", sort_order=1)
            session.add(category)
            await session.flush()
            session.add(
                Product(
                    slug="feed-item",
                    name="Feed Item",
                    base_price=12,
                    currency="RON",
                    category_id=category.id,
                    stock_quantity=3,
                    status=ProductStatus.published,
                )
            )
            await session.commit()

    asyncio.run(seed())
    res = client.get("/api/v1/feeds/products.json")
    assert res.status_code == 200
    body = res.json()
    assert any(item["slug"] == "feed-item" for item in body)


def test_metrics_requires_admin(routes_app) -> None:
    SessionLocal = routes_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = routes_app["client"]  # type: ignore[assignment]

    async def seed_admin() -> None:
        async with SessionLocal() as session:
            admin = User(
                email="metrics-admin@example.com",
                username="mxadmin",
                hashed_password=security.hash_password("Password123"),
                name="Admin",
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
            session.add(
                UserPasskey(
                    user_id=admin.id,
                    name="pk",
                    credential_id=f"cred-{admin.id}",
                    public_key=b"k",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()

    asyncio.run(seed_admin())
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "metrics-admin@example.com", "password": "Password123"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["tokens"]["access_token"]
    res = client.get("/api/v1/metrics", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert isinstance(res.json(), dict)
