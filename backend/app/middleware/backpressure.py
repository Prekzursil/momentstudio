from typing import Awaitable, Callable

import anyio
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings


class BackpressureMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_concurrent: int | None = None):
        super().__init__(app)
        self.max_concurrent = settings.max_concurrent_requests if max_concurrent is None else int(max_concurrent)
        self.limiter = anyio.CapacityLimiter(self.max_concurrent) if self.max_concurrent > 0 else None

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable]):
        if request.url.path.startswith("/api/v1/health"):
            return await call_next(request)
        if not self.limiter:
            return await call_next(request)

        try:
            self.limiter.acquire_nowait()
        except anyio.WouldBlock:
            retry_after = "1"
            payload: dict[str, object] = {
                "detail": "Too many requests",
                "code": "too_many_requests",
            }
            request_id = getattr(request.state, "request_id", None)
            if request_id:
                payload["request_id"] = request_id
            payload["retry_after"] = 1
            return JSONResponse(status_code=429, content=payload, headers={"Retry-After": retry_after})

        try:
            return await call_next(request)
        finally:
            self.limiter.release()


class MaintenanceModeMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, bypass_token: str | None = None):
        super().__init__(app)
        self.bypass_token = bypass_token or settings.maintenance_bypass_token

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable]):
        if settings.maintenance_mode and not _is_exempt(request, self.bypass_token):
            return JSONResponse(
                status_code=503,
                content={"detail": "Maintenance mode"},
                headers={"Retry-After": "120"},
            )
        return await call_next(request)


def _is_exempt(request: Request, bypass_token: str | None) -> bool:
    if request.url.path.startswith("/api/v1/health"):
        return True
    if bypass_token and request.headers.get("X-Maintenance-Bypass") == bypass_token:
        return True
    return False
