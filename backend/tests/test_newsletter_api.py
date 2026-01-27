import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app


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


def test_newsletter_subscribe_idempotent(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    first = client.post("/api/v1/newsletter/subscribe", json={"email": "test@example.com"})
    assert first.status_code == 200, first.text
    assert first.json()["subscribed"] is True
    assert first.json()["already_subscribed"] is False

    again = client.post("/api/v1/newsletter/subscribe", json={"email": "test@example.com"})
    assert again.status_code == 200, again.text
    assert again.json()["subscribed"] is True
    assert again.json()["already_subscribed"] is True

