import asyncio
from datetime import datetime, timedelta, timezone
import uuid
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user


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


def create_admin_token(session_factory) -> str:
    async def _create() -> str:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(email="admin-ops@example.com", password="pass123", name="Admin", username="admin_ops"),
            )
            user.email_verified = True
            user.role = UserRole.admin
            await session.commit()
            await session.refresh(user)
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_create())


def test_ops_banners_and_shipping_simulation(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    token = create_admin_token(SessionLocal)

    empty = client.get("/api/v1/ops/banner")
    assert empty.status_code == 204, empty.text

    now = datetime.now(timezone.utc)
    created = client.post(
        "/api/v1/ops/admin/banners",
        headers=auth_headers(token),
        json={
            "is_active": True,
            "level": "info",
            "message_en": "Planned downtime",
            "message_ro": "Mentenanță planificată",
            "starts_at": (now - timedelta(minutes=1)).isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    banner_id = created.json()["id"]

    listed = client.get("/api/v1/ops/admin/banners", headers=auth_headers(token))
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == banner_id for row in listed.json())

    active = client.get("/api/v1/ops/banner")
    assert active.status_code == 200, active.text
    assert active.json()["message_en"] == "Planned downtime"

    simulated = client.post(
        "/api/v1/ops/admin/shipping-simulate",
        headers=auth_headers(token),
        json={"subtotal_ron": "100.00", "discount_ron": "0.00"},
    )
    assert simulated.status_code == 200, simulated.text
    data = simulated.json()
    assert "total_ron" in data

    deleted = client.delete(f"/api/v1/ops/admin/banners/{uuid.UUID(banner_id)}", headers=auth_headers(token))
    assert deleted.status_code == 204, deleted.text
