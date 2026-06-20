"""Lean-gate unit coverage for the ``self_service`` account module.

Fills the remaining branches: ``_ensure_utc`` / ``is_deletion_due`` /
``_deleted_username``, the account-deletion executor + due-batch processor,
``_is_profile_complete``, the Google-cleanup helpers (including the throttle),
and the export comment-status branch.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core import security
from app.models.blog import BlogComment
from app.models.content import ContentBlock, ContentStatus
from app.models.user import RefreshSession, User, UserRole, UserSecondaryEmail
from app.services import self_service as svc

from tests.conftest import make_memory_session_factory


def _user(**kw) -> User:
    uid_hex = uuid4().hex
    defaults = dict(
        email=f"{uid_hex}@e.com",
        username=f"u_{uid_hex[:12]}",
        hashed_password=security.hash_password("pw123456"),
        role=UserRole.customer,
    )
    defaults.update(kw)
    return User(**defaults)


# --------------------------------------------------------------------------- #
# pure helpers                                                                 #
# --------------------------------------------------------------------------- #
def test_ensure_utc_and_is_deletion_due() -> None:
    assert svc._ensure_utc(None) is None
    naive = datetime(2024, 1, 1)
    assert svc._ensure_utc(naive).tzinfo is timezone.utc

    u = _user()
    assert svc.is_deletion_due(u) is False  # no schedule
    u.deletion_scheduled_for = datetime.now(timezone.utc) - timedelta(days=1)
    assert svc.is_deletion_due(u) is True
    u.deletion_scheduled_for = datetime.now(timezone.utc) + timedelta(days=1)
    assert svc.is_deletion_due(u, now=datetime.now(timezone.utc)) is False


def test_deleted_username_from_uuid_and_fallback() -> None:
    uid = uuid4()
    name = svc._deleted_username(uid)
    assert name.startswith("deleted-") and len(name) <= len("deleted-") + 22

    class _NoHex:
        @property
        def hex(self):  # noqa: ANN201
            raise RuntimeError("nope")

    fallback = svc._deleted_username(_NoHex())
    assert fallback.startswith("deleted-")


# --------------------------------------------------------------------------- #
# account deletion                                                             #
# --------------------------------------------------------------------------- #
def test_execute_account_deletion_anonymizes_and_revokes() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            u = _user(name="Real Name", username="realuser", phone="+40711111111")
            session.add(u)
            await session.flush()
            session.add(UserSecondaryEmail(user_id=u.id, email="alt@e.com"))
            session.add(
                RefreshSession(
                    user_id=u.id,
                    jti=uuid4().hex,
                    expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                    revoked=False,
                )
            )
            await session.commit()

            await svc.execute_account_deletion(session, u)
            await session.refresh(u)
            assert u.deleted_at is not None
            assert u.email.endswith("@example.invalid")
            assert u.username.startswith("deleted-")
            assert u.name is None

            # Idempotent: already-deleted returns early.
            await svc.execute_account_deletion(session, u)

    asyncio.run(flow())


def test_process_due_account_deletions_batch() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            due = _user(
                deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(days=1)
            )
            not_due = _user(
                deletion_scheduled_for=datetime.now(timezone.utc) + timedelta(days=5)
            )
            session.add_all([due, not_due])
            await session.commit()

            count = await svc.process_due_account_deletions(session, limit=0)
            assert count == 1

    asyncio.run(flow())


# --------------------------------------------------------------------------- #
# profile completeness + google cleanup                                        #
# --------------------------------------------------------------------------- #
def test_is_profile_complete() -> None:
    complete = _user(
        name="N",
        username="u",
        first_name="F",
        last_name="L",
        date_of_birth=datetime(2000, 1, 1).date(),
        phone="+40711111111",
    )
    assert svc._is_profile_complete(complete) is True
    assert svc._is_profile_complete(_user(name="N")) is False


def test_cleanup_incomplete_google_accounts() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            old_incomplete = _user(google_sub="g-1")
            old_complete = _user(
                google_sub="g-2",
                name="N",
                username="u2",
                first_name="F",
                last_name="L",
                date_of_birth=datetime(2000, 1, 1).date(),
                phone="+40711111111",
            )
            session.add_all([old_incomplete, old_complete])
            await session.flush()
            # Backdate creation so they're past the threshold.
            old = datetime.now(timezone.utc) - timedelta(days=60)
            old_incomplete.created_at = old
            old_complete.created_at = old
            await session.commit()

            deleted = await svc.cleanup_incomplete_google_accounts(
                session, max_age_hours=1
            )
            assert deleted == 1  # only the incomplete one

    asyncio.run(flow())


def test_maybe_cleanup_throttles() -> None:
    factory = make_memory_session_factory()
    svc._last_incomplete_google_cleanup_at = None

    async def flow() -> None:
        async with factory() as session:
            # First call runs (returns 0, no rows), sets the throttle timestamp.
            first = await svc.maybe_cleanup_incomplete_google_accounts(session)
            assert first == 0
            # Second call within 24h is throttled.
            second = await svc.maybe_cleanup_incomplete_google_accounts(session)
            assert second == 0
            assert svc._last_incomplete_google_cleanup_at is not None

    try:
        asyncio.run(flow())
    finally:
        svc._last_incomplete_google_cleanup_at = None


# --------------------------------------------------------------------------- #
# export — comment status branch                                               #
# --------------------------------------------------------------------------- #
def test_export_user_data_comment_statuses() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            u = _user(name="Export User", username="exporter")
            session.add(u)
            block = ContentBlock(
                key="blog.hello",
                title="Hello",
                body_markdown="b",
                status=ContentStatus.published,
            )
            other = ContentBlock(
                key="page.about",
                title="About",
                body_markdown="b",
                status=ContentStatus.published,
            )
            session.add_all([block, other])
            await session.flush()
            session.add_all(
                [
                    BlogComment(content_block_id=block.id, user_id=u.id, body="posted"),
                    BlogComment(
                        content_block_id=block.id,
                        user_id=u.id,
                        body="hidden",
                        is_hidden=True,
                    ),
                    BlogComment(
                        content_block_id=other.id,
                        user_id=u.id,
                        body="deleted",
                        is_deleted=True,
                    ),
                ]
            )
            await session.commit()

            data = await svc.export_user_data(session, u)
            statuses = {c["status"] for c in data["comments"]}
            assert statuses == {"posted", "hidden", "deleted"}
            # blog.* slug stripped; non-blog key kept whole.
            slugs = {c["post_slug"] for c in data["comments"]}
            assert "hello" in slugs
            assert "page.about" in slugs
            # Hidden/deleted bodies are redacted.
            bodies = {c["body"] for c in data["comments"]}
            assert "" in bodies and "posted" in bodies

    asyncio.run(flow())
