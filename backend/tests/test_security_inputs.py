import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app


@pytest.fixture
def client_with_db():
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
    yield client
    client.close()
    app.dependency_overrides.clear()


def test_catalog_search_injection_strings(client_with_db: TestClient):
    payloads = ["' OR 1=1 --", "<script>alert(1)</script>", '";DROP TABLE users;--']
    for term in payloads:
        res = client_with_db.get(f"/api/v1/catalog/products?search={term}")
        assert res.status_code == 200
        assert isinstance(res.json(), dict)


def test_content_block_rejects_script_tags(client_with_db: TestClient):
    res = client_with_db.patch(
        "/api/v1/content/admin/secure.block",
        json={"body_markdown": "<script>alert(1)</script>", "title": "XSS"},
    )
    assert res.status_code in (400, 401, 403)
