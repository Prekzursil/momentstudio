from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal, cast

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
DEFAULT_MONEY_ROUNDING: Literal["half_up", "half_even", "up", "down"] = "half_up"


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
    money_rounding: Literal["half_up", "half_even", "up", "down"] = DEFAULT_MONEY_ROUNDING


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
    if value is None or isinstance(value, bool):
        return fallback
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return fallback
    if isinstance(value, (int, float, str)):
        try:
            return int(value)
        except Exception:
            return fallback
    return fallback


def _normalize_fee_type(value: object | None) -> Literal["flat", "percent"]:
    return "percent" if str(value or DEFAULT_FEE_TYPE).strip().lower() == "percent" else "flat"


def _normalize_money_rounding(value: object | None) -> Literal["half_up", "half_even", "up", "down"]:
    rounding_raw = str(value or DEFAULT_MONEY_ROUNDING).strip().lower()
    if rounding_raw in {"half_up", "half_even", "up", "down"}:
        return cast(Literal["half_up", "half_even", "up", "down"], rounding_raw)
    return DEFAULT_MONEY_ROUNDING


def _clamp_non_negative_decimal(value: Decimal, *, fallback: Decimal) -> Decimal:
    return value if value >= 0 else fallback


def _clamp_vat_rate_percent(value: Decimal) -> Decimal:
    if value < 0:
        return DEFAULT_VAT_RATE_PERCENT
    if value > 100:
        return Decimal("100.00")
    return value


def _clamp_receipt_share_days(value: int) -> int:
    if value < 1:
        return DEFAULT_RECEIPT_SHARE_DAYS
    if value > 3650:
        return 3650
    return value


async def get_checkout_settings(session: AsyncSession) -> CheckoutSettings:
    block = await content_service.get_published_by_key_following_redirects(session, "site.checkout")
    meta = (getattr(block, "meta", None) or {}) if block else {}
    shipping_fee = _parse_decimal(meta.get("shipping_fee_ron"), fallback=DEFAULT_SHIPPING_FEE_RON)
    threshold = _parse_decimal(meta.get("free_shipping_threshold_ron"), fallback=DEFAULT_FREE_SHIPPING_THRESHOLD_RON)
    phone_required_home = _parse_bool(meta.get("phone_required_home"), fallback=DEFAULT_PHONE_REQUIRED_HOME)
    phone_required_locker = _parse_bool(meta.get("phone_required_locker"), fallback=DEFAULT_PHONE_REQUIRED_LOCKER)
    fee_enabled = _parse_bool(meta.get("fee_enabled"), fallback=DEFAULT_FEE_ENABLED)
    fee_type = _normalize_fee_type(meta.get("fee_type"))
    fee_value = _parse_decimal(meta.get("fee_value"), fallback=DEFAULT_FEE_VALUE)
    vat_enabled = _parse_bool(meta.get("vat_enabled"), fallback=DEFAULT_VAT_ENABLED)
    vat_rate_percent = _parse_decimal(meta.get("vat_rate_percent"), fallback=DEFAULT_VAT_RATE_PERCENT)
    vat_apply_to_shipping = _parse_bool(meta.get("vat_apply_to_shipping"), fallback=DEFAULT_VAT_APPLY_TO_SHIPPING)
    vat_apply_to_fee = _parse_bool(meta.get("vat_apply_to_fee"), fallback=DEFAULT_VAT_APPLY_TO_FEE)
    receipt_share_days = _clamp_receipt_share_days(
        _parse_int(meta.get("receipt_share_days"), fallback=DEFAULT_RECEIPT_SHARE_DAYS)
    )
    money_rounding = _normalize_money_rounding(meta.get("money_rounding"))
    threshold = _clamp_non_negative_decimal(threshold, fallback=DEFAULT_FREE_SHIPPING_THRESHOLD_RON)
    shipping_fee = _clamp_non_negative_decimal(shipping_fee, fallback=DEFAULT_SHIPPING_FEE_RON)
    fee_value = _clamp_non_negative_decimal(fee_value, fallback=DEFAULT_FEE_VALUE)
    vat_rate_percent = _clamp_vat_rate_percent(vat_rate_percent)
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
        money_rounding=money_rounding,
    )
