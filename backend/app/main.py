from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import api_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from fastapi.encoders import jsonable_encoder
from app.middleware import (
    AuditMiddleware,
    BackpressureMiddleware,
    MaintenanceModeMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)
from app.schemas.error import ErrorResponse


def get_application() -> FastAPI:
    configure_logging(settings.log_json)
    tags_metadata = [
        {"name": "auth", "description": "Authentication and user management"},
        {"name": "catalog", "description": "Products and categories"},
        {"name": "cart", "description": "Cart and checkout"},
        {"name": "orders", "description": "Orders and admin tools"},
        {"name": "content", "description": "CMS content blocks"},
        {"name": "payments", "description": "Payment integrations"},
    ]
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        openapi_tags=tags_metadata,
        swagger_ui_parameters={"displayRequestDuration": True},
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
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(AuditMiddleware)
    media_root = Path(settings.media_root)
    media_root.mkdir(parents=True, exist_ok=True)
    app.include_router(api_router, prefix="/api/v1")
    app.mount("/media", StaticFiles(directory=media_root), name="media")

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        payload = ErrorResponse(detail=exc.detail, code=None)
        return JSONResponse(status_code=exc.status_code, content=jsonable_encoder(payload.model_dump()))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = jsonable_encoder(exc.errors())
        payload = ErrorResponse(detail=errors, code="validation_error")
        return JSONResponse(status_code=422, content=payload.model_dump())

    return app


app = get_application()
