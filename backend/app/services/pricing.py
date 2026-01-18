from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal


MONEY_QUANT = Decimal("0.01")


def quantize_money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


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
) -> Decimal:
    if not enabled:
        return Decimal("0.00")
    if fee_value <= 0:
        return Decimal("0.00")
    if fee_type == "percent":
        return quantize_money(taxable_subtotal * fee_value / Decimal("100"))
    return quantize_money(fee_value)


def compute_vat(
    *,
    taxable_subtotal: Decimal,
    shipping: Decimal,
    fee: Decimal,
    enabled: bool,
    vat_rate_percent: Decimal,
    apply_to_shipping: bool,
    apply_to_fee: bool,
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
    return quantize_money(base * vat_rate_percent / Decimal("100"))


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
) -> PricingBreakdown:
    subtotal_q = quantize_money(subtotal)
    discount_q = quantize_money(discount) if discount > 0 else Decimal("0.00")
    taxable = subtotal_q - discount_q
    if taxable < 0:
        taxable = Decimal("0.00")
    taxable = quantize_money(taxable)
    shipping_q = quantize_money(shipping) if shipping > 0 else Decimal("0.00")
    fee = compute_fee(taxable_subtotal=taxable, enabled=fee_enabled, fee_type=fee_type, fee_value=fee_value)
    vat = compute_vat(
        taxable_subtotal=taxable,
        shipping=shipping_q,
        fee=fee,
        enabled=vat_enabled,
        vat_rate_percent=vat_rate_percent,
        apply_to_shipping=vat_apply_to_shipping,
        apply_to_fee=vat_apply_to_fee,
    )
    total = taxable + shipping_q + fee + vat
    if total < 0:
        total = Decimal("0.00")
    total = quantize_money(total)
    return PricingBreakdown(
        subtotal=subtotal_q,
        discount=discount_q,
        taxable_subtotal=taxable,
        shipping=shipping_q,
        fee=fee,
        vat=vat,
        total=total,
    )
