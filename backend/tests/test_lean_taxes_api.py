"""Lean-gate unit coverage for ``app.api.v1.taxes`` admin endpoints.

Authenticates a real admin (with a passkey to satisfy the admin-MFA gate) and
drives the full tax-group / tax-rate admin surface: list, create, update
(found + 404), delete (found + 404), rate upsert (found + 404) and rate delete.
"""

from __future__ import annotations

import asyncio
from typing import Dict
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole


@pytest.fixture
def ctx() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    async def _override():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = _override
    c = TestClient(app)
    yield {"client": c, "factory": SessionLocal}
    c.close()
    app.dependency_overrides.clear()


def _admin_headers(ctx) -> dict:
    settings.maintenance_mode = False

    async def _seed() -> None:
        async with ctx["factory"]() as session:
            await session.execute(delete(User).where(User.email == "tax@example.com"))
            admin = User(
                email="tax@example.com",
                username="taxadmin",
                hashed_password=security.hash_password("Password123"),
                name="Tax Admin",
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
            session.add(
                UserPasskey(
                    user_id=admin.id,
                    name="Test Passkey",
                    credential_id=f"cred-{admin.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()

    asyncio.run(_seed())
    common = {"X-Maintenance-Bypass": settings.maintenance_bypass_token}
    resp = ctx["client"].post(
        "/api/v1/auth/login",
        json={"email": "tax@example.com", "password": "Password123"},
        headers=common,
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Maintenance-Bypass": settings.maintenance_bypass_token,
    }
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def test_tax_admin_full_flow(ctx) -> None:
    client = ctx["client"]
    headers = _admin_headers(ctx)

    # Empty list initially.
    res = client.get("/api/v1/taxes/admin/groups", headers=headers)
    assert res.status_code == 200
    assert res.json() == []

    # Create a group.
    res = client.post(
        "/api/v1/taxes/admin/groups",
        headers=headers,
        json={"code": "Standard", "name": "Standard", "is_default": True},
    )
    assert res.status_code == 201, res.text
    group_id = res.json()["id"]

    # Update the group.
    res = client.patch(
        f"/api/v1/taxes/admin/groups/{group_id}",
        headers=headers,
        json={"name": "Standard Rate"},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Standard Rate"

    # Update a missing group -> 404.
    res = client.patch(
        f"/api/v1/taxes/admin/groups/{uuid4()}",
        headers=headers,
        json={"name": "x"},
    )
    assert res.status_code == 404

    # Upsert a rate.
    res = client.put(
        f"/api/v1/taxes/admin/groups/{group_id}/rates",
        headers=headers,
        json={"country_code": "RO", "vat_rate_percent": "19"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["country_code"] == "RO"

    # Upsert a rate for a missing group -> 404.
    res = client.put(
        f"/api/v1/taxes/admin/groups/{uuid4()}/rates",
        headers=headers,
        json={"country_code": "RO", "vat_rate_percent": "19"},
    )
    assert res.status_code == 404

    # Delete the rate.
    res = client.delete(
        f"/api/v1/taxes/admin/groups/{group_id}/rates/RO", headers=headers
    )
    assert res.status_code == 204

    # Cannot delete the default group -> 400 from the service.
    res = client.delete(f"/api/v1/taxes/admin/groups/{group_id}", headers=headers)
    assert res.status_code == 400

    # Delete a missing group -> 404.
    res = client.delete(f"/api/v1/taxes/admin/groups/{uuid4()}", headers=headers)
    assert res.status_code == 404

    # Make the group non-default then delete it (204).
    res = client.patch(
        f"/api/v1/taxes/admin/groups/{group_id}",
        headers=headers,
        json={"is_default": False},
    )
    assert res.status_code == 200
    res = client.delete(f"/api/v1/taxes/admin/groups/{group_id}", headers=headers)
    assert res.status_code == 204
