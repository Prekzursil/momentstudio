import asyncio
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
from app.models.user import User
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
                hashed_password="hashed",
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
            user = User(email="existing@example.com", hashed_password="hashed")
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
    assert data["tokens"]["access_token"]

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
    res = client.post("/api/v1/auth/register", json={"email": "link@example.com", "password": "linkpass"})
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

    # Unlink
    res = client.post(
        "/api/v1/auth/google/unlink",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "linkpass"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["google_sub"] is None
