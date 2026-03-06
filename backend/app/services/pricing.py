from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, ROUND_UP
from typing import Literal


MONEY_QUANT = Decimal("0.01")

MoneyRounding = Literal["half_up", "half_even", "up", "down"]


_ROUNDING_MAP: dict[str, str] = {
    "half_up": ROUND_HALF_UP,
    "half_even": ROUND_HALF_EVEN,
    "up": ROUND_UP,
    "down": ROUND_DOWN,
}


def quantize_money(value: Decimal, *, rounding: MoneyRounding = "half_up") -> Decimal:
    mode = _ROUNDING_MAP.get(str(rounding), ROUND_HALF_UP)
    return Decimal(value).quantize(MONEY_QUANT, rounding=mode)


@dataclass(frozen=True)
class PricingBreakdown:
    subtotal: Decimal
    discount: Decimal
    taxable_subtotal: Decimal
    shipping: Decimal
    fee: Decimal
    vat: Decimal
    total: Decimal


def compute_fee(
    *,
    taxable_subtotal: Decimal,
    enabled: bool,
    fee_type: Literal["flat", "percent"],
    fee_value: Decimal,
    rounding: MoneyRounding = "half_up",
) -> Decimal:
    if not enabled:
        return Decimal("0.00")
    if fee_value <= 0:
        return Decimal("0.00")
    if fee_type == "percent":
        return quantize_money(taxable_subtotal * fee_value / Decimal("100"), rounding=rounding)
    return quantize_money(fee_value, rounding=rounding)


def compute_vat(
    *,
    taxable_subtotal: Decimal,
    shipping: Decimal,
    fee: Decimal,
    enabled: bool,
    vat_rate_percent: Decimal,
    apply_to_shipping: bool,
    apply_to_fee: bool,
    rounding: MoneyRounding = "half_up",
) -> Decimal:
    if not enabled:
        return Decimal("0.00")
    if vat_rate_percent <= 0:
        return Decimal("0.00")
    base = taxable_subtotal
    if apply_to_shipping:
        base += shipping
    if apply_to_fee:
        base += fee
    if base <= 0:
        return Decimal("0.00")
    return quantize_money(base * vat_rate_percent / Decimal("100"), rounding=rounding)


def _taxable_subtotal(subtotal: Decimal, discount: Decimal, *, rounding: MoneyRounding) -> tuple[Decimal, Decimal]:
    subtotal_q = quantize_money(subtotal, rounding=rounding)
    discount_q = quantize_money(discount, rounding=rounding) if discount > 0 else Decimal("0.00")
    return subtotal_q, discount_q if discount_q >= 0 else Decimal("0.00")


def _resolved_taxable(taxable: Decimal, *, rounding: MoneyRounding) -> Decimal:
    if taxable < 0:
        return Decimal("0.00")
    return quantize_money(taxable, rounding=rounding)


def _resolved_shipping(shipping: Decimal, *, rounding: MoneyRounding) -> Decimal:
    if shipping <= 0:
        return Decimal("0.00")
    return quantize_money(shipping, rounding=rounding)


def _resolved_vat(
    *,
    taxable: Decimal,
    shipping: Decimal,
    fee: Decimal,
    vat_enabled: bool,
    vat_override: Decimal | None,
    vat_rate_percent: Decimal,
    vat_apply_to_shipping: bool,
    vat_apply_to_fee: bool,
    rounding: MoneyRounding,
) -> Decimal:
    if not vat_enabled:
        return Decimal("0.00")
    if vat_override is not None:
        return quantize_money(vat_override if vat_override > 0 else Decimal("0.00"), rounding=rounding)
    return compute_vat(
        taxable_subtotal=taxable,
        shipping=shipping,
        fee=fee,
        enabled=vat_enabled,
        vat_rate_percent=vat_rate_percent,
        apply_to_shipping=vat_apply_to_shipping,
        apply_to_fee=vat_apply_to_fee,
        rounding=rounding,
    )


def compute_totals(
    *,
    subtotal: Decimal,
    discount: Decimal,
    shipping: Decimal,
    fee_enabled: bool,
    fee_type: Literal["flat", "percent"],
    fee_value: Decimal,
    vat_enabled: bool,
    vat_rate_percent: Decimal,
    vat_apply_to_shipping: bool,
    vat_apply_to_fee: bool,
    rounding: MoneyRounding = "half_up",
    vat_override: Decimal | None = None,
) -> PricingBreakdown:
    subtotal_q, discount_q = _taxable_subtotal(subtotal, discount, rounding=rounding)
    taxable = _resolved_taxable(subtotal_q - discount_q, rounding=rounding)
    shipping_q = _resolved_shipping(shipping, rounding=rounding)
    fee = compute_fee(taxable_subtotal=taxable, enabled=fee_enabled, fee_type=fee_type, fee_value=fee_value, rounding=rounding)
    vat = _resolved_vat(
        taxable=taxable,
        shipping=shipping_q,
        fee=fee,
        vat_enabled=vat_enabled,
        vat_override=vat_override,
        vat_rate_percent=vat_rate_percent,
        vat_apply_to_shipping=vat_apply_to_shipping,
        vat_apply_to_fee=vat_apply_to_fee,
        rounding=rounding,
    )
    total = taxable + shipping_q + fee + vat
    if total < 0:
        total = Decimal("0.00")
    total = quantize_money(total, rounding=rounding)
    return PricingBreakdown(
        subtotal=subtotal_q,
        discount=discount_q,
        taxable_subtotal=taxable,
        shipping=shipping_q,
        fee=fee,
        vat=vat,
        total=total,
    )
