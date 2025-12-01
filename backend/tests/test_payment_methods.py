import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from sqlalchemy import select
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import PaymentMethod
from app.services.auth import create_user, issue_tokens_for_user
from app.schemas.user import UserCreate


@pytest.fixture
def test_app(monkeypatch) -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    # Stub Stripe calls
    settings.stripe_secret_key = "sk_test_dummy"
    monkeypatch.setattr("app.services.payments.stripe.Customer.create", lambda **_: {"id": "cus_test"})
    monkeypatch.setattr(
        "app.services.payments.stripe.SetupIntent.create",
        lambda **_: {"client_secret": "seti_secret", "customer": "cus_test"},
    )

    def fake_attach(payment_method_id, customer):
        return {
            "id": payment_method_id,
            "customer": customer,
            "card": {"brand": "visa", "last4": "4242", "exp_month": 12, "exp_year": 2030},
        }

    monkeypatch.setattr("app.services.payments.stripe.PaymentMethod.attach", fake_attach)
    monkeypatch.setattr("app.services.payments.stripe.PaymentMethod.detach", lambda *args, **kwargs: {})

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
            user = await create_user(session, UserCreate(email="pm@example.com", password="Password123", name="Payer"))
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def test_payment_methods_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_user_token(SessionLocal)

    # setup intent
    setup = client.post("/api/v1/payment-methods/setup-intent", headers=auth_headers(token))
    assert setup.status_code == 200
    body = setup.json()
    assert body["client_secret"] == "seti_secret"
    assert body["customer_id"] == "cus_test"

    # attach
    attach = client.post(
        "/api/v1/payment-methods/attach",
        headers=auth_headers(token),
        json={"payment_method_id": "pm_test"},
    )
    assert attach.status_code == 201, attach.text
    assert attach.json()["stripe_payment_method_id"] == "pm_test"

    # list
    listed = client.get("/api/v1/payment-methods", headers=auth_headers(token))
    assert listed.status_code == 200
    methods = listed.json()
    assert len(methods) == 1
    pm_id = methods[0]["id"]

    # delete
    delete = client.delete(f"/api/v1/payment-methods/{pm_id}", headers=auth_headers(token))
    assert delete.status_code == 204

    # ensure removed in DB
    async def count_methods_simple():
        async with SessionLocal() as session:
            result = await session.execute(select(PaymentMethod))
            return len(result.scalars().all())

    remaining = asyncio.run(count_methods_simple())
    assert remaining == 0
