from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import socket
import time
from collections.abc import Awaitable
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar, cast
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import settings
from app.core.redis_client import get_redis
from app.db.session import SessionLocal
from app.models.media import MediaJob, MediaJobStatus
from app.services import media_dam


logger = logging.getLogger(__name__)
QUEUE_KEY = media_dam.QUEUE_KEY
T = TypeVar("T")
HEARTBEAT_PREFIX = str(getattr(settings, "media_dam_worker_heartbeat_prefix", "media:workers:heartbeat") or "media:workers:heartbeat")
HEARTBEAT_TTL_SECONDS = max(10, int(getattr(settings, "media_dam_worker_heartbeat_ttl_seconds", 30) or 30))
HEARTBEAT_FILE = str(getattr(settings, "media_dam_worker_heartbeat_file", "/tmp/media-worker-heartbeat.json") or "/tmp/media-worker-heartbeat.json")
RETRY_SWEEP_SECONDS = max(5, int(getattr(settings, "media_dam_retry_sweep_seconds", 10) or 10))
FALLBACK_JOB_BATCH_SIZE = max(1, int(getattr(settings, "media_dam_fallback_job_batch_size", 10) or 10))
FALLBACK_STATS_LOG_SECONDS = max(5, int(getattr(settings, "media_dam_fallback_stats_log_seconds", 30) or 30))
FALLBACK_MAX_SLEEP_SECONDS = max(1.0, float(getattr(settings, "media_dam_fallback_max_sleep_seconds", 5.0) or 5.0))


async def _process_job_id(raw_job_id: str) -> None:
    try:
        job_id = UUID(str(raw_job_id))
    except Exception:
        return
    async with SessionLocal() as session:
        try:
            job = await media_dam.get_job_or_404(session, job_id)
            await media_dam.process_job_inline(session, job)
        except Exception:
            logger.exception("media_worker_job_failed", extra={"job_id": str(job_id)})


async def _enqueue_due_retries_once(limit: int = 50) -> int:
    async with SessionLocal() as session:
        try:
            queued = await media_dam.enqueue_due_retries(session, limit=limit)
            if queued:
                logger.info("media_worker_retry_enqueued", extra={"count": len(queued)})
            return len(queued)
        except Exception:
            logger.exception("media_worker_retry_sweep_failed")
            return 0


async def _process_queued_jobs_once(limit: int = FALLBACK_JOB_BATCH_SIZE) -> int:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(MediaJob)
            .where(MediaJob.status == MediaJobStatus.queued)
            .order_by(MediaJob.created_at.asc())
            .limit(max(1, min(int(limit or 1), 500)))
        )
        jobs = rows.scalars().all()
        processed_count = 0
        for job in jobs:
            try:
                await media_dam.process_job_inline(session, job)
                processed_count += 1
            except Exception:
                logger.exception("media_worker_fallback_job_failed", extra={"job_id": str(job.id)})
        return processed_count


def _worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:8]}"


def _heartbeat_payload(worker_id: str) -> dict[str, object]:
    return {
        "worker_id": worker_id,
        "hostname": socket.gethostname(),
        "pid": os.getpid(),
        "app_version": (getattr(settings, "app_version", "") or "").strip() or None,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }


def _write_heartbeat_file(payload: dict[str, object]) -> None:
    try:
        target = Path(HEARTBEAT_FILE)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(f"{target.suffix}.tmp")
        temp.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        temp.replace(target)
    except Exception:
        logger.exception("media_worker_heartbeat_file_failed")


async def _publish_heartbeat(redis, *, worker_id: str) -> None:
    payload = _heartbeat_payload(worker_id)
    _write_heartbeat_file(payload)
    if redis is None:
        return
    key = f"{HEARTBEAT_PREFIX}:{worker_id}"
    await _await_if_needed(redis.set(key, json.dumps(payload, separators=(",", ":"), ensure_ascii=False), ex=HEARTBEAT_TTL_SECONDS))


