"""Lean-gate unit coverage for ``app.api.v1.support`` endpoint gaps.

Disjoint from ``test_support_api``; targets the customer ticket endpoints
(list/create/get/reply incl. 404s and feedback rejection), the admin
submission detail/update/reply (incl. anonymous email branch and PII reveal),
the SLA settings get/update, canned-response admin CRUD and the assignees list.
"""

from __future__ import annotations

import asyncio
from datetime import date
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
from app.models.support import (
    ContactSubmission,
    ContactSubmissionStatus,
    ContactSubmissionTopic,
)
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services import pii as pii_service
from app.services.auth import create_user, issue_tokens_for_user


def test_submission_to_ticket_without_thread() -> None:
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from app.api.v1.support import _submission_to_ticket

    sub = SimpleNamespace(
        id=uuid4(),
        topic=ContactSubmissionTopic.contact,
        status=ContactSubmissionStatus.new,
        name="N",
        email="n@e.com",
        order_reference=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        resolved_at=None,
        message="hi",
        messages=[],
    )
    # include_thread=False is never used by the API endpoints; cover it directly.
    ticket = _submission_to_ticket(sub, include_thread=False)
    assert ticket.messages == []


def test_parse_sla_hours_branches() -> None:
    from app.api.v1.support import _parse_sla_hours

    assert _parse_sla_hours(10, fallback=24) == 10
    assert _parse_sla_hours(None, fallback=24) == 24
    # Non-int-convertible -> fallback (exception branch).
    assert _parse_sla_hours("not-a-number", fallback=24) == 24
    # Clamped to [1, 720].
    assert _parse_sla_hours(0, fallback=24) == 1
    assert _parse_sla_hours(9999, fallback=24) == 720


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


def _customer_token(factory) -> str:
    async def _seed() -> str:
        async with factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="cust@example.com", password="custpass123", name="Cust"
                ),
            )
            user.first_name = "Cust"
            user.last_name = "Omer"
            user.username = "custuser"
            user.phone = "+40700000001"
            user.date_of_birth = date(1990, 1, 1)
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_seed())


