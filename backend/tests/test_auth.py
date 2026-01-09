import asyncio
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.user import User, UserRole, UserDisplayNameHistory, UserUsernameHistory


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


def make_register_payload(
    *,
    email: str,
    username: str,
    password: str = "supersecret",
    name: str = "User",
    first_name: str = "Test",
    last_name: str = "User",
    middle_name: str | None = None,
    date_of_birth: str = "2000-01-01",
    phone: str = "+40723204204",
) -> dict[str, object]:
    payload: dict[str, object] = {
        "email": email,
        "username": username,
        "password": password,
        "name": name,
        "first_name": first_name,
        "last_name": last_name,
        "date_of_birth": date_of_birth,
        "phone": phone,
    }
    if middle_name is not None:
        payload["middle_name"] = middle_name
    return payload


def test_register_and_login_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    register_payload = make_register_payload(email="user@example.com", username="user", name="User")
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user"]["email"] == "user@example.com"
    assert body["user"]["username"] == "user"
    assert body["tokens"]["access_token"]
    assert body["tokens"]["refresh_token"]

    # Login by email
    res = client.post("/api/v1/auth/login", json={"identifier": "user@example.com", "password": "supersecret"})
    assert res.status_code == 200, res.text
    tokens = res.json()["tokens"]
    assert tokens["access_token"]
    assert tokens["refresh_token"]

    # Login by username
    res = client.post("/api/v1/auth/login", json={"identifier": "user", "password": "supersecret"})
    assert res.status_code == 200, res.text

    # Refresh
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 200, res.text
    refreshed = res.json()
    assert refreshed["access_token"]
    assert refreshed["refresh_token"]


def test_register_rejects_invalid_phone(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="badphone@example.com", username="badphone", phone="0723204204"),
    )
    assert res.status_code == 422, res.text


def test_register_rejects_future_date_of_birth(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="baddob@example.com", username="baddob", date_of_birth="2999-01-01"),
    )
    assert res.status_code == 422, res.text


def test_invalid_login_and_refresh(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "invalidpw"})
    assert res.status_code == 401

    res = client.post("/api/v1/auth/refresh", json={"refresh_token": "not-a-token"})
    assert res.status_code == 401


def test_admin_guard(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    # Register user
    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="admin@example.com", username="admin", password="adminpass", name="Admin"),
    )
    assert res.status_code == 201
    access_token = res.json()["tokens"]["access_token"]

    # Non-admin should be forbidden
    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 403

    # Promote to admin directly in DB for test
    async def promote() -> None:
        async with SessionLocal() as session:
            result = await session.execute(select(User).where(User.email == "admin@example.com"))
            user = result.scalar_one()
            user.role = UserRole.admin
            await session.commit()

    asyncio.run(promote())

    # Acquire new tokens after role change
    res = client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "adminpass"})
    admin_access = res.json()["tokens"]["access_token"]

    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {admin_access}"})
    assert res.status_code == 200
    assert res.json()["status"] == "admin-ok"


def test_password_reset_flow(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    sent = {"token": None}

    async def fake_send(email: str, token: str):
        sent["token"] = token
        return True

    monkeypatch.setattr("app.services.email.send_password_reset", fake_send)

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="reset@example.com", username="reset", password="resetpass", name="Reset"),
    )
    assert res.status_code == 201

    req = client.post("/api/v1/auth/password-reset/request", json={"email": "reset@example.com"})
    assert req.status_code == 202
    assert sent["token"]

    confirm = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": sent["token"], "new_password": "newsecret"},
    )
    assert confirm.status_code == 200

    login = client.post("/api/v1/auth/login", json={"identifier": "reset@example.com", "password": "newsecret"})
    assert login.status_code == 200


