from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import (
    get_current_user,
    get_current_user_optional,
    require_admin,
    require_admin_section,
)
from app.db.session import get_session
from app.models.support import ContactSubmissionStatus, ContactSubmissionTopic
from app.models.content import ContentStatus
from app.models.user import User
from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.content import ContentBlockUpdate
from app.schemas.support import (
    AdminFeedbackCreate,
    ContactSubmissionCreate,
    ContactSubmissionListItem,
    ContactSubmissionListResponse,
    ContactSubmissionRead,
    ContactSubmissionUpdate,
    SupportAgentRef,
    SupportCannedResponseCreate,
    SupportCannedResponseRead,
    SupportCannedResponseUpdate,
    TicketCreate,
    TicketListItemRead,
    TicketMessageCreate,
    TicketMessageRead,
    TicketRead,
    SupportSlaSettingsRead,
    SupportSlaSettingsUpdate,
)
from app.services import auth as auth_service
from app.services import captcha as captcha_service
from app.services import content as content_service
from app.services import email as email_service
from app.services import support as support_service
from app.services import pii as pii_service

router = APIRouter(prefix="/support", tags=["support"])


def _submission_to_ticket(submission, *, include_thread: bool) -> TicketRead:
    messages: list[TicketMessageRead] = []
    if include_thread:
        messages.append(
            TicketMessageRead(
                id=f"initial:{submission.id}",
                from_admin=False,
                message=submission.message,
                created_at=submission.created_at,
            )
        )
        for m in getattr(submission, "messages", []) or []:
            messages.append(
                TicketMessageRead(
                    id=str(m.id),
                    from_admin=bool(getattr(m, "from_admin", False)),
                    message=m.message,
                    created_at=m.created_at,
                )
            )

    return TicketRead(
        id=submission.id,
        topic=submission.topic,
        status=submission.status,
        name=submission.name,
        email=submission.email,
        order_reference=submission.order_reference,
        created_at=submission.created_at,
        updated_at=submission.updated_at,
        resolved_at=submission.resolved_at,
        messages=messages,
    )


def _mask_contact_submission_read(record: ContactSubmissionRead) -> ContactSubmissionRead:
    masked_email = pii_service.mask_email(record.email) or record.email
    masked_name = pii_service.mask_text(record.name, keep=1) or record.name
    masked_message = pii_service.redact_emails_in_text(record.message) or record.message
    masked_admin_note = pii_service.redact_emails_in_text(record.admin_note) if record.admin_note else None
    masked_messages = [
        m.model_copy(update={"message": pii_service.redact_emails_in_text(m.message) or m.message})
        for m in (record.messages or [])
    ]
    return record.model_copy(
        update={
            "email": masked_email,
            "name": masked_name,
            "message": masked_message,
            "admin_note": masked_admin_note,
            "messages": masked_messages,
        }
    )


@router.post("/contact", response_model=ContactSubmissionRead, status_code=status.HTTP_201_CREATED)
async def submit_contact(
    payload: ContactSubmissionCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User | None = Depends(get_current_user_optional),
) -> ContactSubmissionRead:
    if payload.topic == ContactSubmissionTopic.feedback:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported topic")
    await captcha_service.verify(payload.captcha_token, remote_ip=request.client.host if request.client else None)
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

    hydrated = await support_service.get_contact_submission_with_messages(session, record.id)
    return ContactSubmissionRead.model_validate(hydrated or record)


