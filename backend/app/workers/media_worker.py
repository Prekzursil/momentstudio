from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Awaitable
from typing import TypeVar, cast
from uuid import UUID

from app.core.redis_client import get_redis
from app.db.session import SessionLocal
from app.services import media_dam


logger = logging.getLogger(__name__)
QUEUE_KEY = media_dam.QUEUE_KEY
T = TypeVar("T")


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


async def run_media_worker(poll_interval_seconds: float = 2.0) -> None:
    redis = get_redis()
    if redis is None:
        logger.warning("media_worker_no_redis")
        while True:
            await asyncio.sleep(max(0.1, poll_interval_seconds))
    logger.info("media_worker_started")
    while True:
        try:
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
