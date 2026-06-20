"""Lean-gate unit coverage for ``app.workers.media_worker``."""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.media import MediaJob, MediaJobStatus, MediaJobType
from app.workers import media_worker as mw


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
    monkeypatch.setattr(mw, "SessionLocal", factory)
    return factory


# --------------------------------------------------------------------------- #
# _process_job_id                                                              #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_process_job_id_invalid_uuid(session_factory, monkeypatch) -> None:
    called = {"v": False}

    async def fake_get(*a, **k):  # noqa: ANN002, ANN003
        called["v"] = True

    monkeypatch.setattr(mw.media_dam, "get_job_or_404", fake_get)
    await mw._process_job_id("not-a-uuid")
    assert called["v"] is False


@pytest.mark.anyio
async def test_process_job_id_success(session_factory, monkeypatch) -> None:
    job = object()
    processed = {"v": False}

    async def fake_get(session, job_id):  # noqa: ANN001
        return job

    async def fake_inline(session, j):  # noqa: ANN001
        processed["v"] = True

    monkeypatch.setattr(mw.media_dam, "get_job_or_404", fake_get)
    monkeypatch.setattr(mw.media_dam, "process_job_inline", fake_inline)
    await mw._process_job_id(str(uuid.uuid4()))
    assert processed["v"] is True


@pytest.mark.anyio
async def test_process_job_id_error_logged(session_factory, monkeypatch) -> None:
    async def boom(*a, **k):  # noqa: ANN002, ANN003
        raise RuntimeError("fail")

    monkeypatch.setattr(mw.media_dam, "get_job_or_404", boom)
    await mw._process_job_id(str(uuid.uuid4()))  # exception swallowed


# --------------------------------------------------------------------------- #
# _enqueue_due_retries_once                                                    #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_enqueue_due_retries_success(session_factory, monkeypatch) -> None:
    async def fake_enqueue(session, *, limit):  # noqa: ANN001
        return ["a", "b"]

    monkeypatch.setattr(mw.media_dam, "enqueue_due_retries", fake_enqueue)
    assert await mw._enqueue_due_retries_once() == 2


@pytest.mark.anyio
async def test_enqueue_due_retries_empty(session_factory, monkeypatch) -> None:
    async def fake_enqueue(session, *, limit):  # noqa: ANN001
        return []

    monkeypatch.setattr(mw.media_dam, "enqueue_due_retries", fake_enqueue)
    assert await mw._enqueue_due_retries_once() == 0


@pytest.mark.anyio
async def test_enqueue_due_retries_error(session_factory, monkeypatch) -> None:
    async def boom(session, *, limit):  # noqa: ANN001
        raise RuntimeError("x")

    monkeypatch.setattr(mw.media_dam, "enqueue_due_retries", boom)
    assert await mw._enqueue_due_retries_once() == 0


# --------------------------------------------------------------------------- #
# _process_queued_jobs_once                                                    #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_process_queued_jobs(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        session.add(
            MediaJob(
                job_type=MediaJobType.usage_reconcile, status=MediaJobStatus.queued
            )
        )
        session.add(
            MediaJob(
                job_type=MediaJobType.usage_reconcile, status=MediaJobStatus.queued
            )
        )
        await session.commit()

    calls = {"n": 0}

    async def fake_inline(session, job):  # noqa: ANN001
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("second fails")

    monkeypatch.setattr(mw.media_dam, "process_job_inline", fake_inline)
    # One succeeds, one raises (logged) -> processed_count == 1.
    assert await mw._process_queued_jobs_once() == 1


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def test_worker_id_format() -> None:
    wid = mw._worker_id()
    assert wid.count("-") >= 2


def test_heartbeat_payload() -> None:
    payload = mw._heartbeat_payload("w1")
    assert payload["worker_id"] == "w1"
    assert "last_seen_at" in payload


def test_write_heartbeat_file(tmp_path, monkeypatch) -> None:
    target = tmp_path / "hb.json"
    monkeypatch.setattr(mw, "HEARTBEAT_FILE", str(target))
    mw._write_heartbeat_file({"worker_id": "w"})
    assert json.loads(target.read_text())["worker_id"] == "w"


def test_write_heartbeat_file_error(monkeypatch) -> None:
    # Force an error inside the write to exercise the except branch.
    def boom(*a, **k):  # noqa: ANN002, ANN003
        raise OSError("no disk")

    monkeypatch.setattr(mw.Path, "mkdir", boom)
    monkeypatch.setattr(mw, "HEARTBEAT_FILE", "/some/dir/hb.json")
    mw._write_heartbeat_file({"worker_id": "w"})  # swallowed


