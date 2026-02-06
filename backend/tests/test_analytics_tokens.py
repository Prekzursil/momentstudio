import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app


@pytest.fixture(scope="module")
def test_client() -> TestClient:
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


def test_analytics_ingest_allows_missing_token_by_default(test_client: TestClient) -> None:
    previous_require_token = settings.analytics_require_token
    settings.analytics_require_token = False
    try:
        resp = test_client.post(
            "/api/v1/analytics/events",
            json={"event": "session_start", "session_id": "test-session", "path": "/", "payload": None},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json().get("received") is True
    finally:
        settings.analytics_require_token = previous_require_token


def test_analytics_token_required_flow(test_client: TestClient) -> None:
    previous_require_token = settings.analytics_require_token
    previous_ttl = settings.analytics_token_ttl_seconds
    settings.analytics_require_token = True
    settings.analytics_token_ttl_seconds = 60 * 60
    try:
        missing = test_client.post(
            "/api/v1/analytics/events",
            json={"event": "session_start", "session_id": "secure-session", "path": "/", "payload": None},
        )
        assert missing.status_code == 401, missing.text
        payload = missing.json()
        assert payload.get("code") == "analytics_token_required"

        minted = test_client.post("/api/v1/analytics/token", json={"session_id": "secure-session"})
        assert minted.status_code == 200, minted.text
        token = minted.json().get("token")
        assert isinstance(token, str) and token

        ok = test_client.post(
            "/api/v1/analytics/events",
            headers={"X-Analytics-Token": token},
            json={"event": "session_start", "session_id": "secure-session", "path": "/", "payload": None},
        )
        assert ok.status_code == 200, ok.text

        mismatch = test_client.post(
            "/api/v1/analytics/events",
            headers={"X-Analytics-Token": token},
            json={"event": "session_start", "session_id": "other-session", "path": "/", "payload": None},
        )
        assert mismatch.status_code == 401, mismatch.text
        mismatch_payload = mismatch.json()
        assert mismatch_payload.get("code") == "analytics_token_invalid"
    finally:
        settings.analytics_require_token = previous_require_token
        settings.analytics_token_ttl_seconds = previous_ttl

