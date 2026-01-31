import asyncio
from datetime import datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import auth as auth_api
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentStatus


@pytest.fixture
def rate_limit_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            session.add_all(
                [
                    ContentBlock(
                        key="page.terms-and-conditions",
                        title="Terms",
                        body_markdown="Terms",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                    ContentBlock(
                        key="page.privacy-policy",
                        title="Privacy",
                        body_markdown="Privacy",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                ]
            )
            await session.commit()

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    for dep in [
        auth_api.login_rate_limit,
        auth_api.register_rate_limit,
        auth_api.refresh_rate_limit,
        auth_api.reset_request_rate_limit,
        auth_api.reset_confirm_rate_limit,
    ]:
        dep.buckets.clear()
    client = TestClient(app)
    yield {"client": client}
    client.close()
    app.dependency_overrides.clear()
    for dep in [
        auth_api.login_rate_limit,
        auth_api.register_rate_limit,
        auth_api.refresh_rate_limit,
        auth_api.reset_request_rate_limit,
        auth_api.reset_confirm_rate_limit,
    ]:
        dep.buckets.clear()


def test_login_rate_limiter(rate_limit_app: Dict[str, object]) -> None:
    client: TestClient = rate_limit_app["client"]  # type: ignore[assignment]
    payload = {
        "email": "limited@example.com",
        "username": "limiter",
        "password": "pass12345",
        "name": "Limiter",
        "first_name": "Limiter",
        "last_name": "User",
        "date_of_birth": "2000-01-01",
        "phone": "+40723204204",
        "accept_terms": True,
        "accept_privacy": True,
    }
    res = client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 201, res.text

    limit = auth_api.settings.auth_rate_limit_login
    for _ in range(limit):
        ok = client.post("/api/v1/auth/login", json={"email": payload["email"], "password": payload["password"]})
        assert ok.status_code == 200, ok.text

    blocked = client.post("/api/v1/auth/login", json={"email": payload["email"], "password": payload["password"]})
    assert blocked.status_code == 429
    assert blocked.headers.get("Retry-After")
    assert blocked.headers.get("X-Request-ID")
    body = blocked.json()
    assert body.get("code") == "too_many_requests"
    assert body.get("request_id")
    assert isinstance(body.get("retry_after"), int)
