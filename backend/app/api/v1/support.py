from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user_optional, require_admin
from app.db.session import get_session
from app.models.support import ContactSubmissionStatus, ContactSubmissionTopic
from app.models.user import User
from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.support import (
    ContactSubmissionCreate,
    ContactSubmissionListItem,
    ContactSubmissionListResponse,
    ContactSubmissionRead,
    ContactSubmissionUpdate,
)
from app.services import auth as auth_service
from app.services import email as email_service
from app.services import support as support_service

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/contact", response_model=ContactSubmissionRead, status_code=status.HTTP_201_CREATED)
async def submit_contact(
    payload: ContactSubmissionCreate,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user: User | None = Depends(get_current_user_optional),
) -> ContactSubmissionRead:
    record = await support_service.create_contact_submission(
        session,
        topic=payload.topic,
        name=payload.name,
        email=str(payload.email),
        message=payload.message,
        order_reference=payload.order_reference,
        user=current_user,
    )

    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_contact_submission_notification,
            admin_to,
            topic=record.topic.value,
            from_name=record.name,
            from_email=record.email,
            message=record.message,
            order_reference=record.order_reference,
            admin_url=f"{settings.frontend_origin.rstrip('/')}/admin/support",
            lang=owner.preferred_language if owner else None,
        )

    return ContactSubmissionRead.model_validate(record)


@router.get("/admin/submissions", response_model=ContactSubmissionListResponse)
async def admin_list_contact_submissions(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
    q: str | None = Query(default=None),
    status_filter: ContactSubmissionStatus | None = Query(default=None),
    topic_filter: ContactSubmissionTopic | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
) -> ContactSubmissionListResponse:
    rows, total_items = await support_service.list_contact_submissions(
        session,
        q=q,
        status_filter=status_filter,
        topic_filter=topic_filter,
        page=page,
        limit=limit,
    )
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    return ContactSubmissionListResponse(
        items=[
            ContactSubmissionListItem(
                id=r.id,
                topic=r.topic,
                status=r.status,
                name=r.name,
                email=r.email,
                order_reference=r.order_reference,
                created_at=r.created_at,
            )
            for r in rows
        ],
        meta=AdminPaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.get("/admin/submissions/{submission_id}", response_model=ContactSubmissionRead)
async def admin_get_contact_submission(
    submission_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> ContactSubmissionRead:
    record = await support_service.get_contact_submission(session, submission_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return ContactSubmissionRead.model_validate(record)


@router.patch("/admin/submissions/{submission_id}", response_model=ContactSubmissionRead)
async def admin_update_contact_submission(
    submission_id: UUID,
    payload: ContactSubmissionUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ContactSubmissionRead:
    record = await support_service.get_contact_submission(session, submission_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    updated = await support_service.update_contact_submission(
        session,
        submission=record,
        status_value=payload.status,
        admin_note=payload.admin_note,
        actor=admin,
    )
    return ContactSubmissionRead.model_validate(updated)
