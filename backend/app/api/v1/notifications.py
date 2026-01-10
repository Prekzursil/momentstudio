from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.notification import NotificationListResponse, NotificationRead, NotificationUnreadCountResponse
from app.services import notifications as notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationListResponse:
    rows = await notification_service.list_notifications(session, user_id=current_user.id, limit=limit)
    return NotificationListResponse(items=[NotificationRead.model_validate(row) for row in rows])


@router.get("/unread-count", response_model=NotificationUnreadCountResponse)
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationUnreadCountResponse:
    count = await notification_service.unread_count(session, user_id=current_user.id)
    return NotificationUnreadCountResponse(count=count)


@router.post("/{notification_id}/read", response_model=NotificationRead, status_code=status.HTTP_200_OK)
async def mark_notification_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationRead:
    row = await notification_service.mark_read(session, user_id=current_user.id, notification_id=notification_id)
    return NotificationRead.model_validate(row)


@router.post("/{notification_id}/dismiss", response_model=NotificationRead, status_code=status.HTTP_200_OK)
async def dismiss_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationRead:
    row = await notification_service.dismiss(session, user_id=current_user.id, notification_id=notification_id)
    return NotificationRead.model_validate(row)

