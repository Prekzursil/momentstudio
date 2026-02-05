from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import fx_store
from app.services import leader_lock

logger = logging.getLogger(__name__)


async def _refresh_once() -> None:
    async with SessionLocal() as session:
        await fx_store.refresh_last_known(session)


async def _refresh_loop(stop: asyncio.Event) -> None:
    interval = max(60, int(settings.fx_refresh_interval_seconds))
    while not stop.is_set():
        try:
            await _refresh_once()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("fx_refresh_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not settings.fx_refresh_enabled:
        return
    if getattr(app.state, "fx_refresh_task", None) is not None:
        return

    stop = asyncio.Event()
    task = asyncio.create_task(leader_lock.run_as_leader(name="fx_refresh", stop=stop, work=_refresh_loop))
    app.state.fx_refresh_stop = stop
    app.state.fx_refresh_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "fx_refresh_stop", None)
    task = getattr(app.state, "fx_refresh_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "fx_refresh_stop", None) is not None:
        delattr(app.state, "fx_refresh_stop")
    if getattr(app.state, "fx_refresh_task", None) is not None:
        delattr(app.state, "fx_refresh_task")