@pytest.mark.anyio
async def test_publish_heartbeat_no_redis(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(mw, "HEARTBEAT_FILE", str(tmp_path / "hb.json"))
    await mw._publish_heartbeat(None, worker_id="w")  # writes file, returns


@pytest.mark.anyio
async def test_publish_heartbeat_with_redis(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(mw, "HEARTBEAT_FILE", str(tmp_path / "hb.json"))
    sets: list[tuple] = []

    class _Redis:
        async def set(self, key, value, ex=None):  # noqa: ANN001
            sets.append((key, ex))

    await mw._publish_heartbeat(_Redis(), worker_id="w")
    assert sets and sets[0][1] == mw.HEARTBEAT_TTL_SECONDS


def test_normalize_job_id_candidate_bytes() -> None:
    assert mw._normalize_job_id_candidate(b"abc") == "abc"


def test_normalize_job_id_candidate_str() -> None:
    assert mw._normalize_job_id_candidate("  xyz  ") == "xyz"


def test_normalize_job_id_candidate_other() -> None:
    assert mw._normalize_job_id_candidate(123) == "123"


def test_normalize_job_id_candidate_empty() -> None:
    assert mw._normalize_job_id_candidate("   ") is None


@pytest.mark.anyio
async def test_await_if_needed_awaitable() -> None:
    async def coro():
        return 42

    assert await mw._await_if_needed(coro()) == 42


@pytest.mark.anyio
async def test_await_if_needed_plain() -> None:
    assert await mw._await_if_needed(7) == 7


# --------------------------------------------------------------------------- #
# run_media_worker (degraded / redis modes, driven to a controlled stop)       #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_run_worker_degraded_mode(monkeypatch) -> None:
    monkeypatch.setattr(mw, "get_redis", lambda: None)
    monkeypatch.setattr(mw, "RETRY_SWEEP_SECONDS", 0)
    monkeypatch.setattr(mw, "FALLBACK_STATS_LOG_SECONDS", 0)

    async def fake_hb(redis, *, worker_id):  # noqa: ANN001
        return None

    retries = {"n": 0}

    async def fake_retries(*, limit):  # noqa: ANN001
        retries["n"] += 1
        return 1

    async def fake_jobs(*, limit):  # noqa: ANN001
        return 1

    monkeypatch.setattr(mw, "_publish_heartbeat", fake_hb)
    monkeypatch.setattr(mw, "_enqueue_due_retries_once", fake_retries)
    monkeypatch.setattr(mw, "_process_queued_jobs_once", fake_jobs)

    iterations = {"n": 0}

    async def fake_sleep(seconds):  # noqa: ANN001
        iterations["n"] += 1
        if iterations["n"] >= 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(mw.asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        await mw.run_media_worker(poll_interval_seconds=1.0)
    assert retries["n"] >= 1


@pytest.mark.anyio
async def test_run_worker_degraded_mode_handles_loop_error(monkeypatch) -> None:
    monkeypatch.setattr(mw, "get_redis", lambda: None)

    async def boom_hb(redis, *, worker_id):  # noqa: ANN001
        raise RuntimeError("hb down")

    monkeypatch.setattr(mw, "_publish_heartbeat", boom_hb)

    sleeps = {"n": 0}

    async def fake_sleep(seconds):  # noqa: ANN001
        sleeps["n"] += 1
        raise asyncio.CancelledError

    monkeypatch.setattr(mw.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await mw.run_media_worker(poll_interval_seconds=1.0)
    assert sleeps["n"] == 1


@pytest.mark.anyio
async def test_run_worker_redis_mode(monkeypatch) -> None:
    monkeypatch.setattr(mw, "RETRY_SWEEP_SECONDS", 0)

    state = {"i": 0}

    class _Redis:
        async def set(self, *a, **k):  # noqa: ANN002, ANN003
            return None

        async def blpop(self, keys, timeout=None):  # noqa: ANN001
            state["i"] += 1
            if state["i"] == 1:
                return None  # empty -> continue
            if state["i"] == 2:
                return ("q", b"job-123")
            raise asyncio.CancelledError

    monkeypatch.setattr(mw, "get_redis", lambda: _Redis())

    async def fake_hb(redis, *, worker_id):  # noqa: ANN001
        return None

    async def fake_retries(*, limit):  # noqa: ANN001
        return 0

    processed = {"v": None}

    async def fake_process(candidate):  # noqa: ANN001
        processed["v"] = candidate

    monkeypatch.setattr(mw, "_publish_heartbeat", fake_hb)
    monkeypatch.setattr(mw, "_enqueue_due_retries_once", fake_retries)
    monkeypatch.setattr(mw, "_process_job_id", fake_process)

    with pytest.raises(asyncio.CancelledError):
        await mw.run_media_worker(poll_interval_seconds=1.0)
    assert processed["v"] == "job-123"


@pytest.mark.anyio
async def test_run_worker_degraded_skips_intervals(monkeypatch) -> None:
    # Deterministic clock that never advances -> retry-sweep and stats-log are
    # skipped after their first firing (189->192, 195->205).
    monkeypatch.setattr(mw.time, "monotonic", lambda: 100000.0)

    monkeypatch.setattr(mw, "get_redis", lambda: None)

    async def fake_hb(redis, *, worker_id):  # noqa: ANN001
        return None

    retries = {"n": 0}

    async def fake_retries(*, limit):  # noqa: ANN001
        retries["n"] += 1
        return 0

    jobs = {"n": 0}

    async def fake_jobs(*, limit):  # noqa: ANN001
        jobs["n"] += 1
        return 0

    monkeypatch.setattr(mw, "_publish_heartbeat", fake_hb)
    monkeypatch.setattr(mw, "_enqueue_due_retries_once", fake_retries)
    monkeypatch.setattr(mw, "_process_queued_jobs_once", fake_jobs)

    sleeps = {"n": 0}

    async def fake_sleep(seconds):  # noqa: ANN001
        sleeps["n"] += 1
        if sleeps["n"] >= 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(mw.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await mw.run_media_worker(poll_interval_seconds=1.0)
    # First iteration fires retry+stats (now-0 >= 0); second iteration skips both
    # because the clock never advanced, yet jobs run every iteration.
    assert retries["n"] == 1
    assert jobs["n"] == 2


@pytest.mark.anyio
async def test_run_worker_redis_mode_skips_sweep_and_empty_candidate(
    monkeypatch,
) -> None:
    # Frozen clock -> after the first sweep fires, the second iteration skips it
    # (223->226). A blank payload exercises the ``candidate is None`` continue.
    monkeypatch.setattr(mw.time, "monotonic", lambda: 100000.0)
    state = {"i": 0}

    class _Redis:
        async def set(self, *a, **k):  # noqa: ANN002, ANN003
            return None

        async def blpop(self, keys, timeout=None):  # noqa: ANN001
            state["i"] += 1
            if state["i"] == 1:
                return ("q", b"   ")  # blank -> normalize None -> continue (234)
            raise asyncio.CancelledError

    monkeypatch.setattr(mw, "get_redis", lambda: _Redis())

    async def fake_hb(redis, *, worker_id):  # noqa: ANN001
        return None

    retries = {"n": 0}

    async def fake_retries(*, limit):  # noqa: ANN001
        retries["n"] += 1
        return 0

    process_called = {"v": False}

    async def fake_process(candidate):  # noqa: ANN001
        process_called["v"] = True

    monkeypatch.setattr(mw, "_publish_heartbeat", fake_hb)
    monkeypatch.setattr(mw, "_enqueue_due_retries_once", fake_retries)
    monkeypatch.setattr(mw, "_process_job_id", fake_process)

    with pytest.raises(asyncio.CancelledError):
        await mw.run_media_worker(poll_interval_seconds=1.0)
    assert retries["n"] == 1  # second iteration skipped the sweep
    assert process_called["v"] is False  # blank payload never processed


@pytest.mark.anyio
async def test_run_worker_redis_mode_loop_error(monkeypatch) -> None:
    class _Redis:
        async def set(self, *a, **k):  # noqa: ANN002, ANN003
            return None

        async def blpop(self, keys, timeout=None):  # noqa: ANN001
            raise RuntimeError("redis blip")

    monkeypatch.setattr(mw, "get_redis", lambda: _Redis())

    async def fake_hb(redis, *, worker_id):  # noqa: ANN001
        return None

    async def fake_retries(*, limit):  # noqa: ANN001
        return 0

    monkeypatch.setattr(mw, "_publish_heartbeat", fake_hb)
    monkeypatch.setattr(mw, "_enqueue_due_retries_once", fake_retries)

    sleeps = {"n": 0}

    async def fake_sleep(seconds):  # noqa: ANN001
        sleeps["n"] += 1
        raise asyncio.CancelledError

    monkeypatch.setattr(mw.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await mw.run_media_worker(poll_interval_seconds=1.0)
    assert sleeps["n"] == 1
