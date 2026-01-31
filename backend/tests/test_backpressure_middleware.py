import asyncio

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from httpx import AsyncClient

from app.middleware.backpressure import BackpressureMiddleware
from app.middleware.request_log import RequestLoggingMiddleware


@pytest.mark.anyio
async def test_backpressure_disabled_allows_requests() -> None:
    app = FastAPI()
    app.add_middleware(BackpressureMiddleware, max_concurrent=0)
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        await asyncio.sleep(0.05)
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get("/slow")
        assert res.status_code == 200, res.text


@pytest.mark.anyio
async def test_backpressure_rejects_under_saturation() -> None:
    app = FastAPI()
    app.add_middleware(BackpressureMiddleware, max_concurrent=1)
    app.add_middleware(RequestLoggingMiddleware)

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

    rejected = blocked if blocked.status_code == status.HTTP_429_TOO_MANY_REQUESTS else ok
    assert rejected.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert rejected.headers.get("Retry-After") == "1"
    assert rejected.headers.get("X-Request-ID")
    body = rejected.json()
    assert body["code"] == "too_many_requests"
    assert body["retry_after"] == 1
    assert body.get("request_id")


@pytest.mark.anyio
async def test_backpressure_exempts_health_endpoints() -> None:
    app = FastAPI()
    app.add_middleware(BackpressureMiddleware, max_concurrent=1)
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        await asyncio.sleep(0.2)
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        first = asyncio.create_task(client.get("/slow"))
        await asyncio.sleep(0.05)
        health_res = await client.get("/api/v1/health")
        await first

    assert health_res.status_code == 200, health_res.text


@pytest.mark.anyio
async def test_backpressure_releases_tokens_on_exceptions() -> None:
    app = FastAPI()
    app.add_middleware(BackpressureMiddleware, max_concurrent=1)
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/boom")
    async def boom() -> dict[str, bool]:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="boom")

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        await asyncio.sleep(0.05)
        return {"ok": True}

    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get("/boom")
        assert res.status_code == 500, res.text
        after = await client.get("/slow")
        assert after.status_code == 200, after.text

