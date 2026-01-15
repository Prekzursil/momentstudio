import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.schemas.shipping import LockerProvider, LockerRead
from app.services import lockers as lockers_service


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


def test_shipping_lockers_endpoint_uses_service(test_app: Dict[str, object], monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    async def fake_list_lockers(**_kwargs):  # type: ignore[no-untyped-def]
        return [
            LockerRead(
                id="osm:node:1",
                provider=LockerProvider.sameday,
                name="Locker 1",
                address="Somewhere",
                lat=44.4,
                lng=26.1,
                distance_km=0.5,
            )
        ]

    monkeypatch.setattr(lockers_service, "list_lockers", fake_list_lockers)
    monkeypatch.setattr(lockers_service, "_reset_cache_for_tests", lambda: None)

    resp = client.get("/api/v1/shipping/lockers?provider=sameday&lat=44.4&lng=26.1")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body[0]["id"] == "osm:node:1"
    assert body[0]["provider"] == "sameday"

