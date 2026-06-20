"""Lean-gate unit coverage for ``app.services.leader_lock``."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import pytest

from app.services import leader_lock


# --------------------------------------------------------------------------- #
# pure helpers                                                                 #
# --------------------------------------------------------------------------- #
def test_lock_id_is_deterministic_signed_bigint() -> None:
    a = leader_lock._lock_id("scheduler")
    b = leader_lock._lock_id("scheduler")
    assert a == b
    assert 0 <= a < 2**63 - 1
    assert leader_lock._lock_id("other") != a


def test_lock_id_handles_none() -> None:
    assert leader_lock._lock_id(None) == leader_lock._lock_id("")


def test_is_postgres_false_on_sqlite() -> None:
    # The test engine is sqlite -> not postgres.
    assert leader_lock._is_postgres() is False


def test_leader_engine_is_cached(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_LEADER_ENGINE", None)
    created: list[dict] = []

    def fake_create(url, **kwargs):  # noqa: ANN001
        created.append({"url": url, **kwargs})
        return object()

    monkeypatch.setattr(leader_lock, "create_async_engine", fake_create)
    monkeypatch.setattr(
        leader_lock.settings, "database_url", "sqlite+aiosqlite:///:memory:"
    )
    first = leader_lock._leader_engine()
    second = leader_lock._leader_engine()
    assert first is second
    assert len(created) == 1
    assert created[0]["connect_args"] == {"check_same_thread": False}


def test_leader_engine_non_sqlite_connect_args(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_LEADER_ENGINE", None)
    captured: dict = {}

    def fake_create(url, **kwargs):  # noqa: ANN001
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(leader_lock, "create_async_engine", fake_create)
    monkeypatch.setattr(
        leader_lock.settings, "database_url", "postgresql+asyncpg://x/y"
    )
    leader_lock._leader_engine()
    assert captured["connect_args"] == {}


# --------------------------------------------------------------------------- #
# run_as_leader: non-postgres short-circuit                                    #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_run_as_leader_non_postgres_runs_work_directly(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_is_postgres", lambda: False)
    ran = {"v": False}

    async def work(stop) -> None:  # noqa: ANN001
        ran["v"] = True

    await leader_lock.run_as_leader(name="x", stop=asyncio.Event(), work=work)
    assert ran["v"] is True


# --------------------------------------------------------------------------- #
# run_as_leader: postgres path (mocked engine/connection)                     #
# --------------------------------------------------------------------------- #
class _Result:
    def __init__(self, value) -> None:  # noqa: ANN001
        self._value = value

    def scalar(self):
        return self._value


class _Conn:
    def __init__(self, acquired: bool, statements: list) -> None:
        self._acquired = acquired
        self._statements = statements

    async def execute(self, stmt, params=None):  # noqa: ANN001
        text = str(stmt)
        self._statements.append(text)
        if "pg_try_advisory_lock" in text:
            return _Result(self._acquired)
        return _Result(None)


def _engine_yielding(conn: _Conn):
    class _Engine:
        def connect(self):
            @asynccontextmanager
            async def _cm():
                yield conn

            return _cm()

    return _Engine()


@pytest.mark.anyio
async def test_run_as_leader_acquires_and_runs_then_unlocks(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_is_postgres", lambda: True)
    statements: list[str] = []
    conn = _Conn(acquired=True, statements=statements)
    monkeypatch.setattr(leader_lock, "_leader_engine", lambda: _engine_yielding(conn))

    worked = {"v": False}

    async def work(stop) -> None:  # noqa: ANN001
        worked["v"] = True

    await leader_lock.run_as_leader(
        name="lock-a", stop=asyncio.Event(), work=work
    )
    assert worked["v"] is True
    assert any("pg_advisory_unlock" in s for s in statements)


@pytest.mark.anyio
async def test_run_as_leader_not_acquired_then_stops(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_is_postgres", lambda: True)
    stop = asyncio.Event()

    class _ConnSetsStop(_Conn):
        async def execute(self, stmt, params=None):  # noqa: ANN001
            # After reporting the lock as unavailable, set stop so the backoff
            # wait returns and the while-loop exits on the next check (covering
            # the ``if not acquired`` retry/continue branch).
            stop.set()
            return await super().execute(stmt, params)

    conn = _ConnSetsStop(acquired=False, statements=[])
    monkeypatch.setattr(leader_lock, "_leader_engine", lambda: _engine_yielding(conn))

    async def work(stop) -> None:  # noqa: ANN001
        raise AssertionError("work should not run when lock not acquired")

    await asyncio.wait_for(
        leader_lock.run_as_leader(
            name="lock-b", stop=stop, work=work, retry_seconds=5
        ),
        timeout=5,
    )


@pytest.mark.anyio
async def test_run_as_leader_cancelled_breaks(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_is_postgres", lambda: True)

    def boom_engine():
        raise asyncio.CancelledError

    monkeypatch.setattr(leader_lock, "_leader_engine", boom_engine)

    async def work(stop) -> None:  # noqa: ANN001
        pass

    # CancelledError raised inside the try -> caught -> break -> returns.
    await leader_lock.run_as_leader(name="lock-c", stop=asyncio.Event(), work=work)


@pytest.mark.anyio
async def test_run_as_leader_unexpected_error_then_stops(monkeypatch) -> None:
    monkeypatch.setattr(leader_lock, "_is_postgres", lambda: True)
    stop = asyncio.Event()
    calls = {"n": 0}

    def flaky_engine():
        calls["n"] += 1
        stop.set()  # ensure the backoff wait returns and loop exits
        raise RuntimeError("db down")

    monkeypatch.setattr(leader_lock, "_leader_engine", flaky_engine)

    async def work(stop) -> None:  # noqa: ANN001
        pass

    await asyncio.wait_for(
        leader_lock.run_as_leader(
            name="lock-d", stop=stop, work=work, retry_seconds=0
        ),
        timeout=5,
    )
    assert calls["n"] == 1
