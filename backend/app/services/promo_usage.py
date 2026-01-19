from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order, OrderEvent
from app.models.promo import PromoCode


async def record_promo_usage(session: AsyncSession, *, order: Order, note: str | None = None) -> None:
    code = (getattr(order, "promo_code", None) or "").strip().upper()
    if not code:
        return

    events = getattr(order, "events", None) or []
    if any(getattr(evt, "event", None) == "promo_counted" for evt in events):
        return

    promo = (await session.execute(select(PromoCode).where(PromoCode.code == code))).scalar_one_or_none()
    if promo:
        promo.times_used += 1
        session.add(promo)

    session.add(OrderEvent(order_id=order.id, event="promo_counted", note=note or code))

