import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import observability as observability_api
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
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


def create_admin_token(session_factory) -> str:
    async def _create() -> str:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(email="admin-observability@example.com", password="password123", name="Admin"),
            )
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
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_create())


def test_admin_client_error_logs_metadata_only(
    test_app: Dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(session_factory)
    captured: dict[str, object] = {}

    def _capture(message: str, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        captured["message"] = message
        captured["extra"] = kwargs.get("extra")

    monkeypatch.setattr(observability_api.logger, "error", _capture)

    payload = {
        "kind": "window_error",
        "message": "boom\r\nline",
        "stack": "stack\r\ntrace",
        "url": "https://example.com/admin?token=secret",
        "route": "/admin/dashboard",
        "user_agent": "Mozilla/5.0",
        "context": {"note": "hello\nworld", "nested": {"x": 1}, "items": [1, 2, 3]},
    }
    response = client.post(
        "/api/v1/admin/observability/client-errors",
        json=payload,
        headers=auth_headers(admin_token),
    )
    assert response.status_code == 204, response.text
    assert captured["message"] == "admin_client_error"
    extra = captured.get("extra")
    assert isinstance(extra, dict)
    assert extra.get("kind") == "window_error"
    assert extra.get("message_len") == len(payload["message"])
    assert extra.get("stack_len") == len(payload["stack"])
    assert extra.get("context_key_count") == len(payload["context"])
    assert isinstance(extra.get("error_fingerprint"), str)
    assert len(str(extra.get("error_fingerprint"))) == 24
    assert "message" not in extra
    assert "stack" not in extra
    assert "url" not in extra
    assert "route" not in extra
    assert "user_agent" not in extra
    assert "context" not in extra
