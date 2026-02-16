from __future__ import annotations

import asyncio
from datetime import timedelta, timezone, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.dependencies import get_current_user
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.shipping_locker import ShippingLockerMirror, ShippingLockerProvider, ShippingLockerSyncRun, ShippingLockerSyncStatus
from app.models.user import UserRole
from app.schemas.shipping import LockerProvider, LockerRead
from app.services import lockers as lockers_service
from app.services import sameday_easybox_mirror


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def test_ctx():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    _run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()
    _run(engine.dispose())


def test_sameday_mirror_sync_success_upsert_and_deactivate(test_ctx, monkeypatch):
    SessionLocal = test_ctx["session_factory"]

    async def payload_v1():
        return (
            [
                {"lockerId": "A1", "name": "Easybox A1", "address": "Str. A", "city": "Bucuresti", "lat": 44.4, "lng": 26.1},
                {"lockerId": "B2", "name": "Easybox B2", "address": "Str. B", "city": "Bucuresti", "lat": 44.41, "lng": 26.11},
            ],
            "https://sameday.ro/api/easybox/locations",
        )

    async def payload_v2():
        return (
            [
                {"lockerId": "A1", "name": "Easybox A1 Updated", "address": "Str. A nr. 2", "city": "Bucuresti", "lat": 44.4, "lng": 26.1},
            ],
            "https://sameday.ro/api/easybox/locations",
        )

    monkeypatch.setattr(sameday_easybox_mirror, "_fetch_raw_payload", payload_v1)
    async def run_first():
        async with SessionLocal() as session:
            run = await sameday_easybox_mirror.sync_now(session, trigger="test")
            assert run.status == ShippingLockerSyncStatus.success

    _run(run_first())

    monkeypatch.setattr(sameday_easybox_mirror, "_fetch_raw_payload", payload_v2)
    async def run_second():
        async with SessionLocal() as session:
            run = await sameday_easybox_mirror.sync_now(session, trigger="test")
            assert run.status == ShippingLockerSyncStatus.success
            assert run.deactivated_count == 1
            assert run.candidate_count == 1
            assert run.normalized_count == 1
            assert (run.normalization_ratio or 0.0) > 0
            assert run.schema_signature
            rows = (await session.execute(select(ShippingLockerMirror).order_by(ShippingLockerMirror.external_id))).scalars().all()
            assert len(rows) == 2
            assert rows[0].name == "Easybox A1 Updated"
            assert rows[1].is_active is False

    _run(run_second())


def test_sameday_mirror_sync_failure_keeps_previous_snapshot(test_ctx, monkeypatch):
    SessionLocal = test_ctx["session_factory"]

    async def payload_ok():
        return (
            [
                {"lockerId": "A1", "name": "Easybox A1", "address": "Str. A", "city": "Iasi", "lat": 47.16, "lng": 27.58},
            ],
            "https://sameday.ro/api/easybox/locations",
        )

    async def payload_fail():
        raise RuntimeError("Cloudflare challenge")

    monkeypatch.setattr(sameday_easybox_mirror, "_fetch_raw_payload", payload_ok)
    async def run_seed():
        async with SessionLocal() as session:
            await sameday_easybox_mirror.sync_now(session, trigger="test")

    _run(run_seed())

    async def count_active() -> int:
        async with SessionLocal() as session:
            return int(
                (
                    await session.scalar(
                        select(func.count())
                        .select_from(ShippingLockerMirror)
                        .where(
                            ShippingLockerMirror.provider == ShippingLockerProvider.sameday,
                            ShippingLockerMirror.is_active.is_(True),
                        )
                    )
                )
                or 0
            )

    before = _run(count_active())
    monkeypatch.setattr(sameday_easybox_mirror, "_fetch_raw_payload", payload_fail)
    async def run_fail():
        async with SessionLocal() as session:
            run = await sameday_easybox_mirror.sync_now(session, trigger="test")
            assert run.status == ShippingLockerSyncStatus.failed
            assert run.failure_kind == "cloudflare_challenge"
            assert run.challenge_failure is True

    _run(run_fail())
    after = _run(count_active())
    assert before == after == 1


