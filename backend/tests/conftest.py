import asyncio
import os
from collections.abc import Generator

import pytest
from sqlalchemy.ext import asyncio as sa_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Keep pytest output high-signal by disabling outbound Sentry capture in tests.
os.environ["SENTRY_DSN"] = ""

from app.api.v1 import auth as auth_api


_TRACKED_ENGINES: list[sa_asyncio.AsyncEngine] = []
_ORIGINAL_CREATE_ASYNC_ENGINE = sa_asyncio.create_async_engine


def _tracked_create_async_engine(*args, **kwargs):  # type: ignore[no-untyped-def]
    engine = _ORIGINAL_CREATE_ASYNC_ENGINE(*args, **kwargs)
    _TRACKED_ENGINES.append(engine)
    return engine


sa_asyncio.create_async_engine = _tracked_create_async_engine  # type: ignore[assignment]


@pytest.fixture(scope="module")
def anyio_backend() -> str:
    return "asyncio"


def make_memory_session_factory() -> async_sessionmaker:
    """Create an in-memory SQLite async session factory with all tables created.

    Mirrors the per-test engine pattern used across the suite so unit tests for
    service-layer DB helpers can run without a real database. Import the models
    package first so every table is registered on ``Base.metadata``.
    """
    import app.models  # noqa: F401  (register all ORM tables on Base.metadata)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return session_factory


@pytest.fixture
def seeded_theme_factory() -> async_sessionmaker:
    """In-memory SQLite session factory with the default theme already seeded.

    Shared by the theme WUs (WU1 model/seed tests; WU4a resolve/read, WU6 SSR,
    WU12 preview later) so each obtains the published default row by calling
    ``ensure_default_theme`` — NOT by asserting a migration INSERT, which the
    ``create_all`` test path never executes.
    """
    from app.services.theme_service import ensure_default_theme

    factory = make_memory_session_factory()

    async def _seed() -> None:
        async with factory() as session:
            await ensure_default_theme(session)
            await session.commit()

    asyncio.run(_seed())
    return factory


@pytest.fixture(autouse=True)
def _dispose_tracked_async_engines() -> Generator[None, None, None]:
    start_index = len(_TRACKED_ENGINES)
    yield
    pending = _TRACKED_ENGINES[start_index:]
    if not pending:
        return

    async def _dispose_all() -> None:
        for engine in pending:
            try:
                await engine.dispose()
            except Exception:
                continue

    try:
        asyncio.run(_dispose_all())
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_dispose_all())
        finally:
            loop.close()

    del _TRACKED_ENGINES[start_index:]


@pytest.fixture(autouse=True)
def _clear_auth_rate_limits() -> Generator[None, None, None]:
    # The in-memory rate-limit buckets are process-global and can leak across tests.
    for dep in (
        auth_api.login_rate_limit,
        auth_api.two_factor_rate_limit,
        auth_api.register_rate_limit,
        auth_api.refresh_rate_limit,
        auth_api.reset_request_rate_limit,
        auth_api.reset_confirm_rate_limit,
        auth_api.step_up_rate_limit,
        auth_api.google_rate_limit,
    ):
        dep.buckets.clear()
    yield
    for dep in (
        auth_api.login_rate_limit,
        auth_api.two_factor_rate_limit,
        auth_api.register_rate_limit,
        auth_api.refresh_rate_limit,
        auth_api.reset_request_rate_limit,
        auth_api.reset_confirm_rate_limit,
        auth_api.step_up_rate_limit,
        auth_api.google_rate_limit,
    ):
        dep.buckets.clear()
