import asyncio
import os
from collections.abc import Generator

import pytest
from sqlalchemy.ext import asyncio as sa_asyncio

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
