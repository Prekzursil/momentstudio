import asyncio
import io
from datetime import datetime, timedelta, timezone, date
from urllib.parse import urlparse, parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy import select

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.services import auth as auth_service


@pytest.fixture
def test_app():
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


def _parse_state_from_start(client: TestClient) -> str:
    res = client.get("/api/v1/auth/google/start")
    assert res.status_code == 200
    auth_url = res.json()["auth_url"]
    qs = parse_qs(urlparse(auth_url).query)
    return qs["state"][0]


def _parse_state_from_link(client: TestClient) -> str:
    res = client.get("/api/v1/auth/google/link/start", headers={"Authorization": "Bearer fake"})
    assert res.status_code in (200, 401)  # real token required, but this helper not used in secured call
    return ""


def test_google_start_builds_url(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    res = client.get("/api/v1/auth/google/start")
    assert res.status_code == 200
    url = res.json()["auth_url"]
    assert "client_id=client-id" in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%2Fcallback" in url
    assert "scope=openid+email+profile" in url


def test_google_oauth_smoke_with_mocked_endpoints(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    calls = {"token": 0, "userinfo": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "https://oauth2.googleapis.com/token":
            calls["token"] += 1
            return httpx.Response(200, json={"access_token": "mock-access"}, request=request)
        if str(request.url) == "https://www.googleapis.com/oauth2/v3/userinfo":
            calls["userinfo"] += 1
            return httpx.Response(
                200,
                json={"sub": "mock-sub", "email": "mocked@example.com", "email_verified": True, "name": "Mocked User"},
                request=request,
            )
        return httpx.Response(404, json={"error": "not found"}, request=request)

    transport = httpx.MockTransport(handler)

    real_async_client = httpx.AsyncClient

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            self._client = real_async_client(transport=transport, timeout=kwargs.get("timeout"))

        async def __aenter__(self):
            return self._client

        async def __aexit__(self, exc_type, exc, tb):
            await self._client.aclose()

    monkeypatch.setattr(auth_service.httpx, "AsyncClient", MockAsyncClient)

    state = _parse_state_from_start(client)
    res = client.post("/api/v1/auth/google/callback", json={"code": "abc", "state": state})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["email"] == "mocked@example.com"
    assert body["requires_completion"] is True
    assert body["completion_token"]
    assert calls == {"token": 1, "userinfo": 1}


def test_google_callback_existing_sub(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    SessionLocal = test_app["session_factory"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    async def seed_user():
        async with SessionLocal() as session:
            user = User(
                email="google@example.com",
                username="googleuser",
                hashed_password="hashed",
                name="G User",
                name_tag=0,
                first_name="G",
                last_name="User",
                date_of_birth=date(2000, 1, 1),
                phone="+40723204204",
                google_sub="sub-123",
                google_email="google@example.com",
                email_verified=True,
            )
            session.add(user)
            await session.commit()
    asyncio.run(seed_user())

    async def fake_exchange(code: str):
        return {"sub": "sub-123", "email": "google@example.com", "email_verified": True, "name": "G User"}

    monkeypatch.setattr(auth_service, "exchange_google_code", fake_exchange)
    state = _parse_state_from_start(client)
    res = client.post("/api/v1/auth/google/callback", json={"code": "abc", "state": state})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["google_sub"] == "sub-123"
    assert body["tokens"]["access_token"]


def test_google_callback_email_collision(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    SessionLocal = test_app["session_factory"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    async def seed_user():
        async with SessionLocal() as session:
            user = User(
                email="existing@example.com",
                username="existing",
                hashed_password="hashed",
                name="Existing User",
            )
            session.add(user)
            await session.commit()
    asyncio.run(seed_user())

    async def fake_exchange(code: str):
        return {"sub": "new-sub", "email": "existing@example.com", "email_verified": True, "name": "Existing"}

    monkeypatch.setattr(auth_service, "exchange_google_code", fake_exchange)
    state = _parse_state_from_start(client)
    res = client.post("/api/v1/auth/google/callback", json={"code": "abc", "state": state})
    assert res.status_code == 409


def test_google_callback_creates_user(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    SessionLocal = test_app["session_factory"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    async def fake_exchange(code: str):
        return {
            "sub": "new-sub",
            "email": "newuser@example.com",
            "email_verified": True,
            "name": "New User",
            "picture": "http://example.com/pic.png",
        }

    monkeypatch.setattr(auth_service, "exchange_google_code", fake_exchange)
    state = _parse_state_from_start(client)
    res = client.post("/api/v1/auth/google/callback", json={"code": "abc", "state": state})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["user"]["email"] == "newuser@example.com"
    assert data["user"]["google_sub"] == "new-sub"
    assert data["user"]["google_picture_url"] == "http://example.com/pic.png"
    # Google profile photo is stored, but using it as the site avatar is opt-in.
    assert data["user"]["avatar_url"] is None
    assert data["requires_completion"] is True
    assert data["completion_token"]

    async def verify_db():
        async with SessionLocal() as session:
            user = await auth_service.get_user_by_google_sub(session, "new-sub")
            assert user is not None
            assert user.google_email == "newuser@example.com"
    asyncio.run(verify_db())


def test_google_link_and_unlink(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    SessionLocal = test_app["session_factory"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    # Register and login to get token
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "link@example.com",
            "username": "linkuser",
            "name": "Link User",
            "password": "linkpass",
            "first_name": "Link",
            "last_name": "User",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert res.status_code == 201
    token = res.json()["tokens"]["access_token"]

    async def fake_exchange(code: str):
        return {
            "sub": "link-sub",
            "email": "link@example.com",
            "email_verified": True,
            "name": "Link User",
            "picture": "http://example.com/pic.png",
        }

    monkeypatch.setattr(auth_service, "exchange_google_code", fake_exchange)
    state = _parse_state_from_start(client)  # reuse start to build state template
    # rebuild state for link with correct uid
    async def get_user_id():
        async with SessionLocal() as session:
            result = await session.execute(select(User).where(User.email == "link@example.com"))
            return str(result.scalar_one().id)
    uid = asyncio.run(get_user_id())
    from app.api.v1.auth import _build_google_state  # type: ignore
    state = _build_google_state("google_link", uid)

    res = client.post(
        "/api/v1/auth/google/link",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": "abc", "state": state, "password": "linkpass"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["google_sub"] == "link-sub"
    assert body["google_picture_url"] == "http://example.com/pic.png"
    # Linking Google stores google_picture_url but does not override the site avatar unless user opts in.
    assert body["avatar_url"] is None

    # After linking, Google login should also work
    state_login = _parse_state_from_start(client)
    res = client.post("/api/v1/auth/google/callback", json={"code": "abc", "state": state_login})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "link@example.com"
    assert res.json()["tokens"]["access_token"]

    # Unlink
    res = client.post(
        "/api/v1/auth/google/unlink",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "linkpass"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["google_sub"] is None


def test_google_created_user_can_set_password_and_login(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    async def fake_exchange(code: str):
        return {
            "sub": "pw-sub",
            "email": "pw@example.com",
            "email_verified": True,
            "name": "PW User",
            "given_name": "PW",
            "family_name": "User",
            "picture": "http://example.com/pic.png",
        }

    monkeypatch.setattr(auth_service, "exchange_google_code", fake_exchange)
    state = _parse_state_from_start(client)
    res = client.post("/api/v1/auth/google/callback", json={"code": "abc", "state": state})
    assert res.status_code == 200, res.text
    username = res.json()["user"]["username"]
    completion_token = res.json()["completion_token"]
    assert res.json()["requires_completion"] is True

    # Completion token is exchanged for a real session only after the required profile fields are provided.
    res = client.post(
        "/api/v1/auth/google/complete",
        headers={"Authorization": f"Bearer {completion_token}"},
        json={
            "username": username,
            "name": "PW User",
            "first_name": "PW",
            "middle_name": None,
            "last_name": "User",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
            "password": "newpass123",
            "preferred_language": "en",
        },
    )
    assert res.status_code == 200, res.text
    access_token = res.json()["tokens"]["access_token"]

    ok = client.get("/api/v1/wishlist", headers={"Authorization": f"Bearer {access_token}"})
    assert ok.status_code == 200, ok.text

    # Password login works after registration completion.
    res = client.post("/api/v1/auth/login", json={"identifier": username, "password": "newpass123"})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "pw@example.com"

    res = client.post("/api/v1/auth/login", json={"identifier": "pw@example.com", "password": "newpass123"})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "pw@example.com"


def test_admin_cleanup_incomplete_google_accounts(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    SessionLocal = test_app["session_factory"]  # type: ignore

    # Create an admin user
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "cleanup-admin@example.com",
            "username": "cleanupadmin",
            "name": "Cleanup Admin",
            "password": "adminpass",
            "first_name": "Cleanup",
            "last_name": "Admin",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert res.status_code == 201, res.text

    async def promote_admin_and_seed() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "cleanup-admin@example.com"))).scalar_one()
            user.role = UserRole.admin
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

            old_user = await auth_service.create_google_user(
                session,
                email="old-incomplete@example.com",
                name="Old Incomplete",
                first_name="Old",
                last_name="Incomplete",
                picture=None,
                sub="old-sub",
                email_verified=True,
                preferred_language="en",
            )
            old_user.created_at = datetime.now(timezone.utc) - timedelta(days=10)
            session.add(old_user)

            await auth_service.create_google_user(
                session,
                email="new-incomplete@example.com",
                name="New Incomplete",
                first_name="New",
                last_name="Incomplete",
                picture=None,
                sub="new-sub",
                email_verified=True,
                preferred_language="en",
            )
            await session.commit()

    asyncio.run(promote_admin_and_seed())

    # Login again to get an admin token
    res = client.post("/api/v1/auth/login", json={"identifier": "cleanup-admin@example.com", "password": "adminpass"})
    assert res.status_code == 200, res.text
    token = res.json()["tokens"]["access_token"]

    res = client.post(
        "/api/v1/auth/admin/cleanup/incomplete-google",
        params={"max_age_hours": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["deleted"] == 1

    async def verify_deleted() -> None:
        async with SessionLocal() as session:
            old_user = await auth_service.get_user_by_email(session, "old-incomplete@example.com")
            assert old_user is None

            new_user = await auth_service.get_user_by_email(session, "new-incomplete@example.com")
            assert new_user is not None
            assert new_user.deleted_at is None

    asyncio.run(verify_deleted())


def test_upload_avatar_updates_avatar_url(monkeypatch: pytest.MonkeyPatch, tmp_path, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    monkeypatch.setattr(settings, "media_root", str(tmp_path))

    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "avatar@example.com",
            "username": "avataruser",
            "name": "Avatar User",
            "password": "avatarpass",
            "first_name": "Avatar",
            "last_name": "User",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]
    user_id = res.json()["user"]["id"]

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (1, 1), color=(255, 0, 0, 255)).save(buf, format="PNG")
    png_bytes = buf.getvalue()
    res = client.post(
        "/api/v1/auth/me/avatar",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("avatar.png", png_bytes, "image/png")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["avatar_url"] == f"/media/avatars/avatar-{user_id}.png"
    assert (tmp_path / "avatars" / f"avatar-{user_id}.png").exists()


def test_google_avatar_opt_in_and_cleanup(monkeypatch: pytest.MonkeyPatch, test_app):
    client: TestClient = test_app["client"]  # type: ignore
    SessionLocal = test_app["session_factory"]  # type: ignore
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost/callback")

    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "avatar-google@example.com",
            "username": "avatargoogle",
            "name": "Avatar Google",
            "password": "avatarpass",
            "first_name": "Avatar",
            "last_name": "Google",
            "date_of_birth": "2000-01-01",
            "phone": "+40723204204",
        },
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    async def fake_exchange(code: str):
        return {
            "sub": "avatar-sub",
            "email": "avatar-google@example.com",
            "email_verified": True,
            "name": "Avatar Google",
            "picture": "http://example.com/pic.png",
        }

    monkeypatch.setattr(auth_service, "exchange_google_code", fake_exchange)

    async def get_user_id():
        async with SessionLocal() as session:
            result = await session.execute(select(User).where(User.email == "avatar-google@example.com"))
            return str(result.scalar_one().id)

    uid = asyncio.run(get_user_id())
    from app.api.v1.auth import _build_google_state  # type: ignore

    state = _build_google_state("google_link", uid)
    res = client.post(
        "/api/v1/auth/google/link",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": "abc", "state": state, "password": "avatarpass"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["google_picture_url"] == "http://example.com/pic.png"
    assert res.json()["avatar_url"] is None

    # Opt into using the Google picture as the site avatar.
    res = client.post("/api/v1/auth/me/avatar/use-google", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    assert res.json()["avatar_url"] == "http://example.com/pic.png"

    # Explicit removal clears avatar_url without affecting google_picture_url.
    res = client.delete("/api/v1/auth/me/avatar", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    assert res.json()["avatar_url"] is None
    assert res.json()["google_picture_url"] == "http://example.com/pic.png"

    # If the user opts in again, unlinking should also clear avatar_url.
    res = client.post("/api/v1/auth/me/avatar/use-google", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    assert res.json()["avatar_url"] == "http://example.com/pic.png"

    res = client.post(
        "/api/v1/auth/google/unlink",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "avatarpass"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["google_sub"] is None
    assert res.json()["google_picture_url"] is None
    assert res.json()["avatar_url"] is None
