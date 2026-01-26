from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.support import (
    ContactSubmission,
    ContactSubmissionMessage,
    ContactSubmissionStatus,
    ContactSubmissionTopic,
    SupportCannedResponse,
)
from app.models.user import User, UserRole
from app.services import notifications as notification_service

_MENTION_RE = re.compile(r"(?<![A-Za-z0-9._-])@([A-Za-z0-9][A-Za-z0-9._-]{2,29})")


async def _support_recipients(session: AsyncSession) -> list[User]:
    stmt = select(User).where(
        User.role.in_([UserRole.owner, UserRole.admin, UserRole.support]),
        User.deleted_at.is_(None),
    )
    recipients = (await session.execute(stmt)).scalars().all()
    return [u for u in recipients if u and u.id]


async def list_support_agents(session: AsyncSession) -> list[User]:
    stmt = (
        select(User)
        .where(
            User.role.in_([UserRole.owner, UserRole.admin, UserRole.support]),
            User.deleted_at.is_(None),
        )
        .order_by(User.role.asc(), User.username.asc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def create_contact_submission(
    session: AsyncSession,
    *,
    topic: ContactSubmissionTopic,
    name: str,
    email: str,
    message: str,
    order_reference: str | None = None,
    user: User | None = None,
) -> ContactSubmission:
    record = ContactSubmission(
        topic=topic,
        status=ContactSubmissionStatus.new,
        name=name.strip()[:255],
        email=(email or "").strip()[:255],
        message=(message or "").strip(),
        order_reference=(order_reference or "").strip()[:50] or None,
        user_id=user.id if user else None,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)

    for recipient in await _support_recipients(session):
        title = "New contact message" if (recipient.preferred_language or "en") != "ro" else "Mesaj nou de contact"
        body = f"From: {record.email}"
        await notification_service.create_notification(
            session,
            user_id=recipient.id,
            type="support",
            title=title,
            body=body,
            url="/admin/support",
        )

    return record


async def get_contact_submission(session: AsyncSession, submission_id: UUID) -> ContactSubmission | None:
    return await session.get(ContactSubmission, submission_id)


async def get_contact_submission_with_messages(session: AsyncSession, submission_id: UUID) -> ContactSubmission | None:
    stmt = (
        select(ContactSubmission)
        .where(ContactSubmission.id == submission_id)
        .options(selectinload(ContactSubmission.messages), selectinload(ContactSubmission.user))
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def list_contact_submissions_for_user(session: AsyncSession, *, user: User) -> list[ContactSubmission]:
    stmt = (
        select(ContactSubmission)
        .where(ContactSubmission.user_id == user.id)
        .order_by(ContactSubmission.updated_at.desc(), ContactSubmission.created_at.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def add_contact_submission_message(
    session: AsyncSession,
    *,
    submission: ContactSubmission,
    message: str,
    from_admin: bool,
    actor: User,
) -> ContactSubmission:
    cleaned = (message or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required")
    if len(cleaned) > 10_000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message too long")

    if from_admin:
        if actor.role not in (UserRole.admin, UserRole.owner, UserRole.support):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    else:
        if not submission.user_id or submission.user_id != actor.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        if submission.status == ContactSubmissionStatus.resolved:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticket is resolved")

    session.add(ContactSubmissionMessage(submission_id=submission.id, from_admin=bool(from_admin), message=cleaned))

    # Ensure list ordering reflects new activity.
    submission.updated_at = datetime.now(timezone.utc)
    if from_admin and submission.status == ContactSubmissionStatus.new:
        submission.status = ContactSubmissionStatus.triaged

    session.add(submission)
    await session.commit()

    session.expire(submission, ["messages"])
    updated = await get_contact_submission_with_messages(session, submission.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if from_admin:
        usernames = {u for u in _MENTION_RE.findall(cleaned or "") if u}
        if usernames:
            stmt = select(User).where(
                User.username.in_(sorted(usernames)),
                User.role.in_([UserRole.owner, UserRole.admin, UserRole.support]),
                User.deleted_at.is_(None),
            )
            mentioned = (await session.execute(stmt)).scalars().all()
            for mentioned_user in mentioned:
                if not mentioned_user or not mentioned_user.id or mentioned_user.id == actor.id:
                    continue
                lang = mentioned_user.preferred_language or "en"
                title = "Mentioned in support ticket" if lang != "ro" else "Menționat în tichet de suport"
                actor_name = (actor.username or "").strip() or "support"
                body = (
                    f"You were mentioned by {actor_name}."
                    if lang != "ro"
                    else f"Ai fost menționat de {actor_name}."
                )
                await notification_service.create_notification(
                    session,
                    user_id=mentioned_user.id,
                    type="support",
                    title=title,
                    body=body,
                    url=f"/admin/support?ticket={updated.id}",
                )

    if from_admin and updated.user_id:
        user = await session.get(User, updated.user_id)
        if user and user.id:
            title = "Support reply" if (user.preferred_language or "en") != "ro" else "Răspuns de la suport"
            body = "You have a new reply in your support ticket."
            if (user.preferred_language or "en") == "ro":
                body = "Ai un răspuns nou în tichetul tău de suport."
            await notification_service.create_notification(
                session,
                user_id=user.id,
                type="support",
                title=title,
                body=body,
                url="/tickets",
            )

    if not from_admin:
        for recipient in await _support_recipients(session):
            title = "Support ticket update" if (recipient.preferred_language or "en") != "ro" else "Actualizare tichet suport"
            body = f"From: {updated.email}"
            await notification_service.create_notification(
                session,
                user_id=recipient.id,
                type="support",
                title=title,
                body=body,
                url="/admin/support",
            )

    return updated


async def list_contact_submissions(
    session: AsyncSession,
    *,
    q: str | None = None,
    status_filter: ContactSubmissionStatus | None = None,
    topic_filter: ContactSubmissionTopic | None = None,
    customer_filter: str | None = None,
    assignee_filter: str | None = None,
    page: int = 1,
    limit: int = 25,
) -> tuple[list[ContactSubmission], int]:
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 25)))
    offset = (page - 1) * limit

    stmt = select(ContactSubmission)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(ContactSubmission.email).like(like)
            | func.lower(ContactSubmission.name).like(like)
            | func.lower(ContactSubmission.message).like(like)
            | func.lower(func.coalesce(ContactSubmission.order_reference, "")).like(like)
        )
    if status_filter is not None:
        stmt = stmt.where(ContactSubmission.status == status_filter)
    if topic_filter is not None:
        stmt = stmt.where(ContactSubmission.topic == topic_filter)
    if customer_filter:
        cleaned = customer_filter.strip()
        if cleaned:
            try:
                customer_id = UUID(cleaned)
            except Exception:
                customer_id = None
            if customer_id is not None:
                stmt = stmt.where(ContactSubmission.user_id == customer_id)
            else:
                like = f"%{cleaned.lower()}%"
                stmt = stmt.where(
                    func.lower(ContactSubmission.email).like(like) | func.lower(ContactSubmission.name).like(like)
                )
    if assignee_filter:
        cleaned = assignee_filter.strip()
        if cleaned:
            if cleaned.lower() in {"unassigned", "none"}:
                stmt = stmt.where(ContactSubmission.assignee_user_id.is_(None))
            else:
                try:
                    assignee_id = UUID(cleaned)
                except Exception as exc:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee filter") from exc
                stmt = stmt.where(ContactSubmission.assignee_user_id == assignee_id)

    total = await session.scalar(stmt.with_only_columns(func.count(func.distinct(ContactSubmission.id))).order_by(None))
    total_items = int(total or 0)

    rows = (
        await session.execute(
            stmt.order_by(ContactSubmission.updated_at.desc(), ContactSubmission.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(rows), total_items


async def update_contact_submission(
    session: AsyncSession,
    *,
    submission: ContactSubmission,
    status_value: ContactSubmissionStatus | None = None,
    admin_note: str | None = None,
    assignee_id: UUID | None = None,
    assignee_set: bool = False,
    actor: User,
) -> ContactSubmission:
    if actor.role not in (UserRole.admin, UserRole.owner, UserRole.support):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if status_value is not None and submission.status != status_value:
        submission.status = status_value
        if status_value == ContactSubmissionStatus.resolved:
            submission.resolved_at = datetime.now(timezone.utc)
        else:
            submission.resolved_at = None

    if admin_note is not None:
        cleaned = admin_note.strip()
        submission.admin_note = cleaned or None

    notify_assignee: User | None = None
    if assignee_set:
        if assignee_id is not None:
            target = await session.get(User, assignee_id)
            if not target or not target.id or target.deleted_at is not None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
            if target.role not in (UserRole.owner, UserRole.admin, UserRole.support):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee")
        else:
            target = None

        if submission.assignee_user_id != (target.id if target else None):
            submission.assignee_user_id = target.id if target else None
            submission.assigned_by_user_id = actor.id
            submission.assigned_at = datetime.now(timezone.utc)

            if target and target.id and target.id != actor.id:
                notify_assignee = target

    session.add(submission)
    await session.commit()
    await session.refresh(submission)

    if notify_assignee and notify_assignee.id:
        lang = notify_assignee.preferred_language or "en"
        title = "Support ticket assigned" if lang != "ro" else "Tichet suport atribuit"
        body = (
            f"You have been assigned a ticket from {submission.email}."
            if lang != "ro"
            else f"Ți-a fost atribuit un tichet de la {submission.email}."
        )
        await notification_service.create_notification(
            session,
            user_id=notify_assignee.id,
            type="support",
            title=title,
            body=body,
            url=f"/admin/support?ticket={submission.id}",
        )
    return submission


async def list_canned_responses(session: AsyncSession, *, include_inactive: bool = False) -> list[SupportCannedResponse]:
    stmt = select(SupportCannedResponse)
    if not include_inactive:
        stmt = stmt.where(SupportCannedResponse.is_active.is_(True))
    stmt = stmt.order_by(SupportCannedResponse.title.asc(), SupportCannedResponse.created_at.desc())
    return list((await session.execute(stmt)).scalars().all())


async def get_canned_response(session: AsyncSession, response_id: UUID) -> SupportCannedResponse | None:
    return await session.get(SupportCannedResponse, response_id)


async def create_canned_response(
    session: AsyncSession,
    *,
    title: str,
    body_en: str,
    body_ro: str,
    is_active: bool = True,
    actor: User,
) -> SupportCannedResponse:
    if actor.role not in (UserRole.admin, UserRole.owner, UserRole.support):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    cleaned_title = (title or "").strip()
    if not cleaned_title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    cleaned_en = (body_en or "").strip()
    cleaned_ro = (body_ro or "").strip()
    if not cleaned_en or not cleaned_ro:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template body is required")

    record = SupportCannedResponse(
        title=cleaned_title[:120],
        body_en=cleaned_en,
        body_ro=cleaned_ro,
        is_active=bool(is_active),
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def update_canned_response(
    session: AsyncSession,
    *,
    record: SupportCannedResponse,
    title: str | None = None,
    body_en: str | None = None,
    body_ro: str | None = None,
    is_active: bool | None = None,
    actor: User,
) -> SupportCannedResponse:
    if actor.role not in (UserRole.admin, UserRole.owner, UserRole.support):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if title is not None:
        cleaned = title.strip()
        record.title = cleaned[:120] if cleaned else record.title
    if body_en is not None:
        cleaned = body_en.strip()
        if cleaned:
            record.body_en = cleaned
    if body_ro is not None:
        cleaned = body_ro.strip()
        if cleaned:
            record.body_ro = cleaned
    if is_active is not None:
        record.is_active = bool(is_active)

    record.updated_by_user_id = actor.id
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def delete_canned_response(session: AsyncSession, *, record: SupportCannedResponse, actor: User) -> None:
    if actor.role not in (UserRole.admin, UserRole.owner, UserRole.support):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    await session.delete(record)
    await session.commit()
