"""Lean coverage for the ``app.middleware`` package re-export module.

``backend/app/middleware/__init__.py`` re-exports the middleware classes
and declares ``__all__``. The test imports the package and asserts every
re-exported name resolves to its defining class so all four import
statements and the ``__all__`` assignment run.
"""

import importlib

from app.middleware.backpressure import (
    BackpressureMiddleware as _Backpressure,
    MaintenanceModeMiddleware as _Maintenance,
)
from app.middleware.request_log import RequestLoggingMiddleware as _RequestLogging
from app.middleware.security import (
    AuditMiddleware as _Audit,
    SecurityHeadersMiddleware as _SecurityHeaders,
)


def test_middleware_package_reexports() -> None:
    module = importlib.import_module("app.middleware")
    assert module.RequestLoggingMiddleware is _RequestLogging
    assert module.AuditMiddleware is _Audit
    assert module.SecurityHeadersMiddleware is _SecurityHeaders
    assert module.BackpressureMiddleware is _Backpressure
    assert module.MaintenanceModeMiddleware is _Maintenance
    assert module.__all__ == [
        "RequestLoggingMiddleware",
        "AuditMiddleware",
        "SecurityHeadersMiddleware",
        "BackpressureMiddleware",
        "MaintenanceModeMiddleware",
    ]
