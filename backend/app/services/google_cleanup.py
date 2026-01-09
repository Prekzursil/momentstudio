from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import self_service

logger = logging.getLogger(__name__)


async def _cleanup_once() -> int:
    async with SessionLocal() as session:
        return await self_service.cleanup_incomplete_google_accounts(session, max_age_hours=settings.google_cleanup_max_age_hours)


async def _cleanup_loop(stop: asyncio.Event) -> None:
    interval = max(60, int(settings.google_cleanup_interval_seconds))
    while not stop.is_set():
        try:
            deleted = await _cleanup_once()
            if deleted:
                logger.info("google_cleanup_deleted", extra={"deleted": deleted})
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("google_cleanup_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not settings.google_cleanup_enabled:
        return
    if getattr(app.state, "google_cleanup_task", None) is not None:
        return

    stop = asyncio.Event()
    task = asyncio.create_task(_cleanup_loop(stop))
    app.state.google_cleanup_stop = stop
    app.state.google_cleanup_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "google_cleanup_stop", None)
    task = getattr(app.state, "google_cleanup_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "google_cleanup_stop", None) is not None:
        delattr(app.state, "google_cleanup_stop")
    if getattr(app.state, "google_cleanup_task", None) is not None:
        delattr(app.state, "google_cleanup_task")

