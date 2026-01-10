import asyncio
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import User, UserRole
from app.models.webhook import StripeWebhookEvent  # noqa: F401
from app.services import email as email_service


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


def test_webhook_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")

    def fake_construct_event(payload, sig_header, secret):
        raise Exception("bad signature")

    monkeypatch.setattr("app.services.payments.stripe.Webhook.construct_event", fake_construct_event)

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/payments/webhook",
        content=b"{}",
        headers={"Stripe-Signature": "bad"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == "Invalid payload"


def test_webhook_idempotency(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(
        "app.services.payments.stripe.Webhook.construct_event",
        lambda payload, sig_header, secret: {"id": "evt_123", "type": "payment_intent.succeeded"},
    )

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res1 = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert res1.status_code == 200, res1.text

    res2 = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert res2.status_code == 200, res2.text

    async def count() -> int:
        async with session_factory() as session:
            result = await session.execute(select(StripeWebhookEvent))
            return len(result.scalars().all())

    assert asyncio.run(count()) == 1


def test_webhook_dispute_notifies_owner_once(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(settings, "admin_alert_email", None)

    dispute_event = {
        "id": "evt_dispute_1",
        "type": "charge.dispute.created",
        "data": {
            "object": {
                "id": "dp_123",
                "charge": "ch_123",
                "amount": 12345,
                "currency": "ron",
                "reason": "fraudulent",
                "status": "needs_response",
            }
        },
    }

    monkeypatch.setattr(
        "app.services.payments.stripe.Webhook.construct_event",
        lambda payload, sig_header, secret: dispute_event,
    )

    sent: dict[str, object] = {"count": 0, "to": None, "event_type": None}

    async def fake_send_stripe_dispute_notification(
        to_email: str,
        *,
        event_type: str,
        dispute_id: str | None = None,
        charge_id: str | None = None,
        amount: int | None = None,
        currency: str | None = None,
        reason: str | None = None,
        dispute_status: str | None = None,
        lang: str | None = None,
    ) -> bool:
        sent["count"] = int(sent["count"]) + 1
        sent["to"] = to_email
        sent["event_type"] = event_type
        return True

    monkeypatch.setattr(email_service, "send_stripe_dispute_notification", fake_send_stripe_dispute_notification)

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]

    async def seed_owner() -> None:
        async with session_factory() as session:
            user = User(
                email="owner@example.com",
                username="owner",
                hashed_password=security.hash_password("Password123"),
                name="Owner",
                role=UserRole.owner,
                email_verified=True,
                preferred_language="en",
            )
            session.add(user)
            await session.commit()

    asyncio.run(seed_owner())

    res1 = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert res1.status_code == 200, res1.text
    res2 = client.post("/api/v1/payments/webhook", content=b"{}", headers={"Stripe-Signature": "t"})
    assert res2.status_code == 200, res2.text

    assert sent["count"] == 1
    assert sent["to"] == "owner@example.com"
    assert sent["event_type"] == "charge.dispute.created"