@router.get("/me/submissions", response_model=list[TicketListItemRead])
async def list_my_tickets(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[TicketListItemRead]:
    rows = await support_service.list_contact_submissions_for_user(session, user=user)
    return [TicketListItemRead.model_validate(r) for r in rows]


@router.post("/me/submissions", response_model=TicketRead, status_code=status.HTTP_201_CREATED)
async def create_my_ticket(
    payload: TicketCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TicketRead:
    if payload.topic == ContactSubmissionTopic.feedback:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported topic")
    display_name = (getattr(user, "name", None) or "").strip() or (getattr(user, "username", None) or "").strip() or "Customer"
    record = await support_service.create_contact_submission(
        session,
        topic=payload.topic,
        name=display_name,
        email=str(user.email),
        message=payload.message,
        order_reference=payload.order_reference,
        user=user,
    )
    hydrated = await support_service.get_contact_submission_with_messages(session, record.id)
    if not hydrated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return _submission_to_ticket(hydrated, include_thread=True)


@router.get("/me/submissions/{submission_id}", response_model=TicketRead)
async def get_my_ticket(
    submission_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TicketRead:
    record = await support_service.get_contact_submission_with_messages(session, submission_id)
    if not record or not record.user_id or record.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return _submission_to_ticket(record, include_thread=True)


@router.post("/me/submissions/{submission_id}/messages", response_model=TicketRead)
async def reply_my_ticket(
    submission_id: UUID,
    payload: TicketMessageCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TicketRead:
    record = await support_service.get_contact_submission_with_messages(session, submission_id)
    if not record or not record.user_id or record.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    updated = await support_service.add_contact_submission_message(
        session,
        submission=record,
        message=payload.message,
        from_admin=False,
        actor=user,
    )
    return _submission_to_ticket(updated, include_thread=True)


@router.get("/admin/submissions", response_model=ContactSubmissionListResponse)
async def admin_list_contact_submissions(
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
    q: str | None = Query(default=None),
    status_filter: ContactSubmissionStatus | None = Query(default=None),
    channel_filter: ContactSubmissionTopic | None = Query(default=None),
    topic_filter: ContactSubmissionTopic | None = Query(default=None),
    customer_filter: str | None = Query(default=None),
    assignee_filter: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
) -> ContactSubmissionListResponse:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    topic_filter = channel_filter or topic_filter
    rows, total_items = await support_service.list_contact_submissions(
        session,
        q=q,
        status_filter=status_filter,
        topic_filter=topic_filter,
        customer_filter=customer_filter,
        assignee_filter=assignee_filter,
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
                name=r.name if include_pii else (pii_service.mask_text(r.name, keep=1) or r.name),
                email=r.email if include_pii else (pii_service.mask_email(r.email) or r.email),
                order_reference=r.order_reference,
                assignee=getattr(r, "assignee", None),
                created_at=r.created_at,
            )
            for r in rows
        ],
        meta=AdminPaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.get("/admin/assignees", response_model=list[SupportAgentRef])
async def admin_list_support_assignees(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("support")),
) -> list[SupportAgentRef]:
    rows = await support_service.list_support_agents(session)
    return [SupportAgentRef.model_validate(r) for r in rows]


@router.post("/admin/feedback", response_model=ContactSubmissionRead, status_code=status.HTTP_201_CREATED)
async def admin_submit_feedback(
    payload: AdminFeedbackCreate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_admin_section("dashboard")),
) -> ContactSubmissionRead:
    display_name = (getattr(staff, "name", None) or "").strip() or (getattr(staff, "username", None) or "").strip() or "Staff"
    context = (payload.context or "").strip() or None
    record = await support_service.create_contact_submission(
        session,
        topic=ContactSubmissionTopic.feedback,
        name=display_name,
        email=str(staff.email),
        message=payload.message,
        admin_note=context,
        user=staff,
    )
    hydrated = await support_service.get_contact_submission_with_messages(session, record.id)
    if not hydrated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return ContactSubmissionRead.model_validate(hydrated)


@router.get("/admin/canned-responses", response_model=list[SupportCannedResponseRead])
async def admin_list_canned_responses(
    include_inactive: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("support")),
) -> list[SupportCannedResponseRead]:
    rows = await support_service.list_canned_responses(session, include_inactive=include_inactive)
    return [SupportCannedResponseRead.model_validate(r) for r in rows]


@router.post("/admin/canned-responses", response_model=SupportCannedResponseRead, status_code=status.HTTP_201_CREATED)
async def admin_create_canned_response(
    payload: SupportCannedResponseCreate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
) -> SupportCannedResponseRead:
    record = await support_service.create_canned_response(
        session,
        title=payload.title,
        body_en=payload.body_en,
        body_ro=payload.body_ro,
        is_active=payload.is_active,
        actor=admin,
    )
    return SupportCannedResponseRead.model_validate(record)


