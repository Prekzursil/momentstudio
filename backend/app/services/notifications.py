from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.notification import UserNotification


def _visible_cutoff(now: datetime) -> datetime:
    return now - timedelta(days=3)


async def create_notification(
    session: AsyncSession,
    *,
    user_id: UUID,
    type: str,
    title: str,
    body: str | None = None,
    url: str | None = None,
) -> UserNotification:
    record = UserNotification(
        user_id=user_id,
        type=type,
        title=title[:255],
        body=body,
        url=url,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def list_notifications(
    session: AsyncSession,
    *,
    user_id: UUID,
    limit: int = 20,
    include_dismissed: bool = False,
    include_old_read: bool = False,
) -> list[UserNotification]:
    now = datetime.now(timezone.utc)
    cutoff = _visible_cutoff(now)
    limit = max(1, min(100, int(limit or 20)))

    filters: list[ColumnElement[bool]] = [UserNotification.user_id == user_id]

    if include_old_read:
        if not include_dismissed:
            filters.append(UserNotification.dismissed_at.is_(None))
    else:
        read_filter = or_(UserNotification.read_at.is_(None), UserNotification.read_at >= cutoff)
        if include_dismissed:
            filters.append(or_(UserNotification.dismissed_at.is_not(None), read_filter))
        else:
            filters.append(UserNotification.dismissed_at.is_(None))
            filters.append(read_filter)

    stmt = select(UserNotification).where(*filters).order_by(UserNotification.created_at.desc()).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def unread_count(session: AsyncSession, *, user_id: UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(UserNotification)
        .where(
            UserNotification.user_id == user_id,
            UserNotification.dismissed_at.is_(None),
            UserNotification.read_at.is_(None),
        )
    )
    return int((await session.execute(stmt)).scalar_one() or 0)


async def mark_read(session: AsyncSession, *, user_id: UUID, notification_id: UUID) -> UserNotification:
    record = await session.get(UserNotification, notification_id)
    if not record or record.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if record.dismissed_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Notification dismissed")
    if record.read_at is None:
        record.read_at = datetime.now(timezone.utc)
        session.add(record)
        await session.commit()
        await session.refresh(record)
    return record


async def dismiss(session: AsyncSession, *, user_id: UUID, notification_id: UUID) -> UserNotification:
    record = await session.get(UserNotification, notification_id)
    if not record or record.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if record.dismissed_at is None:
        record.dismissed_at = datetime.now(timezone.utc)
        session.add(record)
        await session.commit()
        await session.refresh(record)
    return record


async def restore(session: AsyncSession, *, user_id: UUID, notification_id: UUID) -> UserNotification:
    record = await session.get(UserNotification, notification_id)
    if not record or record.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if record.dismissed_at is not None:
        record.dismissed_at = None
        session.add(record)
        await session.commit()
        await session.refresh(record)
    return record
