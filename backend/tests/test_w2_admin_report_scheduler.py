"""Lean-gate unit coverage for ``app.services.admin_report_scheduler``.

Mirrors the established scheduler-test pattern (see
``test_lr_media_usage_reconcile_scheduler``) but targets the admin-report
scheduler exclusively, so it is disjoint from any other scheduler test module.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services import admin_report_scheduler as sched


def _memory_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register all ORM tables)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture
def session_factory(monkeypatch):
    factory = _memory_session_factory()
    monkeypatch.setattr(sched, "SessionLocal", factory)
    return factory


# --------------------------------------------------------------------------- #
# _run_once                                                                    #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_run_once_invokes_send_due_reports(monkeypatch, session_factory) -> None:
    seen = {"called": False}

    async def fake_send(session) -> None:  # noqa: ANN001
        seen["called"] = True

    monkeypatch.setattr(sched.admin_reports, "send_due_reports", fake_send)
    await sched._run_once()
    assert seen["called"] is True


# --------------------------------------------------------------------------- #
# _loop                                                                        #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_loop_runs_then_stops(monkeypatch) -> None:
    calls = {"n": 0}
    stop = asyncio.Event()
    monkeypatch.setattr(
        sched.settings, "admin_reports_poll_interval_seconds", 4242, raising=False
    )

    async def fake_run_once() -> None:
        calls["n"] += 1
        if calls["n"] >= 2:
            stop.set()

    monkeypatch.setattr(sched, "_run_once", fake_run_once)

    real_wait_for = asyncio.wait_for

    async def shim_wait_for(awaitable, timeout):  # noqa: ANN001
        if timeout == 4242:
            awaitable.close()
            raise asyncio.TimeoutError
        return await real_wait_for(awaitable, timeout)

    monkeypatch.setattr(sched.asyncio, "wait_for", shim_wait_for)

    await real_wait_for(sched._loop(stop), timeout=5)
    assert calls["n"] == 2


@pytest.mark.anyio
async def test_loop_cancelled_breaks(monkeypatch) -> None:
    async def boom() -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(sched, "_run_once", boom)
    await sched._loop(asyncio.Event())


@pytest.mark.anyio
async def test_loop_logs_unexpected_error(monkeypatch) -> None:
    state = {"called": False}
    stop = asyncio.Event()
    monkeypatch.setattr(
        sched.settings, "admin_reports_poll_interval_seconds", 4242, raising=False
    )

    async def boom_then_stop() -> None:
        if not state["called"]:
            state["called"] = True
            raise RuntimeError("kaboom")
        stop.set()

    monkeypatch.setattr(sched, "_run_once", boom_then_stop)

    real_wait_for = asyncio.wait_for

    async def shim_wait_for(awaitable, timeout):  # noqa: ANN001
        if timeout == 4242:
            awaitable.close()
            raise asyncio.TimeoutError
        return await real_wait_for(awaitable, timeout)

    monkeypatch.setattr(sched.asyncio, "wait_for", shim_wait_for)

    await real_wait_for(sched._loop(stop), timeout=5)
    assert state["called"] is True


def test_loop_interval_clamped_to_minimum(monkeypatch) -> None:
    # A configured interval below the floor must be clamped to 30 seconds; this
    # asserts the exact timeout the loop hands to ``asyncio.wait_for``.
    monkeypatch.setattr(
        sched.settings, "admin_reports_poll_interval_seconds", 1, raising=False
    )
    stop = asyncio.Event()
    seen = {"interval": None}

    async def fake_run_once() -> None:
        return None

    monkeypatch.setattr(sched, "_run_once", fake_run_once)

    async def shim_wait_for(awaitable, timeout):  # noqa: ANN001
        seen["interval"] = timeout
        awaitable.close()
        stop.set()  # end the loop on the next predicate check
        raise asyncio.TimeoutError

    monkeypatch.setattr(sched.asyncio, "wait_for", shim_wait_for)
    asyncio.run(sched._loop(stop))
    assert seen["interval"] == 30


# --------------------------------------------------------------------------- #
# start / stop                                                                 #
# --------------------------------------------------------------------------- #
class _FakeApp:
    def __init__(self) -> None:
        self.state = type("S", (), {})()


@pytest.mark.anyio
async def test_start_disabled_noop(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "admin_reports_scheduler_enabled", False, raising=False
    )
    app = _FakeApp()
    sched.start(app)
    assert getattr(app.state, "admin_report_scheduler_task", None) is None


@pytest.mark.anyio
async def test_start_idempotent(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "admin_reports_scheduler_enabled", True, raising=False
    )
    app = _FakeApp()
    app.state.admin_report_scheduler_task = "sentinel"
    sched.start(app)
    assert app.state.admin_report_scheduler_task == "sentinel"


@pytest.mark.anyio
async def test_start_then_stop(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "admin_reports_scheduler_enabled", True, raising=False
    )

    async def fake_leader(*, name, stop, work):  # noqa: ANN001
        await stop.wait()

    monkeypatch.setattr(sched.leader_lock, "run_as_leader", fake_leader)
    app = _FakeApp()
    sched.start(app)
    assert app.state.admin_report_scheduler_task is not None
    await sched.stop(app)
    assert getattr(app.state, "admin_report_scheduler_task", None) is None
    assert getattr(app.state, "admin_report_scheduler_stop", None) is None


@pytest.mark.anyio
async def test_stop_noop_when_idle() -> None:
    await sched.stop(_FakeApp())
