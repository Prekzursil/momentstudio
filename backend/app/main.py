from pathlib import Path
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import api_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.core.sentry import init_sentry
from fastapi.encoders import jsonable_encoder
from app.middleware import (
    AuditMiddleware,
    BackpressureMiddleware,
    MaintenanceModeMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)
from app.schemas.error import ErrorResponse
from app.services import fx_refresh
from app.services import admin_report_scheduler
from app.services import account_deletion_scheduler
from app.services import order_expiration_scheduler
from app.core.startup_checks import validate_production_settings
from app.core import redis_client


def get_application() -> FastAPI:
    configure_logging(settings.log_json)
    init_sentry()
    validate_production_settings()
    tags_metadata = [
        {"name": "auth", "description": "Authentication and user management"},
        {"name": "catalog", "description": "Products and categories"},
        {"name": "cart", "description": "Cart and checkout"},
        {"name": "orders", "description": "Orders and admin tools"},
        {"name": "content", "description": "CMS content blocks"},
        {"name": "payments", "description": "Payment integrations"},
    ]

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        fx_refresh.start(app)
        admin_report_scheduler.start(app)
        account_deletion_scheduler.start(app)
        order_expiration_scheduler.start(app)
        yield
        await fx_refresh.stop(app)
        await admin_report_scheduler.stop(app)
        await account_deletion_scheduler.stop(app)
        await order_expiration_scheduler.stop(app)
        await redis_client.close_redis()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        openapi_tags=tags_metadata,
        swagger_ui_parameters={"displayRequestDuration": True},
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(MaintenanceModeMiddleware)
    app.add_middleware(BackpressureMiddleware)
    app.add_middleware(AuditMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    media_root = Path(settings.media_root)
    media_root.mkdir(parents=True, exist_ok=True)
    Path(settings.private_media_root).mkdir(parents=True, exist_ok=True)
    app.include_router(api_router, prefix="/api/v1")
    app.mount("/media", StaticFiles(directory=media_root), name="media")

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        headers = dict(getattr(exc, "headers", None) or {})
        if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            retry_after = headers.get("Retry-After") or "1"
            headers.setdefault("Retry-After", str(retry_after))
            body: dict[str, object] = ErrorResponse(detail=exc.detail, code="too_many_requests").model_dump()
            request_id = getattr(request.state, "request_id", None)
            if request_id:
                body["request_id"] = request_id
            try:
                body["retry_after"] = int(str(retry_after))
            except Exception:
                body["retry_after"] = str(retry_after)
            return JSONResponse(status_code=exc.status_code, content=jsonable_encoder(body), headers=headers)

        error_code = headers.get("X-Error-Code") or headers.get("x-error-code")
        err = ErrorResponse(detail=exc.detail, code=str(error_code) if error_code else None)
        return JSONResponse(status_code=exc.status_code, content=jsonable_encoder(err.model_dump()), headers=headers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = jsonable_encoder(exc.errors())
        payload = ErrorResponse(detail=errors, code="validation_error")
        return JSONResponse(status_code=422, content=jsonable_encoder(payload.model_dump()))

    return app


app = get_application()