def _admin_headers(ctx) -> dict:
    settings.maintenance_mode = False

    async def _seed() -> None:
        async with ctx["factory"]() as session:
            await session.execute(
                delete(User).where(User.email == "supadmin@example.com")
            )
            admin = User(
                email="supadmin@example.com",
                username="supadmin",
                hashed_password=security.hash_password("Password123"),
                name="Support Admin",
                role=UserRole.owner,
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
        json={"email": "supadmin@example.com", "password": "Password123"},
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


def test_public_contact_endpoint(ctx, monkeypatch) -> None:
    client = ctx["client"]
    # Ensure an admin alert recipient so the notification background task fires.
    monkeypatch.setattr(
        settings, "admin_alert_email", "alerts@example.com", raising=False
    )

    # Feedback topic rejected on the public endpoint too.
    res = client.post(
        "/api/v1/support/contact",
        json={
            "topic": "feedback",
            "name": "Anon",
            "email": "anon@example.com",
            "message": "feedback text here",
        },
    )
    assert res.status_code == 400

    res = client.post(
        "/api/v1/support/contact",
        json={
            "topic": "contact",
            "name": "Anon",
            "email": "anon@example.com",
            "message": "I need assistance with my order",
        },
    )
    assert res.status_code == 201, res.text


def test_admin_feedback_and_pii_list(ctx, monkeypatch) -> None:
    client = ctx["client"]
    headers = _admin_headers(ctx)

    # Admin feedback submission.
    res = client.post(
        "/api/v1/support/admin/feedback",
        headers=headers,
        json={"message": "internal feedback note", "context": "dashboard"},
    )
    assert res.status_code in (200, 201), res.text

    # Admin list with include_pii reveal.
    monkeypatch.setattr(
        pii_service, "require_pii_reveal", lambda admin, *, request: None
    )
    res = client.get(
        "/api/v1/support/admin/submissions?include_pii=true", headers=headers
    )
    assert res.status_code == 200


def test_admin_canned_response_404s(ctx) -> None:
    client = ctx["client"]
    headers = _admin_headers(ctx)

    res = client.patch(
        f"/api/v1/support/admin/canned-responses/{uuid4()}",
        headers=headers,
        json={"title": "x"},
    )
    assert res.status_code == 404

    res = client.delete(
        f"/api/v1/support/admin/canned-responses/{uuid4()}", headers=headers
    )
    assert res.status_code == 404


def test_customer_ticket_endpoints(ctx) -> None:
    client = ctx["client"]
    token = _customer_token(ctx["factory"])
    h = {"Authorization": f"Bearer {token}"}

    # Empty list.
    res = client.get("/api/v1/support/me/submissions", headers=h)
    assert res.status_code == 200
    assert res.json() == []

    # Feedback topic rejected for customer tickets.
    res = client.post(
        "/api/v1/support/me/submissions",
        headers=h,
        json={"topic": "feedback", "message": "hi there friend"},
    )
    assert res.status_code == 400

    # Create a contact ticket.
    res = client.post(
        "/api/v1/support/me/submissions",
        headers=h,
        json={"topic": "contact", "message": "please help me out"},
    )
    assert res.status_code == 201, res.text
    ticket_id = res.json()["id"]

    # Get own ticket.
    res = client.get(f"/api/v1/support/me/submissions/{ticket_id}", headers=h)
    assert res.status_code == 200

    # Get a missing ticket -> 404.
    res = client.get(f"/api/v1/support/me/submissions/{uuid4()}", headers=h)
    assert res.status_code == 404

    # Reply to own ticket.
    res = client.post(
        f"/api/v1/support/me/submissions/{ticket_id}/messages",
        headers=h,
        json={"message": "any update?"},
    )
    assert res.status_code == 200

    # Reply to a missing ticket -> 404.
    res = client.post(
        f"/api/v1/support/me/submissions/{uuid4()}/messages",
        headers=h,
        json={"message": "x"},
    )
    assert res.status_code == 404


def test_admin_submission_detail_update_reply(ctx, monkeypatch) -> None:
    client = ctx["client"]
    headers = _admin_headers(ctx)

    # Seed an anonymous submission directly.
    async def _seed() -> str:
        async with ctx["factory"]() as session:
            sub = ContactSubmission(
                topic=ContactSubmissionTopic.contact,
                status=ContactSubmissionStatus.new,
                name="Anon",
                email="anon@example.com",
                message="hello",
            )
            session.add(sub)
            await session.commit()
            await session.refresh(sub)
            return str(sub.id)

    sub_id = asyncio.run(_seed())

    # Detail without PII (masked).
    res = client.get(f"/api/v1/support/admin/submissions/{sub_id}", headers=headers)
    assert res.status_code == 200

    # Detail with PII reveal (monkeypatch require_pii_reveal to allow).
    monkeypatch.setattr(
        pii_service, "require_pii_reveal", lambda admin, *, request: None
    )
    res = client.get(
        f"/api/v1/support/admin/submissions/{sub_id}?include_pii=true",
        headers=headers,
    )
    assert res.status_code == 200

    # Detail of a missing submission -> 404.
    res = client.get(f"/api/v1/support/admin/submissions/{uuid4()}", headers=headers)
    assert res.status_code == 404

    # Update status with PII reveal (covers the include_pii update branch).
    res = client.patch(
        f"/api/v1/support/admin/submissions/{sub_id}?include_pii=true",
        headers=headers,
        json={"status": "triaged"},
    )
    assert res.status_code == 200

    # Update a missing submission -> 404.
    res = client.patch(
        f"/api/v1/support/admin/submissions/{uuid4()}",
        headers=headers,
        json={"status": "triaged"},
    )
    assert res.status_code == 404

    # Admin reply to the anonymous submission with PII reveal (triggers the
    # include_pii branch + the email background task for user-less submissions).
    res = client.post(
        f"/api/v1/support/admin/submissions/{sub_id}/messages?include_pii=true",
        headers=headers,
        json={"message": "thanks for reaching out"},
    )
    assert res.status_code == 200

    # Admin reply to a missing submission -> 404.
    res = client.post(
        f"/api/v1/support/admin/submissions/{uuid4()}/messages",
        headers=headers,
        json={"message": "x"},
    )
    assert res.status_code == 404


def test_admin_assignees_and_sla_and_canned(ctx) -> None:
    client = ctx["client"]
    headers = _admin_headers(ctx)

    # Assignees list (includes the seeded owner).
    res = client.get("/api/v1/support/admin/assignees", headers=headers)
    assert res.status_code == 200
    assert any(a["username"] == "supadmin" for a in res.json())

    # SLA settings: default get, then update, then get reflects update.
    res = client.get("/api/v1/support/admin/sla-settings", headers=headers)
    assert res.status_code == 200
    assert res.json()["first_reply_hours"] == 24

    res = client.patch(
        "/api/v1/support/admin/sla-settings",
        headers=headers,
        json={"first_reply_hours": 12, "resolution_hours": 48},
    )
    assert res.status_code == 200
    assert res.json()["first_reply_hours"] == 12

    res = client.get("/api/v1/support/admin/sla-settings", headers=headers)
    assert res.json()["resolution_hours"] == 48

    # Canned responses: empty, create, list, update, delete.
    res = client.get("/api/v1/support/admin/canned-responses", headers=headers)
    assert res.status_code == 200

    res = client.post(
        "/api/v1/support/admin/canned-responses",
        headers=headers,
        json={"title": "Hi", "body_en": "Hello", "body_ro": "Salut"},
    )
    assert res.status_code in (200, 201), res.text
    canned_id = res.json()["id"]

    res = client.patch(
        f"/api/v1/support/admin/canned-responses/{canned_id}",
        headers=headers,
        json={"title": "Hi Updated"},
    )
    assert res.status_code == 200

    res = client.delete(
        f"/api/v1/support/admin/canned-responses/{canned_id}", headers=headers
    )
    assert res.status_code in (200, 204)
