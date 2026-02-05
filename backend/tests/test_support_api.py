import asyncio
import uuid
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.notification import UserNotification
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.services import email as email_service


@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_user_token(session_factory, *, email: str, role: UserRole, username: str) -> tuple[str, uuid.UUID]:
    async def _create() -> tuple[str, uuid.UUID]:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(email=email, password="pass123", name="User", username=username),
            )
            user.email_verified = True
            user.role = role
            if role in (UserRole.admin, UserRole.owner):
                session.add(
                    UserPasskey(
                        user_id=user.id,
                        name="Test Passkey",
                        credential_id=f"cred-{user.id}",
                        public_key=b"test",
                        sign_count=0,
                        backed_up=False,
                    )
                )
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(_create())


def test_support_contact_submission_creates_notification(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, admin_id = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin, username="admin")

    res = client.post(
        "/api/v1/support/contact",
        json={
            "topic": "support",
            "name": "Customer",
            "email": "customer@example.com",
            "message": "Help please",
            "order_reference": "MS-123",
        },
    )
    assert res.status_code == 201, res.text
    submission_id = res.json()["id"]

    listed = client.get("/api/v1/support/admin/submissions", headers=auth_headers(admin_token))
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()["items"]}
    assert submission_id in ids

    async def _fetch_notifications() -> list[UserNotification]:
        async with SessionLocal() as session:
            rows = (await session.execute(select(UserNotification).where(UserNotification.user_id == admin_id))).scalars().all()
            return list(rows)

    notifications = asyncio.run(_fetch_notifications())
    assert any(n.type == "support" and n.url == "/admin/support" for n in notifications)


def test_support_admin_feedback_creates_submission(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    staff_token, _ = create_user_token(SessionLocal, email="staff@example.com", role=UserRole.content, username="staff")
    admin_token, _ = create_user_token(SessionLocal, email="admin3@example.com", role=UserRole.admin, username="admin3")

    res = client.post(
        "/api/v1/support/admin/feedback",
        headers=auth_headers(staff_token),
        json={"message": "Found a UX issue on the orders page", "context": "/admin/orders/123"},
    )
    assert res.status_code == 201, res.text
    created = res.json()
    assert created["topic"] == "feedback"
    assert created["admin_note"] == "/admin/orders/123"

    listed = client.get(
        "/api/v1/support/admin/submissions",
        headers=auth_headers(admin_token),
        params={"topic_filter": "feedback"},
    )
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()["items"]}
    assert created["id"] in ids


def test_support_public_feedback_topic_rejected(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/support/contact",
        json={
            "topic": "feedback",
            "name": "Customer",
            "email": "customer@example.com",
            "message": "Feedback",
        },
    )
    assert res.status_code == 400, res.text


