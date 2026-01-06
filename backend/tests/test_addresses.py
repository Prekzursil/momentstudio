import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.services.auth import create_user, issue_tokens_for_user
from app.schemas.user import UserCreate


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


def create_user_token(session_factory) -> str:
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email="addr@example.com", password="addrpass", name="Addr"))
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_address_validation(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_user_token(SessionLocal)

    valid_payload = {
        "label": "Home",
        "line1": "123 Main",
        "city": "Bucharest",
        "region": "IF",
        "postal_code": "010203",
        "country": "ro",
    }
    ok = client.post("/api/v1/me/addresses", json=valid_payload, headers=auth_headers(token))
    assert ok.status_code == 201, ok.text
    assert ok.json()["country"] == "RO"

    bad = client.post(
        "/api/v1/me/addresses",
        json={**valid_payload, "postal_code": "12", "country": "US"},
        headers=auth_headers(token),
    )
    assert bad.status_code == 400


def test_address_default_flags_are_exclusive(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_user_token(SessionLocal)

    base = {
        "line1": "123 Main",
        "city": "Bucharest",
        "region": "IF",
        "postal_code": "010203",
        "country": "ro",
    }

    first = client.post(
        "/api/v1/me/addresses",
        json={**base, "label": "Home", "is_default_shipping": True, "is_default_billing": True},
        headers=auth_headers(token),
    )
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]
    assert first.json()["is_default_shipping"] is True
    assert first.json()["is_default_billing"] is True

    second = client.post(
        "/api/v1/me/addresses",
        json={**base, "label": "Work", "line1": "456 Work", "postal_code": "010204", "is_default_shipping": True},
        headers=auth_headers(token),
    )
    assert second.status_code == 201, second.text
    second_id = second.json()["id"]
    assert second.json()["is_default_shipping"] is True

    listed = client.get("/api/v1/me/addresses", headers=auth_headers(token))
    assert listed.status_code == 200, listed.text
    by_id = {addr["id"]: addr for addr in listed.json()}
    assert by_id[first_id]["is_default_shipping"] is False
    assert by_id[first_id]["is_default_billing"] is True
    assert by_id[second_id]["is_default_shipping"] is True
    assert by_id[second_id]["is_default_billing"] is False

    third = client.post(
        "/api/v1/me/addresses",
        json={**base, "label": "Alt", "line1": "789 Alt", "postal_code": "010205", "is_default_billing": True},
        headers=auth_headers(token),
    )
    assert third.status_code == 201, third.text
    third_id = third.json()["id"]
    assert third.json()["is_default_billing"] is True

    listed_again = client.get("/api/v1/me/addresses", headers=auth_headers(token))
    assert listed_again.status_code == 200
    by_id2 = {addr["id"]: addr for addr in listed_again.json()}
    assert by_id2[third_id]["is_default_billing"] is True
    assert by_id2[first_id]["is_default_billing"] is False
