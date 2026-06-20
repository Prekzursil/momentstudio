"""Unit tests for ``app.services.fx_refresh`` (slice f-k).

Covers the background FX-refresh scheduler: the one-shot ``_refresh_once``
session helper, every branch of ``_refresh_loop`` (success, CancelledError,
generic-exception logging, and the timed wait), and the ``start``/``stop``
lifecycle on the FastAPI app state. Uses lightweight fakes so no real DB,
event loop scheduler, or leader-election machinery is required.
"""

from __future__ import annotations

import asyncio

import pytest

from app.services import fx_refresh


def _run(coro):
    return asyncio.run(coro)


class _FakeApp:
    def __init__(self) -> None:
        self.state = type("State", (), {})()


class _FakeSessionCtx:
    def __init__(self, recorder: list) -> None:
        self._recorder = recorder

    async def __aenter__(self):
        return "session"

    async def __aexit__(self, *exc):
        return None


def test_refresh_once_uses_session_and_store(monkeypatch) -> None:
    recorder: list = []

    monkeypatch.setattr(
        fx_refresh, "SessionLocal", lambda: _FakeSessionCtx(recorder)
    )

    async def fake_refresh(session):
        recorder.append(session)

    monkeypatch.setattr(fx_refresh.fx_store, "refresh_last_known", fake_refresh)

    _run(fx_refresh._refresh_once())
    assert recorder == ["session"]


def test_refresh_loop_runs_then_stops(monkeypatch) -> None:
    """One successful refresh, then the timed wait observes ``stop`` and exits."""
    calls = {"n": 0}

    async def fake_refresh_once():
        calls["n"] += 1

    monkeypatch.setattr(fx_refresh, "_refresh_once", fake_refresh_once)
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_interval_seconds", 60, raising=False
    )

    async def scenario() -> None:
        stop = asyncio.Event()

        async def fake_wait_for(awaitable, timeout):
            # consume the stop.wait() coroutine to avoid 'never awaited'
            task = asyncio.ensure_future(awaitable)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            stop.set()  # end the loop after the first timed wait
            return None

        monkeypatch.setattr(fx_refresh.asyncio, "wait_for", fake_wait_for)
        await fx_refresh._refresh_loop(stop)

    _run(scenario())
    assert calls["n"] == 1


def test_refresh_loop_logs_generic_exception(monkeypatch) -> None:
    """A non-cancel exception is logged and the loop keeps going until stop."""
    calls = {"n": 0}

    async def boom():
        calls["n"] += 1
        raise RuntimeError("refresh failed")

    monkeypatch.setattr(fx_refresh, "_refresh_once", boom)
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_interval_seconds", 60, raising=False
    )

    warnings: list = []
    monkeypatch.setattr(
        fx_refresh.logger,
        "warning",
        lambda msg, **kw: warnings.append((msg, kw)),
    )

    async def scenario() -> None:
        stop = asyncio.Event()

        async def fake_wait_for(awaitable, timeout):
            task = asyncio.ensure_future(awaitable)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            stop.set()
            return None

        monkeypatch.setattr(fx_refresh.asyncio, "wait_for", fake_wait_for)
        await fx_refresh._refresh_loop(stop)

    _run(scenario())
    assert calls["n"] == 1
    assert warnings and warnings[0][0] == "fx_refresh_failed"


def test_refresh_loop_breaks_on_cancelled(monkeypatch) -> None:
    """A CancelledError from the work breaks the loop immediately."""

    async def cancel():
        raise asyncio.CancelledError()

    monkeypatch.setattr(fx_refresh, "_refresh_once", cancel)
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_interval_seconds", 60, raising=False
    )

    async def scenario() -> None:
        stop = asyncio.Event()
        await fx_refresh._refresh_loop(stop)

    _run(scenario())  # returns cleanly (break), no hang


def test_refresh_loop_timeout_keeps_running(monkeypatch) -> None:
    """``asyncio.TimeoutError`` from the wait is suppressed; the loop continues
    and we stop it after two iterations."""
    calls = {"n": 0}

    async def fake_refresh_once():
        calls["n"] += 1

    monkeypatch.setattr(fx_refresh, "_refresh_once", fake_refresh_once)
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_interval_seconds", 60, raising=False
    )

    async def scenario() -> None:
        stop = asyncio.Event()

        async def fake_wait_for(awaitable, timeout):
            task = asyncio.ensure_future(awaitable)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            if calls["n"] >= 2:
                stop.set()
                return None
            raise asyncio.TimeoutError()  # first wait times out -> loop again

        monkeypatch.setattr(fx_refresh.asyncio, "wait_for", fake_wait_for)
        await fx_refresh._refresh_loop(stop)

    _run(scenario())
    assert calls["n"] == 2


def test_start_disabled_is_noop(monkeypatch) -> None:
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_enabled", False, raising=False
    )
    app = _FakeApp()
    fx_refresh.start(app)
    assert getattr(app.state, "fx_refresh_task", None) is None


def test_start_idempotent_when_task_exists(monkeypatch) -> None:
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_enabled", True, raising=False
    )
    app = _FakeApp()
    app.state.fx_refresh_task = object()  # already running
    fx_refresh.start(app)
    # unchanged sentinel, no new task created
    assert app.state.fx_refresh_task is not None


def test_start_creates_task_then_stop_cleans_up(monkeypatch) -> None:
    monkeypatch.setattr(
        fx_refresh.settings, "fx_refresh_enabled", True, raising=False
    )

    async def fake_run_as_leader(*, name, stop, work):
        # mimic the real loop: run the supplied work until stop is set.
        await stop.wait()

    monkeypatch.setattr(
        fx_refresh.leader_lock, "run_as_leader", fake_run_as_leader
    )

    async def scenario() -> None:
        app = _FakeApp()
        fx_refresh.start(app)
        assert getattr(app.state, "fx_refresh_task", None) is not None
        assert getattr(app.state, "fx_refresh_stop", None) is not None
        await fx_refresh.stop(app)
        # state attrs removed after stop
        assert getattr(app.state, "fx_refresh_task", None) is None
        assert getattr(app.state, "fx_refresh_stop", None) is None

    _run(scenario())


def test_stop_when_nothing_started_is_noop() -> None:
    async def scenario() -> None:
        app = _FakeApp()
        await fx_refresh.stop(app)  # no stop_event / task attrs present

    _run(scenario())
