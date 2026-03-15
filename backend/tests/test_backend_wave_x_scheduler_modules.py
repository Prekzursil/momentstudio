from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services import account_deletion_scheduler as account_sched
from app.services import admin_report_scheduler as admin_sched
from app.services import fx_refresh as fx_sched
from app.services import sameday_easybox_sync_scheduler as sameday_sched


class _SessionCtx:
    def __init__(self, payload: object = "session") -> None:
        self.payload = payload

    def __aenter__(self):
        return self.payload

    def __aexit__(self, exc_type, exc, tb):
        return False


class _AwaitableTask:
    def __init__(self, *, cancel_raises: bool = False) -> None:
        self.cancel_called = False
        self.cancel_raises = cancel_raises

    def cancel(self) -> None:
        self.cancel_called = True

    def __await__(self):
        def _done():
            if self.cancel_raises:
                raise asyncio.CancelledError
            return None

        return _done().__await__()


def test_account_scheduler_run_once_and_loop_paths(monkeypatch) -> None:
    process = AsyncMock()
    monkeypatch.setattr(account_sched, "SessionLocal", lambda: _SessionCtx("sess"))
    monkeypatch.setattr(account_sched.self_service, "process_due_account_deletions", process)
    monkeypatch.setattr(account_sched.settings, "account_deletion_batch_limit", 17, raising=False)

    asyncio.run(account_sched._run_once())
    process.assert_awaited_once_with("sess", limit=17)

    stop = asyncio.Event()
    run_once = AsyncMock(side_effect=[RuntimeError("boom"), None])
    monkeypatch.setattr(account_sched, "_run_once", run_once)

    async def _wait_for(coro, timeout):
        stop.set()
        await coro
        return None

    monkeypatch.setattr(account_sched.asyncio, "wait_for", _wait_for)
    asyncio.run(account_sched._loop(stop))
    assert run_once.await_count >= 1


def test_admin_scheduler_run_once_and_loop_paths(monkeypatch) -> None:
    send_due = AsyncMock()
    monkeypatch.setattr(admin_sched, "SessionLocal", lambda: _SessionCtx("sess"))
    monkeypatch.setattr(admin_sched.admin_reports, "send_due_reports", send_due)

    asyncio.run(admin_sched._run_once())
    send_due.assert_awaited_once_with("sess")

    stop = asyncio.Event()
    run_once = AsyncMock(side_effect=[None, asyncio.CancelledError()])
    monkeypatch.setattr(admin_sched, "_run_once", run_once)

    async def _wait_for(coro, timeout):
        stop.set()
        await coro
        return None

    monkeypatch.setattr(admin_sched.asyncio, "wait_for", _wait_for)
    asyncio.run(admin_sched._loop(stop))


def test_fx_scheduler_run_once_and_loop_paths(monkeypatch) -> None:
    refresh = AsyncMock()
    monkeypatch.setattr(fx_sched, "SessionLocal", lambda: _SessionCtx("sess"))
    monkeypatch.setattr(fx_sched.fx_store, "refresh_last_known", refresh)
    monkeypatch.setattr(fx_sched.settings, "fx_refresh_interval_seconds", 61, raising=False)

    asyncio.run(fx_sched._refresh_once())
    refresh.assert_awaited_once_with("sess")

    stop = asyncio.Event()
    refresh_once = AsyncMock(side_effect=[None, RuntimeError("err")])
    monkeypatch.setattr(fx_sched, "_refresh_once", refresh_once)

    async def _wait_for(coro, timeout):
        stop.set()
        await coro
        return None

    monkeypatch.setattr(fx_sched.asyncio, "wait_for", _wait_for)
    asyncio.run(fx_sched._refresh_loop(stop))


