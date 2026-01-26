from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import FastAPI

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import admin_reports

logger = logging.getLogger(__name__)


async def _run_once() -> None:
    async with SessionLocal() as session:
        await admin_reports.send_due_reports(session)


async def _loop(stop: asyncio.Event) -> None:
    interval = max(30, int(getattr(settings, "admin_reports_poll_interval_seconds", 60)))
    while not stop.is_set():
        try:
            await _run_once()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("admin_report_scheduler_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not getattr(settings, "admin_reports_scheduler_enabled", True):
        return
    if getattr(app.state, "admin_report_scheduler_task", None) is not None:
        return

    stop = asyncio.Event()
    task = asyncio.create_task(_loop(stop))
    app.state.admin_report_scheduler_stop = stop
    app.state.admin_report_scheduler_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "admin_report_scheduler_stop", None)
    task = getattr(app.state, "admin_report_scheduler_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "admin_report_scheduler_stop", None) is not None:
        delattr(app.state, "admin_report_scheduler_stop")
    if getattr(app.state, "admin_report_scheduler_task", None) is not None:
        delattr(app.state, "admin_report_scheduler_task")

