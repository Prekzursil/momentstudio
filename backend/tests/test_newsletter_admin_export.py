import asyncio
import csv
from datetime import datetime, timezone
from io import StringIO
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.newsletter import NewsletterSubscriber
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole


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


async def seed_owner(session_factory) -> None:
    settings.maintenance_mode = False
    async with session_factory() as session:
        owner = User(
            email="owner@example.com",
            username="owner",
            hashed_password=security.hash_password("Password123"),
            name="Owner",
            role=UserRole.owner,
        )
        session.add(owner)
        await session.flush()
        session.add(
            UserPasskey(
                user_id=owner.id,
                name="Test Passkey",
                credential_id=f"cred-{owner.id}",
                public_key=b"test",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()


async def seed_subscribers(session_factory) -> None:
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        session.add_all(
            [
                NewsletterSubscriber(
                    email="confirmed@example.com",
                    source="test",
                    subscribed_at=now,
                    confirmed_at=now,
                    unsubscribed_at=None,
                ),
                NewsletterSubscriber(
                    email="unconfirmed@example.com",
                    source="test",
                    subscribed_at=now,
                    confirmed_at=None,
                    unsubscribed_at=None,
                ),
                NewsletterSubscriber(
                    email="unsubscribed@example.com",
                    source="test",
                    subscribed_at=now,
                    confirmed_at=now,
                    unsubscribed_at=now,
                ),
            ]
        )
        await session.commit()


def auth_headers(client: TestClient, session_factory) -> dict[str, str]:
    asyncio.run(seed_owner(session_factory))
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "Password123"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_export_only_includes_confirmed_opted_in_subscribers(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]
    asyncio.run(seed_subscribers(session_factory))

    resp = client.get("/api/v1/newsletter/admin/export", headers=auth_headers(client, session_factory))
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type", "").startswith("text/csv")

    reader = csv.DictReader(StringIO(resp.text))
    rows = list(reader)
    assert {row.get("email") for row in rows} == {"confirmed@example.com"}
