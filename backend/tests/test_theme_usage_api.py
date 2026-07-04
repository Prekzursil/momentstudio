"""WU14 — theme usage/metrics API + aggregation-service tests.

Proves the admin metrics surface DERIVES theme-change activity from the
append-only ``ThemeAuditLog`` history (no counter table):

* every publish / rollback / reset / draft-save moves the derived counts;
* the current published version + who/when reflect the latest live change;
* a freshly-seeded store (no admin change yet) reports zero events + null actor;
* an empty (unseeded) store reports a null current version; and
* the read endpoint is section-gated (``require_admin_section("theme")``).

Mirrors ``test_theme_mutate_api.py``'s per-test in-memory-SQLite app pattern
(``dependency_overrides[get_session]`` + ``TestClient`` + admin auth via
``role=admin`` + ``UserPasskey`` + ``X-Admin-Step-Up``), seeding the WU1 default
theme through ``ensure_default_theme``.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import theme as theme_api
from app.core import security
from app.core.rate_limit import reset_buckets
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.theme import Theme, ThemeAuditLog, ThemeStatus, ThemeVersion
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services import theme_usage
from app.services.auth import create_user, issue_tokens_for_user
from app.services.theme_derive import PRIMARY_DEFAULTS
from app.services.theme_service import ensure_default_theme

USAGE_URL = "/api/v1/theme/usage"


# --------------------------------------------------------------------------- #
# App / auth fixtures (mirror test_theme_mutate_api.py)
# --------------------------------------------------------------------------- #
def _make_session_factory(*, seed: bool) -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        if seed:
            async with session_factory() as session:
                await ensure_default_theme(session)
                await session.commit()

    asyncio.run(_init())
    return session_factory


def _client_for(session_factory: async_sessionmaker) -> TestClient:
    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> None:
    reset_buckets([theme_api.theme_mutation_rate_limit.buckets])
    yield
    reset_buckets([theme_api.theme_mutation_rate_limit.buckets])


@pytest.fixture
def seeded_app() -> Dict[str, object]:
    session_factory = _make_session_factory(seed=True)
    client = _client_for(session_factory)
    yield {"client": client, "session_factory": session_factory}
    client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def empty_app() -> Dict[str, object]:
    session_factory = _make_session_factory(seed=False)
    client = _client_for(session_factory)
    yield {"client": client, "session_factory": session_factory}
    client.close()
    app.dependency_overrides.clear()


def _auth_headers(token: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def _create_admin(session_factory: async_sessionmaker) -> tuple[str, str]:
    """Create an admin user; return ``(access_token, user_id)``."""

    async def _run() -> tuple[str, str]:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="theme-admin@example.com",
                    password="themepassword",
                    name="Theme Admin",
                ),
            )
            user.role = UserRole.admin
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="Test Passkey",
                    credential_id=f"cred-{user.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], str(user.id)

    return asyncio.run(_run())


def _create_customer_token(session_factory: async_sessionmaker) -> str:
    async def _run() -> str:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="shopper@example.com",
                    password="shopperpass",
                    name="Shopper",
                ),
            )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_run())


def _primaries() -> dict[str, str]:
    return dict(PRIMARY_DEFAULTS)


def _save_and_publish(client: TestClient, headers: dict[str, str], accent: str) -> None:
    """Save a draft with a distinct --accent then publish it (a live change)."""
    save = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": accent}},
        headers=headers,
    )
    assert save.status_code == 200, save.text
    pub = client.post("/api/v1/theme/publish", json={}, headers=headers)
    assert pub.status_code == 200, pub.text


# --------------------------------------------------------------------------- #
# Derived counts move on each event type
# --------------------------------------------------------------------------- #
def test_usage_fresh_seed_reports_zero_events(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, _uid = _create_admin(factory)

    resp = client.get(USAGE_URL, headers=_auth_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["publishes"] == 0
    assert body["rollbacks"] == 0
    assert body["resets"] == 0
    assert body["draft_saves"] == 0
    assert body["total_publish_events"] == 0
    # Seed published v1 exists, but no admin has CHANGED it yet.
    assert body["current_published_version"] == 1
    assert body["last_changed_by"] is None
    assert body["last_changed_at"] is None
    assert body["last_change_action"] is None


def test_usage_counts_draft_save(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, _uid = _create_admin(factory)
    headers = _auth_headers(token)

    client.put("/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers)

    body = client.get(USAGE_URL, headers=headers).json()
    assert body["draft_saves"] == 1
    assert body["publishes"] == 0
    assert body["total_publish_events"] == 0
    # A draft-save does NOT change the live theme.
    assert body["last_change_action"] is None
    assert body["current_published_version"] == 1


def test_usage_counts_publish_with_actor_and_version(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, uid = _create_admin(factory)
    headers = _auth_headers(token)

    _save_and_publish(client, headers, "20 30 120")

    body = client.get(USAGE_URL, headers=headers).json()
    assert body["publishes"] == 1
    assert body["draft_saves"] == 1  # the save that preceded the publish
    assert body["total_publish_events"] == 1
    assert body["current_published_version"] == 2
    assert body["last_change_action"] == "publish"
    assert body["last_changed_by"] == uid
    assert body["last_changed_at"] is not None


def test_usage_counts_rollback(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, uid = _create_admin(factory)
    headers = _auth_headers(token)

    _save_and_publish(client, headers, "20 30 120")  # -> v2
    resp = client.post("/api/v1/theme/rollback/1", headers=headers)  # -> v3
    assert resp.status_code == 200, resp.text

    body = client.get(USAGE_URL, headers=headers).json()
    assert body["publishes"] == 1
    assert body["rollbacks"] == 1
    assert body["total_publish_events"] == 2
    assert body["current_published_version"] == 3
    assert body["last_change_action"] == "rollback:1"
    assert body["last_changed_by"] == uid


def test_usage_counts_reset(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, uid = _create_admin(factory)
    headers = _auth_headers(token)

    _save_and_publish(client, headers, "20 30 120")  # -> v2
    resp = client.post("/api/v1/theme/reset-to-default", headers=headers)  # -> v3
    assert resp.status_code == 200, resp.text

    body = client.get(USAGE_URL, headers=headers).json()
    assert body["publishes"] == 1
    assert body["resets"] == 1
    assert body["total_publish_events"] == 2
    assert body["current_published_version"] == 3
    assert body["last_change_action"] == "reset-to-default"
    assert body["last_changed_by"] == uid


def test_usage_aggregates_mixed_activity(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, _uid = _create_admin(factory)
    headers = _auth_headers(token)

    _save_and_publish(client, headers, "20 30 120")  # publish #1 -> v2
    _save_and_publish(client, headers, "30 40 130")  # publish #2 -> v3
    client.post("/api/v1/theme/rollback/2", headers=headers)  # rollback -> v4
    client.post("/api/v1/theme/reset-to-default", headers=headers)  # reset -> v5

    body = client.get(USAGE_URL, headers=headers).json()
    assert body["publishes"] == 2
    assert body["rollbacks"] == 1
    assert body["resets"] == 1
    assert body["draft_saves"] == 2
    assert body["total_publish_events"] == 4  # publishes + rollbacks + resets
    assert body["current_published_version"] == 5
    # The reset was the last live change.
    assert body["last_change_action"] == "reset-to-default"


# --------------------------------------------------------------------------- #
# Empty (unseeded) store — no published theme at all
# --------------------------------------------------------------------------- #
def test_usage_empty_store_null_current_version(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]
    token, _uid = _create_admin(factory)

    body = client.get(USAGE_URL, headers=_auth_headers(token)).json()
    assert body["current_published_version"] is None
    assert body["publishes"] == 0
    assert body["total_publish_events"] == 0
    assert body["last_change_action"] is None


# --------------------------------------------------------------------------- #
# Authorization — the metrics read is section-gated
# --------------------------------------------------------------------------- #
def test_usage_requires_auth(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.get(USAGE_URL)
    assert resp.status_code == 401, resp.text


def test_usage_rejects_customer(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_customer_token(factory)
    resp = client.get(USAGE_URL, headers=_auth_headers(token))
    assert resp.status_code == 403, resp.text


# --------------------------------------------------------------------------- #
# Service-layer aggregation directly (no HTTP) — dataclass shape + rollback prefix
# --------------------------------------------------------------------------- #
def test_get_usage_metrics_service_layer(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, _uid = _create_admin(factory)
    headers = _auth_headers(token)
    _save_and_publish(client, headers, "20 30 120")
    client.post("/api/v1/theme/rollback/1", headers=headers)

    async def _run() -> theme_usage.ThemeUsageMetrics:
        async with factory() as session:
            return await theme_usage.get_usage_metrics(session)

    metrics = asyncio.run(_run())
    assert metrics.publishes == 1
    assert metrics.rollbacks == 1
    assert metrics.resets == 0
    assert metrics.draft_saves == 1
    assert metrics.total_publish_events == 2
    assert metrics.current_published_version == 3
    assert metrics.last_change_action == "rollback:1"
    assert metrics.last_changed_at is not None


def test_is_rollback_helper() -> None:
    assert theme_usage._is_rollback("rollback:1") is True
    assert theme_usage._is_rollback("rollback:42") is True
    assert theme_usage._is_rollback("publish") is False
    assert theme_usage._is_rollback("reset-to-default") is False
    assert theme_usage._is_rollback("draft-save") is False


def test_last_change_orders_by_created_at_not_version(
    seeded_app: Dict[str, object],
) -> None:
    """FIX 2: ``last_change_*`` reflects the most-recent-by-TIME live change, so
    the aggregation orders by ``created_at`` first, NOT ``version``.

    Force-publish anomaly (the exact case the ordering must survive): an EARLIER
    change carries a HIGHER version than a LATER one. Ordering by version first
    would name the older-but-higher-versioned publish as "last"; ordering by
    ``created_at`` first correctly names the later reset. Seeded directly at the
    audit layer so the anomaly is reproducible regardless of the version-assign
    path.
    """
    factory = seeded_app["session_factory"]

    async def _seed_anomaly() -> None:
        async with factory() as session:
            theme = (await session.execute(select(Theme).limit(1))).scalar_one()
            base = datetime(2026, 1, 1, tzinfo=timezone.utc)
            # Higher version, but EARLIER in time.
            hi = ThemeVersion(
                theme_id=theme.id,
                version=9,
                schema_version=1,
                tokens={},
                status=ThemeStatus.published,
                created_by_user_id=None,
                published_at=base,
            )
            # Lower version, but LATER in time.
            lo = ThemeVersion(
                theme_id=theme.id,
                version=5,
                schema_version=1,
                tokens={},
                status=ThemeStatus.published,
                created_by_user_id=None,
                published_at=base + timedelta(hours=1),
            )
            session.add_all([hi, lo])
            await session.flush()
            session.add(
                ThemeAuditLog(
                    theme_version_id=hi.id,
                    action="publish",
                    version=9,
                    user_id=None,
                    created_at=base,
                )
            )
            session.add(
                ThemeAuditLog(
                    theme_version_id=lo.id,
                    action="reset-to-default",
                    version=5,
                    user_id=None,
                    created_at=base + timedelta(hours=1),
                )
            )
            await session.commit()

    asyncio.run(_seed_anomaly())

    async def _run() -> theme_usage.ThemeUsageMetrics:
        async with factory() as session:
            return await theme_usage.get_usage_metrics(session)

    metrics = asyncio.run(_run())
    # created_at-primary ordering picks the LATER row (reset, v5), NOT the
    # higher-version-but-earlier publish (v9).
    assert metrics.last_change_action == "reset-to-default"
    assert metrics.last_changed_at is not None
    # The chosen row is the later-in-time one (its hour component is 1, not 0),
    # independent of how SQLite round-trips the timezone.
    assert metrics.last_changed_at.hour == 1


def test_usage_current_version_tracks_singleton(seeded_app: Dict[str, object]) -> None:
    # Sanity: derived current_published_version equals the live singleton's.
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token, _uid = _create_admin(factory)
    headers = _auth_headers(token)
    _save_and_publish(client, headers, "20 30 120")

    async def _live_version() -> int:
        async with factory() as session:
            return (await session.execute(select(Theme).limit(1))).scalar_one().version

    live = asyncio.run(_live_version())
    body = client.get(USAGE_URL, headers=headers).json()
    assert body["current_published_version"] == live
