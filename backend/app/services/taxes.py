from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.catalog import Category, Product
from app.models.taxes import TaxGroup, TaxRate
from app.services import pricing
from app.services.checkout_settings import CheckoutSettings


def _normalize_country_code(value: str | None) -> str | None:
    if value is None:
        return None
    code = (value or "").strip().upper()
    if not code:
        return None
    if len(code) != 2 or not code.isalpha():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Country must be a 2-letter code")
    return code


def _normalize_group_code(value: str) -> str:
    cleaned = (value or "").strip().lower().replace(" ", "-")
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax group code is required")
    if len(cleaned) > 40:
        cleaned = cleaned[:40]
    return cleaned


async def _get_default_group_id(session: AsyncSession) -> UUID | None:
    result = await session.execute(select(TaxGroup.id).where(TaxGroup.is_default.is_(True)).order_by(TaxGroup.created_at))
    group_id = result.scalar_one_or_none()
    if group_id:
        return group_id
    result = await session.execute(select(TaxGroup.id).where(TaxGroup.code == "standard").order_by(TaxGroup.created_at))
    return result.scalar_one_or_none()


async def default_country_vat_rate_percent(
    session: AsyncSession, *, country_code: str | None, fallback_rate_percent: Decimal
) -> Decimal:
    country = _normalize_country_code(country_code)
    if not country:
        return fallback_rate_percent
    default_group_id = await _get_default_group_id(session)
    if not default_group_id:
        return fallback_rate_percent
    result = await session.execute(
        select(TaxRate.vat_rate_percent).where(TaxRate.group_id == default_group_id, TaxRate.country_code == country)
    )
    rate = result.scalar_one_or_none()
    if rate is None:
        return fallback_rate_percent
    return Decimal(rate)


async def list_tax_groups(session: AsyncSession) -> list[TaxGroup]:
    result = await session.execute(
        select(TaxGroup)
        .options(selectinload(TaxGroup.rates))
        .order_by(TaxGroup.is_default.desc(), func.lower(TaxGroup.name), func.lower(TaxGroup.code))
    )
    groups = list(result.scalars().unique())
    return groups


async def create_tax_group(
    session: AsyncSession,
    *,
    code: str,
    name: str,
    description: str | None,
    is_default: bool,
) -> TaxGroup:
    code_clean = _normalize_group_code(code)
    exists = await session.execute(select(TaxGroup.id).where(TaxGroup.code == code_clean))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax group code already exists")

    if is_default:
        await session.execute(update(TaxGroup).values(is_default=False))

    group = TaxGroup(code=code_clean, name=(name or "").strip()[:120], description=description, is_default=bool(is_default))
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


async def update_tax_group(
    session: AsyncSession,
    *,
    group: TaxGroup,
    name: str | None,
    description: str | None,
    is_default: bool | None,
) -> TaxGroup:
    if is_default is True:
        await session.execute(update(TaxGroup).where(TaxGroup.id != group.id).values(is_default=False))
        group.is_default = True
    elif is_default is False:
        group.is_default = False

    if name is not None:
        group.name = (name or "").strip()[:120]
    if description is not None:
        group.description = description

    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


async def delete_tax_group(session: AsyncSession, *, group: TaxGroup) -> None:
    if group.is_default:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete default tax group")
    # Prevent deleting a group still referenced by categories.
    result = await session.execute(select(func.count()).select_from(Category).where(Category.tax_group_id == group.id))
    if (result.scalar_one() or 0) > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax group is still assigned to categories")
    await session.delete(group)
    await session.commit()


async def upsert_tax_rate(
    session: AsyncSession,
    *,
    group: TaxGroup,
    country_code: str,
    vat_rate_percent: Decimal,
) -> TaxRate:
    country = _normalize_country_code(country_code) or ""
    rate = Decimal(vat_rate_percent)
    if rate < 0 or rate > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VAT rate must be between 0 and 100")
    rate = rate.quantize(Decimal("0.01"))
    existing = await session.execute(
        select(TaxRate).where(TaxRate.group_id == group.id, TaxRate.country_code == country)
    )
    row = existing.scalar_one_or_none()
    if row:
        row.vat_rate_percent = rate
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row
    row = TaxRate(group_id=group.id, country_code=country, vat_rate_percent=rate)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def delete_tax_rate(session: AsyncSession, *, group_id: UUID, country_code: str) -> None:
    country = _normalize_country_code(country_code) or ""
    await session.execute(delete(TaxRate).where(TaxRate.group_id == group_id, TaxRate.country_code == country))
    await session.commit()