def test_sameday_scheduler_run_once_and_loop_paths(monkeypatch) -> None:
    monkeypatch.setattr(sameday_sched.settings, "sameday_mirror_enabled", False, raising=False)
    assert asyncio.run(sameday_sched._run_once()) == 0

    monkeypatch.setattr(sameday_sched.settings, "sameday_mirror_enabled", True, raising=False)
    monkeypatch.setattr(sameday_sched, "SessionLocal", lambda: _SessionCtx("sess"))
    monkeypatch.setattr(sameday_sched.sameday_easybox_mirror, "should_run_scheduled_sync", AsyncMock(return_value=False))
    assert asyncio.run(sameday_sched._run_once()) == 0

    monkeypatch.setattr(sameday_sched.sameday_easybox_mirror, "should_run_scheduled_sync", AsyncMock(return_value=True))
    monkeypatch.setattr(
        sameday_sched.sameday_easybox_mirror,
        "sync_now",
        AsyncMock(return_value=SimpleNamespace(status=SimpleNamespace(value="success"))),
    )
    assert asyncio.run(sameday_sched._run_once()) == 1

    monkeypatch.setattr(
        sameday_sched.sameday_easybox_mirror,
        "sync_now",
        AsyncMock(return_value=SimpleNamespace(status=SimpleNamespace(value="failed"))),
    )
    assert asyncio.run(sameday_sched._run_once()) == 0

    stop = asyncio.Event()
    run_once = AsyncMock(return_value=1)
    monkeypatch.setattr(sameday_sched, "_run_once", run_once)

    async def _wait_for(coro, timeout):
        stop.set()
        await coro
        return None

    monkeypatch.setattr(sameday_sched.asyncio, "wait_for", _wait_for)
    asyncio.run(sameday_sched._loop(stop))


def _assert_start_stop_module(monkeypatch, module, *, enabled_attr: str, task_attr: str, stop_attr: str, leader_name: str) -> None:
    app = SimpleNamespace(state=SimpleNamespace())
    monkeypatch.setattr(module.settings, enabled_attr, False, raising=False)
    module.start(app)
    assert getattr(app.state, task_attr, None) is None

    monkeypatch.setattr(module.settings, enabled_attr, True, raising=False)
    leader_runner = AsyncMock(return_value=None)
    monkeypatch.setattr(module.leader_lock, "run_as_leader", leader_runner)

    created = {}

    def _fake_create_task(coro):
        created["coro"] = coro
        return _AwaitableTask(cancel_raises=False)

    monkeypatch.setattr(module.asyncio, "create_task", _fake_create_task)
    module.start(app)
    assert getattr(app.state, task_attr, None) is not None
    assert getattr(app.state, stop_attr, None) is not None
    assert "coro" in created
    created["coro"].close()

    # Already started guard.
    existing_task = _AwaitableTask(cancel_raises=False)
    setattr(app.state, task_attr, existing_task)
    module.start(app)
    assert getattr(app.state, task_attr) is existing_task

    # Stop clears state with cancelled awaitable.
    setattr(app.state, stop_attr, asyncio.Event())
    setattr(app.state, task_attr, _AwaitableTask(cancel_raises=True))
    asyncio.run(module.stop(app))
    assert getattr(app.state, stop_attr, None) is None
    assert getattr(app.state, task_attr, None) is None


def test_start_stop_guards_for_scheduler_modules(monkeypatch) -> None:
    _assert_start_stop_module(
        monkeypatch,
        account_sched,
        enabled_attr="account_deletion_scheduler_enabled",
        task_attr="account_deletion_scheduler_task",
        stop_attr="account_deletion_scheduler_stop",
        leader_name="account_deletion_scheduler",
    )
    _assert_start_stop_module(
        monkeypatch,
        admin_sched,
        enabled_attr="admin_reports_scheduler_enabled",
        task_attr="admin_report_scheduler_task",
        stop_attr="admin_report_scheduler_stop",
        leader_name="admin_report_scheduler",
    )
    _assert_start_stop_module(
        monkeypatch,
        fx_sched,
        enabled_attr="fx_refresh_enabled",
        task_attr="fx_refresh_task",
        stop_attr="fx_refresh_stop",
        leader_name="fx_refresh",
    )
    _assert_start_stop_module(
        monkeypatch,
        sameday_sched,
        enabled_attr="sameday_mirror_enabled",
        task_attr="sameday_easybox_sync_scheduler_task",
        stop_attr="sameday_easybox_sync_scheduler_stop",
        leader_name="sameday_easybox_sync_scheduler",
    )
