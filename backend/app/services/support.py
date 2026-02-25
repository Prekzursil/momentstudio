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


def _is_support_actor(actor: User) -> bool:
    return actor.role in (UserRole.admin, UserRole.owner, UserRole.support)


def _require_support_actor(actor: User) -> None:
    if not _is_support_actor(actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def _support_notification_title(*, topic: ContactSubmissionTopic, preferred_language: str | None) -> str:
    language = preferred_language or "en"
    if topic == ContactSubmissionTopic.feedback:
        return "Feedback nou" if language == "ro" else "New admin feedback"
    return "Mesaj nou de contact" if language == "ro" else "New contact message"


async def _notify_support_new_submission(
    session: AsyncSession,
    *,
    topic: ContactSubmissionTopic,
    from_email: str,
) -> None:
    for recipient in await _support_recipients(session):
        await notification_service.create_notification(
            session,
            user_id=recipient.id,
            type="support",
            title=_support_notification_title(topic=topic, preferred_language=recipient.preferred_language),
            body=f"From: {from_email}",
            url="/admin/support",
        )


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
    admin_note: str | None = None,
    user: User | None = None,
) -> ContactSubmission:
    record = ContactSubmission(
        topic=topic,
        status=ContactSubmissionStatus.new,
        name=name.strip()[:255],
        email=(email or "").strip()[:255],
        message=(message or "").strip(),
        order_reference=(order_reference or "").strip()[:50] or None,
        admin_note=(admin_note or "").strip() or None,
        user_id=user.id if user else None,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)

    await _notify_support_new_submission(session, topic=topic, from_email=record.email)

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


