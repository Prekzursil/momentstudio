"""WU4b — theme MUTATE API contract + security tests.

Covers the derive-aware mutate surface (draft-save / atomic publish / rollback /
panic reset): the authz matrix, the staleness 409, the rate-limit, publish
atomicity, rollback published-only, reset audit, AND the security negatives that
prove the white-on-white bypass class is DEAD —

* an admin CANNOT set any DERIVED token (rejected 422 — not an editable key);
* a hostile PRIMARY edit that collapses a derived pairing is caught (422); and
* the ON-COLOURS always contrast (property test over random primaries), so
  white-on-white is unreachable even when ``--surface-inverse`` is set to white.

Mirrors the ``test_theme_api.py`` per-test in-memory-SQLite app pattern
(``dependency_overrides[get_session]`` + ``TestClient`` + admin auth via
``role=admin`` + ``UserPasskey`` + ``X-Admin-Step-Up``), seeding the WU1 default
theme through ``ensure_default_theme``.
"""

import asyncio
import random
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
from app.services.auth import create_user, issue_tokens_for_user
from app.services.theme_contrast import contrast_ratio
from app.services.theme_derive import (
    DERIVED_COLOR_NAMES,
    PRIMARY_DEFAULTS,
    derive_tokens,
    parse_triplet,
)
from app.services.theme_service import default_theme_tokens, ensure_default_theme


# --------------------------------------------------------------------------- #
# App / auth fixtures (mirror test_theme_api.py)
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
    # The mutate limiter is a module-level singleton; clear its buckets before
    # each test so an earlier test's requests never trip a later test's limit.
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


def _theme_row(session_factory: async_sessionmaker) -> dict:
    async def _run() -> dict:
        async with session_factory() as session:
            theme = (await session.execute(select(Theme).limit(1))).scalar_one()
            return {
                "version": theme.version,
                "status": theme.status,
                "tokens": dict(theme.tokens),
            }

    return asyncio.run(_run())


def _audit_actions(session_factory: async_sessionmaker) -> list[str]:
    async def _run() -> list[str]:
        async with session_factory() as session:
            rows = (
                await session.execute(
                    select(ThemeAuditLog).order_by(ThemeAuditLog.created_at)
                )
            ).scalars().all()
            return [row.action for row in rows]

    return asyncio.run(_run())


def _versions(session_factory: async_sessionmaker) -> list[dict]:
    async def _run() -> list[dict]:
        async with session_factory() as session:
            rows = (
                await session.execute(
                    select(ThemeVersion).order_by(ThemeVersion.version)
                )
            ).scalars().all()
            return [{"version": r.version, "status": r.status} for r in rows]

    return asyncio.run(_run())


def _primaries() -> dict[str, str]:
    """The nine primary colour tokens at their compiled defaults."""
    return dict(PRIMARY_DEFAULTS)


# --------------------------------------------------------------------------- #
# PUT /theme/draft — authz + revalidation + audit
# --------------------------------------------------------------------------- #
def test_save_draft_requires_auth(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    resp = client.put("/api/v1/theme/draft", json={"tokens": _primaries()})
    assert resp.status_code == 401, resp.text


def test_save_draft_rejects_customer(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_customer_token(factory)
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": _primaries()},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 403, resp.text


def test_save_draft_persists_and_audits(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)

    tokens = {**_primaries(), "--accent": "12 34 56"}
    resp = client.put(
        "/api/v1/theme/draft", json={"tokens": tokens}, headers=_auth_headers(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["version"] == 2
    # Read surface returns the DERIVED effective set (primaries + computed shades).
    assert body["tokens"] == derive_tokens(tokens)
    assert body["tokens"]["--accent"] == "12 34 56"
    assert _audit_actions(factory) == ["draft-save"]


def test_save_draft_updates_existing_draft_in_place(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": "12 34 56"}},
        headers=headers,
    )
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": "65 43 21"}},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] == 2  # same draft snapshot, updated in place
    # Exactly one draft version (v2) beside the seeded published v1.
    assert _versions(factory) == [
        {"version": 1, "status": ThemeStatus.published},
        {"version": 2, "status": ThemeStatus.draft},
    ]
    assert _audit_actions(factory) == ["draft-save", "draft-save"]


def test_save_draft_missing_theme_404(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": _primaries()},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# Security negative: an admin CANNOT set a DERIVED token (bypass class dead)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "derived_key",
    [
        "--surface-inverse-hover",
        "--background-subtle",
        "--text-inverse",
        "--text-onmedia",
        "--border-inverse",
    ],
)
def test_save_draft_rejects_derived_token_key(
    seeded_app: Dict[str, object], derived_key: str
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    # Try to smuggle a derived shade / on-colour (e.g. white-on-white via
    # --surface-inverse-hover) — the WU2 registry has no such editable key.
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), derived_key: "255 255 255"}},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 422, resp.text
    assert derived_key in resp.json()["detail"]["invalid"]


@pytest.mark.parametrize(
    "ramp_key,value",
    [
        ("--background-50", "255 255 255"),  # numeric colour ramp step
        ("--surface-800", "30 41 59"),  # numeric colour ramp step
        ("--space-2xl", "3rem"),  # wider spacing ramp (not an admin anchor)
    ],
)
def test_save_draft_rejects_server_emitted_ramp_key(
    seeded_app: Dict[str, object], ramp_key: str, value: str
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    # A server-emitted ramp name is sink-acceptable (SSR forward-compat) but is
    # NOT admin-settable: draft-save must 422 so a white-on-white numeric ramp
    # step can never reach the published :root (the LATENT bypass vector).
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), ramp_key: value}},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 422, resp.text
    assert ramp_key in resp.json()["detail"]["invalid"]


