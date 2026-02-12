import logging

from fastapi import APIRouter, Depends, Response, status

from app.core.dependencies import require_admin_section
from app.models.user import User
from app.schemas.observability import AdminClientErrorIn

logger = logging.getLogger("app.admin_client_errors")

router = APIRouter(prefix="/admin/observability", tags=["admin"])
@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
async def log_admin_client_error(
    payload: AdminClientErrorIn,  # parsed/validated to enforce schema at ingress
    user: User = Depends(require_admin_section("dashboard")),
) -> Response:
    _ = payload
    _ = user
    logger.error("admin_client_error")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