async def vat_rates_for_products(
    session: AsyncSession,
    *,
    product_ids: set[UUID],
    country_code: str | None,
    fallback_rate_percent: Decimal,
) -> dict[UUID, Decimal]:
    country = _normalize_country_code(country_code)
    if not country or not product_ids:
        return {}

    default_group_id = await _get_default_group_id(session)
    result = await session.execute(
        select(Product.id, Category.tax_group_id)
        .join(Category, Product.category_id == Category.id)
        .where(Product.id.in_(product_ids))
    )
    group_by_product: dict[UUID, UUID | None] = {pid: (group_id or default_group_id) for pid, group_id in result.all()}
    group_ids = {gid for gid in group_by_product.values() if gid is not None}
    if not group_ids:
        return {pid: Decimal(fallback_rate_percent) for pid in product_ids}

    rates = await session.execute(
        select(TaxRate.group_id, TaxRate.vat_rate_percent).where(TaxRate.group_id.in_(group_ids), TaxRate.country_code == country)
    )
    rate_by_group: dict[UUID, Decimal] = {gid: Decimal(rate) for gid, rate in rates.all()}
    default_rate = rate_by_group.get(default_group_id) if default_group_id else None
    fallback = Decimal(fallback_rate_percent)

    resolved: dict[UUID, Decimal] = {}
    for product_id, group_id in group_by_product.items():
        if group_id is None:
            resolved[product_id] = fallback
            continue
        resolved[product_id] = rate_by_group.get(group_id) or default_rate or fallback
    return resolved


@dataclass(frozen=True)
class TaxableProductLine:
    product_id: UUID
    subtotal: Decimal


def _allocate_discount(lines: list[TaxableProductLine], discount: Decimal) -> list[Decimal]:
    if not lines:
        return []
    subtotal = sum((line.subtotal for line in lines), start=Decimal("0.00"))
    if discount <= 0 or subtotal <= 0:
        return [Decimal("0.00")] * len(lines)
    discount_q = Decimal(discount).quantize(pricing.MONEY_QUANT)
    if discount_q <= 0:
        return [Decimal("0.00")] * len(lines)
    if discount_q > subtotal:
        discount_q = subtotal

    raw_shares = [(line.subtotal / subtotal) * discount_q for line in lines]
    floored = [share.quantize(pricing.MONEY_QUANT, rounding=ROUND_DOWN) for share in raw_shares]
    remainder = discount_q - sum(floored, start=Decimal("0.00"))
    pennies = int((remainder * 100).to_integral_value())
    if pennies <= 0:
        return floored
    frac_parts = [(raw_shares[i] - floored[i], i) for i in range(len(lines))]
    frac_parts.sort(key=lambda pair: (pair[0], pair[1]), reverse=True)
    allocations = list(floored)
    for _, idx in frac_parts[:pennies]:
        allocations[idx] += pricing.MONEY_QUANT
    return allocations


async def compute_cart_vat_amount(
    session: AsyncSession,
    *,
    country_code: str | None,
    lines: list[TaxableProductLine],
    discount: Decimal,
    shipping: Decimal,
    fee: Decimal,
    checkout: CheckoutSettings,
) -> Decimal:
    rounding = checkout.money_rounding
    if not checkout.vat_enabled:
        return Decimal("0.00")

    subtotal = pricing.quantize_money(sum((line.subtotal for line in lines), start=Decimal("0.00")), rounding=rounding)
    discount_q = pricing.quantize_money(discount, rounding=rounding) if discount > 0 else Decimal("0.00")
    taxable_subtotal = subtotal - discount_q
    if taxable_subtotal < 0:
        taxable_subtotal = Decimal("0.00")
    taxable_subtotal = pricing.quantize_money(taxable_subtotal, rounding=rounding)
    shipping_q = pricing.quantize_money(shipping, rounding=rounding) if shipping > 0 else Decimal("0.00")
    fee_q = pricing.quantize_money(fee, rounding=rounding) if fee > 0 else Decimal("0.00")

    country = _normalize_country_code(country_code)
    if not country:
        return pricing.compute_vat(
            taxable_subtotal=taxable_subtotal,
            shipping=shipping_q,
            fee=fee_q,
            enabled=True,
            vat_rate_percent=checkout.vat_rate_percent,
            apply_to_shipping=checkout.vat_apply_to_shipping,
            apply_to_fee=checkout.vat_apply_to_fee,
            rounding=rounding,
        )

    product_ids = {line.product_id for line in lines}
    rates_by_product = await vat_rates_for_products(
        session, product_ids=product_ids, country_code=country, fallback_rate_percent=checkout.vat_rate_percent
    )
    default_rate = await default_country_vat_rate_percent(session, country_code=country, fallback_rate_percent=checkout.vat_rate_percent)

    allocations = _allocate_discount(lines, discount_q)
    base_by_rate: dict[Decimal, Decimal] = {}
    for line, allocated in zip(lines, allocations, strict=False):
        rate = rates_by_product.get(line.product_id, Decimal(default_rate))
        if rate <= 0:
            continue
        base = pricing.quantize_money(line.subtotal, rounding=rounding) - pricing.quantize_money(allocated, rounding=rounding)
        if base <= 0:
            continue
        base_by_rate[rate] = base_by_rate.get(rate, Decimal("0.00")) + base

    extra_base = Decimal("0.00")
    if checkout.vat_apply_to_shipping:
        extra_base += shipping_q
    if checkout.vat_apply_to_fee:
        extra_base += fee_q
    if extra_base > 0 and default_rate > 0:
        base_by_rate[Decimal(default_rate)] = base_by_rate.get(Decimal(default_rate), Decimal("0.00")) + extra_base

    vat_total = Decimal("0.00")
    for rate, base in base_by_rate.items():
        if base <= 0 or rate <= 0:
            continue
        vat_total += pricing.quantize_money(base * Decimal(rate) / Decimal("100"), rounding=rounding)
    return pricing.quantize_money(vat_total, rounding=rounding)