def _validate_contact_message(message: str) -> str:
    cleaned = (message or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message is required")
    if len(cleaned) > 10_000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message too long")
    return cleaned


def _validate_message_actor(*, submission: ContactSubmission, from_admin: bool, actor: User) -> None:
    if from_admin:
        _require_support_actor(actor)
        return
    if not submission.user_id or submission.user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if submission.status == ContactSubmissionStatus.resolved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticket is resolved")


def _apply_submission_message_update(*, submission: ContactSubmission, from_admin: bool) -> None:
    submission.updated_at = datetime.now(timezone.utc)
    if from_admin and submission.status == ContactSubmissionStatus.new:
        submission.status = ContactSubmissionStatus.triaged


async def _notify_mentioned_support_users(
    session: AsyncSession,
    *,
    message: str,
    actor: User,
    ticket_id: UUID,
) -> None:
    usernames = {username for username in _MENTION_RE.findall(message or "") if username}
    if not usernames:
        return
    stmt = select(User).where(
        User.username.in_(sorted(usernames)),
        User.role.in_([UserRole.owner, UserRole.admin, UserRole.support]),
        User.deleted_at.is_(None),
    )
    mentioned = (await session.execute(stmt)).scalars().all()
    for mentioned_user in mentioned:
        payload = _mentioned_user_notification_payload(mentioned_user=mentioned_user, actor=actor)
        if payload is None:
            continue
        title, body = payload
        await notification_service.create_notification(
            session,
            user_id=mentioned_user.id,
            type="support",
            title=title,
            body=body,
            url=f"/admin/support?ticket={ticket_id}",
        )


def _mentioned_user_notification_payload(*, mentioned_user: User | None, actor: User) -> tuple[str, str] | None:
    if not mentioned_user or not mentioned_user.id or mentioned_user.id == actor.id:
        return None
    language = mentioned_user.preferred_language or "en"
    actor_name = (actor.username or "").strip() or "support"
    if language == "ro":
        return "Menționat în tichet de suport", f"Ai fost menționat de {actor_name}."
    return "Mentioned in support ticket", f"You were mentioned by {actor_name}."


async def _notify_submission_owner(session: AsyncSession, *, submission: ContactSubmission) -> None:
    if not submission.user_id:
        return
    user = await session.get(User, submission.user_id)
    if not user or not user.id:
        return
    language = user.preferred_language or "en"
    title = "Răspuns de la suport" if language == "ro" else "Support reply"
    body = "Ai un răspuns nou în tichetul tău de suport." if language == "ro" else "You have a new reply in your support ticket."
    await notification_service.create_notification(
        session,
        user_id=user.id,
        type="support",
        title=title,
        body=body,
        url="/tickets",
    )


async def _notify_assigned_user(
    session: AsyncSession,
    *,
    assignee: User | None,
    submission: ContactSubmission,
) -> None:
    if not assignee or not assignee.id:
        return
    language = assignee.preferred_language or "en"
    title = "Tichet suport atribuit" if language == "ro" else "Support ticket assigned"
    body = (
        f"Ți-a fost atribuit un tichet de la {submission.email}."
        if language == "ro"
        else f"You have been assigned a ticket from {submission.email}."
    )
    await notification_service.create_notification(
        session,
        user_id=assignee.id,
        type="support",
        title=title,
        body=body,
        url=f"/admin/support?ticket={submission.id}",
    )


async def _notify_support_customer_reply(session: AsyncSession, *, from_email: str) -> None:
    for recipient in await _support_recipients(session):
        title = "Actualizare tichet suport" if (recipient.preferred_language or "en") == "ro" else "Support ticket update"
        await notification_service.create_notification(
            session,
            user_id=recipient.id,
            type="support",
            title=title,
            body=f"From: {from_email}",
            url="/admin/support",
        )


async def add_contact_submission_message(
    session: AsyncSession,
    *,
    submission: ContactSubmission,
    message: str,
    from_admin: bool,
    actor: User,
) -> ContactSubmission:
    cleaned = _validate_contact_message(message)
    _validate_message_actor(submission=submission, from_admin=from_admin, actor=actor)

    session.add(ContactSubmissionMessage(submission_id=submission.id, from_admin=bool(from_admin), message=cleaned))

    # Ensure list ordering reflects new activity.
    _apply_submission_message_update(submission=submission, from_admin=from_admin)
    session.add(submission)
    await session.commit()

    session.expire(submission, ["messages"])
    updated = await get_contact_submission_with_messages(session, submission.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if from_admin:
        await _notify_mentioned_support_users(session, message=cleaned, actor=actor, ticket_id=updated.id)
        await _notify_submission_owner(session, submission=updated)
    else:
        await _notify_support_customer_reply(session, from_email=updated.email)

    return updated


def _apply_support_search_filter(stmt, *, query: str | None):
    if not query:
        return stmt
    like = f"%{query.strip().lower()}%"
    return stmt.where(
        func.lower(ContactSubmission.email).like(like)
        | func.lower(ContactSubmission.name).like(like)
        | func.lower(ContactSubmission.message).like(like)
        | func.lower(func.coalesce(ContactSubmission.order_reference, "")).like(like)
    )


def _apply_support_customer_filter(stmt, *, customer_filter: str | None):
    if not customer_filter:
        return stmt
    cleaned = customer_filter.strip()
    if not cleaned:
        return stmt
    try:
        customer_id = UUID(cleaned)
    except Exception:
        customer_id = None
    if customer_id is not None:
        return stmt.where(ContactSubmission.user_id == customer_id)
    like = f"%{cleaned.lower()}%"
    return stmt.where(func.lower(ContactSubmission.email).like(like) | func.lower(ContactSubmission.name).like(like))


def _apply_support_assignee_filter(stmt, *, assignee_filter: str | None):
    if not assignee_filter:
        return stmt
    cleaned = assignee_filter.strip()
    if not cleaned:
        return stmt
    if cleaned.lower() in {"unassigned", "none"}:
        return stmt.where(ContactSubmission.assignee_user_id.is_(None))
    try:
        assignee_id = UUID(cleaned)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee filter") from exc
    return stmt.where(ContactSubmission.assignee_user_id == assignee_id)


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
    stmt = _apply_support_search_filter(stmt, query=q)
    if status_filter is not None:
        stmt = stmt.where(ContactSubmission.status == status_filter)
    if topic_filter is not None:
        stmt = stmt.where(ContactSubmission.topic == topic_filter)
    stmt = _apply_support_customer_filter(stmt, customer_filter=customer_filter)
    stmt = _apply_support_assignee_filter(stmt, assignee_filter=assignee_filter)

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


def _apply_submission_status_update(
    *,
    submission: ContactSubmission,
    status_value: ContactSubmissionStatus | None,
) -> None:
    if status_value is None or submission.status == status_value:
        return
    submission.status = status_value
    submission.resolved_at = datetime.now(timezone.utc) if status_value == ContactSubmissionStatus.resolved else None


async def _resolve_support_assignee(session: AsyncSession, *, assignee_id: UUID | None) -> User | None:
    if assignee_id is None:
        return None
    target = await session.get(User, assignee_id)
    if not target or not target.id or target.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
    if target.role not in (UserRole.owner, UserRole.admin, UserRole.support):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee")
    return target


def _apply_assignee_update(
    *,
    submission: ContactSubmission,
    actor: User,
    target: User | None,
) -> User | None:
    target_id = target.id if target else None
    if submission.assignee_user_id == target_id:
        return None
    submission.assignee_user_id = target_id
    submission.assigned_by_user_id = actor.id
    submission.assigned_at = datetime.now(timezone.utc)
    if target and target.id and target.id != actor.id:
        return target
    return None


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
    _require_support_actor(actor)
    _apply_submission_status_update(submission=submission, status_value=status_value)

    if admin_note is not None:
        cleaned = admin_note.strip()
        submission.admin_note = cleaned or None

    notify_assignee: User | None = None
    if assignee_set:
        target = await _resolve_support_assignee(session, assignee_id=assignee_id)
        notify_assignee = _apply_assignee_update(submission=submission, actor=actor, target=target)

    session.add(submission)
    await session.commit()
    await session.refresh(submission)
    await _notify_assigned_user(session, assignee=notify_assignee, submission=submission)
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
    _require_support_actor(actor)

    if title is not None:
        cleaned = title.strip()
        if cleaned:
            record.title = cleaned[:120]
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
