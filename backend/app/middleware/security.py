import json
import logging
import time
from typing import Any, Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logging_config import request_id_ctx_var
from app.core.security import decode_token

audit_logger = logging.getLogger("app.audit")

_SENSITIVE_EXACT_KEYS = {
    # Auth/session secrets
    "password",
    "new_password",
    "current_password",
    "token",
    "refresh_token",
    "access_token",
    "id_token",
    "client_secret",
    "secret",
    "api_key",
    "captcha_token",
    "turnstile_token",
    # Common PII fields
    "email",
    "phone",
    "first_name",
    "middle_name",
    "last_name",
}
_SENSITIVE_KEY_FRAGMENTS = (
    "password",
    "token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
    "session",
    "address",
    "street",
    "city",
    "county",
    "state",
    "postal",
    "zip",
    "note",
)


def _is_sensitive_key(key: str) -> bool:
    lowered = (key or "").strip().lower()
    if not lowered:
        return False
    if lowered in _SENSITIVE_EXACT_KEYS:
        return True
    return any(fragment in lowered for fragment in _SENSITIVE_KEY_FRAGMENTS)


def _redact_mapping(payload: dict[Any, Any], *, _depth: int) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for idx, (k, v) in enumerate(payload.items()):
        if idx >= 80:
            redacted["..."] = "truncated"
            break
        key = str(k)
        if _is_sensitive_key(key):
            redacted[key] = "***"
        else:
            redacted[key] = _redact_payload(v, _depth=_depth + 1)
    return redacted


def _redact_sequence(payload: list[Any], *, _depth: int) -> list[Any]:
    items: list[Any] = []
    for idx, item in enumerate(payload):
        if idx >= 80:
            items.append("...truncated")
            break
        items.append(_redact_payload(item, _depth=_depth + 1))
    return items


def _redact_payload(payload: Any, *, _depth: int = 0) -> Any:
    if _depth >= 6:
        return "***"
    if isinstance(payload, dict):
        return _redact_mapping(payload, _depth=_depth)
    if isinstance(payload, list):
        return _redact_sequence(payload, _depth=_depth)
    if isinstance(payload, str) and len(payload) > 2000:
        return payload[:2000]
    return payload


async def _read_body_text_if_enabled(request: Request, *, max_bytes: int, log_payload: bool) -> str | None:
    if not log_payload:
        return None
    try:
        raw_body = await request.body()
        request._body = raw_body  # type: ignore[attr-defined]
    except Exception:
        return None
    if raw_body and len(raw_body) < max_bytes:
        return raw_body.decode("utf-8", errors="replace")
    return None


def _extract_user_id(auth_header: str | None) -> str | None:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1]
    decoded = decode_token(token)
    if decoded and decoded.get("sub"):
        return str(decoded["sub"])
    return None


def _parse_json_request_payload(body_text: str | None, *, content_type: str) -> Any:
    if not body_text or "application/json" not in content_type:
        return None
    try:
        return _redact_payload(json.loads(body_text))
    except Exception:
        return None


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        max_bytes = int(getattr(settings, "audit_log_max_body_bytes", 4096) or 4096)
        log_payload = bool(getattr(settings, "audit_log_request_payload", True))
        body_text = await _read_body_text_if_enabled(request, max_bytes=max_bytes, log_payload=log_payload)
        user_id = _extract_user_id(request.headers.get("authorization"))

        start = time.time()
        response = await call_next(request)
        duration_ms = int((time.time() - start) * 1000)
        request_payload = _parse_json_request_payload(body_text, content_type=request.headers.get("content-type", ""))

        audit_logger.info(
            "audit",
            extra={
                "request_id": request_id_ctx_var.get() or "-",
                "path": request.url.path,
                "method": request.method,
                "status_code": response.status_code,
                "user_id": user_id or "-",
                "client_ip": request.client.host if request.client else "-",
                "duration_ms": duration_ms,
                "request_payload": request_payload,
            },
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        if settings.csp_enabled:
            response.headers.setdefault("Content-Security-Policy", settings.csp_policy)
        if settings.secure_cookies:
            response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response
