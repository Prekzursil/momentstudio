import asyncio
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.webhook import StripeWebhookEvent  # noqa: F401


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
