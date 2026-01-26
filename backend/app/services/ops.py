from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ops import MaintenanceBanner
from app.schemas.ops import ShippingSimulationResult
from app.services import checkout_settings as checkout_settings_service
from app.services import order as order_service
from app.services import pricing


async def list_maintenance_banners(session: AsyncSession) -> list[MaintenanceBanner]:
    result = await session.execute(select(MaintenanceBanner).order_by(MaintenanceBanner.starts_at.desc()))
    return list(result.scalars().unique())


async def get_active_maintenance_banner(session: AsyncSession) -> MaintenanceBanner | None:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(MaintenanceBanner)
        .where(
            MaintenanceBanner.is_active.is_(True),
            MaintenanceBanner.starts_at <= now,
            or_(MaintenanceBanner.ends_at.is_(None), MaintenanceBanner.ends_at > now),
        )
        .order_by(MaintenanceBanner.starts_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_maintenance_banner(session: AsyncSession, banner: MaintenanceBanner) -> MaintenanceBanner:
    session.add(banner)
    await session.commit()
    await session.refresh(banner)
    return banner


async def update_maintenance_banner(session: AsyncSession, banner: MaintenanceBanner) -> MaintenanceBanner:
    session.add(banner)
    await session.commit()
    await session.refresh(banner)
    return banner


async def delete_maintenance_banner(session: AsyncSession, banner: MaintenanceBanner) -> None:
    await session.delete(banner)
    await session.commit()


async def simulate_shipping_rates(
    session: AsyncSession,
    *,
    subtotal_ron: Decimal,
    discount_ron: Decimal,
    shipping_method_id: UUID | None,
    country: str | None = None,
    postal_code: str | None = None,
) -> ShippingSimulationResult:
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    rounding = checkout_settings.money_rounding

    subtotal = pricing.quantize_money(Decimal(subtotal_ron), rounding=rounding)
    discount = pricing.quantize_money(Decimal(discount_ron or 0), rounding=rounding)
    taxable = subtotal - discount
    if taxable < 0:
        taxable = Decimal("0.00")

    method = None
    selected_id: UUID | None = None
    if shipping_method_id:
        method = await order_service.get_shipping_method(session, shipping_method_id)
        if not method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
        selected_id = method.id

    # Current storefront rules: prefer checkout_settings.shipping_fee_ron when set; otherwise compute using shipping method.
    if checkout_settings.shipping_fee_ron is not None:
        base_shipping = pricing.quantize_money(Decimal(checkout_settings.shipping_fee_ron), rounding=rounding)
    else:
        base_shipping = pricing.quantize_money(order_service._calculate_shipping(subtotal, method), rounding=rounding)  # type: ignore[attr-defined]

    threshold = checkout_settings.free_shipping_threshold_ron
    if threshold is not None and threshold >= 0 and taxable >= Decimal(str(threshold)):
        base_shipping = Decimal("0.00")

    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=discount,
        shipping=base_shipping,
        fee_enabled=checkout_settings.fee_enabled,
        fee_type=checkout_settings.fee_type,
        fee_value=checkout_settings.fee_value,
        vat_enabled=checkout_settings.vat_enabled,
        vat_rate_percent=checkout_settings.vat_rate_percent,
        vat_apply_to_shipping=checkout_settings.vat_apply_to_shipping,
        vat_apply_to_fee=checkout_settings.vat_apply_to_fee,
        rounding=rounding,
    )

    methods = await order_service.list_shipping_methods(session)
    method_rows = []
    for m in methods:
        if checkout_settings.shipping_fee_ron is not None:
            shipping_for_method = Decimal(checkout_settings.shipping_fee_ron)
        else:
            shipping_for_method = order_service._calculate_shipping(subtotal, m)  # type: ignore[attr-defined]
        shipping_for_method = pricing.quantize_money(Decimal(shipping_for_method or 0), rounding=rounding)
        if threshold is not None and threshold >= 0 and taxable >= Decimal(str(threshold)):
            shipping_for_method = Decimal("0.00")
        method_rows.append(
            {
                "id": m.id,
                "name": m.name,
                "rate_flat": pricing.quantize_money(Decimal(getattr(m, "rate_flat", 0) or 0), rounding=rounding)
                if getattr(m, "rate_flat", None) is not None
                else None,
                "rate_per_kg": pricing.quantize_money(Decimal(getattr(m, "rate_per_kg", 0) or 0), rounding=rounding)
                if getattr(m, "rate_per_kg", None) is not None
                else None,
                "computed_shipping_ron": shipping_for_method,
            }
        )

    return ShippingSimulationResult(
        subtotal_ron=subtotal,
        discount_ron=discount,
        taxable_subtotal_ron=pricing.quantize_money(taxable, rounding=rounding),
        shipping_ron=breakdown.shipping,
        fee_ron=breakdown.fee,
        vat_ron=breakdown.vat,
        total_ron=breakdown.total,
        shipping_fee_ron=Decimal(checkout_settings.shipping_fee_ron) if checkout_settings.shipping_fee_ron is not None else None,
        free_shipping_threshold_ron=Decimal(checkout_settings.free_shipping_threshold_ron)
        if checkout_settings.free_shipping_threshold_ron is not None
        else None,
        selected_shipping_method_id=selected_id,
        methods=method_rows,  # type: ignore[arg-type]
    )
