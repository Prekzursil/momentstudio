"""Lean-gate unit coverage for ``app.services.media_usage_reconcile_scheduler``."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.media import MediaJob, MediaJobStatus, MediaJobType
from app.services import media_usage_reconcile_scheduler as sched


def _memory_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401
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


class _FakeJob:
    def __init__(self) -> None:
        self.id = uuid.uuid4()


@pytest.mark.anyio
async def test_run_once_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", False, raising=False
    )
    assert await sched._run_once() == 0


@pytest.mark.anyio
async def test_run_once_skips_when_pending_exists(monkeypatch, session_factory) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", True, raising=False
    )
    async with session_factory() as session:
        session.add(
            MediaJob(
                job_type=MediaJobType.usage_reconcile,
                status=MediaJobStatus.queued,
            )
        )
        await session.commit()
    assert await sched._run_once() == 0


@pytest.mark.anyio
async def test_run_once_enqueues_and_runs_inline_when_no_redis(
    monkeypatch, session_factory
) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", True, raising=False
    )
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_batch_size", 5, raising=False
    )

    job = _FakeJob()
    inline_called = {"v": False}

    async def fake_enqueue(session, **kw):  # noqa: ANN001
        assert kw["job_type"] is MediaJobType.usage_reconcile
        assert kw["payload"]["limit"] == 5
        return job

    async def fake_queue(job_id):  # noqa: ANN001
        assert job_id == job.id

    async def fake_get_job(session, job_id):  # noqa: ANN001
        return job

    async def fake_inline(session, j):  # noqa: ANN001
        inline_called["v"] = True
        return j

    monkeypatch.setattr(sched.media_dam, "enqueue_job", fake_enqueue)
    monkeypatch.setattr(sched.media_dam, "queue_job", fake_queue)
    monkeypatch.setattr(sched.media_dam, "get_redis", lambda: None)
    monkeypatch.setattr(sched.media_dam, "get_job_or_404", fake_get_job)
    monkeypatch.setattr(sched.media_dam, "process_job_inline", fake_inline)

    assert await sched._run_once() == 1
    assert inline_called["v"] is True


@pytest.mark.anyio
async def test_run_once_enqueues_only_when_redis_present(
    monkeypatch, session_factory
) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", True, raising=False
    )
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_batch_size", -3, raising=False
    )  # negative value exercises the max(1, ...) clamp
    job = _FakeJob()
    inline_called = {"v": False}

    async def fake_enqueue(session, **kw):  # noqa: ANN001
        assert kw["payload"]["limit"] == 1
        return job

    async def fake_queue(job_id):  # noqa: ANN001
        return None

    async def fake_inline(session, j):  # noqa: ANN001
        inline_called["v"] = True
        return j

    monkeypatch.setattr(sched.media_dam, "enqueue_job", fake_enqueue)
    monkeypatch.setattr(sched.media_dam, "queue_job", fake_queue)
    monkeypatch.setattr(sched.media_dam, "get_redis", lambda: object())
    monkeypatch.setattr(sched.media_dam, "process_job_inline", fake_inline)

    assert await sched._run_once() == 1
    assert inline_called["v"] is False  # redis present -> no inline processing


# --------------------------------------------------------------------------- #
# _loop                                                                        #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_loop_runs_then_stops(monkeypatch) -> None:
    calls = {"n": 0}
    stop = asyncio.Event()
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_interval_seconds", 4242, raising=False
    )

    async def fake_run_once() -> int:
        calls["n"] += 1
        if calls["n"] >= 2:
            stop.set()
        return 1  # non-zero -> logs

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
    async def boom() -> int:
        raise asyncio.CancelledError

    monkeypatch.setattr(sched, "_run_once", boom)
    await sched._loop(asyncio.Event())


@pytest.mark.anyio
async def test_loop_logs_unexpected_error(monkeypatch) -> None:
    state = {"called": False}
    stop = asyncio.Event()
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_interval_seconds", 4242, raising=False
    )

    async def boom_then_stop() -> int:
        if not state["called"]:
            state["called"] = True
            raise RuntimeError("kaboom")
        stop.set()
        return 0

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


# --------------------------------------------------------------------------- #
# start / stop                                                                 #
# --------------------------------------------------------------------------- #
class _FakeApp:
    def __init__(self) -> None:
        self.state = type("S", (), {})()


@pytest.mark.anyio
async def test_start_disabled_noop(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", False, raising=False
    )
    app = _FakeApp()
    sched.start(app)
    assert getattr(app.state, "media_usage_reconcile_scheduler_task", None) is None


@pytest.mark.anyio
async def test_start_idempotent(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", True, raising=False
    )
    app = _FakeApp()
    app.state.media_usage_reconcile_scheduler_task = "sentinel"
    sched.start(app)
    assert app.state.media_usage_reconcile_scheduler_task == "sentinel"


@pytest.mark.anyio
async def test_start_then_stop(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "media_usage_reconcile_enabled", True, raising=False
    )

    async def fake_leader(*, name, stop, work):  # noqa: ANN001
        await stop.wait()

    monkeypatch.setattr(sched.leader_lock, "run_as_leader", fake_leader)
    app = _FakeApp()
    sched.start(app)
    assert app.state.media_usage_reconcile_scheduler_task is not None
    await sched.stop(app)
    assert getattr(app.state, "media_usage_reconcile_scheduler_task", None) is None
    assert getattr(app.state, "media_usage_reconcile_scheduler_stop", None) is None


@pytest.mark.anyio
async def test_stop_noop_when_idle() -> None:
    await sched.stop(_FakeApp())
