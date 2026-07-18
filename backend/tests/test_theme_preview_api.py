"""WU12 — theme draft-PREVIEW API contract + security tests.

Proves the admin draft-preview surface (mint a short-lived signed token → render
the storefront themed with the DRAFT / a chosen historical version WITHOUT
publishing):

* the mint route ``POST /theme/preview-token`` is section-gated (unauth → 401,
  customer → 403), rate-limited, and 404s when the target does not exist;
* the render route ``GET /theme/preview`` is TOKEN-gated (no session): no /
  garbage / wrong-type / expired token → 403; a forged/other selector that
  resolves to nothing → 404; a valid token → the RE-DERIVED draft (or version)
  tokens with ``no-store`` / ``noindex`` headers;
* rendering a preview NEVER publishes (the singleton published row + audit chain
  are untouched, the draft stays a draft).

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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import theme_preview as preview_api
from app.core import security
from app.core.rate_limit import reset_buckets
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.theme import Theme, ThemeAuditLog, ThemeVersion
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.services.theme_derive import PRIMARY_DEFAULTS, derive_tokens
from app.services.theme_service import default_theme_tokens, ensure_default_theme


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
    reset_buckets(
        [
            preview_api.preview_token_rate_limit.buckets,
            preview_api.preview_render_rate_limit.buckets,
        ]
    )
    yield
    reset_buckets(
        [
            preview_api.preview_token_rate_limit.buckets,
            preview_api.preview_render_rate_limit.buckets,
        ]
    )


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


def _primaries() -> dict[str, str]:
    return dict(PRIMARY_DEFAULTS)


def _published_snapshot(session_factory: async_sessionmaker) -> dict:
    async def _run() -> dict:
        async with session_factory() as session:
            theme = (await session.execute(select(Theme).limit(1))).scalar_one()
            version_count = await session.scalar(select(func.count(ThemeVersion.id)))
            audit_count = await session.scalar(select(func.count(ThemeAuditLog.id)))
            return {
                "version": theme.version,
                "status": theme.status,
                "tokens": dict(theme.tokens),
                "version_count": int(version_count or 0),
                "audit_count": int(audit_count or 0),
            }

    return asyncio.run(_run())


def _save_draft(client: TestClient, admin_token: str, tokens: dict[str, str]) -> None:
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": tokens},
        headers=_auth_headers(admin_token),
    )
    assert resp.status_code == 200, resp.text


# --------------------------------------------------------------------------- #
# Token helpers (unit)
# --------------------------------------------------------------------------- #
def test_decode_rejects_garbage_token() -> None:
    assert preview_api.decode_theme_preview_token("not-a-jwt") is None


def test_decode_rejects_wrong_type_token() -> None:
    # A content-preview token is a valid JWT but the wrong TYPE → rejected.
    other = security.create_content_preview_token(
        content_key="page.home",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    assert preview_api.decode_theme_preview_token(other) is None


def test_decode_rejects_missing_uid() -> None:
    import jwt

    from app.core.config import settings

    token = jwt.encode(
        {
            "type": "theme_preview",
            "sel": "draft",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    assert preview_api.decode_theme_preview_token(token) is None


def test_decode_rejects_missing_selector() -> None:
    token = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    assert preview_api.decode_theme_preview_token(token) is None


def test_decode_roundtrips_valid_token() -> None:
    token = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="draft",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    claims = preview_api.decode_theme_preview_token(token)
    assert claims is not None
    assert claims.user_id == "u1"
    assert claims.selector == "draft"


# --------------------------------------------------------------------------- #
# POST /theme/preview-token — mint (section-gated)
# --------------------------------------------------------------------------- #
def test_mint_requires_auth(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.post("/api/v1/theme/preview-token")
    assert resp.status_code == 401, resp.text


def test_mint_rejects_customer(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_customer_token(factory)
    resp = client.post("/api/v1/theme/preview-token", headers=_auth_headers(token))
    assert resp.status_code == 403, resp.text


def test_mint_draft_token_ok(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    admin = _create_admin_token(factory)
    resp = client.post("/api/v1/theme/preview-token", headers=_auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["selector"] == "draft"
    assert body["version"] >= 1
    assert body["token"]
    assert "theme_preview=" in body["url"]
    claims = preview_api.decode_theme_preview_token(body["token"])
    assert claims is not None and claims.selector == "draft"


def test_mint_version_token_ok(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    admin = _create_admin_token(factory)
    resp = client.post(
        "/api/v1/theme/preview-token?version=1", headers=_auth_headers(admin)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["selector"] == "1"
    assert body["version"] == 1


def test_mint_unknown_version_404(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    admin = _create_admin_token(factory)
    resp = client.post(
        "/api/v1/theme/preview-token?version=999", headers=_auth_headers(admin)
    )
    assert resp.status_code == 404, resp.text


def test_mint_draft_404_when_no_theme(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]
    admin = _create_admin_token(factory)
    resp = client.post("/api/v1/theme/preview-token", headers=_auth_headers(admin))
    assert resp.status_code == 404, resp.text


def test_mint_rate_limited(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    admin = _create_admin_token(factory)
    headers = _auth_headers(admin)
    last = None
    for _ in range(preview_api.PREVIEW_TOKEN_RATE_LIMIT + 1):
        last = client.post("/api/v1/theme/preview-token", headers=headers)
    assert last is not None and last.status_code == 429, last.text


# --------------------------------------------------------------------------- #
# GET /theme/preview — render (token-gated), never publishes
# --------------------------------------------------------------------------- #
def test_render_no_token_403(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.get("/api/v1/theme/preview")
    assert resp.status_code == 403, resp.text


def test_render_bad_token_403(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.get("/api/v1/theme/preview?token=garbage")
    assert resp.status_code == 403, resp.text


def test_render_expired_token_403(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    expired = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="draft",
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    resp = client.get(f"/api/v1/theme/preview?token={expired}")
    assert resp.status_code == 403, resp.text


def test_render_draft_returns_draft_tokens(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    admin = _create_admin_token(factory)

    # Save a DRAFT with a distinctive accent — different from the published doc.
    draft_tokens = {**_primaries(), "--accent": "12 34 56"}
    _save_draft(client, admin, draft_tokens)

    before = _published_snapshot(factory)

    mint = client.post("/api/v1/theme/preview-token", headers=_auth_headers(admin))
    token = mint.json()["token"]
    resp = client.get(f"/api/v1/theme/preview?token={token}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Preview renders the DRAFT (re-derived) — NOT the published document.
    assert body["status"] == "draft"
    assert body["tokens"] == derive_tokens(draft_tokens)
    assert body["tokens"]["--accent"] == "12 34 56"
    assert resp.headers["Cache-Control"] == "no-store"
    assert resp.headers["X-Robots-Tag"] == "noindex"

    # And the published document is UNCHANGED — a preview never publishes.
    published = client.get("/api/v1/theme")
    assert published.json()["tokens"]["--accent"] == default_theme_tokens()["--accent"]

    after = _published_snapshot(factory)
    assert after["version"] == before["version"]
    assert after["status"] == before["status"]
    assert after["tokens"] == before["tokens"]
    assert after["audit_count"] == before["audit_count"]


def test_render_version_returns_that_version(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    admin = _create_admin_token(factory)

    mint = client.post(
        "/api/v1/theme/preview-token?version=1", headers=_auth_headers(admin)
    )
    token = mint.json()["token"]
    resp = client.get(f"/api/v1/theme/preview?token={token}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version"] == 1
    assert body["tokens"] == derive_tokens(default_theme_tokens())


def test_render_unknown_version_selector_404(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    # A signed token whose version selector does not resolve → 404 (not a soft 200).
    token = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="999",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    resp = client.get(f"/api/v1/theme/preview?token={token}")
    assert resp.status_code == 404, resp.text


def test_render_non_numeric_selector_404(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    token = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="not-a-version",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    resp = client.get(f"/api/v1/theme/preview?token={token}")
    assert resp.status_code == 404, resp.text


def test_render_draft_404_when_no_theme(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    token = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="draft",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    resp = client.get(f"/api/v1/theme/preview?token={token}")
    assert resp.status_code == 404, resp.text


def test_render_rate_limited(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    token = preview_api.create_theme_preview_token(
        user_id="u1",
        selector="draft",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    last = None
    for _ in range(preview_api.PREVIEW_RENDER_RATE_LIMIT + 1):
        last = client.get(f"/api/v1/theme/preview?token={token}")
    assert last is not None and last.status_code == 429, last.text
