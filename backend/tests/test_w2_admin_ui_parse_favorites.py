"""Unit + API coverage for ``app.api.v1.admin_ui`` branches not exercised by
``test_admin_ui_favorites_api`` (the ``_parse_favorites`` filtering/dedupe paths
and the 50-item PUT cap).

Disjoint from the favorites-API integration test: this module targets the pure
helper directly and the upper-bound truncation branch.
"""

import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import admin_ui
from app.api.v1.admin_ui import _parse_favorites
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.schemas.admin_ui import AdminFavoriteItem


def _valid_entry(key: str = "page:/admin/orders") -> dict:
    return {
        "key": key,
        "type": "page",
        "label": "Orders",
        "subtitle": "",
        "url": "/admin/orders",
        "state": None,
    }


def test_parse_favorites_returns_empty_for_non_list() -> None:
    # Covers the ``not isinstance(raw, list)`` early return.
    assert _parse_favorites(None) == []
    assert _parse_favorites({"items": 1}) == []
    assert _parse_favorites("nope") == []


def test_parse_favorites_skips_non_dict_entries() -> None:
    # Covers the ``not isinstance(entry, dict): continue`` branch.
    result = _parse_favorites(["string", 42, None, _valid_entry()])
    assert [item.key for item in result] == ["page:/admin/orders"]


def test_parse_favorites_skips_invalid_dict_entries() -> None:
    # Covers the validation ``except Exception: continue`` branch (missing
    # required fields make ``model_validate`` raise).
    result = _parse_favorites([{"key": "x"}, _valid_entry()])
    assert [item.key for item in result] == ["page:/admin/orders"]


def test_parse_favorites_dedupes_repeated_keys() -> None:
    # Covers the ``if item.key in seen: continue`` dedupe branch.
    dup = _valid_entry()
    other = _valid_entry(key="product:abc")
    other["type"] = "product"
    result = _parse_favorites([dup, dict(dup), other])
    assert [item.key for item in result] == ["page:/admin/orders", "product:abc"]


def test_parse_favorites_truncates_to_fifty() -> None:
    # Covers the ``return unique[:50]`` cap on the parse side.
    entries = [_valid_entry(key=f"page:/p{i}") for i in range(60)]
    result = _parse_favorites(entries)
    assert len(result) == 50
    assert all(isinstance(item, AdminFavoriteItem) for item in result)


@pytest.fixture(scope="module")
def cap_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": session_factory}
    client.close()
    app.dependency_overrides.clear()


async def _seed_admin(session_factory, email: str) -> None:
    settings.maintenance_mode = False
    async with session_factory() as session:
        await session.execute(delete(User).where(User.email == email))
        user = User(
            email=email,
            username=email.split("@")[0],
            hashed_password=security.hash_password("Password123"),
            name=email.split("@")[0],
            role=UserRole.admin,
        )
        session.add(user)
        await session.flush()
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


def _admin_headers(client: TestClient, session_factory, email: str) -> dict:
    asyncio.run(_seed_admin(session_factory, email))
    bypass = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Password123"},
        headers=bypass,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}", **bypass}


def test_update_favorites_caps_at_fifty(cap_app) -> None:
    # Covers the ``if len(items) >= 50: break`` cap inside the PUT handler:
    # the schema allows at most 50 items, so exactly 50 unique keys triggers
    # the break after the final append.
    client: TestClient = cap_app["client"]  # type: ignore[assignment]
    headers = _admin_headers(
        client, cap_app["session_factory"], "w2-cap-admin@example.com"
    )
    payload = {"items": [_valid_entry(key=f"page:/p{i}") for i in range(50)]}
    resp = client.put("/api/v1/admin/ui/favorites", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["items"]) == 50


def test_module_router_prefix_is_admin_ui() -> None:
    # Sanity anchor so the import of the module participates in coverage even if
    # the API fixtures are skipped in a constrained environment.
    assert admin_ui.router.prefix == "/admin/ui"
