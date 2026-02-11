import logging

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.dependencies import require_admin_section
from app.models.user import User
from app.schemas.observability import AdminClientErrorIn

logger = logging.getLogger("app.admin_client_errors")

router = APIRouter(prefix="/admin/observability", tags=["admin"])


def _sanitize_log_text(value: str | None, *, max_len: int = 2048) -> str | None:
    if value is None:
        return None
    cleaned = value.replace("\r", "\\r").replace("\n", "\\n")
    if len(cleaned) > max_len:
        return f"{cleaned[:max_len]}…"
    return cleaned


def _sanitize_log_value(value: object) -> object:
    if isinstance(value, dict):
        out: dict[str, object] = {}
        for raw_key, raw_value in value.items():
            safe_key = _sanitize_log_text(str(raw_key), max_len=128) or "key"
            out[safe_key] = _sanitize_log_value(raw_value)
        return out
    if isinstance(value, list):
        return [_sanitize_log_value(item) for item in value[:50]]
    if isinstance(value, str):
        return _sanitize_log_text(value, max_len=1024) or ""
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _sanitize_log_text(str(value), max_len=1024) or ""


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
async def log_admin_client_error(
    payload: AdminClientErrorIn,
    request: Request,
    user: User = Depends(require_admin_section("dashboard")),
) -> Response:
    logger.error(
        "admin_client_error",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "user_id": str(user.id),
            "user_role": str(user.role),
            "kind": _sanitize_log_text(payload.kind, max_len=64),
            "message": _sanitize_log_text(payload.message, max_len=512),
            "stack": _sanitize_log_text(payload.stack, max_len=4096),
            "url": _sanitize_log_text(payload.url, max_len=1024),
            "route": _sanitize_log_text(payload.route, max_len=256),
            "user_agent": _sanitize_log_text(payload.user_agent, max_len=512),
            "context": _sanitize_log_value(payload.context or {}),
            "client_occurred_at": payload.occurred_at.isoformat() if payload.occurred_at else None,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