@router.patch("/admin/canned-responses/{response_id}", response_model=SupportCannedResponseRead)
async def admin_update_canned_response(
    response_id: UUID,
    payload: SupportCannedResponseUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
) -> SupportCannedResponseRead:
    record = await support_service.get_canned_response(session, response_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canned response not found")
    updated = await support_service.update_canned_response(
        session,
        record=record,
        title=payload.title,
        body_en=payload.body_en,
        body_ro=payload.body_ro,
        is_active=payload.is_active,
        actor=admin,
    )
    return SupportCannedResponseRead.model_validate(updated)


@router.delete("/admin/canned-responses/{response_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_canned_response(
    response_id: UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
) -> Response:
    record = await support_service.get_canned_response(session, response_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canned response not found")
    await support_service.delete_canned_response(session, record=record, actor=admin)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/submissions/{submission_id}", response_model=ContactSubmissionRead)
async def admin_get_contact_submission(
    submission_id: UUID,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
) -> ContactSubmissionRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    record = await support_service.get_contact_submission_with_messages(session, submission_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    out = ContactSubmissionRead.model_validate(record)
    return out if include_pii else _mask_contact_submission_read(out)


@router.patch("/admin/submissions/{submission_id}", response_model=ContactSubmissionRead)
async def admin_update_contact_submission(
    submission_id: UUID,
    payload: ContactSubmissionUpdate,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
) -> ContactSubmissionRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    record = await support_service.get_contact_submission_with_messages(session, submission_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    updated = await support_service.update_contact_submission(
        session,
        submission=record,
        status_value=payload.status,
        admin_note=payload.admin_note,
        assignee_id=payload.assignee_id,
        assignee_set="assignee_id" in payload.model_fields_set,
        actor=admin,
    )
    hydrated = await support_service.get_contact_submission_with_messages(session, updated.id)
    if not hydrated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    out = ContactSubmissionRead.model_validate(hydrated)
    return out if include_pii else _mask_contact_submission_read(out)


@router.post("/admin/submissions/{submission_id}/messages", response_model=ContactSubmissionRead)
async def admin_reply_contact_submission(
    submission_id: UUID,
    payload: TicketMessageCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("support")),
) -> ContactSubmissionRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    record = await support_service.get_contact_submission_with_messages(session, submission_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    updated = await support_service.add_contact_submission_message(
        session,
        submission=record,
        message=payload.message,
        from_admin=True,
        actor=admin,
    )
    if not getattr(record, "user_id", None):
        contact_url = f"{settings.frontend_origin.rstrip('/')}/contact"
        background_tasks.add_task(
            email_service.send_contact_submission_reply,
            record.email,
            customer_name=record.name,
            topic=getattr(record.topic, "value", None) or str(record.topic),
            order_reference=record.order_reference,
            reference=str(record.id),
            reply_message=payload.message,
            contact_url=contact_url,
            lang=None,
        )
    out = ContactSubmissionRead.model_validate(updated)
    return out if include_pii else _mask_contact_submission_read(out)


_SUPPORT_SLA_SETTINGS_KEY = "site.support_sla"
_DEFAULT_SUPPORT_FIRST_REPLY_HOURS = 24
_DEFAULT_SUPPORT_RESOLUTION_HOURS = 72


def _parse_sla_hours(value: object | None, *, fallback: int) -> int:
    try:
        raw = int(value) if value is not None else fallback
    except Exception:
        raw = fallback
    return max(1, min(720, raw))


@router.get("/admin/sla-settings", response_model=SupportSlaSettingsRead)
async def admin_support_sla_settings(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("support")),
) -> SupportSlaSettingsRead:
    block = await content_service.get_published_by_key_following_redirects(session, _SUPPORT_SLA_SETTINGS_KEY)
    meta = (getattr(block, "meta", None) or {}) if block else {}
    first_reply = _parse_sla_hours(meta.get("support_sla_first_reply_hours"), fallback=_DEFAULT_SUPPORT_FIRST_REPLY_HOURS)
    resolution = _parse_sla_hours(meta.get("support_sla_resolution_hours"), fallback=_DEFAULT_SUPPORT_RESOLUTION_HOURS)
    return SupportSlaSettingsRead(first_reply_hours=first_reply, resolution_hours=resolution)


@router.patch("/admin/sla-settings", response_model=SupportSlaSettingsRead)
async def admin_update_support_sla_settings(
    payload: SupportSlaSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> SupportSlaSettingsRead:
    meta = {
        "support_sla_first_reply_hours": int(payload.first_reply_hours),
        "support_sla_resolution_hours": int(payload.resolution_hours),
    }
    updated = await content_service.upsert_block(
        session,
        _SUPPORT_SLA_SETTINGS_KEY,
        ContentBlockUpdate(
            title="Support SLA settings",
            body_markdown="SLA thresholds for support tickets.",
            status=ContentStatus.published,
            meta=meta,
        ),
        actor_id=admin.id,
    )
    merged_meta = (getattr(updated, "meta", None) or {}) if updated else {}
    first_reply = _parse_sla_hours(merged_meta.get("support_sla_first_reply_hours"), fallback=_DEFAULT_SUPPORT_FIRST_REPLY_HOURS)
    resolution = _parse_sla_hours(merged_meta.get("support_sla_resolution_hours"), fallback=_DEFAULT_SUPPORT_RESOLUTION_HOURS)
    return SupportSlaSettingsRead(first_reply_hours=first_reply, resolution_hours=resolution)
