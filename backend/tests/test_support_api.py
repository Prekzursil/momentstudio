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
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user


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
