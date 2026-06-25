"""Lean-gate coverage for ``app.api.v1.newsletter`` endpoints."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import newsletter as newsletter_api
from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.newsletter import NewsletterSubscriber
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.services import email as email_service
from app.services import newsletter_tokens


@pytest.fixture
def newsletter_app(monkeypatch) -> Dict[str, object]:
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

    # Captcha disabled by default -> verify() is a no-op; ensure that here.
    monkeypatch.setattr(
        newsletter_api.settings, "captcha_enabled", False, raising=False
    )

    sent: list[tuple] = []

    async def fake_send(email, *, confirm_url):  # noqa: ANN001
        sent.append((email, confirm_url))

    monkeypatch.setattr(email_service, "send_newsletter_confirmation", fake_send)
    newsletter_api.newsletter_subscribe_rate_limit.buckets.clear()

    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal, "sent": sent}
    client.close()
    app.dependency_overrides.clear()
    newsletter_api.newsletter_subscribe_rate_limit.buckets.clear()


def _run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- #
# subscribe                                                                    #
# --------------------------------------------------------------------------- #
def test_subscribe_new_smtp_disabled(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", False, raising=False)
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe",
        json={"email": "New@Example.com", "source": "footer"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["subscribed"] is True
    assert body["already_subscribed"] is False
    assert newsletter_app["sent"] == []


def test_subscribe_new_smtp_enabled_sends(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", True, raising=False)
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe", json={"email": "send@example.com"}
    )
    assert res.status_code == 200, res.text
    assert len(newsletter_app["sent"]) == 1


def test_subscribe_existing_pending_resends(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", True, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="pending@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                    confirmed_at=None,
                    confirmation_sent_at=None,
                )
            )
            await session.commit()

    _run(seed())
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe",
        json={"email": "pending@example.com", "source": "x"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["already_subscribed"] is True
    assert len(newsletter_app["sent"]) == 1


def test_subscribe_existing_pending_cooldown_skips_send(
    newsletter_app, monkeypatch
) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", True, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    # SQLite drops tzinfo on read, so to exercise the cooldown subtraction we
    # store a naive value and pin the endpoint's ``now`` to a naive datetime too.
    recent = datetime(2024, 6, 1, 12, 0, 0)

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="cooldown@example.com",
                    subscribed_at=recent,
                    confirmed_at=None,
                    confirmation_sent_at=recent,
                )
            )
            await session.commit()

    _run(seed())

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001
            # One minute after the seeded send -> still inside the 2-min cooldown.
            return datetime(2024, 6, 1, 12, 1, 0)

    monkeypatch.setattr(newsletter_api, "datetime", _FixedDateTime)
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe", json={"email": "cooldown@example.com"}
    )
    assert res.status_code == 200, res.text
    assert newsletter_app["sent"] == []  # within cooldown -> no resend


def test_subscribe_already_confirmed_no_send(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", True, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="confirmed@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                    confirmed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    _run(seed())
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe", json={"email": "confirmed@example.com"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["already_subscribed"] is True
    assert newsletter_app["sent"] == []


def test_subscribe_already_confirmed_no_source_no_commit(
    newsletter_app, monkeypatch
) -> None:
    # Confirmed subscriber (should_send stays False) with no source -> neither
    # the source assignment nor the commit branch runs (81->83, 83->87).
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", True, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="noupdate@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                    confirmed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    _run(seed())
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    # Explicit empty source -> endpoint normalises to None (source default is
    # "blog", so we must override it to hit the no-source branches).
    res = client.post(
        "/api/v1/newsletter/subscribe",
        json={"email": "noupdate@example.com", "source": ""},
    )
    assert res.status_code == 200, res.text
    assert res.json()["already_subscribed"] is True
    assert newsletter_app["sent"] == []


def test_subscribe_resubscribe_no_source(newsletter_app, monkeypatch) -> None:
    # Resubscribe path with no source -> 104->106 false branch.
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", False, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="nosrc@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                    confirmed_at=None,
                    unsubscribed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    _run(seed())
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe",
        json={"email": "nosrc@example.com", "source": ""},
    )
    assert res.status_code == 200, res.text
    assert res.json()["already_subscribed"] is False


def test_subscribe_resubscribe_after_unsubscribe(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", True, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="back@example.com",
                    subscribed_at=datetime.now(timezone.utc) - timedelta(days=10),
                    confirmed_at=None,
                    unsubscribed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    _run(seed())
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe",
        json={"email": "back@example.com", "source": "re"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["already_subscribed"] is False
    assert len(newsletter_app["sent"]) == 1


def test_subscribe_resubscribe_smtp_off(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_api.settings, "smtp_enabled", False, raising=False)
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="backoff@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                    confirmed_at=None,
                    unsubscribed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    _run(seed())
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/subscribe", json={"email": "backoff@example.com"}
    )
    assert res.status_code == 200, res.text
    assert newsletter_app["sent"] == []


# --------------------------------------------------------------------------- #
# confirm                                                                      #
# --------------------------------------------------------------------------- #
def test_confirm_invalid_token(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_tokens, "decode_newsletter_token", lambda **kw: None)
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/newsletter/confirm", json={"token": "bad-token-xx"})
    assert res.status_code == 400


def test_confirm_existing_subscriber_and_user(newsletter_app, monkeypatch) -> None:
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="conf@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                )
            )
            session.add(
                User(
                    email="conf@example.com",
                    username="conf",
                    hashed_password=security.hash_password("Password123"),
                    notify_marketing=False,
                )
            )
            await session.commit()

    _run(seed())
    monkeypatch.setattr(
        newsletter_tokens, "decode_newsletter_token", lambda **kw: "conf@example.com"
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/newsletter/confirm", json={"token": "ok-token-xxxx"})
    assert res.status_code == 200, res.text
    assert res.json()["confirmed"] is True


def test_confirm_creates_subscriber_when_missing(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(
        newsletter_tokens, "decode_newsletter_token", lambda **kw: "fresh@example.com"
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/newsletter/confirm", json={"token": "ok-token-xxxx"})
    assert res.status_code == 200, res.text
    assert res.json()["confirmed"] is True


# --------------------------------------------------------------------------- #
# unsubscribe                                                                  #
# --------------------------------------------------------------------------- #
def test_unsubscribe_invalid_token(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(newsletter_tokens, "decode_newsletter_token", lambda **kw: None)
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/newsletter/unsubscribe?token=bad")
    assert res.status_code == 400


def test_unsubscribe_get_json(newsletter_app, monkeypatch) -> None:
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]

    async def seed() -> None:
        async with SessionLocal() as session:
            session.add(
                NewsletterSubscriber(
                    email="unsub@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                )
            )
            session.add(
                User(
                    email="unsub@example.com",
                    username="unsub",
                    hashed_password=security.hash_password("Password123"),
                    notify_marketing=True,
                )
            )
            await session.commit()

    _run(seed())
    monkeypatch.setattr(
        newsletter_tokens, "decode_newsletter_token", lambda **kw: "unsub@example.com"
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.get(
        "/api/v1/newsletter/unsubscribe?token=ok",
        headers={"accept": "application/json"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["unsubscribed"] is True


def test_unsubscribe_get_html(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(
        newsletter_tokens, "decode_newsletter_token", lambda **kw: "html@example.com"
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.get(
        "/api/v1/newsletter/unsubscribe?token=ok", headers={"accept": "text/html"}
    )
    assert res.status_code == 200
    assert "Unsubscribed" in res.text


def test_unsubscribe_post_token_query(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(
        newsletter_tokens, "decode_newsletter_token", lambda **kw: "p1@example.com"
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/newsletter/unsubscribe?token=ok")
    assert res.status_code == 200, res.text


def test_unsubscribe_post_json_body(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(
        newsletter_tokens, "decode_newsletter_token", lambda **kw: "p2@example.com"
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/newsletter/unsubscribe", json={"token": "body-token"})
    assert res.status_code == 200, res.text


def test_unsubscribe_post_no_body(newsletter_app, monkeypatch) -> None:
    # No query token, empty/invalid body -> decode("") -> None -> 400.
    monkeypatch.setattr(
        newsletter_tokens,
        "decode_newsletter_token",
        lambda **kw: "e@example.com" if kw.get("token") else None,
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/newsletter/unsubscribe",
        content=b"not json",
        headers={"content-type": "text/plain"},
    )
    assert res.status_code == 400


def test_unsubscribe_post_json_non_string_token(newsletter_app, monkeypatch) -> None:
    monkeypatch.setattr(
        newsletter_tokens,
        "decode_newsletter_token",
        lambda **kw: "e@example.com" if kw.get("token") else None,
    )
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]
    # token present but not a string -> resolved stays empty -> 400
    res = client.post("/api/v1/newsletter/unsubscribe", json={"token": 123})
    assert res.status_code == 400


# --------------------------------------------------------------------------- #
# admin export                                                                 #
# --------------------------------------------------------------------------- #
def test_admin_export_csv(newsletter_app) -> None:
    SessionLocal = newsletter_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = newsletter_app["client"]  # type: ignore[assignment]

    async def seed_admin() -> None:
        async with SessionLocal() as session:
            admin = User(
                email="nladmin@example.com",
                username="nladmin",
                hashed_password=security.hash_password("Password123"),
                name="Admin",
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
            session.add(
                UserPasskey(
                    user_id=admin.id,
                    name="pk",
                    credential_id=f"cred-{admin.id}",
                    public_key=b"k",
                    sign_count=0,
                    backed_up=False,
                )
            )
            session.add(
                NewsletterSubscriber(
                    email="csvrow@example.com",
                    subscribed_at=datetime.now(timezone.utc),
                    confirmed_at=datetime.now(timezone.utc),
                    source="footer",
                )
            )
            await session.commit()

    _run(seed_admin())

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "nladmin@example.com", "password": "Password123"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["tokens"]["access_token"]

    res = client.get(
        "/api/v1/newsletter/admin/export",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert "email,confirmed_at,source" in res.text
    assert "csvrow@example.com" in res.text
