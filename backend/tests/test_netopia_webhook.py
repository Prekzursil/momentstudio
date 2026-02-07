import asyncio
import base64
import hashlib
import json
from decimal import Decimal
from typing import Callable, Dict
from uuid import UUID, uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jose import jwt
from jose.exceptions import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.order import Order, OrderStatus


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


def _make_rsa_keypair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


def _sign_verification_token(*, private_pem: str, pos_signature: str, payload: bytes) -> str:
    payload_hash = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    claims = {
        "iss": "NETOPIA Payments",
        "aud": [pos_signature],
        "sub": payload_hash,
    }
    return jwt.encode(claims, private_pem, algorithm="RS512")


def test_netopia_webhook_rejects_missing_header(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/payments/netopia/webhook", json={"order": {"orderID": "x"}, "payment": {"status": 3}})
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == "Missing Netopia verification token"


def test_netopia_webhook_marks_order_captured(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", True)
    monkeypatch.setattr(settings, "netopia_pos_signature", "SIG-TEST")
    private_pem, public_pem = _make_rsa_keypair()
    monkeypatch.setattr(settings, "netopia_public_key_pem", public_pem)
    monkeypatch.setattr(settings, "netopia_public_key_path", None)
    monkeypatch.setattr(settings, "netopia_jwt_alg", "RS512")

    order_id = uuid4()
    payload_obj = {
        "order": {"orderID": str(order_id)},
        "payment": {"status": 3, "ntpID": "ntp_test_1", "message": "OK"},
    }
    payload = json.dumps(payload_obj, separators=(",", ":"), sort_keys=True).encode("utf-8")
    token = _sign_verification_token(private_pem=private_pem, pos_signature="SIG-TEST", payload=payload)

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory: Callable = test_app["session_factory"]  # type: ignore[assignment]

    async def seed_order() -> None:
        async with session_factory() as session:
            session.add(
                Order(
                    id=order_id,
                    status=OrderStatus.pending_payment,
                    reference_code="NETOPIA1",
                    customer_email="buyer@example.com",
                    customer_name="Buyer",
                    total_amount=Decimal("10.00"),
                    tax_amount=Decimal("0.00"),
                    shipping_amount=Decimal("0.00"),
                    currency="RON",
                    payment_method="netopia",
                )
            )
            await session.commit()

    asyncio.run(seed_order())

    res = client.post(
        "/api/v1/payments/netopia/webhook",
        content=payload,
        headers={"Verification-token": token, "Content-Type": "application/json"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["errorType"] == 0

    async def fetch() -> tuple[OrderStatus, bool, str | None]:
        async with session_factory() as session:
            order = (
                (
                    await session.execute(
                        select(Order)
                        .options(selectinload(Order.events))
                        .where(Order.id == UUID(str(order_id)))
                    )
                )
                .scalars()
                .one()
            )
            captured = any(evt.event == "payment_captured" for evt in (order.events or []))
            last_note = next((evt.note for evt in reversed(order.events or []) if evt.event == "payment_captured"), None)
            return order.status, captured, last_note

    status_val, captured, note = asyncio.run(fetch())
    assert status_val == OrderStatus.pending_acceptance
    assert captured is True
    assert note and "Netopia" in note


def test_netopia_webhook_uses_env_specific_keys(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", True)
    monkeypatch.setattr(settings, "netopia_env", "live")
    monkeypatch.setattr(settings, "netopia_pos_signature_live", "SIG-LIVE")
    monkeypatch.setattr(settings, "netopia_pos_signature", "SIG-LEGACY")

    private_live, public_live = _make_rsa_keypair()
    _, public_legacy = _make_rsa_keypair()
    monkeypatch.setattr(settings, "netopia_public_key_pem_live", public_live)
    monkeypatch.setattr(settings, "netopia_public_key_pem", public_legacy)
    monkeypatch.setattr(settings, "netopia_public_key_path", None)
    monkeypatch.setattr(settings, "netopia_public_key_path_live", None)
    monkeypatch.setattr(settings, "netopia_jwt_alg", "RS512")

    order_id = uuid4()
    payload_obj = {
        "order": {"orderID": str(order_id)},
        "payment": {"status": 3, "ntpID": "ntp_live_1", "message": "OK"},
    }
    payload = json.dumps(payload_obj, separators=(",", ":"), sort_keys=True).encode("utf-8")
    token = _sign_verification_token(private_pem=private_live, pos_signature="SIG-LIVE", payload=payload)

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory: Callable = test_app["session_factory"]  # type: ignore[assignment]

    async def seed_order() -> None:
        async with session_factory() as session:
            session.add(
                Order(
                    id=order_id,
                    status=OrderStatus.pending_payment,
                    reference_code="NETOPIA_LIVE_1",
                    customer_email="buyer@example.com",
                    customer_name="Buyer",
                    total_amount=Decimal("10.00"),
                    tax_amount=Decimal("0.00"),
                    shipping_amount=Decimal("0.00"),
                    currency="RON",
                    payment_method="netopia",
                )
            )
            await session.commit()

    asyncio.run(seed_order())

    res = client.post(
        "/api/v1/payments/netopia/webhook",
        content=payload,
        headers={"Verification-token": token, "Content-Type": "application/json"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["errorType"] == 0

    # Sanity check: the legacy keypair would not validate the token we signed above.
    with pytest.raises(JWTError):
        jwt.decode(token, public_legacy, algorithms=["RS512"], options={"verify_aud": False})


def test_netopia_webhook_rejects_payload_hash_mismatch(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", True)
    monkeypatch.setattr(settings, "netopia_pos_signature", "SIG-TEST")
    private_pem, public_pem = _make_rsa_keypair()
    monkeypatch.setattr(settings, "netopia_public_key_pem", public_pem)
    monkeypatch.setattr(settings, "netopia_public_key_path", None)
    monkeypatch.setattr(settings, "netopia_jwt_alg", "RS512")

    payload_obj = {"order": {"orderID": "x"}, "payment": {"status": 3}}
    payload = json.dumps(payload_obj, separators=(",", ":"), sort_keys=True).encode("utf-8")
    token = _sign_verification_token(private_pem=private_pem, pos_signature="SIG-TEST", payload=payload)

    tampered = payload.replace(b"3", b"5")

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.post(
        "/api/v1/payments/netopia/webhook",
        content=tampered,
        headers={"Verification-token": token, "Content-Type": "application/json"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == "Netopia payload hash mismatch"
