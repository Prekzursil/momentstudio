from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI
from sqlalchemy import func, select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.media import MediaJob, MediaJobStatus, MediaJobType
from app.services import leader_lock, media_dam

logger = logging.getLogger(__name__)


async def _run_once() -> int:
    if not bool(getattr(settings, "media_usage_reconcile_enabled", True)):
        return 0

    async with SessionLocal() as session:
        pending = int(
            (
                await session.scalar(
                    select(func.count())
                    .select_from(MediaJob)
                    .where(
                        MediaJob.job_type == MediaJobType.usage_reconcile,
                        MediaJob.status.in_((MediaJobStatus.queued, MediaJobStatus.processing)),
                    )
                )
            )
            or 0
        )
        if pending > 0:
            return 0

        limit = max(1, int(getattr(settings, "media_usage_reconcile_batch_size", 200) or 200))
        job = await media_dam.enqueue_job(
            session,
            asset_id=None,
            job_type=MediaJobType.usage_reconcile,
            payload={"limit": limit, "reason": "scheduled_reconcile"},
            created_by_user_id=None,
        )
        await session.commit()
        await media_dam.queue_job(job.id)
        if media_dam.get_redis() is None:
            job = await media_dam.get_job_or_404(session, job.id)
            await media_dam.process_job_inline(session, job)
        return 1


async def _loop(stop: asyncio.Event) -> None:
    interval = max(300, int(getattr(settings, "media_usage_reconcile_interval_seconds", 86400) or 86400))
    while not stop.is_set():
        try:
            queued = await _run_once()
            if queued:
                logger.info("media_usage_reconcile_scheduled", extra={"queued": int(queued)})
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("media_usage_reconcile_scheduler_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not bool(getattr(settings, "media_usage_reconcile_enabled", True)):
        return
    if getattr(app.state, "media_usage_reconcile_scheduler_task", None) is not None:
        return

    stop = asyncio.Event()
    task = asyncio.create_task(
        leader_lock.run_as_leader(name="media_usage_reconcile_scheduler", stop=stop, work=_loop)
    )
    app.state.media_usage_reconcile_scheduler_stop = stop
    app.state.media_usage_reconcile_scheduler_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "media_usage_reconcile_scheduler_stop", None)
    task = getattr(app.state, "media_usage_reconcile_scheduler_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "media_usage_reconcile_scheduler_stop", None) is not None:
        delattr(app.state, "media_usage_reconcile_scheduler_stop")
    if getattr(app.state, "media_usage_reconcile_scheduler_task", None) is not None:
        delattr(app.state, "media_usage_reconcile_scheduler_task")

