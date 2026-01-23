import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.notification import UserNotification
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


def create_user_token(session_factory) -> tuple[str, uuid.UUID]:
    async def _create() -> tuple[str, uuid.UUID]:
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email="notify@example.com", password="pass123", name="Notify"))
            user.email_verified = True
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(_create())


def seed_notifications(session_factory, user_id: uuid.UUID) -> dict[str, str]:
    async def _seed() -> dict[str, str]:
        async with session_factory() as session:
            now = datetime.now(timezone.utc)
            unread = UserNotification(
                user_id=user_id,
                type="order",
                title="Order placed",
                body="Reference TEST",
                url="/account",
            )
            recent_read = UserNotification(
                user_id=user_id,
                type="blog_reply",
                title="New reply",
                body="Post",
                url="/blog/post",
                read_at=now - timedelta(hours=1),
            )
            dismissed = UserNotification(
                user_id=user_id,
                type="order",
                title="Dismiss me",
                dismissed_at=now,
            )
            old_read = UserNotification(
                user_id=user_id,
                type="order",
                title="Old read",
                read_at=now - timedelta(days=4),
            )
            session.add_all([unread, recent_read, dismissed, old_read])
            await session.commit()
            await session.refresh(unread)
            await session.refresh(recent_read)
            await session.refresh(dismissed)
            await session.refresh(old_read)
            return {
                "unread_id": str(unread.id),
                "recent_read_id": str(recent_read.id),
                "dismissed_id": str(dismissed.id),
                "old_read_id": str(old_read.id),
            }

    return asyncio.run(_seed())


def test_notifications_list_and_unread_count(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    ids = seed_notifications(SessionLocal, user_id)

    res = client.get("/api/v1/notifications", headers=auth_headers(token))
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    returned_ids = {row["id"] for row in items}
    assert ids["unread_id"] in returned_ids
    assert ids["recent_read_id"] in returned_ids
    assert ids["dismissed_id"] not in returned_ids
    assert ids["old_read_id"] not in returned_ids

    count = client.get("/api/v1/notifications/unread-count", headers=auth_headers(token))
    assert count.status_code == 200, count.text
    assert count.json()["count"] == 1


def test_notifications_mark_read_and_dismiss(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    ids = seed_notifications(SessionLocal, user_id)

    mark = client.post(f"/api/v1/notifications/{ids['unread_id']}/read", headers=auth_headers(token))
    assert mark.status_code == 200, mark.text
    assert mark.json()["read_at"] is not None

    count = client.get("/api/v1/notifications/unread-count", headers=auth_headers(token))
    assert count.status_code == 200, count.text
    assert count.json()["count"] == 0

    dismiss = client.post(f"/api/v1/notifications/{ids['recent_read_id']}/dismiss", headers=auth_headers(token))
    assert dismiss.status_code == 200, dismiss.text
    assert dismiss.json()["dismissed_at"] is not None

    res = client.get("/api/v1/notifications", headers=auth_headers(token))
    assert res.status_code == 200, res.text
    returned_ids = {row["id"] for row in res.json()["items"]}
    assert ids["recent_read_id"] not in returned_ids


def test_notifications_list_include_dismissed_and_old_read(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    ids = seed_notifications(SessionLocal, user_id)

    res = client.get(
        "/api/v1/notifications?limit=50&include_dismissed=1&include_old_read=1",
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text
    returned_ids = {row["id"] for row in res.json()["items"]}
    assert ids["dismissed_id"] in returned_ids
    assert ids["old_read_id"] in returned_ids


def test_notifications_restore(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token, user_id = create_user_token(SessionLocal)
    ids = seed_notifications(SessionLocal, user_id)

    restore = client.post(f"/api/v1/notifications/{ids['dismissed_id']}/restore", headers=auth_headers(token))
    assert restore.status_code == 200, restore.text
    assert restore.json()["dismissed_at"] is None

    res = client.get("/api/v1/notifications", headers=auth_headers(token))
    assert res.status_code == 200, res.text
    returned_ids = {row["id"] for row in res.json()["items"]}
    assert ids["dismissed_id"] in returned_ids
