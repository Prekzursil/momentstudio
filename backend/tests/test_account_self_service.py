import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import RefreshSession, User, UserRole
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


def create_user_token(session_factory, *, email: str, role: UserRole = UserRole.customer) -> str:
    async def create_and_token() -> str:
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="password123", name="User"))
            user.role = role
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_account_export_and_deletion_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_user_token(SessionLocal, email="user@example.com", role=UserRole.customer)

    export = client.get("/api/v1/auth/me/export", headers=auth_headers(token))
    assert export.status_code == 200, export.text
    assert "attachment;" in export.headers.get("content-disposition", "")
    exported = export.json()
    assert "exported_at" in exported
    assert exported["user"]["email"] == "user@example.com"
    assert exported["orders"] == []
    assert exported["wishlist"] == []

    status_res = client.get("/api/v1/auth/me/delete/status", headers=auth_headers(token))
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["scheduled_for"] is None
    assert status_res.json()["cooldown_hours"] >= 1

    bad_confirm = client.post(
        "/api/v1/auth/me/delete",
        json={"confirm": "nope", "password": "password123"},
        headers=auth_headers(token),
    )
    assert bad_confirm.status_code == 400

    scheduled = client.post(
        "/api/v1/auth/me/delete",
        json={"confirm": "DELETE", "password": "password123"},
        headers=auth_headers(token),
    )
    assert scheduled.status_code == 200, scheduled.text
    scheduled_json = scheduled.json()
    assert scheduled_json["scheduled_for"] is not None

    reschedule = client.post(
        "/api/v1/auth/me/delete",
        json={"confirm": "DELETE", "password": "password123"},
        headers=auth_headers(token),
    )
    assert reschedule.status_code == 400, reschedule.text

    canceled = client.post("/api/v1/auth/me/delete/cancel", json={}, headers=auth_headers(token))
    assert canceled.status_code == 200
    assert canceled.json()["scheduled_for"] is None

    # Force the scheduled_for into the past and ensure access is blocked + deletion executes.
    scheduled_again = client.post(
        "/api/v1/auth/me/delete",
        json={"confirm": "DELETE", "password": "password123"},
        headers=auth_headers(token),
    )
    assert scheduled_again.status_code == 200

    async def expire_schedule():
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "user@example.com"))).scalar_one()
            user.deletion_scheduled_for = datetime.now(timezone.utc) - timedelta(hours=1)
            user_id = user.id
            await session.commit()
            return user_id

    user_id = asyncio.run(expire_schedule())

    blocked = client.get("/api/v1/auth/me", headers=auth_headers(token))
    assert blocked.status_code == 401

    async def assert_deleted() -> None:
        async with SessionLocal() as session:
            user = await session.get(User, user_id)
            assert user is not None
            assert user.deleted_at is not None
            assert user.email.startswith("deleted+")
            sessions = (await session.execute(select(RefreshSession).where(RefreshSession.user_id == user.id))).scalars().all()
            assert sessions
            assert all(s.revoked for s in sessions)

    asyncio.run(assert_deleted())


def test_my_comments_endpoint_includes_status_and_context(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    admin_token = create_user_token(SessionLocal, email="admin@example.com", role=UserRole.admin)
    user_token = create_user_token(SessionLocal, email="user@example.com", role=UserRole.customer)
    other_token = create_user_token(SessionLocal, email="other@example.com", role=UserRole.customer)

    create_post = client.post(
        "/api/v1/content/admin/blog.first-post",
        json={
            "title": "Salut",
            "body_markdown": "Postare RO",
            "status": "published",
            "lang": "ro",
            "meta": {"summary": {"ro": "Rezumat RO", "en": "Summary EN"}},
        },
        headers=auth_headers(admin_token),
    )
    assert create_post.status_code == 201, create_post.text

    tr = client.patch(
        "/api/v1/content/admin/blog.first-post",
        json={"title": "Hello", "body_markdown": "Post EN", "lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert tr.status_code == 200, tr.text

    parent = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Parent comment"},
        headers=auth_headers(other_token),
    )
    assert parent.status_code == 201, parent.text
    parent_id = parent.json()["id"]

    reply = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "My reply", "parent_id": parent_id},
        headers=auth_headers(user_token),
    )
    assert reply.status_code == 201, reply.text
    reply_id = reply.json()["id"]

    root = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "My root comment"},
        headers=auth_headers(user_token),
    )
    assert root.status_code == 201, root.text
    root_id = root.json()["id"]

    other_reply = client.post(
        "/api/v1/blog/posts/first-post/comments",
        json={"body": "Reply from other", "parent_id": root_id},
        headers=auth_headers(other_token),
    )
    assert other_reply.status_code == 201, other_reply.text

    listing = client.get("/api/v1/blog/me/comments", params={"lang": "en"}, headers=auth_headers(user_token))
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    by_id = {item["id"]: item for item in items}

    assert by_id[root_id]["post_title"] == "Hello"
    assert by_id[root_id]["status"] == "posted"
    assert by_id[root_id]["reply_count"] == 1
    assert by_id[root_id]["last_reply"]["snippet"].startswith("Reply from other")

    assert by_id[reply_id]["parent"] is not None
    assert by_id[reply_id]["parent"]["snippet"].startswith("Parent comment")

    hide = client.post(
        f"/api/v1/blog/admin/comments/{root_id}/hide",
        json={"reason": "spam"},
        headers=auth_headers(admin_token),
    )
    assert hide.status_code == 200, hide.text

    after_hide = client.get("/api/v1/blog/me/comments", headers=auth_headers(user_token))
    assert after_hide.status_code == 200
    hidden_item = next(i for i in after_hide.json()["items"] if i["id"] == root_id)
    assert hidden_item["status"] == "hidden"
    assert hidden_item["body"] == ""

    deleted = client.delete(f"/api/v1/blog/comments/{reply_id}", headers=auth_headers(user_token))
    assert deleted.status_code == 204, deleted.text

    after_delete = client.get("/api/v1/blog/me/comments", headers=auth_headers(user_token))
    assert after_delete.status_code == 200
    deleted_item = next(i for i in after_delete.json()["items"] if i["id"] == reply_id)
    assert deleted_item["status"] == "deleted"
    assert deleted_item["body"] == ""
