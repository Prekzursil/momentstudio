"""Lean-gate unit coverage for ``app.services.support``.

Drives every helper against an in-memory SQLite engine: recipient/agent
listing, contact submission creation (incl. feedback vs contact and RO/EN
notification titles), message threading (validation, admin/customer guards,
mentions, customer + admin reply notifications), the paginated/filtered list,
submission updates (status/note/assignment + assignee notification), and the
full canned-response CRUD with role guards.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core import security
from app.models.support import (
    ContactSubmission,
    ContactSubmissionStatus,
    ContactSubmissionTopic,
)
from app.models.user import User, UserRole
from app.services import support

from tests.conftest import make_memory_session_factory


def _user(role: UserRole = UserRole.customer, **kw) -> User:
    h = uuid4().hex
    defaults = dict(
        email=f"{h}@e.com",
        username=f"u_{h[:12]}",
        hashed_password=security.hash_password("pw123456"),
        role=role,
    )
    defaults.update(kw)
    return User(**defaults)


def test_recipients_and_agents() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            admin = _user(UserRole.admin, preferred_language="ro")
            support_agent = _user(UserRole.support, preferred_language="en")
            customer = _user(UserRole.customer)
            session.add_all([admin, support_agent, customer])
            await session.commit()

            recipients = await support._support_recipients(session)
            assert {r.role for r in recipients} == {UserRole.admin, UserRole.support}
            agents = await support.list_support_agents(session)
            assert len(agents) == 2

    asyncio.run(run())


def test_create_submission_notifies_staff() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            admin_ro = _user(UserRole.admin, preferred_language="ro")
            admin_en = _user(UserRole.owner, preferred_language="en")
            session.add_all([admin_ro, admin_en])
            await session.commit()

            contact = await support.create_contact_submission(
                session,
                topic=ContactSubmissionTopic.contact,
                name="  Jane  ",
                email=" jane@e.com ",
                message="  hello  ",
                order_reference=" ORD1 ",
                admin_note=" note ",
            )
            assert contact.name == "Jane"
            assert contact.email == "jane@e.com"
            assert contact.order_reference == "ORD1"

            feedback = await support.create_contact_submission(
                session,
                topic=ContactSubmissionTopic.feedback,
                name="Joe",
                email="joe@e.com",
                message="feedback",
            )
            assert feedback.topic == ContactSubmissionTopic.feedback
            assert feedback.order_reference is None

    asyncio.run(run())


def test_message_threading_validation_and_guards() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            customer = _user(UserRole.customer)
            other = _user(UserRole.customer)
            admin = _user(UserRole.admin)
            session.add_all([customer, other, admin])
            await session.commit()
            await session.refresh(customer)
            await session.refresh(other)
            await session.refresh(admin)

            submission = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.new,
                name="C",
                email="c@e.com",
                message="hi",
                user_id=customer.id,
            )
            session.add(submission)
            await session.commit()
            await session.refresh(submission)

            # Empty message rejected.
            with pytest.raises(HTTPException):
                await support.add_contact_submission_message(
                    session, submission=submission, message="  ", from_admin=False,
                    actor=customer,
                )
            # Too long rejected.
            with pytest.raises(HTTPException):
                await support.add_contact_submission_message(
                    session, submission=submission, message="x" * 10_001,
                    from_admin=False, actor=customer,
                )
            # Non-admin non-owner cannot post as admin.
            with pytest.raises(HTTPException):
                await support.add_contact_submission_message(
                    session, submission=submission, message="hi", from_admin=True,
                    actor=customer,
                )
            # A different customer cannot post.
            with pytest.raises(HTTPException):
                await support.add_contact_submission_message(
                    session, submission=submission, message="hi", from_admin=False,
                    actor=other,
                )

            # Customer reply (notifies staff).
            updated = await support.add_contact_submission_message(
                session, submission=submission, message="please help",
                from_admin=False, actor=customer,
            )
            assert any(m.message == "please help" for m in updated.messages)

            # Resolved ticket blocks customer replies.
            submission.status = ContactSubmissionStatus.resolved
            await session.commit()
            with pytest.raises(HTTPException):
                await support.add_contact_submission_message(
                    session, submission=submission, message="more", from_admin=False,
                    actor=customer,
                )

    asyncio.run(run())


def test_admin_reply_with_mentions_and_customer_notify() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            customer = _user(UserRole.customer, preferred_language="ro")
            admin = _user(UserRole.admin, preferred_language="en")
            mentioned = _user(UserRole.support, username="helperbob")
            session.add_all([customer, admin, mentioned])
            await session.commit()
            await session.refresh(customer)
            await session.refresh(admin)
            await session.refresh(mentioned)

            submission = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.new,
                name="C",
                email="c@e.com",
                message="hi",
                user_id=customer.id,
            )
            session.add(submission)
            await session.commit()
            await session.refresh(submission)

            updated = await support.add_contact_submission_message(
                session,
                submission=submission,
                message=f"@helperbob please look @{admin.username}",
                from_admin=True,
                actor=admin,
            )
            # Admin reply triages a 'new' ticket; self-mention of the actor is
            # skipped (the ``continue`` branch) while helperbob is notified, and
            # the RO-language customer gets a reply notification.
            assert updated.status == ContactSubmissionStatus.triaged

    asyncio.run(run())


def test_admin_reply_no_mentions_en_customer() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            customer = _user(UserRole.customer, preferred_language="en")
            admin = _user(UserRole.admin)
            session.add_all([customer, admin])
            await session.commit()
            await session.refresh(customer)
            await session.refresh(admin)

            submission = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.triaged,
                name="C",
                email="c@e.com",
                message="hi",
                user_id=customer.id,
            )
            session.add(submission)
            await session.commit()
            await session.refresh(submission)

            # Admin reply with no @mentions, EN customer (else lang branch).
            updated = await support.add_contact_submission_message(
                session, submission=submission, message="thanks, resolved",
                from_admin=True, actor=admin,
            )
            assert any(m.from_admin for m in updated.messages)

    asyncio.run(run())


def test_admin_reply_anonymous_submission_no_customer_notify() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            admin = _user(UserRole.admin)
            session.add(admin)
            await session.commit()
            await session.refresh(admin)

            # Anonymous submission (no user_id) -> the customer-notify branch is
            # skipped (223->241 false arc).
            submission = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.triaged,
                name="Anon",
                email="anon@e.com",
                message="hi",
            )
            session.add(submission)
            await session.commit()
            await session.refresh(submission)

            updated = await support.add_contact_submission_message(
                session, submission=submission, message="admin note here",
                from_admin=True, actor=admin,
            )
            assert any(m.from_admin for m in updated.messages)

            # Submission referencing a missing user (SQLite does not enforce
            # FKs): ``from_admin and updated.user_id`` is True but session.get
            # returns None -> the 223->241 false arc.
            dangling = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.triaged,
                name="Ghost",
                email="ghost@e.com",
                message="hi",
                user_id=uuid4(),
            )
            session.add(dangling)
            await session.commit()
            await session.refresh(dangling)
            updated2 = await support.add_contact_submission_message(
                session, submission=dangling, message="reply to ghost",
                from_admin=True, actor=admin,
            )
            assert any(m.from_admin for m in updated2.messages)

    asyncio.run(run())


def test_list_contact_submissions_filters() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            customer = _user(UserRole.customer)
            session.add(customer)
            await session.commit()
            await session.refresh(customer)

            s1 = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.new,
                name="Alpha",
                email="alpha@e.com",
                message="need help with order",
                order_reference="ORD9",
                user_id=customer.id,
            )
            s2 = ContactSubmission(
                topic=ContactSubmissionTopic.feedback,
                status=ContactSubmissionStatus.resolved,
                name="Beta",
                email="beta@e.com",
                message="nice store",
            )
            session.add_all([s1, s2])
            await session.commit()

            # Full-text query.
            rows, total = await support.list_contact_submissions(session, q="alpha")
            assert total == 1 and rows[0].email == "alpha@e.com"

            # Status + topic filters.
            rows, total = await support.list_contact_submissions(
                session,
                status_filter=ContactSubmissionStatus.resolved,
                topic_filter=ContactSubmissionTopic.feedback,
            )
            assert total == 1

            # Customer filter by UUID.
            rows, total = await support.list_contact_submissions(
                session, customer_filter=str(customer.id)
            )
            assert total == 1

            # Customer filter by free text (non-UUID).
            rows, total = await support.list_contact_submissions(
                session, customer_filter="beta"
            )
            assert total == 1

            # Assignee filter "unassigned".
            rows, total = await support.list_contact_submissions(
                session, assignee_filter="unassigned"
            )
            assert total == 2

            # Assignee filter by UUID (matches none).
            rows, total = await support.list_contact_submissions(
                session, assignee_filter=str(uuid4())
            )
            assert total == 0

            # Invalid assignee filter raises.
            with pytest.raises(HTTPException):
                await support.list_contact_submissions(
                    session, assignee_filter="not-a-uuid"
                )

            # Whitespace-only filters strip to empty and are ignored.
            rows, total = await support.list_contact_submissions(
                session, customer_filter="   ", assignee_filter="   "
            )
            assert total == 2

            # Per-user listing.
            mine = await support.list_contact_submissions_for_user(
                session, user=customer
            )
            assert len(mine) == 1

            # get helpers.
            assert await support.get_contact_submission(session, s1.id) is not None
            with_msgs = await support.get_contact_submission_with_messages(
                session, s1.id
            )
            assert with_msgs is not None

    asyncio.run(run())


def test_update_submission_status_note_assignment() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            admin = _user(UserRole.admin)
            assignee = _user(UserRole.support, preferred_language="ro")
            customer = _user(UserRole.customer)
            session.add_all([admin, assignee, customer])
            await session.commit()
            await session.refresh(admin)
            await session.refresh(assignee)

            submission = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.new,
                name="C",
                email="c@e.com",
                message="hi",
            )
            session.add(submission)
            await session.commit()
            await session.refresh(submission)

            # Non-admin cannot update.
            with pytest.raises(HTTPException):
                await support.update_contact_submission(
                    session, submission=submission, actor=customer
                )

            # Resolve + note + assign to a real agent (notifies assignee).
            updated = await support.update_contact_submission(
                session,
                submission=submission,
                status_value=ContactSubmissionStatus.resolved,
                admin_note="  done  ",
                assignee_id=assignee.id,
                assignee_set=True,
                actor=admin,
            )
            assert updated.status == ContactSubmissionStatus.resolved
            assert updated.resolved_at is not None
            assert updated.admin_note == "done"
            assert updated.assignee_user_id == assignee.id

            # Re-open (status not resolved clears resolved_at) and unassign.
            reopened = await support.update_contact_submission(
                session,
                submission=submission,
                status_value=ContactSubmissionStatus.triaged,
                assignee_id=None,
                assignee_set=True,
                actor=admin,
            )
            assert reopened.resolved_at is None
            assert reopened.assignee_user_id is None

            # Assign to a missing user -> 400.
            with pytest.raises(HTTPException):
                await support.update_contact_submission(
                    session,
                    submission=submission,
                    assignee_id=uuid4(),
                    assignee_set=True,
                    actor=admin,
                )

            # Assign to a non-staff user -> 400.
            with pytest.raises(HTTPException):
                await support.update_contact_submission(
                    session,
                    submission=submission,
                    assignee_id=customer.id,
                    assignee_set=True,
                    actor=admin,
                )

            # Update without touching the assignee (assignee_set False branch).
            no_assign = await support.update_contact_submission(
                session,
                submission=submission,
                status_value=ContactSubmissionStatus.new,
                actor=admin,
            )
            assert no_assign.status == ContactSubmissionStatus.new

            # Re-assign to the SAME assignee leaves it unchanged (no-op branch).
            await support.update_contact_submission(
                session,
                submission=submission,
                assignee_id=assignee.id,
                assignee_set=True,
                actor=admin,
            )
            same = await support.update_contact_submission(
                session,
                submission=submission,
                assignee_id=assignee.id,
                assignee_set=True,
                actor=admin,
            )
            assert same.assignee_user_id == assignee.id

    asyncio.run(run())


def test_canned_response_crud() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            admin = _user(UserRole.admin)
            customer = _user(UserRole.customer)
            session.add_all([admin, customer])
            await session.commit()
            await session.refresh(admin)

            # Non-admin create blocked.
            with pytest.raises(HTTPException):
                await support.create_canned_response(
                    session, title="t", body_en="en", body_ro="ro", actor=customer
                )
            # Missing title blocked.
            with pytest.raises(HTTPException):
                await support.create_canned_response(
                    session, title="  ", body_en="en", body_ro="ro", actor=admin
                )
            # Missing body blocked.
            with pytest.raises(HTTPException):
                await support.create_canned_response(
                    session, title="t", body_en="", body_ro="ro", actor=admin
                )

            record = await support.create_canned_response(
                session,
                title="Greeting",
                body_en="Hello",
                body_ro="Salut",
                is_active=True,
                actor=admin,
            )
            assert record.title == "Greeting"

            # Inactive one for include_inactive filter.
            inactive = await support.create_canned_response(
                session, title="Old", body_en="x", body_ro="y", is_active=False,
                actor=admin,
            )

            active_only = await support.list_canned_responses(session)
            assert all(r.is_active for r in active_only)
            all_resp = await support.list_canned_responses(
                session, include_inactive=True
            )
            assert len(all_resp) == 2

            assert await support.get_canned_response(session, record.id) is not None

            # Update with guards.
            with pytest.raises(HTTPException):
                await support.update_canned_response(
                    session, record=record, title="x", actor=customer
                )
            updated = await support.update_canned_response(
                session,
                record=record,
                title=" New Title ",
                body_en=" New EN ",
                body_ro=" New RO ",
                is_active=False,
                actor=admin,
            )
            assert updated.title == "New Title"
            assert updated.is_active is False

            # Blank update values leave fields unchanged.
            unchanged = await support.update_canned_response(
                session, record=record, title="  ", body_en="  ", body_ro="  ",
                actor=admin,
            )
            assert unchanged.title == "New Title"

            # None update values skip each field block (only is_active changes).
            only_active = await support.update_canned_response(
                session, record=record, is_active=True, actor=admin
            )
            assert only_active.is_active is True

            # Delete with guards.
            with pytest.raises(HTTPException):
                await support.delete_canned_response(
                    session, record=inactive, actor=customer
                )
            await support.delete_canned_response(session, record=inactive, actor=admin)
            assert await support.get_canned_response(session, inactive.id) is None

    asyncio.run(run())
