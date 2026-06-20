"""Worker-0 coverage delta for ``app.api.v1.analytics``.

Targets the API-endpoint branches that ``test_analytics_tokens`` does not
reach: payload sanitisation, blank-session guards, event validation, the
best-effort body-read failure paths, optional-token clearing, and ``order_id``
extraction from the event payload.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.requests import Request

from app.api.v1 import analytics as analytics_api
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.services import analytics_tokens


@pytest.fixture
def test_client() -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with session_local() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield client
    client.close()
    app.dependency_overrides.clear()


def test_sanitize_payload_trims_and_filters() -> None:
    # Non-dict -> None.
    assert analytics_api._sanitize_payload(None) is None
    # A dict with: >50 keys (break), a non-str key, a blank-after-strip key,
    # an over-long string value, and a normal value.
    raw: dict = {"  ": "blank-key-dropped", "keep": "value", "long": "x" * 600}
    raw[123] = "non-str-key-dropped"  # type: ignore[index]
    for i in range(60):
        raw[f"k{i}"] = i
    cleaned = analytics_api._sanitize_payload(raw)
    assert cleaned is not None
    assert cleaned["keep"] == "value"
    assert cleaned["long"] == "x" * 500
    assert "" not in cleaned
    assert 123 not in cleaned
    # Capped at 50 entries.
    assert len(cleaned) <= 50


def test_sanitize_payload_all_dropped_returns_none() -> None:
    # Only droppable entries -> empty dict -> None.
    assert analytics_api._sanitize_payload({"   ": "x"}) is None


def test_mint_token_blank_session_rejected(test_client: TestClient) -> None:
    resp = test_client.post("/api/v1/analytics/token", json={"session_id": "   "})
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "Missing session_id"


def test_ingest_unsupported_event_rejected(test_client: TestClient) -> None:
    resp = test_client.post(
        "/api/v1/analytics/events",
        json={"event": "totally_unknown", "session_id": "sess"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "Unsupported analytics event"


def test_ingest_blank_session_rejected(test_client: TestClient) -> None:
    resp = test_client.post(
        "/api/v1/analytics/events",
        json={"event": "session_start", "session_id": "   "},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "Missing session_id"


def test_ingest_optional_invalid_token_is_cleared(test_client: TestClient) -> None:
    previous = settings.analytics_require_token
    settings.analytics_require_token = False
    try:
        # token does not match session -> elif branch clears raw_token, request
        # still succeeds.
        token = analytics_tokens.create_analytics_token(session_id="other")
        resp = test_client.post(
            "/api/v1/analytics/events",
            headers={"X-Analytics-Token": token},
            json={"event": "session_start", "session_id": "mine"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["received"] is True
    finally:
        settings.analytics_require_token = previous


def test_ingest_extracts_order_id_from_payload(test_client: TestClient) -> None:
    previous = settings.analytics_require_token
    settings.analytics_require_token = False
    try:
        order_id = str(uuid.uuid4())
        # Valid order_id string in payload is parsed.
        ok = test_client.post(
            "/api/v1/analytics/events",
            json={
                "event": "checkout_success",
                "session_id": "sess-order",
                "payload": {"order_id": order_id, "keep": "v"},
            },
        )
        assert ok.status_code == 200, ok.text

        # Invalid order_id string -> swallowed (order_id stays None).
        bad = test_client.post(
            "/api/v1/analytics/events",
            json={
                "event": "checkout_success",
                "session_id": "sess-order2",
                "payload": {"order_id": "not-a-uuid"},
            },
        )
        assert bad.status_code == 200, bad.text

        # Non-string order_id in payload -> isinstance guard skips the parse.
        non_str = test_client.post(
            "/api/v1/analytics/events",
            json={
                "event": "checkout_success",
                "session_id": "sess-order3",
                "payload": {"order_id": 12345},
            },
        )
        assert non_str.status_code == 200, non_str.text
    finally:
        settings.analytics_require_token = previous


def test_mint_token_body_read_failure_is_logged(monkeypatch) -> None:
    async def boom(self) -> bytes:
        raise RuntimeError("client disconnected")

    monkeypatch.setattr(Request, "body", boom)

    from app.schemas.analytics import AnalyticsTokenRequest

    async def run() -> None:
        scope = {
            "type": "http",
            "method": "POST",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        }
        request = Request(scope, receive=lambda: None)
        resp = await analytics_api.mint_analytics_token(
            AnalyticsTokenRequest(session_id="sess"), request
        )
        assert resp.expires_in >= 60
        assert resp.token

    asyncio.run(run())


def test_ingest_body_read_failure_is_logged(monkeypatch) -> None:
    async def boom(self) -> bytes:
        raise RuntimeError("client disconnected")

    monkeypatch.setattr(Request, "body", boom)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    from app.schemas.analytics import AnalyticsEventCreate

    async def run() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        scope = {
            "type": "http",
            "method": "POST",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        }
        request = Request(scope, receive=lambda: None)
        async with session_local() as session:
            resp = await analytics_api.ingest_analytics_event(
                AnalyticsEventCreate(event="session_start", session_id="sess"),
                request,
                session=session,
                user=None,
            )
        assert resp.received is True

    asyncio.run(run())
