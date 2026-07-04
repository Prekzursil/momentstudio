"""WU4a — theme resolve/read API contract + service tests.

Mirrors the ``test_content_api.py`` per-test in-memory-SQLite app pattern
(``dependency_overrides[get_session]`` + ``TestClient`` + admin auth via
``role=admin`` + ``UserPasskey`` + ``X-Admin-Step-Up``) and seeds the WU1 default
theme through ``ensure_default_theme`` (the ``create_all`` test path never runs
migrations, so the row is seeded at runtime — see plan §WU1/B2).
"""

import asyncio
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.theme import Theme, ThemeStatus, ThemeVersion
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.services.theme_derive import derive_tokens
from app.services.theme_service import (
    DEFAULT_SCHEMA_VERSION,
    default_theme_tokens,
    ensure_default_theme,
    get_draft,
    list_versions,
    resolve_published_tokens,
    seed_default_theme_on_startup,
)


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


def _create_admin_token(session_factory: async_sessionmaker) -> str:
    async def _run() -> str:
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
            return tokens["access_token"]

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


def _insert_draft_version(
    session_factory: async_sessionmaker, tokens: dict[str, str], version: int
) -> None:
    async def _run() -> None:
        async with session_factory() as session:
            theme = (await session.execute(select(Theme).limit(1))).scalar_one()
            session.add(
                ThemeVersion(
                    theme_id=theme.id,
                    version=version,
                    schema_version=DEFAULT_SCHEMA_VERSION,
                    tokens=tokens,
                    status=ThemeStatus.draft,
                    created_by_user_id=None,
                    published_at=None,
                )
            )
            await session.commit()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# GET /theme (published, public/SSR — no auth)
# --------------------------------------------------------------------------- #
def test_get_published_theme_is_public(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.get("/api/v1/theme")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version"] == 1
    assert body["schema_version"] == DEFAULT_SCHEMA_VERSION
    assert body["status"] == "published"
    assert body["tokens"]["--background"] == "255 255 255"
    # The read surface returns the SOURCE-OF-TRUTH primaries + the derived shade /
    # state tokens recomputed from them (never the raw stored primaries alone).
    assert body["tokens"] == derive_tokens(default_theme_tokens())
    assert body["published_at"] is not None


def test_get_published_theme_missing_returns_404(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    resp = client.get("/api/v1/theme")
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# GET /theme/draft (admin)
# --------------------------------------------------------------------------- #
def test_get_draft_falls_back_to_published_when_no_draft(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]  # type: ignore[assignment]
    token = _create_admin_token(factory)

    resp = client.get("/api/v1/theme/draft", headers=_auth_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # No draft snapshot yet → the published baseline is returned.
    assert body["status"] == "published"
    assert body["tokens"] == derive_tokens(default_theme_tokens())


def test_get_draft_returns_saved_draft(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]  # type: ignore[assignment]
    token = _create_admin_token(factory)

    draft_tokens = {**default_theme_tokens(), "--accent": "12 34 56"}
    _insert_draft_version(factory, draft_tokens, version=2)

    resp = client.get("/api/v1/theme/draft", headers=_auth_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["version"] == 2
    assert body["tokens"]["--accent"] == "12 34 56"


def test_get_draft_missing_returns_404(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]  # type: ignore[assignment]
    token = _create_admin_token(factory)
    resp = client.get("/api/v1/theme/draft", headers=_auth_headers(token))
    assert resp.status_code == 404, resp.text


def test_get_draft_rejects_customer(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]  # type: ignore[assignment]
    token = _create_customer_token(factory)
    resp = client.get("/api/v1/theme/draft", headers=_auth_headers(token))
    assert resp.status_code == 403, resp.text


def test_get_draft_requires_auth(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.get("/api/v1/theme/draft")
    assert resp.status_code == 401, resp.text


# --------------------------------------------------------------------------- #
# GET /theme/versions (admin)
# --------------------------------------------------------------------------- #
def test_list_versions_admin(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]  # type: ignore[assignment]
    token = _create_admin_token(factory)

    _insert_draft_version(factory, default_theme_tokens(), version=2)

    resp = client.get("/api/v1/theme/versions", headers=_auth_headers(token))
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert [item["version"] for item in items] == [2, 1]
    assert items[0]["status"] == "draft"
    assert items[1]["status"] == "published"


def test_list_versions_rejects_customer(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]  # type: ignore[assignment]
    token = _create_customer_token(factory)
    resp = client.get("/api/v1/theme/versions", headers=_auth_headers(token))
    assert resp.status_code == 403, resp.text


# --------------------------------------------------------------------------- #
# Service-layer resolve/read + seed helpers (branch coverage)
# --------------------------------------------------------------------------- #
def test_resolve_and_draft_none_on_empty_db() -> None:
    factory = _make_session_factory(seed=False)

    async def _run() -> None:
        async with factory() as session:
            assert await resolve_published_tokens(session) is None
            assert await get_draft(session) is None
            assert await list_versions(session) == []

    asyncio.run(_run())


def test_ensure_default_theme_idempotent() -> None:
    factory = _make_session_factory(seed=True)

    async def _run() -> None:
        async with factory() as session:
            # Second call must return the existing row, not create a new one.
            again = await ensure_default_theme(session)
            await session.commit()
            assert again is not None
            count = await session.scalar(select(func.count()).select_from(Theme))
            assert count == 1

    asyncio.run(_run())


def test_seed_default_theme_on_startup_seeds_row() -> None:
    factory = _make_session_factory(seed=False)
    assert asyncio.run(seed_default_theme_on_startup(factory)) is True

    async def _check() -> None:
        async with factory() as session:
            count = await session.scalar(select(func.count()).select_from(Theme))
            assert count == 1

    asyncio.run(_check())


def test_seed_default_theme_on_startup_skips_without_schema() -> None:
    # An engine whose theme schema was never created → the seed is skipped
    # (migrations own schema creation) rather than crashing startup.
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    assert asyncio.run(seed_default_theme_on_startup(factory)) is False
