from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1 import api_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.middleware import (
    AuditMiddleware,
    BackpressureMiddleware,
    MaintenanceModeMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)


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
    return app


app = get_application()
