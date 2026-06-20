"""Coverage-completion tests (worker 5) for app.middleware.backpressure.

Focuses on the branches not exercised by the existing
``test_backpressure_middleware.py`` / ``test_backpressure_maintenance.py``:

* ``_is_exempt`` health / admin / payment-webhook / bypass-token / default arcs
* the 429 response payload when no ``request_id`` is present on ``request.state``
* ``MaintenanceModeMiddleware`` bypass-token header acceptance and the
  explicit ``bypass_token`` constructor argument
"""

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from starlette.requests import Request

from app.core.config import settings
from app.middleware.backpressure import (
    BackpressureMiddleware,
    MaintenanceModeMiddleware,
    _is_exempt,
)


def _make_request(path: str, headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1"))
        for k, v in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "raw_path": path.encode("latin-1"),
        "headers": raw_headers,
        "query_string": b"",
    }
    return Request(scope)


def test_is_exempt_health_path() -> None:
    assert _is_exempt(_make_request("/api/v1/health"), None) is True
    assert _is_exempt(_make_request("/api/v1/health/ready"), "tok") is True


def test_is_exempt_admin_path() -> None:
    assert _is_exempt(_make_request("/api/v1/admin/orders"), None) is True


def test_is_exempt_payment_webhooks() -> None:
    for path in (
        "/api/v1/payments/webhook",
        "/api/v1/payments/paypal/webhook",
        "/api/v1/payments/netopia/webhook",
    ):
        assert _is_exempt(_make_request(path), None) is True


def test_is_exempt_bypass_token_match() -> None:
    req = _make_request("/api/v1/catalog", {"X-Maintenance-Bypass": "secret"})
    assert _is_exempt(req, "secret") is True


def test_is_exempt_bypass_token_mismatch_returns_false() -> None:
    req = _make_request("/api/v1/catalog", {"X-Maintenance-Bypass": "wrong"})
    assert _is_exempt(req, "secret") is False


def test_is_exempt_no_token_default_false() -> None:
    assert _is_exempt(_make_request("/api/v1/catalog"), None) is False


@pytest.mark.anyio
async def test_backpressure_429_without_request_id() -> None:
    """When no RequestLoggingMiddleware runs, ``request.state.request_id`` is
    absent, so the 429 payload omits ``request_id`` (covers the False arc of
    ``if request_id:``)."""
    app = FastAPI()
    # Only the backpressure middleware -> request.state has no request_id.
    app.add_middleware(BackpressureMiddleware, max_concurrent=1)

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        await asyncio.sleep(0.2)
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        first = asyncio.create_task(client.get("/slow"))
        await asyncio.sleep(0.05)
        blocked = await client.get("/slow")
        ok = await first

    rejected = blocked if blocked.status_code == 429 else ok
    assert rejected.status_code == 429
    body = rejected.json()
    assert body["code"] == "too_many_requests"
    assert body["retry_after"] == 1
    assert "request_id" not in body
    assert rejected.headers.get("Retry-After") == "1"


@pytest.mark.anyio
async def test_maintenance_bypass_token_header_allows_request(monkeypatch) -> None:
    monkeypatch.setattr(settings, "maintenance_mode", True)
    app = FastAPI()
    app.add_middleware(MaintenanceModeMiddleware, bypass_token="let-me-in")

    @app.get("/store")
    async def store() -> dict[str, bool]:
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        blocked = await client.get("/store")
        assert blocked.status_code == 503
        assert blocked.headers.get("Retry-After") == "120"

        allowed = await client.get(
            "/store", headers={"X-Maintenance-Bypass": "let-me-in"}
        )
        assert allowed.status_code == 200, allowed.text


def test_maintenance_constructor_falls_back_to_settings(monkeypatch) -> None:
    """When ``bypass_token`` is not passed, it falls back to the settings value
    (covers the ``or settings.maintenance_bypass_token`` arc)."""
    monkeypatch.setattr(settings, "maintenance_bypass_token", "from-settings")
    mw = MaintenanceModeMiddleware(app=FastAPI())
    assert mw.bypass_token == "from-settings"