def test_update_profile_me(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="me@example.com", username="me1", password="supersecret", name="Old"),
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    patch = client.patch(
        "/api/v1/auth/me",
        json={"phone": "+40723204204", "preferred_language": "ro"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patch.status_code == 200, patch.text
    body = patch.json()
    assert body["name"] == "Old"
    assert body["phone"] == "+40723204204"
    assert body["preferred_language"] == "ro"
    assert body["notify_marketing"] is False
    assert body["name_tag"] == 0

    blocked = client.patch(
        "/api/v1/auth/me",
        json={"name": "New Name"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert blocked.status_code == 429, blocked.text

    async def rewind_display_name_cooldown() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "me@example.com"))).scalar_one()
            history = (
                (
                    await session.execute(
                        select(UserDisplayNameHistory)
                        .where(UserDisplayNameHistory.user_id == user.id)
                        .order_by(UserDisplayNameHistory.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .one()
            )
            history.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
            await session.commit()

    asyncio.run(rewind_display_name_cooldown())

    ok = client.patch(
        "/api/v1/auth/me",
        json={"name": "New Name"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "New Name"

    cleared = client.patch(
        "/api/v1/auth/me",
        json={"phone": "   "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cleared.status_code == 400, cleared.text
    assert cleared.json()["detail"] == "Phone is required"


def test_change_password_persists_and_updates_login(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="pw@example.com", username="pw1", password="oldsecret", name="PW"),
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    wrong = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "wrong", "new_password": "newsecret"},
        headers=auth_headers(token),
    )
    assert wrong.status_code == 400

    ok = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "oldsecret", "new_password": "newsecret"},
        headers=auth_headers(token),
    )
    assert ok.status_code == 200, ok.text

    old_login = client.post("/api/v1/auth/login", json={"identifier": "pw@example.com", "password": "oldsecret"})
    assert old_login.status_code == 401

    new_login = client.post("/api/v1/auth/login", json={"identifier": "pw@example.com", "password": "newsecret"})
    assert new_login.status_code == 200, new_login.text


def test_update_notification_preferences(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="notify@example.com", username="notify", password="supersecret", name="N"),
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    patch = client.patch(
        "/api/v1/auth/me/notifications",
        json={"notify_blog_comments": True, "notify_marketing": True},
        headers=auth_headers(token),
    )
    assert patch.status_code == 200, patch.text
    updated = patch.json()
    assert updated["notify_blog_comments"] is True
    assert updated["notify_marketing"] is True

    me = client.get("/api/v1/auth/me", headers=auth_headers(token))
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["notify_blog_comments"] is True
    assert body["notify_marketing"] is True


def test_alias_history_and_display_name_tags(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res1 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="ana1@example.com", username="ana1", password="supersecret", name="Ana"),
    )
    assert res1.status_code == 201, res1.text
    assert res1.json()["user"]["name_tag"] == 0
    token = res1.json()["tokens"]["access_token"]

    res2 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="ana2@example.com", username="ana2", password="supersecret", name="Ana"),
    )
    assert res2.status_code == 201, res2.text
    assert res2.json()["user"]["name_tag"] == 1

    aliases = client.get("/api/v1/auth/me/aliases", headers=auth_headers(token))
    assert aliases.status_code == 200, aliases.text
    data = aliases.json()
    assert data["usernames"][0]["username"] == "ana1"
    assert data["display_names"][0]["name"] == "Ana"
    assert data["display_names"][0]["name_tag"] == 0

    update = client.patch("/api/v1/auth/me/username", json={"username": "ana1-new"}, headers=auth_headers(token))
    assert update.status_code == 429, update.text

    async def rewind_username_cooldown() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "ana1@example.com"))).scalar_one()
            history = (
                (
                    await session.execute(
                        select(UserUsernameHistory)
                        .where(UserUsernameHistory.user_id == user.id)
                        .order_by(UserUsernameHistory.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .one()
            )
            history.created_at = datetime.now(timezone.utc) - timedelta(days=8)
            await session.commit()

    asyncio.run(rewind_username_cooldown())

    update = client.patch("/api/v1/auth/me/username", json={"username": "ana1-new"}, headers=auth_headers(token))
    assert update.status_code == 200, update.text
    aliases2 = client.get("/api/v1/auth/me/aliases", headers=auth_headers(token))
    assert aliases2.status_code == 200, aliases2.text
    usernames = [u["username"] for u in aliases2.json()["usernames"]]
    assert usernames[:2] == ["ana1-new", "ana1"]


def test_display_name_history_reuses_name_tag_on_revert(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res1 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="tagreuse1@example.com", username="tagreuse1", password="supersecret", name="Ana"),
    )
    assert res1.status_code == 201, res1.text
    token = res1.json()["tokens"]["access_token"]
    assert res1.json()["user"]["name_tag"] == 0

    res2 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="tagreuse2@example.com", username="tagreuse2", password="supersecret", name="Ana"),
    )
    assert res2.status_code == 201, res2.text
    assert res2.json()["user"]["name_tag"] == 1

    renamed = client.patch(
        "/api/v1/auth/me",
        json={"name": "Maria"},
        headers=auth_headers(token),
    )
    assert renamed.status_code == 429, renamed.text

    async def rewind_display_name_cooldown() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "tagreuse1@example.com"))).scalar_one()
            history = (
                (
                    await session.execute(
                        select(UserDisplayNameHistory)
                        .where(UserDisplayNameHistory.user_id == user.id)
                        .order_by(UserDisplayNameHistory.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .one()
            )
            history.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
            await session.commit()

    asyncio.run(rewind_display_name_cooldown())

    renamed = client.patch(
        "/api/v1/auth/me",
        json={"name": "Maria"},
        headers=auth_headers(token),
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Maria"
    assert renamed.json()["name_tag"] == 0

    reverted = client.patch(
        "/api/v1/auth/me",
        json={"name": "Ana"},
        headers=auth_headers(token),
    )
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["name"] == "Ana"
    assert reverted.json()["name_tag"] == 0

    aliases = client.get("/api/v1/auth/me/aliases", headers=auth_headers(token))
    assert aliases.status_code == 200, aliases.text
    display_names = [(h["name"], h["name_tag"]) for h in aliases.json()["display_names"]]
    assert display_names[0] == ("Ana", 0)
    assert ("Maria", 0) in display_names

    bad = client.patch("/api/v1/auth/me", json={"name": "   "}, headers=auth_headers(token))
    assert bad.status_code == 400
