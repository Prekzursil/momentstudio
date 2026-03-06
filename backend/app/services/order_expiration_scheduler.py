from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.order import Order, OrderEvent, OrderStatus
from app.services import leader_lock

logger = logging.getLogger(__name__)


def _expiration_config() -> tuple[int, int] | None:
    if not bool(getattr(settings, "order_pending_payment_expiry_enabled", True)):
        return None
    ttl_minutes = int(getattr(settings, "order_pending_payment_expiry_minutes", 0) or 0)
    if ttl_minutes <= 0:
        return None
    limit = max(1, int(getattr(settings, "order_pending_payment_expiry_batch_limit", 200) or 200))
    return ttl_minutes, limit


async def _expired_pending_payment_orders(session, *, cutoff: datetime, limit: int) -> list[Order]:
    result = await session.execute(
        select(Order)
        .where(Order.status == OrderStatus.pending_payment, Order.created_at < cutoff)
        .order_by(Order.created_at.asc())
        .limit(limit)
    )
    return result.scalars().all()


def _expire_order(session, order: Order) -> None:
    order.status = OrderStatus.cancelled
    if not (getattr(order, "cancel_reason", None) or "").strip():
        order.cancel_reason = "Payment expired"
    session.add(order)
    session.add(
        OrderEvent(
            order_id=order.id,
            event="status_change",
            note="pending_payment -> cancelled (expired)",
            data={
                "changes": {
                    "status": {"from": OrderStatus.pending_payment.value, "to": OrderStatus.cancelled.value},
                    "cancel_reason": order.cancel_reason,
                }
            },
        )
    )


async def _run_once() -> int:
    config = _expiration_config()
    if config is None:
        return 0
    ttl_minutes, limit = config
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)
    async with SessionLocal() as session:
        rows = await _expired_pending_payment_orders(session, cutoff=cutoff, limit=limit)
        if not rows:
            return 0
        for order in rows:
            _expire_order(session, order)
        await session.commit()
        return len(rows)


async def _loop(stop: asyncio.Event) -> None:
    interval = max(
        30,
        int(getattr(settings, "order_pending_payment_expiry_poll_interval_seconds", 600) or 600),
    )
    while not stop.is_set():
        try:
            expired = await _run_once()
            if expired:
                logger.info("order_pending_payment_expired", extra={"count": int(expired)})
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("order_expiration_scheduler_failed", extra={"error": str(exc)})

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def start(app: FastAPI) -> None:
    if not bool(getattr(settings, "order_pending_payment_expiry_enabled", True)):
        return
    if getattr(app.state, "order_expiration_scheduler_task", None) is not None:
        return

    stop = asyncio.Event()
    task = asyncio.create_task(
        leader_lock.run_as_leader(name="order_expiration_scheduler", stop=stop, work=_loop)
    )
    app.state.order_expiration_scheduler_stop = stop
    app.state.order_expiration_scheduler_task = task


async def stop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "order_expiration_scheduler_stop", None)
    task = getattr(app.state, "order_expiration_scheduler_task", None)
    if stop_event:
        stop_event.set()
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if getattr(app.state, "order_expiration_scheduler_stop", None) is not None:
        delattr(app.state, "order_expiration_scheduler_stop")
    if getattr(app.state, "order_expiration_scheduler_task", None) is not None:
        delattr(app.state, "order_expiration_scheduler_task")
