import asyncio
import logging

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.media import MediaJob, MediaJobStatus, MediaJobType
from app.workers import media_worker


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
