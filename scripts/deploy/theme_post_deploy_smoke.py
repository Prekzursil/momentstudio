"""Sub-gate — post-deploy HTTP smoke (P1a WU15 / plan §9 post-deploy smoke).

The plan's post-deploy smoke: after backup → migrate, prove the storefront is
actually serving before declaring the release good — ``GET /theme`` returns a
COMPLETE token payload AND ``home.sections`` content is present — via a REAL HTTP
round-trip, not a bare service-layer call.

It drives the real FastAPI app (``app.main:app``) through Starlette's
``TestClient`` over a per-run in-memory SQLite DB built with
``Base.metadata.create_all`` + the WU1 ``ensure_default_theme`` runtime seed (the
repo's DB-test convention; ``create_all`` never runs migrations, so the theme +
content rows are seeded at runtime — plan §WU1/B2), mirroring
``backend/tests/test_theme_api.py``. This exercises the full ASGI stack — routing,
Pydantic response models, the session dependency — the way a deployed smoke curl
would, so a broken mount / serializer / missing seed fails the gate.

Two HTTP assertions, each FAILING LOUD (``GateFailure`` → exit 1 → CI red):

1. ``GET /api/v1/theme`` → **200** with a COMPLETE token payload — every editable
   primary + every derived shade/on-colour (the exact effective map the SSR sink
   consumes). A 404 (un-seeded theme) or a partial payload fails.
2. ``GET /api/v1/content/home.sections`` → **200** returning the ``home.sections``
   block — the storefront home layout content the plan's post-deploy smoke names.
   A 404 (un-seeded / unpublished home content) fails.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"

THEME_ENDPOINT = "/api/v1/theme"
HOME_SECTIONS_KEY = "home.sections"
HOME_SECTIONS_ENDPOINT = f"/api/v1/content/{HOME_SECTIONS_KEY}"


class GateFailure(RuntimeError):
    """A deploy-gate invariant was violated; the message is the loud reason."""


def _ensure_backend_on_path() -> None:
    """Put ``backend/`` on ``sys.path`` so ``import app...`` resolves (idempotent)."""
    backend = str(BACKEND_DIR)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def required_token_names() -> set[str]:
    """The names a complete ``GET /theme`` payload MUST carry: primaries + derived."""
    _ensure_backend_on_path()
    from app.services.theme_derive import DERIVED_COLOR_NAMES  # noqa: PLC0415
    from app.services.theme_service import default_theme_tokens  # noqa: PLC0415

    return set(default_theme_tokens()) | set(DERIVED_COLOR_NAMES)


def make_session_factory(*, seed_theme: bool = True, seed_home: bool = True) -> Any:
    """Build an in-memory SQLite session factory, optionally seeding theme + home.

    ``seed_theme`` / ``seed_home`` are parameterised so the gate's own fail-case
    tests can build an un-seeded app and prove each assertion goes red.
    """
    _ensure_backend_on_path()
    from sqlalchemy.ext.asyncio import (  # noqa: PLC0415
        async_sessionmaker,
        create_async_engine,
    )

    from app.db.base import Base  # noqa: PLC0415
    from app.models.content import ContentBlock, ContentStatus  # noqa: PLC0415

    # Side-effect import: register the theme ORM tables on ``Base.metadata``
    # BEFORE ``create_all``. ``theme_service`` imports the Theme models lazily,
    # so under the full pytest suite ``create_all`` would otherwise omit the
    # ``themes`` table (CI: "no such table: themes"). Names intentionally unused.
    import app.models.theme  # noqa: PLC0415, F401

    from app.services.theme_service import ensure_default_theme  # noqa: PLC0415

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            if seed_theme:
                await ensure_default_theme(session)
            if seed_home:
                session.add(
                    ContentBlock(
                        key=HOME_SECTIONS_KEY,
                        title="Home sections",
                        body_markdown="Home layout",
                        status=ContentStatus.published,
                    )
                )
            await session.commit()

    asyncio.run(_init())
    return session_factory


def client_for(session_factory: Any) -> Any:
    """Build a ``TestClient`` bound to ``session_factory`` via ``get_session``."""
    _ensure_backend_on_path()
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from app.db.session import get_session  # noqa: PLC0415
    from app.main import app  # noqa: PLC0415

    async def _override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session
    return TestClient(app)


def check_theme_endpoint(client: Any) -> int:
    """Fail loud unless ``GET /theme`` is 200 with a COMPLETE token payload."""
    response = client.get(THEME_ENDPOINT)
    if response.status_code != 200:
        raise GateFailure(
            f"GET {THEME_ENDPOINT} returned {response.status_code}, expected 200 — "
            "the published theme is not being served (un-seeded / mount broken)"
        )
    tokens = response.json().get("tokens") or {}
    missing = sorted(required_token_names() - set(tokens))
    if missing:
        raise GateFailure(
            f"GET {THEME_ENDPOINT} payload is incomplete; missing token(s): "
            f"{missing} — SSR would render partially unstyled"
        )
    return len(tokens)


def check_home_sections_endpoint(client: Any) -> None:
    """Fail loud unless ``GET /content/home.sections`` is 200 for the home block."""
    response = client.get(HOME_SECTIONS_ENDPOINT)
    if response.status_code != 200:
        raise GateFailure(
            f"GET {HOME_SECTIONS_ENDPOINT} returned {response.status_code}, expected "
            "200 — the storefront home.sections content is not present/published"
        )
    key = response.json().get("key")
    if key != HOME_SECTIONS_KEY:
        raise GateFailure(
            f"GET {HOME_SECTIONS_ENDPOINT} returned key={key!r}, expected "
            f"{HOME_SECTIONS_KEY!r}"
        )


def run(session_factory: Any | None = None) -> int:
    """Drive the real app over a seeded in-memory DB; return the theme token count.

    ``session_factory`` is injectable so tests can supply an un-seeded app to prove
    the fail cases; ``None`` builds the fully-seeded happy-path app.
    """
    _ensure_backend_on_path()
    from app.db.session import get_session  # noqa: PLC0415
    from app.main import app  # noqa: PLC0415

    factory = session_factory if session_factory is not None else make_session_factory()
    client = client_for(factory)
    try:
        count = check_theme_endpoint(client)
        check_home_sections_endpoint(client)
    finally:
        client.close()
        app.dependency_overrides.pop(get_session, None)
    return count


def main() -> int:
    """CLI entrypoint: 0 on success, 1 (loud stderr) on any invariant breach."""
    try:
        count = run()
    except GateFailure as exc:
        print(f"FAILED: theme-post-deploy-smoke\n{exc}", file=sys.stderr)
        return 1
    print(
        "SUCCESS: theme-post-deploy-smoke "
        f"(GET /theme -> 200 with {count} tokens; GET /content/home.sections -> 200)"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess/CI
    raise SystemExit(main())
