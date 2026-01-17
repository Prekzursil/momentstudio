from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import content as content_service


DEFAULT_SHIPPING_FEE_RON = Decimal("20.00")
DEFAULT_FREE_SHIPPING_THRESHOLD_RON = Decimal("300.00")


@dataclass(frozen=True)
class CheckoutSettings:
    shipping_fee_ron: Decimal = DEFAULT_SHIPPING_FEE_RON
    free_shipping_threshold_ron: Decimal = DEFAULT_FREE_SHIPPING_THRESHOLD_RON


def _parse_decimal(value: object | None, *, fallback: Decimal) -> Decimal:
    if value is None:
        return fallback
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return fallback
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return fallback
        try:
            return Decimal(candidate)
        except InvalidOperation:
            return fallback
    return fallback


async def get_checkout_settings(session: AsyncSession) -> CheckoutSettings:
    block = await content_service.get_published_by_key(session, "site.checkout")
    meta = (getattr(block, "meta", None) or {}) if block else {}
    shipping_fee = _parse_decimal(meta.get("shipping_fee_ron"), fallback=DEFAULT_SHIPPING_FEE_RON)
    threshold = _parse_decimal(meta.get("free_shipping_threshold_ron"), fallback=DEFAULT_FREE_SHIPPING_THRESHOLD_RON)
    if threshold < 0:
        threshold = DEFAULT_FREE_SHIPPING_THRESHOLD_RON
    if shipping_fee < 0:
        shipping_fee = DEFAULT_SHIPPING_FEE_RON
    return CheckoutSettings(shipping_fee_ron=shipping_fee, free_shipping_threshold_ron=threshold)

