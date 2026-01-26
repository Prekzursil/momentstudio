import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.models.user import User, UserRole
from app.services import email as email_service


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


def _create_user(session_factory, *, email: str, username: str, role: UserRole, password: str = "supersecret") -> User:
    async def _inner() -> User:
        async with session_factory() as session:
            user = User(
                email=email,
                username=username,
                hashed_password=security.hash_password(password),
                name=username,
                name_tag=0,
                role=role,
                email_verified=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    return asyncio.run(_inner())


def test_admin_login_alert_sent_once_per_device(test_app, monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]

    owner = _create_user(session_factory, email="owner@example.com", username="owner", role=UserRole.owner)
    _create_user(session_factory, email="admin@example.com", username="admin", role=UserRole.admin)

    mock_send = AsyncMock(return_value=True)
    monkeypatch.setattr(email_service, "send_admin_login_alert", mock_send)

    headers = {"user-agent": "TestBrowser/1.0"}
    res1 = client.post("/api/v1/auth/login", json={"identifier": "admin", "password": "supersecret"}, headers=headers)
    assert res1.status_code == 200, res1.text

    assert mock_send.await_count == 1
    assert mock_send.await_args.args[0] == owner.email

    res2 = client.post(
        "/api/v1/auth/login", json={"identifier": "admin", "password": "supersecret"}, headers={"user-agent": "TestBrowser/2.0"}
    )
    assert res2.status_code == 200, res2.text
    assert mock_send.await_count == 1

    res3 = client.post(
        "/api/v1/auth/login", json={"identifier": "admin", "password": "supersecret"}, headers={"user-agent": "OtherBrowser/1.0"}
    )
    assert res3.status_code == 200, res3.text
    assert mock_send.await_count == 2


def test_customer_login_does_not_trigger_admin_alert(test_app, monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]

    _create_user(session_factory, email="owner@example.com", username="owner", role=UserRole.owner)
    _create_user(session_factory, email="user@example.com", username="user", role=UserRole.customer)

    mock_send = AsyncMock(return_value=True)
    monkeypatch.setattr(email_service, "send_admin_login_alert", mock_send)

    res = client.post("/api/v1/auth/login", json={"identifier": "user", "password": "supersecret"}, headers={"user-agent": "X/1.0"})
    assert res.status_code == 200, res.text
    assert mock_send.await_count == 0

