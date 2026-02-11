import logging

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.dependencies import require_admin_section
from app.models.user import User
from app.schemas.observability import AdminClientErrorIn

logger = logging.getLogger("app.admin_client_errors")

router = APIRouter(prefix="/admin/observability", tags=["admin"])


def _sanitize_log_token(value: object, *, max_len: int = 128) -> str | None:
    if value is None:
        return None
    cleaned = str(value).replace("\r", "").replace("\n", "")
    if not cleaned:
        return None
    if len(cleaned) > max_len:
        return cleaned[:max_len]
    return cleaned


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
async def log_admin_client_error(
    payload: AdminClientErrorIn,  # parsed/validated to enforce schema at ingress
    request: Request,
    user: User = Depends(require_admin_section("dashboard")),
) -> Response:
    _ = payload
    logger.error(
        "admin_client_error",
        extra={
            "request_id": _sanitize_log_token(getattr(request.state, "request_id", None)),
            "user_id": str(user.id),
            "user_role": str(user.role),
            "source": "admin_observability",
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
