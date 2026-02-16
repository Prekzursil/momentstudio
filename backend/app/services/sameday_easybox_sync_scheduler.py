from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import leader_lock, sameday_easybox_mirror

logger = logging.getLogger(__name__)


async def _run_once() -> int:
    if not bool(getattr(settings, "sameday_mirror_enabled", True)):
        return 0
    async with SessionLocal() as session:
        if not await sameday_easybox_mirror.should_run_scheduled_sync(session):
            return 0
        run = await sameday_easybox_mirror.sync_now(session, trigger="scheduled")
        return 1 if str(run.status.value) == "success" else 0


async def _loop(stop: asyncio.Event) -> None:
    interval = max(300, int(getattr(settings, "sameday_mirror_sync_interval_seconds", 2592000) or 2592000))
    while not stop.is_set():
        try:
            refreshed = await _run_once()
            if refreshed:
                logger.info("sameday_easybox_sync_scheduled")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("sameday_easybox_sync_scheduler_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not bool(getattr(settings, "sameday_mirror_enabled", True)):
        return
    if getattr(app.state, "sameday_easybox_sync_scheduler_task", None) is not None:
        return
    stop = asyncio.Event()
    task = asyncio.create_task(leader_lock.run_as_leader(name="sameday_easybox_sync_scheduler", stop=stop, work=_loop))
    app.state.sameday_easybox_sync_scheduler_stop = stop
    app.state.sameday_easybox_sync_scheduler_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "sameday_easybox_sync_scheduler_stop", None)
    task = getattr(app.state, "sameday_easybox_sync_scheduler_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "sameday_easybox_sync_scheduler_stop", None) is not None:
        delattr(app.state, "sameday_easybox_sync_scheduler_stop")
    if getattr(app.state, "sameday_easybox_sync_scheduler_task", None) is not None:
        delattr(app.state, "sameday_easybox_sync_scheduler_task")
