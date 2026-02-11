import hashlib
import logging
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.dependencies import require_admin_section
from app.models.user import User
from app.schemas.observability import AdminClientErrorIn

logger = logging.getLogger("app.admin_client_errors")

router = APIRouter(prefix="/admin/observability", tags=["admin"])


def _fingerprint_admin_client_error(payload: AdminClientErrorIn) -> str:
    digest = hashlib.sha256()
    parts = (
        payload.kind,
        payload.message,
        payload.stack or "",
        payload.url or "",
        payload.route or "",
        payload.user_agent or "",
    )
    for part in parts:
        digest.update(part.encode("utf-8", "ignore"))
        digest.update(b"\0")
    return digest.hexdigest()[:24]


def _approx_payload_size(value: Any, *, _depth: int = 0) -> int:
    if value is None:
        return 0
    if _depth > 8:
        return 0
    if isinstance(value, dict):
        return sum(
            _approx_payload_size(raw_key, _depth=_depth + 1) + _approx_payload_size(raw_value, _depth=_depth + 1)
            for raw_key, raw_value in list(value.items())[:100]
        )
    if isinstance(value, list):
        return sum(_approx_payload_size(item, _depth=_depth + 1) for item in value[:100])
    return len(str(value))


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
async def log_admin_client_error(
    payload: AdminClientErrorIn,
    request: Request,
    user: User = Depends(require_admin_section("dashboard")),
) -> Response:
    context = payload.context if isinstance(payload.context, dict) else {}
    logger.error(
        "admin_client_error",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "user_id": str(user.id),
            "user_role": str(user.role),
            "kind": payload.kind,
            "error_fingerprint": _fingerprint_admin_client_error(payload),
            "message_len": len(payload.message),
            "has_stack": bool(payload.stack),
            "stack_len": len(payload.stack or ""),
            "has_url": bool(payload.url),
            "has_route": bool(payload.route),
            "has_user_agent": bool(payload.user_agent),
            "context_key_count": len(context),
            "context_approx_size": _approx_payload_size(context),
            "client_occurred_at": payload.occurred_at.isoformat() if payload.occurred_at else None,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