def test_save_draft_accepts_editable_spacing_anchor(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    # The five --space-* anchors ARE admin-controllable and must still save.
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--space-md": "1.25rem"}},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["tokens"]["--space-md"] == "1.25rem"


def test_save_draft_rejects_unknown_and_malicious_keys(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {"--not-a-token": "1 2 3"}},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 422, resp.text
    assert "--not-a-token" in resp.json()["detail"]["invalid"]


def test_save_draft_rejects_bad_primary_value(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    # A CSS-breakout value on a real primary key is rejected by the encoder.
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {"--accent": "15 23 42) } html{background:red"}},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 422, resp.text
    assert "--accent" in resp.json()["detail"]["invalid"]


def test_save_draft_size_cap_too_many_tokens(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    tokens = {f"--k{i}": "1 2 3" for i in range(200)}
    resp = client.put(
        "/api/v1/theme/draft", json={"tokens": tokens}, headers=_auth_headers(token)
    )
    assert resp.status_code == 413, resp.text


def test_save_draft_size_cap_value_too_long(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {"--accent": "1 " * 200}},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 413, resp.text


# --------------------------------------------------------------------------- #
# POST /theme/publish — atomicity, staleness 409, contrast 422, no-draft 400
# --------------------------------------------------------------------------- #
def test_publish_promotes_draft_atomically(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": "20 30 120"}},
        headers=headers,
    )
    resp = client.post("/api/v1/theme/publish", json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["version"] == 2

    live = _theme_row(factory)
    assert live["version"] == 2
    assert live["status"] == ThemeStatus.published
    assert live["tokens"]["--accent"] == "20 30 120"
    # The public read reflects the new published theme.
    assert client.get("/api/v1/theme").json()["tokens"]["--accent"] == "20 30 120"
    assert _audit_actions(factory) == ["draft-save", "publish"]


def test_publish_staleness_conflict_409(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    client.put("/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers)
    resp = client.post(
        "/api/v1/theme/publish", json={"expected_version": 999}, headers=headers
    )
    assert resp.status_code == 409, resp.text


def test_publish_matching_expected_version_succeeds(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    client.put("/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers)
    resp = client.post(
        "/api/v1/theme/publish", json={"expected_version": 1}, headers=headers
    )
    assert resp.status_code == 200, resp.text


def test_publish_without_draft_400(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.post("/api/v1/theme/publish", json={}, headers=_auth_headers(token))
    assert resp.status_code == 400, resp.text


def test_publish_rejects_hostile_primary_failing_contrast(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    # A near-white body --text on the white --background is a valid TRIPLET (so it
    # saves), but collapses the text-on-background pairing below AA — caught at
    # publish over the DERIVED effective set.
    hostile = {**_primaries(), "--text": "250 250 250"}
    save = client.put("/api/v1/theme/draft", json={"tokens": hostile}, headers=headers)
    assert save.status_code == 200, save.text
    resp = client.post("/api/v1/theme/publish", json={}, headers=headers)
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["error"] == "contrast"
    failed = {f["pairing"] for f in detail["failures"]}
    assert "text-on-background" in failed
    # The failing publish did NOT flip the live theme (atomic all-or-nothing).
    assert _theme_row(factory)["version"] == 1


def test_publish_requires_admin(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_customer_token(factory)
    resp = client.post("/api/v1/theme/publish", json={}, headers=_auth_headers(token))
    assert resp.status_code == 403, resp.text


def test_publish_missing_theme_404(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.post("/api/v1/theme/publish", json={}, headers=_auth_headers(token))
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# POST /theme/rollback/{version} — published-only, re-gated
# --------------------------------------------------------------------------- #
def test_rollback_to_published_version_succeeds(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    # Publish a v2 change, then roll back to the seeded v1.
    client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": "20 30 120"}},
        headers=headers,
    )
    client.post("/api/v1/theme/publish", json={}, headers=headers)

    resp = client.post("/api/v1/theme/rollback/1", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["version"] == 3  # rollback force-publishes a NEW snapshot
    # v1's --accent restored (indigo default), not the v2 override.
    assert body["tokens"]["--accent"] == PRIMARY_DEFAULTS["--accent"]
    assert _audit_actions(factory)[-1] == "rollback:1"


def test_rollback_to_draft_version_is_404(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    # Create a draft (v2) but never publish it — rolling back to it must 404.
    client.put("/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers)
    resp = client.post("/api/v1/theme/rollback/2", headers=headers)
    assert resp.status_code == 404, resp.text


def test_rollback_forged_version_is_404(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.post("/api/v1/theme/rollback/999", headers=_auth_headers(token))
    assert resp.status_code == 404, resp.text


def test_rollback_zero_version_rejected(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    # Path ge=1 constraint → 422 validation error on a non-positive version.
    resp = client.post("/api/v1/theme/rollback/0", headers=_auth_headers(token))
    assert resp.status_code == 422, resp.text


def test_rollback_requires_admin(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_customer_token(factory)
    resp = client.post("/api/v1/theme/rollback/1", headers=_auth_headers(token))
    assert resp.status_code == 403, resp.text


def test_rollback_missing_theme_404(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.post("/api/v1/theme/rollback/1", headers=_auth_headers(token))
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# POST /theme/reset-to-default — audited, bypasses only the 409
# --------------------------------------------------------------------------- #
def test_reset_to_default_force_publishes_and_audits(
    seeded_app: Dict[str, object],
) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    # Drift the live theme, then panic-reset.
    client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": "20 30 120"}},
        headers=headers,
    )
    client.post("/api/v1/theme/publish", json={}, headers=headers)

    resp = client.post("/api/v1/theme/reset-to-default", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["version"] == 3
    # Back to the compiled-default derived set.
    assert body["tokens"] == derive_tokens(default_theme_tokens())
    assert _audit_actions(factory)[-1] == "reset-to-default"


def test_reset_to_default_bypasses_staleness(seeded_app: Dict[str, object]) -> None:
    # A reset has no expected_version parameter at all — a stale/broken view can
    # always reset. It force-publishes regardless of the current live version.
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.post(
        "/api/v1/theme/reset-to-default", headers=_auth_headers(token)
    )
    assert resp.status_code == 200, resp.text
    assert _theme_row(factory)["version"] == 2


def test_reset_requires_admin(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_customer_token(factory)
    resp = client.post(
        "/api/v1/theme/reset-to-default", headers=_auth_headers(token)
    )
    assert resp.status_code == 403, resp.text


def test_reset_missing_theme_404(empty_app: Dict[str, object]) -> None:
    client: TestClient = empty_app["client"]  # type: ignore[assignment]
    factory = empty_app["session_factory"]
    token = _create_admin_token(factory)
    resp = client.post(
        "/api/v1/theme/reset-to-default", headers=_auth_headers(token)
    )
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# Rate limit trips on the mutate surface
# --------------------------------------------------------------------------- #
def test_mutation_rate_limit_trips(seeded_app: Dict[str, object]) -> None:
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    limit = theme_api.THEME_MUTATION_RATE_LIMIT
    saw_429 = False
    for _ in range(limit + 5):
        resp = client.put(
            "/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers
        )
        if resp.status_code == 429:
            saw_429 = True
            break
    assert saw_429, "expected the mutate rate limit to trip"


# --------------------------------------------------------------------------- #
# Security property: the ON-COLOURS always contrast (white-on-white unreachable)
# --------------------------------------------------------------------------- #
def test_on_colors_always_contrast_over_random_primaries() -> None:
    rng = random.Random(20260704)

    def rand_triplet() -> str:
        return f"{rng.randint(0, 255)} {rng.randint(0, 255)} {rng.randint(0, 255)}"

    for _ in range(400):
        primaries = {name: rand_triplet() for name in PRIMARY_DEFAULTS}
        effective = derive_tokens(primaries)
        # Every derived key is present and computed (never taken from input).
        for name in DERIVED_COLOR_NAMES:
            assert name in effective
        # --text-inverse on --surface-inverse and --text-onmedia on --accent are
        # contrast-derived → always clear AA body (>= 4.5), even when the admin
        # sets the background to white. White-on-white cannot occur.
        inv = contrast_ratio(
            parse_triplet(effective["--text-inverse"]),
            parse_triplet(effective["--surface-inverse"]),
        )
        media = contrast_ratio(
            parse_triplet(effective["--text-onmedia"]),
            parse_triplet(effective["--accent"]),
        )
        assert inv >= 4.5, (effective["--surface-inverse"], inv)
        assert media >= 4.5, (effective["--accent"], media)


def test_white_surface_inverse_keeps_black_on_color(
    seeded_app: Dict[str, object],
) -> None:
    # Setting --surface-inverse to white is a legal PRIMARY edit, but the derived
    # --text-inverse re-computes to BLACK for contrast — no white-on-white.
    client: TestClient = seeded_app["client"]  # type: ignore[assignment]
    factory = seeded_app["session_factory"]
    token = _create_admin_token(factory)
    headers = _auth_headers(token)

    tokens = {**_primaries(), "--surface-inverse": "255 255 255"}
    save = client.put("/api/v1/theme/draft", json={"tokens": tokens}, headers=headers)
    assert save.status_code == 200, save.text
    effective = save.json()["tokens"]
    assert effective["--surface-inverse"] == "255 255 255"
    assert effective["--text-inverse"] == "0 0 0"
    # And publish still passes (on-colour is safe by construction).
    assert client.post("/api/v1/theme/publish", json={}, headers=headers).status_code == 200
