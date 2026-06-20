"""Worker-7 coverage tests for ``app.services.account_deletion_scheduler``.

Self-contained: this file alone drives the scheduler module to 100% line and
branch coverage. The scheduler is a thin background-loop wrapper, so every test
patches its collaborators (``SessionLocal``, ``self_service``, ``leader_lock``)
to keep the unit hermetic and free of real database / network access.
"""

from __future__ import annotations

import asyncio

import pytest

from app.services import account_deletion_scheduler as scheduler


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _FakeSession:
    """Minimal async-context-manager stand-in for ``SessionLocal()``."""

    def __init__(self, recorder: list[str]) -> None:
        self._recorder = recorder

    async def __aenter__(self) -> "_FakeSession":
        self._recorder.append("enter")
        return self

    async def __aexit__(self, *exc: object) -> bool:
        self._recorder.append("exit")
        return False


class _FakeAppState:
    pass


class _FakeApp:
    def __init__(self) -> None:
        self.state = _FakeAppState()


# --------------------------------------------------------------------------- #
# _run_once
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_run_once_uses_configured_batch_limit(monkeypatch) -> None:
    recorder: list[str] = []
    seen: dict[str, object] = {}

    monkeypatch.setattr(
        scheduler, "SessionLocal", lambda: _FakeSession(recorder)
    )
    monkeypatch.setattr(
        scheduler.settings, "account_deletion_batch_limit", 50, raising=False
    )

    async def fake_process(session: object, *, limit: int) -> None:
        seen["session"] = session
        seen["limit"] = limit

    monkeypatch.setattr(
        scheduler.self_service, "process_due_account_deletions", fake_process
    )

    await scheduler._run_once()

    assert seen["limit"] == 50
    assert recorder == ["enter", "exit"]
    assert isinstance(seen["session"], _FakeSession)


@pytest.mark.anyio("asyncio")
async def test_run_once_falls_back_to_default_limit(monkeypatch) -> None:
    """A falsy / zero configured limit collapses to the 200 default."""
    recorder: list[str] = []
    seen: dict[str, int] = {}

    monkeypatch.setattr(
        scheduler, "SessionLocal", lambda: _FakeSession(recorder)
    )
    # ``0`` is falsy -> ``or 200`` kicks in, then ``max(1, 200)``.
    monkeypatch.setattr(
        scheduler.settings, "account_deletion_batch_limit", 0, raising=False
    )

    async def fake_process(session: object, *, limit: int) -> None:
        seen["limit"] = limit

    monkeypatch.setattr(
        scheduler.self_service, "process_due_account_deletions", fake_process
    )

    await scheduler._run_once()
    assert seen["limit"] == 200


# --------------------------------------------------------------------------- #
# _loop
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_loop_runs_then_exits_when_stop_set(monkeypatch) -> None:
    """Happy path: one iteration runs, the wait observes ``stop`` and the
    ``while not stop.is_set()`` guard ends the loop."""
    calls: list[int] = []
    stop = asyncio.Event()

    async def fake_run_once() -> None:
        calls.append(1)
        stop.set()  # cause the wait to resolve and the guard to exit

    monkeypatch.setattr(scheduler, "_run_once", fake_run_once)
    monkeypatch.setattr(
        scheduler.settings,
        "account_deletion_poll_interval_seconds",
        600,
        raising=False,
    )

    await asyncio.wait_for(scheduler._loop(stop), timeout=5)
    assert calls == [1]


@pytest.mark.anyio("asyncio")
async def test_loop_breaks_on_cancelled_error(monkeypatch) -> None:
    """``CancelledError`` from the work coroutine breaks the loop cleanly."""
    stop = asyncio.Event()

    async def fake_run_once() -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(scheduler, "_run_once", fake_run_once)

    # Should return (break), not propagate CancelledError.
    await asyncio.wait_for(scheduler._loop(stop), timeout=5)
    assert not stop.is_set()


@pytest.mark.anyio("asyncio")
async def test_loop_logs_and_continues_on_generic_exception(monkeypatch) -> None:
    """A generic exception is logged and the loop keeps going until stop."""
    calls: list[int] = []
    warnings: list[str] = []
    stop = asyncio.Event()

    async def fake_run_once() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        stop.set()

    monkeypatch.setattr(scheduler, "_run_once", fake_run_once)
    monkeypatch.setattr(
        scheduler.logger,
        "warning",
        lambda msg, **kw: warnings.append((msg, kw.get("extra"))),
    )
    monkeypatch.setattr(
        scheduler.settings,
        "account_deletion_poll_interval_seconds",
        1,
        raising=False,
    )

    real_wait_for = asyncio.wait_for

    async def fast_wait_for(coro, timeout):  # type: ignore[no-untyped-def]
        # Resolve the inter-iteration wait immediately instead of blocking the
        # floored 30s interval after the failing first iteration.
        coro.close()
        return None

    monkeypatch.setattr(scheduler.asyncio, "wait_for", fast_wait_for)

    await real_wait_for(scheduler._loop(stop), timeout=5)

    assert len(calls) == 2
    assert warnings
    msg, extra = warnings[0]
    assert msg == "account_deletion_scheduler_failed"
    assert extra == {"error": "boom"}


