"""Worker-0 coverage tests for ``app.api.v1.addresses``.

Drives the route handler coroutines directly (so coverage reliably traces every
line, including the ``update_address`` / ``delete_address`` 404 branches that the
existing ``test_addresses.py`` does not reach) and additionally exercises the
full HTTP cycle through ``TestClient``.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Dict

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import addresses as addresses_api
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.schemas.address import AddressCreate, AddressUpdate
from app.schemas.user import UserCreate
from app.services import address as address_service
from app.services.auth import create_user, issue_tokens_for_user


def _make_session_factory() -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())
    return session_local


class _StubUser:
    def __init__(self, user_id) -> None:
        self.id = user_id


_BASE_ADDRESS = {
    "label": "Home",
    "line1": "123 Main",
    "city": "Bucharest",
    "region": "IF",
    "postal_code": "010203",
    "country": "ro",
}


def test_direct_handler_full_cycle() -> None:
    """list -> create -> update -> delete via the route coroutines directly."""
    session_factory = _make_session_factory()
    user_id = uuid.uuid4()
    user = _StubUser(user_id)

    async def _scenario() -> None:
        async with session_factory() as session:
            # list_addresses: empty.
            assert await addresses_api.list_addresses(user, session) == []

            # create_address.
            created = await addresses_api.create_address(
                AddressCreate(**_BASE_ADDRESS), user, session
            )
            assert created.country == "RO"
            assert created.id is not None

            # list_addresses: one row now.
            listed = await addresses_api.list_addresses(user, session)
            assert len(listed) == 1

            # update_address: happy path.
            updated = await addresses_api.update_address(
                created.id,
                AddressUpdate(label="Updated", city="Cluj"),
                user,
                session,
            )
            assert updated.label == "Updated"
            assert updated.city == "Cluj"

            # delete_address: happy path (returns None).
            result = await addresses_api.delete_address(created.id, user, session)
            assert result is None

            # gone afterwards.
            assert await address_service.get_address(
                session, user_id, created.id
            ) is None

    asyncio.run(_scenario())


def test_direct_update_address_not_found() -> None:
    session_factory = _make_session_factory()
    user = _StubUser(uuid.uuid4())

    async def _scenario() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await addresses_api.update_address(
                    uuid.uuid4(), AddressUpdate(label="Nope"), user, session
                )
            assert exc.value.status_code == 404
            assert exc.value.detail == "Address not found"

    asyncio.run(_scenario())


def test_direct_delete_address_not_found() -> None:
    session_factory = _make_session_factory()
    user = _StubUser(uuid.uuid4())

    async def _scenario() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await addresses_api.delete_address(uuid.uuid4(), user, session)
            assert exc.value.status_code == 404
            assert exc.value.detail == "Address not found"

    asyncio.run(_scenario())


# --- Additional end-to-end coverage through the real HTTP stack. ---


@pytest.fixture
def test_app() -> Dict[str, object]:
    session_local = _make_session_factory()

    async def override_get_session():
        async with session_local() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": session_local}
    client.close()
    app.dependency_overrides.clear()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_user_token(session_factory) -> str:
    async def _create_and_token():
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="w0addr@example.com", password="addrpass", name="W0 Addr"
                ),
            )
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_create_and_token())


def test_http_cycle(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    token = _create_user_token(test_app["session_factory"])
    headers = _auth_headers(token)

    created = client.post("/api/v1/me/addresses", json=_BASE_ADDRESS, headers=headers)
    assert created.status_code == 201, created.text
    address_id = created.json()["id"]
    assert created.json()["country"] == "RO"

    listed = client.get("/api/v1/me/addresses", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    updated = client.patch(
        f"/api/v1/me/addresses/{address_id}",
        json={"label": "X"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text

    deleted = client.delete(f"/api/v1/me/addresses/{address_id}", headers=headers)
    assert deleted.status_code == 204

    missing = uuid.uuid4()
    assert (
        client.patch(
            f"/api/v1/me/addresses/{missing}", json={"label": "Y"}, headers=headers
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/v1/me/addresses/{missing}", headers=headers
        ).status_code
        == 404
    )
