"""Lean-gate unit coverage for ``app.services.sameday_easybox_sync_scheduler``.

Covers ``_run_once`` (disabled, should-not-run, success and non-success runs),
``_loop`` (one refreshed iteration, an exception iteration, and clean stop),
and the ``start`` / ``stop`` lifecycle (disabled no-op, already-running no-op,
real create + cancellation teardown).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace


from app.services import sameday_easybox_sync_scheduler as sched
from tests.conftest import make_memory_session_factory


class _Run:
    def __init__(self, status: str) -> None:
        self.status = SimpleNamespace(value=status)


def test_run_once_disabled(monkeypatch) -> None:
    monkeypatch.setattr(sched.settings, "sameday_mirror_enabled", False, raising=False)
    assert asyncio.run(sched._run_once()) == 0


def test_run_once_should_not_run(monkeypatch) -> None:
    monkeypatch.setattr(sched.settings, "sameday_mirror_enabled", True, raising=False)
    monkeypatch.setattr(sched, "SessionLocal", make_memory_session_factory())

    async def _should_run(_session):
        return False

    monkeypatch.setattr(
        sched.sameday_easybox_mirror, "should_run_scheduled_sync", _should_run
    )
    assert asyncio.run(sched._run_once()) == 0


def test_run_once_success_and_failure(monkeypatch) -> None:
    monkeypatch.setattr(sched.settings, "sameday_mirror_enabled", True, raising=False)
    monkeypatch.setattr(sched, "SessionLocal", make_memory_session_factory())

    async def _should_run(_session):
        return True

    monkeypatch.setattr(
        sched.sameday_easybox_mirror, "should_run_scheduled_sync", _should_run
    )

    async def _sync_success(_session, *, trigger):
        assert trigger == "scheduled"
        return _Run("success")

    monkeypatch.setattr(sched.sameday_easybox_mirror, "sync_now", _sync_success)
    assert asyncio.run(sched._run_once()) == 1

    async def _sync_fail(_session, *, trigger):
        return _Run("error")

    monkeypatch.setattr(sched.sameday_easybox_mirror, "sync_now", _sync_fail)
    assert asyncio.run(sched._run_once()) == 0


def test_loop_refreshed_then_stops(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "sameday_mirror_sync_interval_seconds", 300, raising=False
    )
    stop = asyncio.Event()
    calls = {"n": 0}

    async def _run_once():
        calls["n"] += 1
        stop.set()  # request stop after the first refreshed iteration
        return 1

    monkeypatch.setattr(sched, "_run_once", _run_once)

    asyncio.run(sched._loop(stop))
    assert calls["n"] == 1


def test_loop_not_refreshed_then_stops(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "sameday_mirror_sync_interval_seconds", 300, raising=False
    )
    stop = asyncio.Event()
    calls = {"n": 0}

    async def _run_once():
        calls["n"] += 1
        stop.set()
        return 0  # not refreshed -> skips the info log branch

    monkeypatch.setattr(sched, "_run_once", _run_once)
    asyncio.run(sched._loop(stop))
    assert calls["n"] == 1


def test_loop_handles_exception(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "sameday_mirror_sync_interval_seconds", 300, raising=False
    )
    stop = asyncio.Event()
    calls = {"n": 0}

    async def _boom():
        calls["n"] += 1
        stop.set()
        raise RuntimeError("kaboom")

    monkeypatch.setattr(sched, "_run_once", _boom)
    # Should log the warning and exit on stop without propagating.
    asyncio.run(sched._loop(stop))
    assert calls["n"] == 1


def test_loop_cancelled_breaks(monkeypatch) -> None:
    stop = asyncio.Event()

    async def _cancel():
        raise asyncio.CancelledError()

    monkeypatch.setattr(sched, "_run_once", _cancel)
    # CancelledError inside the body breaks the loop cleanly.
    asyncio.run(sched._loop(stop))


def test_start_disabled_is_noop(monkeypatch) -> None:
    monkeypatch.setattr(sched.settings, "sameday_mirror_enabled", False, raising=False)
    app = SimpleNamespace(state=SimpleNamespace())
    sched.start(app)
    assert getattr(app.state, "sameday_easybox_sync_scheduler_task", None) is None


def test_start_already_running_is_noop(monkeypatch) -> None:
    monkeypatch.setattr(sched.settings, "sameday_mirror_enabled", True, raising=False)
    app = SimpleNamespace(
        state=SimpleNamespace(sameday_easybox_sync_scheduler_task="existing")
    )
    sched.start(app)
    assert app.state.sameday_easybox_sync_scheduler_task == "existing"


def test_start_and_stop_lifecycle(monkeypatch) -> None:
    monkeypatch.setattr(sched.settings, "sameday_mirror_enabled", True, raising=False)

    async def _run_as_leader(*, name, stop, work):
        # Block until cancelled (mimics the real leader loop being torn down).
        await stop.wait()

    monkeypatch.setattr(sched.leader_lock, "run_as_leader", _run_as_leader)

    async def run() -> None:
        app = SimpleNamespace(state=SimpleNamespace())
        sched.start(app)
        assert app.state.sameday_easybox_sync_scheduler_task is not None
        await sched.stop(app)
        assert getattr(app.state, "sameday_easybox_sync_scheduler_task", None) is None
        assert getattr(app.state, "sameday_easybox_sync_scheduler_stop", None) is None

    asyncio.run(run())


def test_stop_when_nothing_running() -> None:
    async def run() -> None:
        app = SimpleNamespace(state=SimpleNamespace())
        # No task/stop set -> all guards take the no-op path.
        await sched.stop(app)

    asyncio.run(run())