def test_support_admin_update_requires_admin(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin2@example.com", role=UserRole.admin, username="admin2")

    async def _create_customer() -> tuple[str, str]:
        async with SessionLocal() as session:
            user = await create_user(
                session,
                UserCreate(email="user@example.com", password="pass123", name="User", username="user2"),
            )
            user.email_verified = True
            user.role = UserRole.customer
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], str(user.id)

    user_token, _ = asyncio.run(_create_customer())

    created = client.post(
        "/api/v1/support/contact",
        json={"topic": "contact", "name": "U", "email": "u@example.com", "message": "Hi"},
    )
    assert created.status_code == 201, created.text
    submission_id = created.json()["id"]

    forbidden = client.patch(
        f"/api/v1/support/admin/submissions/{submission_id}",
        headers=auth_headers(user_token),
        json={"status": "resolved", "admin_note": "done"},
    )
    assert forbidden.status_code == 403, forbidden.text

    ok = client.patch(
        f"/api/v1/support/admin/submissions/{submission_id}",
        headers=auth_headers(admin_token),
        json={"status": "resolved", "admin_note": "done"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "resolved"


def test_support_guest_reply_sends_email(test_app: Dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin-guest@example.com", role=UserRole.admin, username="admin_guest")

    created = client.post(
        "/api/v1/support/contact",
        json={
            "topic": "support",
            "name": "Guest",
            "email": "guest@example.com",
            "message": "Hello",
            "order_reference": "MS-555",
        },
    )
    assert created.status_code == 201, created.text
    submission_id = created.json()["id"]

    sent: list[dict] = []

    async def _fake_send_contact_submission_reply(to_email: str, **kwargs) -> bool:
        sent.append({"to_email": to_email, **kwargs})
        return True

    monkeypatch.setattr(email_service, "send_contact_submission_reply", _fake_send_contact_submission_reply)

    reply = client.post(
        f"/api/v1/support/admin/submissions/{submission_id}/messages",
        headers=auth_headers(admin_token),
        json={"message": "Reply from staff"},
    )
    assert reply.status_code == 200, reply.text
    assert len(sent) == 1
    assert sent[0]["to_email"] == "guest@example.com"
    assert sent[0]["reply_message"] == "Reply from staff"


def test_support_ticket_thread_user_and_admin_reply(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin3@example.com", role=UserRole.admin, username="admin3")
    user_token, user_id = create_user_token(SessionLocal, email="user3@example.com", role=UserRole.customer, username="user3")

    created = client.post(
        "/api/v1/support/me/submissions",
        headers=auth_headers(user_token),
        json={"topic": "support", "message": "Need help", "order_reference": "MS-100"},
    )
    assert created.status_code == 201, created.text
    ticket = created.json()
    ticket_id = ticket["id"]
    assert len(ticket["messages"]) == 1
    assert ticket["messages"][0]["from_admin"] is False
    assert ticket["messages"][0]["message"] == "Need help"

    listed = client.get("/api/v1/support/me/submissions", headers=auth_headers(user_token))
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == ticket_id for row in listed.json())

    admin_reply = client.post(
        f"/api/v1/support/admin/submissions/{ticket_id}/messages",
        headers=auth_headers(admin_token),
        json={"message": "We can help"},
    )
    assert admin_reply.status_code == 200, admin_reply.text
    admin_view = admin_reply.json()
    assert admin_view["id"] == ticket_id
    assert admin_view["message"] == "Need help"
    assert len(admin_view["messages"]) == 1
    assert admin_view["messages"][0]["from_admin"] is True

    fetched = client.get(f"/api/v1/support/me/submissions/{ticket_id}", headers=auth_headers(user_token))
    assert fetched.status_code == 200, fetched.text
    thread = fetched.json()
    assert thread["id"] == ticket_id
    assert len(thread["messages"]) == 2
    assert thread["messages"][1]["from_admin"] is True
    assert thread["messages"][1]["message"] == "We can help"

    user_reply = client.post(
        f"/api/v1/support/me/submissions/{ticket_id}/messages",
        headers=auth_headers(user_token),
        json={"message": "Thanks"},
    )
    assert user_reply.status_code == 200, user_reply.text
    assert len(user_reply.json()["messages"]) == 3

    resolved = client.patch(
        f"/api/v1/support/admin/submissions/{ticket_id}",
        headers=auth_headers(admin_token),
        json={"status": "resolved"},
    )
    assert resolved.status_code == 200, resolved.text

    blocked = client.post(
        f"/api/v1/support/me/submissions/{ticket_id}/messages",
        headers=auth_headers(user_token),
        json={"message": "One more thing"},
    )
    assert blocked.status_code == 400, blocked.text

    async def _assert_ticket_owner() -> None:
        async with SessionLocal() as session:
            ticket_owner_id = await session.scalar(select(UserNotification.user_id).where(UserNotification.user_id == user_id))
            assert ticket_owner_id is not None

    asyncio.run(_assert_ticket_owner())


def test_support_assignment_and_mentions_notify_staff(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin4@example.com", role=UserRole.admin, username="admin4")
    _, support_id = create_user_token(SessionLocal, email="helper@example.com", role=UserRole.support, username="helper")

    created = client.post(
        "/api/v1/support/contact",
        json={
            "topic": "support",
            "name": "Customer",
            "email": "customer2@example.com",
            "message": "Help please",
            "order_reference": "MS-555",
        },
    )
    assert created.status_code == 201, created.text
    submission_id = created.json()["id"]

    updated = client.patch(
        f"/api/v1/support/admin/submissions/{submission_id}",
        headers=auth_headers(admin_token),
        json={"assignee_id": str(support_id)},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["assignee"]["id"] == str(support_id)

    filtered = client.get(
        "/api/v1/support/admin/submissions",
        headers=auth_headers(admin_token),
        params={"assignee_filter": str(support_id)},
    )
    assert filtered.status_code == 200, filtered.text
    assert any(row["id"] == submission_id for row in filtered.json()["items"])

    assignees = client.get("/api/v1/support/admin/assignees", headers=auth_headers(admin_token))
    assert assignees.status_code == 200, assignees.text
    assert any(row["id"] == str(support_id) for row in assignees.json())

    replied = client.post(
        f"/api/v1/support/admin/submissions/{submission_id}/messages",
        headers=auth_headers(admin_token),
        json={"message": "Ping @helper"},
    )
    assert replied.status_code == 200, replied.text

    async def _fetch_notifications() -> list[UserNotification]:
        async with SessionLocal() as session:
            rows = (
                (await session.execute(select(UserNotification).where(UserNotification.user_id == support_id)))
                .scalars()
                .all()
            )
            return list(rows)

    notifications = asyncio.run(_fetch_notifications())
    assert any(n.title == "Support ticket assigned" for n in notifications)
    assert any(n.title == "Mentioned in support ticket" for n in notifications)
    assert any(n.url == f"/admin/support?ticket={submission_id}" for n in notifications)


def test_support_canned_responses_crud(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token, _ = create_user_token(SessionLocal, email="admin5@example.com", role=UserRole.admin, username="admin5")

    created = client.post(
        "/api/v1/support/admin/canned-responses",
        headers=auth_headers(admin_token),
        json={
            "title": "Refund policy",
            "body_en": "Hello {{customer_name}}, we can help with your refund.",
            "body_ro": "Salut {{customer_name}}, te putem ajuta cu rambursarea.",
            "is_active": True,
        },
    )
    assert created.status_code == 201, created.text
    response_id = created.json()["id"]

    listed = client.get("/api/v1/support/admin/canned-responses", headers=auth_headers(admin_token))
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == response_id for row in listed.json())

    disabled = client.patch(
        f"/api/v1/support/admin/canned-responses/{response_id}",
        headers=auth_headers(admin_token),
        json={"is_active": False},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["is_active"] is False

    active_only = client.get("/api/v1/support/admin/canned-responses", headers=auth_headers(admin_token))
    assert active_only.status_code == 200, active_only.text
    assert all(row["id"] != response_id for row in active_only.json())

    all_rows = client.get(
        "/api/v1/support/admin/canned-responses",
        headers=auth_headers(admin_token),
        params={"include_inactive": "true"},
    )
    assert all_rows.status_code == 200, all_rows.text
    assert any(row["id"] == response_id for row in all_rows.json())

    deleted = client.delete(
        f"/api/v1/support/admin/canned-responses/{response_id}",
        headers=auth_headers(admin_token),
    )
    assert deleted.status_code == 204, deleted.text
