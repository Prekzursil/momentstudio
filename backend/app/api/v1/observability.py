import logging

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.dependencies import require_admin_section
from app.models.user import User
from app.schemas.observability import AdminClientErrorIn

logger = logging.getLogger("app.admin_client_errors")

router = APIRouter(prefix="/admin/observability", tags=["admin"])


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
            "kind": payload.kind,
            "message": payload.message,
            "stack": payload.stack,
            "url": payload.url,
            "route": payload.route,
            "user_agent": payload.user_agent,
            "context": payload.context or {},
            "client_occurred_at": payload.occurred_at.isoformat() if payload.occurred_at else None,
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

