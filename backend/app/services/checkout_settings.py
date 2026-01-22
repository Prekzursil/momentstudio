from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import content as content_service


DEFAULT_SHIPPING_FEE_RON = Decimal("20.00")
DEFAULT_FREE_SHIPPING_THRESHOLD_RON = Decimal("300.00")
DEFAULT_PHONE_REQUIRED_HOME = True
DEFAULT_PHONE_REQUIRED_LOCKER = True
DEFAULT_FEE_ENABLED = False
DEFAULT_FEE_TYPE: Literal["flat", "percent"] = "flat"
DEFAULT_FEE_VALUE = Decimal("0.00")
DEFAULT_VAT_ENABLED = True
DEFAULT_VAT_RATE_PERCENT = Decimal("10.00")
DEFAULT_VAT_APPLY_TO_SHIPPING = False
DEFAULT_VAT_APPLY_TO_FEE = False
DEFAULT_RECEIPT_SHARE_DAYS = 365


@dataclass(frozen=True)
class CheckoutSettings:
    shipping_fee_ron: Decimal = DEFAULT_SHIPPING_FEE_RON
    free_shipping_threshold_ron: Decimal = DEFAULT_FREE_SHIPPING_THRESHOLD_RON
    phone_required_home: bool = DEFAULT_PHONE_REQUIRED_HOME
    phone_required_locker: bool = DEFAULT_PHONE_REQUIRED_LOCKER
    fee_enabled: bool = DEFAULT_FEE_ENABLED
    fee_type: Literal["flat", "percent"] = DEFAULT_FEE_TYPE
    fee_value: Decimal = DEFAULT_FEE_VALUE
    vat_enabled: bool = DEFAULT_VAT_ENABLED
    vat_rate_percent: Decimal = DEFAULT_VAT_RATE_PERCENT
    vat_apply_to_shipping: bool = DEFAULT_VAT_APPLY_TO_SHIPPING
    vat_apply_to_fee: bool = DEFAULT_VAT_APPLY_TO_FEE
    receipt_share_days: int = DEFAULT_RECEIPT_SHARE_DAYS


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


def _parse_bool(value: object | None, *, fallback: bool) -> bool:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        candidate = value.strip().lower()
        if candidate in {"1", "true", "yes", "on"}:
            return True
        if candidate in {"0", "false", "no", "off"}:
            return False
    return fallback


def _parse_int(value: object | None, *, fallback: int) -> int:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        try:
            return int(value)
        except Exception:
            return fallback
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return fallback
        try:
            return int(candidate)
        except Exception:
            return fallback
    return fallback


async def get_checkout_settings(session: AsyncSession) -> CheckoutSettings:
    block = await content_service.get_published_by_key_following_redirects(session, "site.checkout")
    meta = (getattr(block, "meta", None) or {}) if block else {}
    shipping_fee = _parse_decimal(meta.get("shipping_fee_ron"), fallback=DEFAULT_SHIPPING_FEE_RON)
    threshold = _parse_decimal(meta.get("free_shipping_threshold_ron"), fallback=DEFAULT_FREE_SHIPPING_THRESHOLD_RON)
    phone_required_home = _parse_bool(meta.get("phone_required_home"), fallback=DEFAULT_PHONE_REQUIRED_HOME)
    phone_required_locker = _parse_bool(meta.get("phone_required_locker"), fallback=DEFAULT_PHONE_REQUIRED_LOCKER)
    fee_enabled = _parse_bool(meta.get("fee_enabled"), fallback=DEFAULT_FEE_ENABLED)
    fee_type_raw = str(meta.get("fee_type") or DEFAULT_FEE_TYPE).strip().lower()
    fee_type: Literal["flat", "percent"] = "percent" if fee_type_raw == "percent" else "flat"
    fee_value = _parse_decimal(meta.get("fee_value"), fallback=DEFAULT_FEE_VALUE)
    vat_enabled = _parse_bool(meta.get("vat_enabled"), fallback=DEFAULT_VAT_ENABLED)
    vat_rate_percent = _parse_decimal(meta.get("vat_rate_percent"), fallback=DEFAULT_VAT_RATE_PERCENT)
    vat_apply_to_shipping = _parse_bool(meta.get("vat_apply_to_shipping"), fallback=DEFAULT_VAT_APPLY_TO_SHIPPING)
    vat_apply_to_fee = _parse_bool(meta.get("vat_apply_to_fee"), fallback=DEFAULT_VAT_APPLY_TO_FEE)
    receipt_share_days = _parse_int(meta.get("receipt_share_days"), fallback=DEFAULT_RECEIPT_SHARE_DAYS)
    if threshold < 0:
        threshold = DEFAULT_FREE_SHIPPING_THRESHOLD_RON
    if shipping_fee < 0:
        shipping_fee = DEFAULT_SHIPPING_FEE_RON
    if fee_value < 0:
        fee_value = DEFAULT_FEE_VALUE
    if vat_rate_percent < 0:
        vat_rate_percent = DEFAULT_VAT_RATE_PERCENT
    if vat_rate_percent > 100:
        vat_rate_percent = Decimal("100.00")
    if receipt_share_days < 1:
        receipt_share_days = DEFAULT_RECEIPT_SHARE_DAYS
    if receipt_share_days > 3650:
        receipt_share_days = 3650
    return CheckoutSettings(
        shipping_fee_ron=shipping_fee,
        free_shipping_threshold_ron=threshold,
        phone_required_home=phone_required_home,
        phone_required_locker=phone_required_locker,
        fee_enabled=fee_enabled,
        fee_type=fee_type,
        fee_value=fee_value,
        vat_enabled=vat_enabled,
        vat_rate_percent=vat_rate_percent,
        vat_apply_to_shipping=vat_apply_to_shipping,
        vat_apply_to_fee=vat_apply_to_fee,
        receipt_share_days=receipt_share_days,
    )
