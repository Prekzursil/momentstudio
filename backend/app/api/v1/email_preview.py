from fastapi import APIRouter, Depends, Query

from app.core.dependencies import require_admin
from app.services import email as email_service

router = APIRouter(prefix="/email-preview", tags=["email"])


@router.get("", response_model=dict[str, str])
async def preview_email(
    template: str = Query(..., description="Template filename e.g. cart_abandonment.txt.j2"),
    context: str = Query("{}", description="JSON string for context"),
    _: str = Depends(require_admin),
) -> dict[str, str]:
    import json

    ctx = json.loads(context or "{}")
    return await email_service.preview_email(template, ctx)
