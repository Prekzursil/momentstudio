from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.support import ContactSubmission, ContactSubmissionMessage, ContactSubmissionStatus, ContactSubmissionTopic
from app.models.user import User, UserRole
from app.services import auth as auth_service
from app.services import notifications as notification_service


async def _support_recipients(session: AsyncSession) -> list[User]:
    owner = await auth_service.get_owner_user(session)
    recipients = [owner] if owner else (await session.execute(select(User).where(User.role == UserRole.admin))).scalars().all()
    return [u for u in recipients if u and u.id]


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
        if actor.role not in (UserRole.admin, UserRole.owner):
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

    total = await session.scalar(stmt.with_only_columns(func.count(func.distinct(ContactSubmission.id))).order_by(None))
    total_items = int(total or 0)

    rows = (await session.execute(stmt.order_by(ContactSubmission.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return list(rows), total_items


async def update_contact_submission(
    session: AsyncSession,
    *,
    submission: ContactSubmission,
    status_value: ContactSubmissionStatus | None = None,
    admin_note: str | None = None,
    actor: User,
) -> ContactSubmission:
    if actor.role not in (UserRole.admin, UserRole.owner):
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

    session.add(submission)
    await session.commit()
    await session.refresh(submission)
    return submission
