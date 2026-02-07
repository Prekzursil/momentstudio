from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import leader_lock
from app.services import self_service

logger = logging.getLogger(__name__)


async def _run_once() -> None:
    limit = max(1, int(getattr(settings, "account_deletion_batch_limit", 200) or 200))
    async with SessionLocal() as session:
        await self_service.process_due_account_deletions(session, limit=limit)


async def _loop(stop: asyncio.Event) -> None:
    interval = max(30, int(getattr(settings, "account_deletion_poll_interval_seconds", 600) or 600))
    while not stop.is_set():
        try:
            await _run_once()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("account_deletion_scheduler_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not bool(getattr(settings, "account_deletion_scheduler_enabled", True)):
        return
    if getattr(app.state, "account_deletion_scheduler_task", None) is not None:
        return

    stop = asyncio.Event()
    task = asyncio.create_task(leader_lock.run_as_leader(name="account_deletion_scheduler", stop=stop, work=_loop))
    app.state.account_deletion_scheduler_stop = stop
    app.state.account_deletion_scheduler_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "account_deletion_scheduler_stop", None)
    task = getattr(app.state, "account_deletion_scheduler_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "account_deletion_scheduler_stop", None) is not None:
        delattr(app.state, "account_deletion_scheduler_stop")
    if getattr(app.state, "account_deletion_scheduler_task", None) is not None:
        delattr(app.state, "account_deletion_scheduler_task")

