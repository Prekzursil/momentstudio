import asyncio
import logging
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.media import MediaJob, MediaJobStatus, MediaJobType
from app.workers import media_worker


class _RedisStub:
    def __init__(self, payload):
        self._payload = payload
        self._calls = 0

    async def set(self, *_args, **_kwargs):
        return True

    async def blpop(self, *_args, **_kwargs):
        if self._calls == 0:
            self._calls += 1
            return (media_worker.QUEUE_KEY, self._payload)
        raise asyncio.CancelledError


@pytest.mark.anyio("asyncio")
async def test_process_queued_jobs_once_advances_jobs_without_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    test_session_factory = async_sessionmaker(engine, expire_on_commit=False)

    monkeypatch.setattr(media_worker, "SessionLocal", test_session_factory)

    async with test_session_factory() as session:
        job = MediaJob(job_type=MediaJobType.usage_reconcile, status=MediaJobStatus.queued, payload_json="{}")
        session.add(job)
        await session.commit()
        job_id = job.id

    async def _fake_process_job_inline(session, job):
        job.status = MediaJobStatus.completed
        session.add(job)
        await session.commit()
        return job

    monkeypatch.setattr(media_worker.media_dam, "process_job_inline", _fake_process_job_inline)

    processed_count = await media_worker._process_queued_jobs_once(limit=10)
    assert processed_count == 1

    async with test_session_factory() as session:
        refreshed = await session.scalar(select(MediaJob).where(MediaJob.id == job_id))
        assert refreshed is not None
        assert refreshed.status == MediaJobStatus.completed


@pytest.mark.anyio("asyncio")
async def test_run_media_worker_fallback_runs_retries_and_logs(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    calls = {"retry": 0, "process": 0, "heartbeat": 0, "sleep": 0}

    monkeypatch.setattr(media_worker, "get_redis", lambda: None)

    async def _fake_heartbeat(_redis, *, worker_id: str):
        calls["heartbeat"] += 1

    async def _fake_enqueue(*, limit: int = 50) -> int:
        calls["retry"] += 1
        return 2

    async def _fake_process(*, limit: int = media_worker.FALLBACK_JOB_BATCH_SIZE) -> int:
        calls["process"] += 1
        return 1

    async def _fake_sleep(_seconds: float) -> None:
        calls["sleep"] += 1
        raise asyncio.CancelledError()

    monkeypatch.setattr(media_worker, "_publish_heartbeat", _fake_heartbeat)
    monkeypatch.setattr(media_worker, "_enqueue_due_retries_once", _fake_enqueue)
    monkeypatch.setattr(media_worker, "_process_queued_jobs_once", _fake_process)
    monkeypatch.setattr(media_worker.asyncio, "sleep", _fake_sleep)

    with caplog.at_level(logging.WARNING):
        with pytest.raises(asyncio.CancelledError):
            await media_worker.run_media_worker(poll_interval_seconds=0.01)

    assert calls["heartbeat"] >= 1
    assert calls["retry"] >= 1
    assert calls["process"] >= 1
    assert calls["sleep"] >= 1
    assert "media_worker_degraded_mode_started" in caplog.text
    assert "media_worker_degraded_mode_stats" in caplog.text


@pytest.mark.anyio
@pytest.mark.parametrize("payload", [str(uuid4()).encode("utf-8"), str(uuid4())])
async def test_run_media_worker_normalizes_decode_modes(monkeypatch: pytest.MonkeyPatch, payload) -> None:
    redis = _RedisStub(payload)
    process_mock = AsyncMock()

    monkeypatch.setattr(media_worker, "get_redis", lambda: redis)
    monkeypatch.setattr(media_worker, "_process_job_id", process_mock)
    monkeypatch.setattr(media_worker, "_publish_heartbeat", AsyncMock())
    monkeypatch.setattr(media_worker, "_enqueue_due_retries_once", AsyncMock())

    with pytest.raises(asyncio.CancelledError):
        await media_worker.run_media_worker(poll_interval_seconds=1)

    process_mock.assert_awaited_once()
    expected = payload.decode("utf-8") if isinstance(payload, bytes) else payload
    assert process_mock.await_args.args == (expected.strip(),)


@pytest.mark.anyio
async def test_run_media_worker_logs_warning_on_invalid_payload(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    redis = _RedisStub(b"\xff\xfe")
    process_mock = AsyncMock()

    monkeypatch.setattr(media_worker, "get_redis", lambda: redis)
    monkeypatch.setattr(media_worker, "_process_job_id", process_mock)
    monkeypatch.setattr(media_worker, "_publish_heartbeat", AsyncMock())
    monkeypatch.setattr(media_worker, "_enqueue_due_retries_once", AsyncMock())

    with caplog.at_level("WARNING"):
        with pytest.raises(asyncio.CancelledError):
            await media_worker.run_media_worker(poll_interval_seconds=1)

    process_mock.assert_not_awaited()
    assert "media_worker_invalid_job_payload" in caplog.text
