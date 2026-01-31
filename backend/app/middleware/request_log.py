import logging
import time
import uuid
from typing import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging_config import request_id_ctx_var

logger = logging.getLogger("app.request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = str(uuid.uuid4())
        token = request_id_ctx_var.set(request_id)
        start = time.time()
        request.state.request_id = request_id
        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration = time.time() - start
            if response is not None:
                response.headers["X-Request-ID"] = request_id
                logger.info(
                    "request",
                    extra={
                        "request_id": request_id,
                        "path": request.url.path,
                        "method": request.method,
                        "status_code": response.status_code,
                        "duration_ms": int(duration * 1000),
                    },
                )
            request_id_ctx_var.reset(token)
