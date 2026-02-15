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

from app.core.config import settings
from app.core.redis_client import get_redis
from app.db.session import SessionLocal
from app.services import media_dam


logger = logging.getLogger(__name__)
QUEUE_KEY = media_dam.QUEUE_KEY
T = TypeVar("T")
HEARTBEAT_PREFIX = str(getattr(settings, "media_dam_worker_heartbeat_prefix", "media:workers:heartbeat") or "media:workers:heartbeat")
HEARTBEAT_TTL_SECONDS = max(10, int(getattr(settings, "media_dam_worker_heartbeat_ttl_seconds", 30) or 30))
HEARTBEAT_FILE = str(getattr(settings, "media_dam_worker_heartbeat_file", "/tmp/media-worker-heartbeat.json") or "/tmp/media-worker-heartbeat.json")


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


async def run_media_worker(poll_interval_seconds: float = 2.0) -> None:
    redis = get_redis()
    worker_id = _worker_id()
    heartbeat_interval = max(5.0, float(HEARTBEAT_TTL_SECONDS) / 2.0)
    if redis is None:
        logger.warning("media_worker_no_redis")
        while True:
            await _publish_heartbeat(None, worker_id=worker_id)
            await asyncio.sleep(max(0.1, poll_interval_seconds))
    logger.info("media_worker_started")
    last_heartbeat = 0.0
    while True:
        try:
            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                await _publish_heartbeat(redis, worker_id=worker_id)
                last_heartbeat = now
            result = await _await_if_needed(redis.blpop([QUEUE_KEY], timeout=max(1, int(poll_interval_seconds))))
            if not result:
                continue
            _, raw = result
            await _process_job_id(str(raw))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("media_worker_loop_error")
            await asyncio.sleep(max(0.5, poll_interval_seconds))


async def _await_if_needed(result: Awaitable[T] | T) -> T:
    if inspect.isawaitable(result):
        return await cast(Awaitable[T], result)
    return cast(T, result)


def main() -> None:  # pragma: no cover
    asyncio.run(run_media_worker())


if __name__ == "__main__":  # pragma: no cover
    main()