def test_shipping_lockers_uses_mirror_for_sameday(test_ctx, monkeypatch):
    client: TestClient = test_ctx["client"]
    lockers_service._reset_cache_for_tests()
    monkeypatch.setattr(lockers_service.settings, "sameday_mirror_enabled", True)

    async def fake_nearby(_session, *, lat: float, lng: float, radius_km: float, limit: int):
        return [
            LockerRead(
                id="sameday:A1",
                provider=LockerProvider.sameday,
                name="Easybox A1",
                address="Bucuresti",
                lat=lat,
                lng=lng,
                distance_km=0.2,
            )
        ]

    monkeypatch.setattr(sameday_easybox_mirror, "list_nearby_lockers", fake_nearby)
    response = client.get("/api/v1/shipping/lockers?provider=sameday&lat=44.4&lng=26.1&radius_km=10")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body and body[0]["id"] == "sameday:A1"


def test_shipping_lockers_city_autocomplete(test_ctx):
    client: TestClient = test_ctx["client"]
    SessionLocal = test_ctx["session_factory"]

    async def seed():
        async with SessionLocal() as session:
            session.add_all(
                [
                    ShippingLockerMirror(
                        provider=ShippingLockerProvider.sameday,
                        external_id="A1",
                        name="Easybox A1",
                        city="Bucuresti",
                        county="Ilfov",
                        lat=44.42,
                        lng=26.1,
                        is_active=True,
                    ),
                    ShippingLockerMirror(
                        provider=ShippingLockerProvider.sameday,
                        external_id="A2",
                        name="Easybox A2",
                        city="Bucuresti",
                        county="Ilfov",
                        lat=44.43,
                        lng=26.11,
                        is_active=True,
                    ),
                ]
            )
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.success,
                    started_at=datetime.now(timezone.utc),
                    finished_at=datetime.now(timezone.utc),
                    fetched_count=2,
                    upserted_count=2,
                )
            )
            await session.commit()

    _run(seed())
    response = client.get("/api/v1/shipping/lockers/cities?provider=sameday&q=Buc&limit=5")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["items"]
    assert payload["items"][0]["city"] == "Bucuresti"
    assert payload["snapshot"]["total_lockers"] == 2


def test_shipping_lockers_city_snapshot_exposes_canary_alerts(test_ctx):
    client: TestClient = test_ctx["client"]
    SessionLocal = test_ctx["session_factory"]
    now = datetime.now(timezone.utc)

    async def seed():
        async with SessionLocal() as session:
            session.add(
                ShippingLockerMirror(
                    provider=ShippingLockerProvider.sameday,
                    external_id="A1",
                    name="Easybox A1",
                    city="Bucuresti",
                    county="Ilfov",
                    lat=44.42,
                    lng=26.1,
                    is_active=True,
                )
            )
            for idx in range(3):
                session.add(
                    ShippingLockerSyncRun(
                        provider=ShippingLockerProvider.sameday,
                        status=ShippingLockerSyncStatus.failed,
                        started_at=now - timedelta(minutes=idx + 1),
                        finished_at=now - timedelta(minutes=idx + 1),
                        challenge_failure=True,
                        failure_kind="cloudflare_challenge",
                        error_message="Cloudflare challenge",
                    )
                )
            await session.commit()

    _run(seed())
    response = client.get("/api/v1/shipping/lockers/cities?provider=sameday&q=Buc&limit=5")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["snapshot"]["challenge_failure_streak"] == 3
    assert "challenge_failure_streak" in payload["snapshot"]["canary_alert_codes"]


def test_sync_status_stale_after_30_days(test_ctx):
    SessionLocal = test_ctx["session_factory"]
    now = datetime.now(timezone.utc)

    async def seed_old_success():
        async with SessionLocal() as session:
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.success,
                    started_at=now - timedelta(days=31),
                    finished_at=now - timedelta(days=31),
                    fetched_count=1,
                    upserted_count=1,
                )
            )
            await session.commit()

    _run(seed_old_success())

    async def check_status():
        async with SessionLocal() as session:
            status_payload = await sameday_easybox_mirror.get_snapshot_status(session)
            assert status_payload.stale is True
            assert (status_payload.stale_age_seconds or 0) >= 31 * 24 * 3600

    _run(check_status())