def _normalize_job_id_candidate(raw: object) -> str | None:
    if isinstance(raw, bytes):
        candidate = raw.decode("utf-8", errors="ignore")
    elif isinstance(raw, str):
        candidate = raw
    else:
        candidate = str(raw)
    candidate = candidate.strip()
    if not candidate:
        logger.warning(
            "media_worker_invalid_job_payload",
            extra={"raw_type": type(raw).__name__, "raw_repr": repr(raw)},
        )
        return None
    return candidate


async def _run_degraded_worker_loop(*, worker_id: str, bounded_sleep: float, heartbeat_interval: float) -> None:
    logger.warning(
        "media_worker_degraded_mode_started",
        extra={
            "worker_id": worker_id,
            "poll_interval_seconds": bounded_sleep,
            "retry_sweep_seconds": float(RETRY_SWEEP_SECONDS),
            "job_batch_size": int(FALLBACK_JOB_BATCH_SIZE),
        },
    )
    last_heartbeat = 0.0
    last_retry_sweep = 0.0
    last_stats_log = 0.0
    processed_count = 0
    retry_enqueued_count = 0
    while True:
        try:
            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                await _publish_heartbeat(None, worker_id=worker_id)
                last_heartbeat = now
            if now - last_retry_sweep >= float(RETRY_SWEEP_SECONDS):
                retry_enqueued_count += await _enqueue_due_retries_once(limit=100)
                last_retry_sweep = now
            processed_count += await _process_queued_jobs_once(limit=FALLBACK_JOB_BATCH_SIZE)
            if now - last_stats_log >= float(FALLBACK_STATS_LOG_SECONDS):
                logger.warning(
                    "media_worker_degraded_mode_stats",
                    extra={
                        "worker_id": worker_id,
                        "processed_count": processed_count,
                        "retry_enqueued_count": retry_enqueued_count,
                    },
                )
                last_stats_log = now
            await asyncio.sleep(bounded_sleep)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("media_worker_degraded_mode_loop_error", extra={"worker_id": worker_id})
            await asyncio.sleep(bounded_sleep)


async def _run_redis_worker_loop(*, redis, worker_id: str, heartbeat_interval: float, poll_interval_seconds: float) -> None:
    logger.info("media_worker_started")
    last_heartbeat = 0.0
    last_retry_sweep = 0.0
    while True:
        try:
            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                await _publish_heartbeat(redis, worker_id=worker_id)
                last_heartbeat = now
            if now - last_retry_sweep >= float(RETRY_SWEEP_SECONDS):
                await _enqueue_due_retries_once(limit=100)
                last_retry_sweep = now
            result = await _await_if_needed(redis.blpop([QUEUE_KEY], timeout=max(1, int(poll_interval_seconds))))
            if not result:
                continue
            _, raw = result
            candidate = _normalize_job_id_candidate(raw)
            if candidate is None:
                continue
            await _process_job_id(candidate)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("media_worker_loop_error")
            await asyncio.sleep(max(0.5, poll_interval_seconds))


async def run_media_worker(poll_interval_seconds: float = 2.0) -> None:
    redis = get_redis()
    worker_id = _worker_id()
    heartbeat_interval = max(5.0, float(HEARTBEAT_TTL_SECONDS) / 2.0)
    bounded_sleep = min(FALLBACK_MAX_SLEEP_SECONDS, max(0.1, float(poll_interval_seconds)))
    if redis is None:
        await _run_degraded_worker_loop(
            worker_id=worker_id,
            bounded_sleep=bounded_sleep,
            heartbeat_interval=heartbeat_interval,
        )
        return
    await _run_redis_worker_loop(
        redis=redis,
        worker_id=worker_id,
        heartbeat_interval=heartbeat_interval,
        poll_interval_seconds=poll_interval_seconds,
    )


async def _await_if_needed(result: Awaitable[T] | T) -> T:
    if inspect.isawaitable(result):
        return await cast(Awaitable[T], result)
    return cast(T, result)


def main() -> None:  # pragma: no cover
    asyncio.run(run_media_worker())


if __name__ == "__main__":  # pragma: no cover
    main()
