"""Lean-gate unit coverage for ``app.api.v1.shipping``.

Drives both locker endpoints through a TestClient with an overridden DB
session, monkeypatching the locker/sameday services to cover the success,
not-configured (503), generic-failure (502) and non-sameday-provider branches.
"""

from __future__ import annotations

import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import shipping as shipping_api
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.services import lockers as lockers_service


@pytest.fixture
def client() -> Dict[str, object]:
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
    yield {"client": c}
    c.close()
    app.dependency_overrides.clear()


def test_list_lockers_success(client, monkeypatch) -> None:
    async def _list(**kwargs):
        return []

    monkeypatch.setattr(lockers_service, "list_lockers", _list)
    res = client["client"].get(
        "/api/v1/shipping/lockers",
        params={"provider": "sameday", "lat": 44.4, "lng": 26.1},
    )
    assert res.status_code == 200
    assert res.json() == []


def test_list_lockers_not_configured(client, monkeypatch) -> None:
    async def _list(**kwargs):
        raise lockers_service.LockersNotConfiguredError("no config")

    monkeypatch.setattr(lockers_service, "list_lockers", _list)
    res = client["client"].get(
        "/api/v1/shipping/lockers",
        params={"provider": "sameday", "lat": 44.4, "lng": 26.1},
    )
    assert res.status_code == 503


def test_list_lockers_generic_failure(client, monkeypatch) -> None:
    async def _list(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(lockers_service, "list_lockers", _list)
    res = client["client"].get(
        "/api/v1/shipping/lockers",
        params={"provider": "sameday", "lat": 44.4, "lng": 26.1},
    )
    assert res.status_code == 502


def test_list_cities_non_sameday_provider(client) -> None:
    res = client["client"].get(
        "/api/v1/shipping/lockers/cities", params={"provider": "fan_courier"}
    )
    # fan_courier is not the sameday provider branch -> empty result.
    assert res.status_code == 200
    assert res.json()["items"] == []


def test_list_cities_success(client, monkeypatch) -> None:
    async def _cities(session, *, q, limit):
        return []

    async def _snapshot(session):
        return None

    monkeypatch.setattr(
        shipping_api.sameday_easybox_mirror, "list_city_suggestions", _cities
    )
    monkeypatch.setattr(
        shipping_api.sameday_easybox_mirror, "get_snapshot_status", _snapshot
    )
    res = client["client"].get(
        "/api/v1/shipping/lockers/cities", params={"provider": "sameday", "q": "buc"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["items"] == []


def test_list_cities_failure(client, monkeypatch) -> None:
    async def _boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(
        shipping_api.sameday_easybox_mirror, "list_city_suggestions", _boom
    )
    res = client["client"].get(
        "/api/v1/shipping/lockers/cities", params={"provider": "sameday", "q": "buc"}
    )
    assert res.status_code == 502
