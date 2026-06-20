"""Lean-gate unit coverage for the ``notifications`` service.

Drives create/list/unread_count/mark_read/dismiss/restore and every list
filter branch (include_dismissed x include_old_read, old-read cutoff) plus the
not-found / wrong-owner / already-in-state guard branches.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.notification import UserNotification
from app.services import notifications as svc

from tests.conftest import make_memory_session_factory


def test_visible_cutoff() -> None:
    now = datetime(2024, 1, 10, tzinfo=timezone.utc)
    assert svc._visible_cutoff(now) == now - timedelta(days=3)


def test_create_truncates_title_and_persists() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        uid = uuid4()
        async with factory() as session:
            rec = await svc.create_notification(
                session,
                user_id=uid,
                type="info",
                title="T" * 300,
                body="b",
                url="/x",
            )
            assert len(rec.title) == 255
            assert rec.body == "b"

    asyncio.run(flow())


def test_list_filters_and_unread_count() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        uid = uuid4()
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=10)
        async with factory() as session:
            unread = UserNotification(user_id=uid, type="i", title="unread")
            read_recent = UserNotification(
                user_id=uid, type="i", title="read-recent", read_at=now
            )
            read_old = UserNotification(
                user_id=uid, type="i", title="read-old", read_at=old
            )
            dismissed = UserNotification(
                user_id=uid, type="i", title="dismissed", dismissed_at=now
            )
            session.add_all([unread, read_recent, read_old, dismissed])
            await session.commit()

            # Default: exclude dismissed, exclude old read.
            default = await svc.list_notifications(session, user_id=uid)
            titles = {n.title for n in default}
            assert "unread" in titles and "read-recent" in titles
            assert "read-old" not in titles and "dismissed" not in titles

            # include_dismissed (still not old-read).
            with_dismissed = await svc.list_notifications(
                session, user_id=uid, include_dismissed=True
            )
            assert "dismissed" in {n.title for n in with_dismissed}

            # include_old_read without dismissed.
            old_read = await svc.list_notifications(
                session, user_id=uid, include_old_read=True
            )
            t = {n.title for n in old_read}
            assert "read-old" in t and "dismissed" not in t

            # include_old_read + include_dismissed -> everything.
            everything = await svc.list_notifications(
                session, user_id=uid, include_old_read=True, include_dismissed=True
            )
            assert {"unread", "read-recent", "read-old", "dismissed"} <= {
                n.title for n in everything
            }

            # limit clamp (0 -> 20 default-min, never raises).
            clamped = await svc.list_notifications(session, user_id=uid, limit=0)
            assert isinstance(clamped, list)

            assert await svc.unread_count(session, user_id=uid) == 1

    asyncio.run(flow())


def test_mark_read_dismiss_restore_happy_paths() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        uid = uuid4()
        async with factory() as session:
            rec = await svc.create_notification(
                session, user_id=uid, type="i", title="t"
            )
            read = await svc.mark_read(session, user_id=uid, notification_id=rec.id)
            assert read.read_at is not None
            # mark_read again is idempotent (already read).
            again = await svc.mark_read(session, user_id=uid, notification_id=rec.id)
            assert again.read_at == read.read_at

            dismissed = await svc.dismiss(session, user_id=uid, notification_id=rec.id)
            assert dismissed.dismissed_at is not None
            # dismiss again idempotent.
            assert (
                await svc.dismiss(session, user_id=uid, notification_id=rec.id)
            ).dismissed_at is not None

            restored = await svc.restore(session, user_id=uid, notification_id=rec.id)
            assert restored.dismissed_at is None
            # restore again idempotent (already not dismissed).
            assert (
                await svc.restore(session, user_id=uid, notification_id=rec.id)
            ).dismissed_at is None

    asyncio.run(flow())


def test_mark_read_dismissed_notification_rejected() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        uid = uuid4()
        async with factory() as session:
            rec = await svc.create_notification(
                session, user_id=uid, type="i", title="t"
            )
            await svc.dismiss(session, user_id=uid, notification_id=rec.id)
            with pytest.raises(HTTPException) as exc:
                await svc.mark_read(session, user_id=uid, notification_id=rec.id)
            assert exc.value.status_code == 400

    asyncio.run(flow())


def test_not_found_and_wrong_owner_guards() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        uid = uuid4()
        async with factory() as session:
            rec = await svc.create_notification(
                session, user_id=uid, type="i", title="t"
            )
            for op in (svc.mark_read, svc.dismiss, svc.restore):
                # Missing id -> 404.
                with pytest.raises(HTTPException) as exc:
                    await op(session, user_id=uid, notification_id=uuid4())
                assert exc.value.status_code == 404
                # Wrong owner -> 404.
                with pytest.raises(HTTPException) as exc2:
                    await op(session, user_id=uuid4(), notification_id=rec.id)
                assert exc2.value.status_code == 404

    asyncio.run(flow())
