"""Lean-gate unit coverage for ``app.db.session``.

Covers:
* the ``get_session`` FastAPI dependency (yields a live session and closes it);
* both slow-query event listeners, including the slow-warning branch, the
  fast/no-warning branch and the missing-start-time guard;
* the import-time PostgreSQL engine-config branch by reloading the module with
  a patched ``settings.database_url`` (then restoring the real sqlite module so
  the rest of the suite keeps using the shared engine).
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import sys

import app.db.session as session_module
from app.core.config import settings
from app.db.session import (
    SessionLocal,
    after_cursor_execute,
    before_cursor_execute,
    get_session,
)

# The reload tests below re-execute ``app.db.session``, which replaces
# ``get_session`` / ``SessionLocal`` / ``engine`` with brand-new objects.
# ``app.main.app`` captured the ORIGINAL ``get_session`` at import time for its
# ``Depends(...)``, so after a reload a later test's
# ``app.dependency_overrides[get_session] = ...`` silently no-ops (the override
# key no longer matches the app's captured dependency) — which routed the WU15
# post-deploy smoke's ``GET /theme`` to the real un-seeded session ("no such
# table: themes"). Snapshot the originals and restore their identities after
# each reload so the shared app dependency stays valid for the rest of the suite.
_ORIGINAL_SESSION_ATTRS = {
    name: getattr(session_module, name)
    for name in ("engine", "engine_kwargs", "SessionLocal", "get_session")
    if hasattr(session_module, name)
}


def _restore_original_session_identities() -> None:
    for _name, _obj in _ORIGINAL_SESSION_ATTRS.items():
        setattr(session_module, _name, _obj)


class _FakeInfo(dict):
    pass


class _FakeConn:
    def __init__(self) -> None:
        self.info = _FakeInfo()


def test_get_session_yields_and_closes() -> None:
    async def run() -> None:
        gen = get_session()
        session = await gen.__anext__()
        assert session is not None
        # The dependency uses ``async with`` so exhausting it closes the session.
        with __import__("pytest").raises(StopAsyncIteration):
            await gen.__anext__()

    asyncio.run(run())


def test_slow_query_listeners_warn_on_slow(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "slow_query_threshold_ms", 0, raising=False)
    conn = _FakeConn()

    before_cursor_execute(conn, None, "SELECT 1", None, None, False)
    assert conn.info["query_start_time"]

    with caplog.at_level(logging.WARNING, logger="app.db.slowquery"):
        after_cursor_execute(conn, None, "SELECT 1", {"a": 1}, None, False)

    assert any(r.message == "slow_query" for r in caplog.records)


def test_slow_query_listeners_no_warning_when_fast(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "slow_query_threshold_ms", 10_000_000, raising=False)
    conn = _FakeConn()
    before_cursor_execute(conn, None, "SELECT 1", None, None, False)

    with caplog.at_level(logging.WARNING, logger="app.db.slowquery"):
        after_cursor_execute(conn, None, "SELECT 1", None, None, False)

    assert not any(r.message == "slow_query" for r in caplog.records)


def test_after_cursor_execute_without_start_time_is_noop() -> None:
    conn = _FakeConn()  # no before_cursor_execute call -> empty start-time list
    # Should hit the ``start_time is None`` early return without raising.
    after_cursor_execute(conn, None, "SELECT 1", None, None, False)


def test_postgresql_engine_config_branch(monkeypatch) -> None:
    monkeypatch.setattr(
        settings,
        "database_url",
        "postgresql+asyncpg://u:p@localhost/db",
        raising=False,
    )
    monkeypatch.setattr(settings, "db_pool_size", 7, raising=False)
    monkeypatch.setattr(settings, "db_max_overflow", 3, raising=False)

    # ``create_async_engine`` does not connect eagerly, so reloading with a
    # postgresql URL safely exercises the config branch without a live server.
    try:
        reloaded = importlib.reload(session_module)
        assert str(reloaded.engine.url).startswith("postgresql")
        assert reloaded.engine_kwargs["pool_size"] == 7
        assert reloaded.engine_kwargs["max_overflow"] == 3
        assert reloaded.engine_kwargs["pool_pre_ping"] is True
    finally:
        # Restore the canonical sqlite-backed module for the rest of the suite.
        monkeypatch.undo()
        sys.modules["app.db.session"] = session_module
        importlib.reload(session_module)
        _restore_original_session_identities()


def test_postgresql_engine_config_branch_without_pool_overrides(monkeypatch) -> None:
    monkeypatch.setattr(
        settings,
        "database_url",
        "postgresql+asyncpg://u:p@localhost/db",
        raising=False,
    )
    monkeypatch.setattr(settings, "db_pool_size", None, raising=False)
    monkeypatch.setattr(settings, "db_max_overflow", None, raising=False)

    try:
        reloaded = importlib.reload(session_module)
        assert "pool_size" not in reloaded.engine_kwargs
        assert "max_overflow" not in reloaded.engine_kwargs
        assert reloaded.engine_kwargs["pool_pre_ping"] is True
    finally:
        monkeypatch.undo()
        sys.modules["app.db.session"] = session_module
        importlib.reload(session_module)
        _restore_original_session_identities()


def test_session_local_is_usable_after_reloads() -> None:
    # Guard that the restore in the reload tests left a working session factory.
    async def run() -> None:
        async with SessionLocal() as session:
            assert session is not None

    asyncio.run(run())