def test_sync_status_flags_schema_drift_canary_alert(test_ctx):
    SessionLocal = test_ctx["session_factory"]
    now = datetime.now(timezone.utc)

    async def seed():
        async with SessionLocal() as session:
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.success,
                    started_at=now - timedelta(hours=2),
                    finished_at=now - timedelta(hours=2),
                    fetched_count=100,
                    upserted_count=20,
                    candidate_count=120,
                    normalized_count=100,
                    normalization_ratio=0.83,
                    schema_signature="old-signature",
                    schema_drift_detected=False,
                )
            )
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.success,
                    started_at=now - timedelta(hours=1),
                    finished_at=now - timedelta(hours=1),
                    fetched_count=90,
                    upserted_count=10,
                    candidate_count=120,
                    normalized_count=90,
                    normalization_ratio=0.75,
                    schema_signature="new-signature",
                    schema_drift_detected=True,
                )
            )
            await session.commit()

    _run(seed())

    async def check_status():
        async with SessionLocal() as session:
            status_payload = await sameday_easybox_mirror.get_snapshot_status(session)
            assert status_payload.schema_drift_detected is True
            assert "schema_drift" in status_payload.canary_alert_codes
            assert status_payload.last_schema_drift_at is not None

    _run(check_status())


def test_sync_status_flags_repeated_challenge_failures(test_ctx):
    SessionLocal = test_ctx["session_factory"]
    now = datetime.now(timezone.utc)

    async def seed():
        async with SessionLocal() as session:
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.success,
                    started_at=now - timedelta(days=2),
                    finished_at=now - timedelta(days=2),
                    fetched_count=200,
                    upserted_count=50,
                )
            )
            for idx in range(3):
                session.add(
                    ShippingLockerSyncRun(
                        provider=ShippingLockerProvider.sameday,
                        status=ShippingLockerSyncStatus.failed,
                        started_at=now - timedelta(minutes=idx + 1),
                        finished_at=now - timedelta(minutes=idx + 1),
                        challenge_failure=True,
                        failure_kind="cloudflare_challenge",
                        error_message="Cloudflare challenge",
                    )
                )
            await session.commit()

    _run(seed())

    async def check_status():
        async with SessionLocal() as session:
            status_payload = await sameday_easybox_mirror.get_snapshot_status(session)
            assert status_payload.challenge_failure_streak == 3
            assert "challenge_failure_streak" in status_payload.canary_alert_codes
            assert status_payload.canary_alert_messages

    _run(check_status())


def test_manual_sync_endpoint_rbac(test_ctx, monkeypatch):
    client: TestClient = test_ctx["client"]

    async def payload_ok():
        return (
            [{"lockerId": "A1", "name": "Easybox", "city": "Bucuresti", "lat": 44.4, "lng": 26.1}],
            "https://sameday.ro/api/easybox/locations",
        )

    monkeypatch.setattr(sameday_easybox_mirror, "_fetch_raw_payload", payload_ok)

    async def customer_user():
        return SimpleNamespace(
            id=uuid4(),
            role=UserRole.customer,
            two_factor_enabled=True,
            admin_training_mode=False,
        )

    app.dependency_overrides[get_current_user] = customer_user
    forbidden = client.post("/api/v1/admin/shipping/sameday-sync/run")
    assert forbidden.status_code == 403

    async def owner_user():
        return SimpleNamespace(
            id=uuid4(),
            role=UserRole.owner,
            two_factor_enabled=True,
            admin_training_mode=False,
        )

    app.dependency_overrides[get_current_user] = owner_user
    ok = client.post("/api/v1/admin/shipping/sameday-sync/run")
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] in {"success", "failed"}