@pytest.mark.anyio("asyncio")
async def test_loop_waits_full_interval_then_continues(monkeypatch) -> None:
    """When the interval elapses (TimeoutError suppressed) the loop iterates
    again; we shorten the wait by patching ``asyncio.wait_for``."""
    calls: list[int] = []
    stop = asyncio.Event()

    async def fake_run_once() -> None:
        calls.append(1)
        if len(calls) >= 2:
            stop.set()

    waited: list[float] = []
    real_wait_for = asyncio.wait_for

    async def fast_wait_for(coro, timeout):  # type: ignore[no-untyped-def]
        waited.append(timeout)
        # Close the real wait coroutine and simulate the interval elapsing
        # (TimeoutError) on the first pass so the suppress() branch runs.
        coro.close()
        if len(waited) == 1:
            raise asyncio.TimeoutError
        return None

    monkeypatch.setattr(scheduler, "_run_once", fake_run_once)
    monkeypatch.setattr(scheduler.asyncio, "wait_for", fast_wait_for)
    monkeypatch.setattr(
        scheduler.settings,
        "account_deletion_poll_interval_seconds",
        45,
        raising=False,
    )

    await real_wait_for(scheduler._loop(stop), timeout=5)
    assert len(calls) == 2
    # Interval honored as the wait timeout (max(30, 45) == 45).
    assert waited[0] == 45


# --------------------------------------------------------------------------- #
# start
# --------------------------------------------------------------------------- #
def test_start_noop_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        scheduler.settings,
        "account_deletion_scheduler_enabled",
        False,
        raising=False,
    )
    app = _FakeApp()
    scheduler.start(app)
    assert getattr(app.state, "account_deletion_scheduler_task", None) is None


def test_start_noop_when_task_already_running(monkeypatch) -> None:
    monkeypatch.setattr(
        scheduler.settings,
        "account_deletion_scheduler_enabled",
        True,
        raising=False,
    )
    app = _FakeApp()
    sentinel = object()
    app.state.account_deletion_scheduler_task = sentinel

    created: list[object] = []
    monkeypatch.setattr(
        scheduler.asyncio,
        "create_task",
        lambda coro: created.append(coro),
    )

    scheduler.start(app)
    # Existing task untouched, no new task created.
    assert app.state.account_deletion_scheduler_task is sentinel
    assert created == []


def test_start_creates_task(monkeypatch) -> None:
    monkeypatch.setattr(
        scheduler.settings,
        "account_deletion_scheduler_enabled",
        True,
        raising=False,
    )
    app = _FakeApp()

    captured: dict[str, object] = {}

    async def fake_run_as_leader(*, name, stop, work):  # type: ignore[no-untyped-def]
        captured["name"] = name
        captured["stop"] = stop
        captured["work"] = work

    monkeypatch.setattr(
        scheduler.leader_lock, "run_as_leader", fake_run_as_leader
    )

    class _FakeTask:
        def __init__(self, coro: object) -> None:
            self.coro = coro
            # Avoid "coroutine never awaited" warnings.
            coro.close()

    monkeypatch.setattr(scheduler.asyncio, "create_task", _FakeTask)

    scheduler.start(app)

    assert isinstance(app.state.account_deletion_scheduler_task, _FakeTask)
    assert isinstance(app.state.account_deletion_scheduler_stop, asyncio.Event)


# --------------------------------------------------------------------------- #
# stop
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_stop_cancels_running_task_and_clears_state() -> None:
    app = _FakeApp()
    stop_event = asyncio.Event()

    async def _never() -> None:
        await asyncio.Event().wait()

    task = asyncio.create_task(_never())
    app.state.account_deletion_scheduler_stop = stop_event
    app.state.account_deletion_scheduler_task = task

    await scheduler.stop(app)

    assert stop_event.is_set()
    assert task.cancelled()
    assert getattr(app.state, "account_deletion_scheduler_stop", None) is None
    assert getattr(app.state, "account_deletion_scheduler_task", None) is None


@pytest.mark.anyio("asyncio")
async def test_stop_noop_when_nothing_to_stop() -> None:
    """No event and no task on state -> all guards are skipped, no errors."""
    app = _FakeApp()
    await scheduler.stop(app)
    assert getattr(app.state, "account_deletion_scheduler_stop", None) is None
    assert getattr(app.state, "account_deletion_scheduler_task", None) is None
