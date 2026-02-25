from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import re
import secrets
import string
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.cart import Cart
from app.models.coupons import (
    Coupon,
    CouponAssignment,
    CouponRedemption,
    CouponReservation,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import Order, OrderEvent, OrderStatus
from app.models.user import User
from app.services import pricing
from app.services import taxes as taxes_service
from app.services.taxes import TaxableProductLine
from app.services.catalog import is_sale_active
from app.services.checkout_settings import CheckoutSettings
from app.schemas.cart import Totals


FIRST_ORDER_PROMOTION_KEY = "first_order_reward_v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_code(code: str) -> str:
    return (code or "").strip().upper()


def _quantize_money(value: Decimal, *, rounding: pricing.MoneyRounding = "half_up") -> Decimal:
    if settings.enforce_decimal_prices:
        return pricing.quantize_money(value, rounding=rounding)
    return Decimal(value)


def cart_subtotal(cart: Cart, *, rounding: pricing.MoneyRounding = "half_up") -> Decimal:
    subtotal = sum((Decimal(str(item.unit_price_at_add)) * int(item.quantity or 0) for item in cart.items), start=Decimal("0.00"))
    return _quantize_money(subtotal, rounding=rounding)


def _promotion_scope_sets(promotion: Promotion) -> tuple[set[UUID], set[UUID], set[UUID], set[UUID]]:
    include_products: set[UUID] = set()
    exclude_products: set[UUID] = set()
    include_categories: set[UUID] = set()
    exclude_categories: set[UUID] = set()

    for scope in getattr(promotion, "scopes", None) or []:
        entity_id = getattr(scope, "entity_id", None)
        if not entity_id:
            continue
        entity_type = getattr(scope, "entity_type", None)
        mode = getattr(scope, "mode", None)

        if entity_type == PromotionScopeEntityType.product:
            (include_products if mode == PromotionScopeMode.include else exclude_products).add(entity_id)
        elif entity_type == PromotionScopeEntityType.category:
            (include_categories if mode == PromotionScopeMode.include else exclude_categories).add(entity_id)

    return include_products, exclude_products, include_categories, exclude_categories


def _matches_include_scope(
    product_id: UUID,
    category_id: UUID | None,
    include_products: set[UUID],
    include_categories: set[UUID],
    has_includes: bool,
) -> bool:
    if not has_includes:
        return True
    return product_id in include_products or (category_id is not None and category_id in include_categories)


def _matches_exclude_scope(
    product_id: UUID, category_id: UUID | None, exclude_products: set[UUID], exclude_categories: set[UUID]
) -> bool:
    return product_id in exclude_products or (category_id is not None and category_id in exclude_categories)


def _line_total_for_item(item, quantity: int) -> Decimal:
    return Decimal(str(item.unit_price_at_add)) * quantity


def _should_skip_sale_item(promotion: Promotion, product) -> bool:
    return not promotion.allow_on_sale_items and product is not None and is_sale_active(product)


def _cart_item_scope_identifiers(item) -> tuple[object | None, UUID, UUID | None] | None:
    product = getattr(item, "product", None)
    product_id = getattr(item, "product_id", None) or getattr(product, "id", None)
    if not product_id:
        return None
    category_id = getattr(product, "category_id", None) if product is not None else None
    return product, product_id, category_id


def _item_is_within_scope(
    *,
    product_id: UUID,
    category_id: UUID | None,
    include_products: set[UUID],
    exclude_products: set[UUID],
    include_categories: set[UUID],
    exclude_categories: set[UUID],
    has_includes: bool,
) -> bool:
    if not _matches_include_scope(product_id, category_id, include_products, include_categories, has_includes):
        return False
    if _matches_exclude_scope(product_id, category_id, exclude_products, exclude_categories):
        return False
    return True


def _eligible_line_totals_for_item(
    item,
    *,
    promotion: Promotion,
    include_products: set[UUID],
    exclude_products: set[UUID],
    include_categories: set[UUID],
    exclude_categories: set[UUID],
    has_includes: bool,
) -> tuple[Decimal, Decimal] | None:
    quantity = int(getattr(item, "quantity", 0) or 0)
    if quantity <= 0:
        return None
    resolved = _cart_item_scope_identifiers(item)
    if resolved is None:
        return None
    product, product_id, category_id = resolved
    if not _item_is_within_scope(
        product_id=product_id,
        category_id=category_id,
        include_products=include_products,
        exclude_products=exclude_products,
        include_categories=include_categories,
        exclude_categories=exclude_categories,
        has_includes=has_includes,
    ):
        return None

    line_total = _line_total_for_item(item, quantity)
    eligible_total = Decimal("0.00") if _should_skip_sale_item(promotion, product) else line_total
    return line_total, eligible_total


def cart_eligible_subtotals_for_promotion(
    cart: Cart, *, promotion: Promotion, rounding: pricing.MoneyRounding = "half_up"
) -> tuple[Decimal, Decimal, bool, bool]:
    include_products, exclude_products, include_categories, exclude_categories = _promotion_scope_sets(promotion)
    has_includes = bool(include_products or include_categories)
    has_excludes = bool(exclude_products or exclude_categories)

    eligible_subtotal = Decimal("0.00")
    scope_subtotal = Decimal("0.00")

    for item in cart.items:
        totals = _eligible_line_totals_for_item(
            item,
            promotion=promotion,
            include_products=include_products,
            exclude_products=exclude_products,
            include_categories=include_categories,
            exclude_categories=exclude_categories,
            has_includes=has_includes,
        )
        if totals is None:
            continue
        line_total, eligible_line_total = totals
        scope_subtotal += line_total
        eligible_subtotal += eligible_line_total

    return (
        _quantize_money(eligible_subtotal, rounding=rounding),
        _quantize_money(scope_subtotal, rounding=rounding),
        has_includes,
        has_excludes,
    )


def _calculate_shipping_amount(
    subtotal: Decimal,
    *,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
    shipping_fee_ron: Decimal | None,
    rounding: pricing.MoneyRounding = "half_up",
) -> Decimal:
    if shipping_fee_ron is not None:
        return _quantize_money(shipping_fee_ron, rounding=rounding)
    base = _quantize_money(Decimal(shipping_method_rate_flat or 0), rounding=rounding)
    per = _quantize_money(Decimal(shipping_method_rate_per_kg or 0), rounding=rounding)
    return _quantize_money(base + per * subtotal, rounding=rounding)


@dataclass(frozen=True)
class CouponComputation:
    discount_ron: Decimal
    shipping_discount_ron: Decimal


def _estimate_discount_for_promotion(promotion: Promotion, eligible_subtotal: Decimal) -> Decimal:
    if promotion.discount_type == PromotionDiscountType.percent:
        return _percent_discount_estimate(promotion=promotion, eligible_subtotal=eligible_subtotal)
    if promotion.discount_type == PromotionDiscountType.amount:
        return _amount_discount_estimate(promotion=promotion, eligible_subtotal=eligible_subtotal)
    return Decimal("0.00")


def _percent_discount_estimate(*, promotion: Promotion, eligible_subtotal: Decimal) -> Decimal:
    pct = Decimal(promotion.percentage_off or 0)
    if pct > 0 and eligible_subtotal > 0:
        return eligible_subtotal * pct / Decimal("100")
    return Decimal("0.00")


def _amount_discount_estimate(*, promotion: Promotion, eligible_subtotal: Decimal) -> Decimal:
    amount = Decimal(promotion.amount_off or 0)
    if amount > 0 and eligible_subtotal > 0:
        return min(amount, eligible_subtotal)
    return Decimal("0.00")


def _cap_discount_estimate(discount_estimate: Decimal, promotion: Promotion, eligible_subtotal: Decimal) -> Decimal:
    capped = discount_estimate
    if promotion.max_discount_amount is not None:
        capped = min(capped, Decimal(promotion.max_discount_amount))
    return min(capped, eligible_subtotal)


def _effective_shipping_after_threshold(
    subtotal: Decimal, discount_estimate: Decimal, base_shipping: Decimal, threshold: Decimal | None
) -> Decimal:
    if threshold is not None and threshold >= 0 and (subtotal - discount_estimate) >= Decimal(threshold):
        return Decimal("0.00")
    return base_shipping


def compute_coupon_savings(
    *,
    promotion: Promotion,
    coupon: Coupon,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
) -> CouponComputation:
    rounding = checkout.money_rounding
    subtotal = cart_subtotal(cart, rounding=rounding)
    eligible_subtotal, _, _, _ = cart_eligible_subtotals_for_promotion(cart, promotion=promotion, rounding=rounding)

    # Compute shipping without this coupon (but with free-shipping threshold rules).
    shipping_fee = checkout.shipping_fee_ron
    base_shipping = _calculate_shipping_amount(
        subtotal,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
        shipping_fee_ron=shipping_fee,
        rounding=rounding,
    )

    # Apply free-shipping threshold after discount (discount only affects products).
    discount_estimate = _estimate_discount_for_promotion(promotion, eligible_subtotal)
    discount_estimate = _cap_discount_estimate(discount_estimate, promotion, eligible_subtotal)
    discount_estimate = _quantize_money(discount_estimate, rounding=rounding)

    threshold = checkout.free_shipping_threshold_ron
    effective_shipping = _effective_shipping_after_threshold(subtotal, discount_estimate, base_shipping, threshold)

    if promotion.discount_type == PromotionDiscountType.free_shipping:
        if effective_shipping > 0:
            return CouponComputation(
                discount_ron=Decimal("0.00"), shipping_discount_ron=_quantize_money(effective_shipping, rounding=rounding)
            )
        return CouponComputation(discount_ron=Decimal("0.00"), shipping_discount_ron=Decimal("0.00"))

    return CouponComputation(discount_ron=discount_estimate, shipping_discount_ron=Decimal("0.00"))


async def compute_totals_with_coupon(
    session: AsyncSession,
    *,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
    discount_ron: Decimal,
    free_shipping: bool,
    country_code: str | None = None,
) -> Totals:
    rounding = checkout.money_rounding
    subtotal = cart_subtotal(cart, rounding=rounding)
    shipping_fee = checkout.shipping_fee_ron
    base_shipping = _calculate_shipping_amount(
        subtotal,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
        shipping_fee_ron=shipping_fee,
        rounding=rounding,
    )

    threshold = checkout.free_shipping_threshold_ron
    shipping = base_shipping
    if threshold is not None and threshold >= 0 and (subtotal - discount_ron) >= Decimal(threshold):
        shipping = Decimal("0.00")
    if free_shipping:
        shipping = Decimal("0.00")

    base_breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=_quantize_money(discount_ron, rounding=rounding),
        shipping=_quantize_money(shipping, rounding=rounding),
        fee_enabled=checkout.fee_enabled,
        fee_type=checkout.fee_type,
        fee_value=checkout.fee_value,
        vat_enabled=False,
        vat_rate_percent=checkout.vat_rate_percent,
        vat_apply_to_shipping=checkout.vat_apply_to_shipping,
        vat_apply_to_fee=checkout.vat_apply_to_fee,
        rounding=checkout.money_rounding,
    )

    lines: list[TaxableProductLine] = []
    for item in cart.items:
        product_id = getattr(item, "product_id", None) or getattr(getattr(item, "product", None), "id", None)
        if not product_id:
            continue
        line_total = Decimal(str(item.unit_price_at_add)) * int(item.quantity or 0)
        line_subtotal = _quantize_money(line_total, rounding=rounding)
        lines.append(TaxableProductLine(product_id=product_id, subtotal=line_subtotal))

    if lines:
        line_sum = sum((line.subtotal for line in lines), start=Decimal("0.00"))
        diff = _quantize_money(base_breakdown.subtotal - line_sum, rounding=rounding)
        if diff != 0:
            idx = max(range(len(lines)), key=lambda i: lines[i].subtotal)
            adjusted = lines[idx].subtotal + diff
            if adjusted < 0:
                adjusted = Decimal("0.00")
            lines[idx] = TaxableProductLine(product_id=lines[idx].product_id, subtotal=adjusted)

    vat_override = await taxes_service.compute_cart_vat_amount(
        session,
        country_code=country_code,
        lines=lines,
        discount=base_breakdown.discount,
        shipping=base_breakdown.shipping,
        fee=base_breakdown.fee,
        checkout=checkout,
    )

    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=_quantize_money(discount_ron, rounding=rounding),
        shipping=_quantize_money(shipping, rounding=rounding),
        fee_enabled=checkout.fee_enabled,
        fee_type=checkout.fee_type,
        fee_value=checkout.fee_value,
        vat_enabled=checkout.vat_enabled,
        vat_rate_percent=checkout.vat_rate_percent,
        vat_apply_to_shipping=checkout.vat_apply_to_shipping,
        vat_apply_to_fee=checkout.vat_apply_to_fee,
        rounding=checkout.money_rounding,
        vat_override=vat_override,
    )

    return Totals(
        subtotal=breakdown.subtotal,
        fee=breakdown.fee,
        tax=breakdown.vat,
        shipping=breakdown.shipping,
        total=breakdown.total,
        currency="RON",
    )


@dataclass(frozen=True)
class AppliedDiscount:
    coupon: Coupon | None
    discount_ron: Decimal
    shipping_discount_ron: Decimal
    totals: Totals


async def apply_discount_code_to_cart(
    session: AsyncSession,
    *,
    user: User,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
    code: str | None,
    country_code: str | None = None,
) -> AppliedDiscount:
    cleaned = _normalize_code(code or "")
    if not cleaned:
        totals = await compute_totals_with_coupon(
            session,
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=shipping_method_rate_flat,
            shipping_method_rate_per_kg=shipping_method_rate_per_kg,
            discount_ron=Decimal("0.00"),
            free_shipping=False,
            country_code=country_code,
        )
        return AppliedDiscount(coupon=None, discount_ron=Decimal("0.00"), shipping_discount_ron=Decimal("0.00"), totals=totals)

    coupon = await get_coupon_by_code(session, code=cleaned)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    eval_result = await evaluate_coupon_for_cart(
        session,
        user_id=user.id,
        coupon=coupon,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
    )
    if not eval_result.eligible:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon is not eligible")

    free_shipping = coupon.promotion.discount_type == PromotionDiscountType.free_shipping
    totals = await compute_totals_with_coupon(
        session,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
        discount_ron=eval_result.estimated_discount_ron,
        free_shipping=free_shipping,
        country_code=country_code,
    )
    return AppliedDiscount(
        coupon=coupon,
        discount_ron=eval_result.estimated_discount_ron,
        shipping_discount_ron=eval_result.estimated_shipping_discount_ron,
        totals=totals,
    )


def _promotion_reasons(promotion: Promotion, now: datetime) -> list[str]:
    reasons: list[str] = []
    if not promotion.is_active:
        reasons.append("inactive")
    if promotion.starts_at and promotion.starts_at > now:
        reasons.append("not_started")
    if promotion.ends_at and promotion.ends_at < now:
        reasons.append("expired")
    return reasons


def _coupon_reasons(coupon: Coupon, now: datetime) -> list[str]:
    reasons: list[str] = []
    if not coupon.is_active:
        reasons.append("inactive")
    if coupon.starts_at and coupon.starts_at > now:
        reasons.append("not_started")
    if coupon.ends_at and coupon.ends_at < now:
        reasons.append("expired")
    return reasons


async def _count_active_reservations(session: AsyncSession, *, coupon_id: UUID, now: datetime) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponReservation)
                .where(CouponReservation.coupon_id == coupon_id, CouponReservation.expires_at >= now)
            )
        )
        .scalar_one()
    )


async def _count_redemptions(session: AsyncSession, *, coupon_id: UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponRedemption)
                .where(CouponRedemption.coupon_id == coupon_id, CouponRedemption.voided_at.is_(None))
            )
        )
        .scalar_one()
    )


async def _count_user_redemptions(session: AsyncSession, *, coupon_id: UUID, user_id: UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponRedemption)
                .where(
                    CouponRedemption.coupon_id == coupon_id,
                    CouponRedemption.user_id == user_id,
                    CouponRedemption.voided_at.is_(None),
                )
            )
        )
        .scalar_one()
    )


async def _count_user_active_reservations(session: AsyncSession, *, coupon_id: UUID, user_id: UUID, now: datetime) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponReservation)
                .where(
                    CouponReservation.coupon_id == coupon_id,
                    CouponReservation.user_id == user_id,
                    CouponReservation.expires_at >= now,
                )
            )
        )
        .scalar_one()
    )


async def _user_has_delivered_orders(session: AsyncSession, *, user_id: UUID) -> bool:
    return (
        int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(Order)
                    .where(
                        Order.user_id == user_id,
                        Order.status == OrderStatus.delivered,
                    )
                )
            ).scalar_one()
        )
        > 0
    )


async def get_coupon_by_code(session: AsyncSession, *, code: str) -> Coupon | None:
    cleaned = _normalize_code(code)
    if not cleaned:
        return None
    res = await session.execute(
        select(Coupon)
        .options(selectinload(Coupon.promotion).selectinload(Promotion.scopes))
        .where(Coupon.code == cleaned)
    )
    return res.scalar_one_or_none()


async def get_user_visible_coupons(session: AsyncSession, *, user_id: UUID) -> list[Coupon]:
    assignment_ids = select(CouponAssignment.coupon_id).where(
        CouponAssignment.user_id == user_id,
        CouponAssignment.revoked_at.is_(None),
    )
    result = await session.execute(
        select(Coupon)
        .options(selectinload(Coupon.promotion).selectinload(Promotion.scopes))
        .join(Promotion, Coupon.promotion_id == Promotion.id)
        .where(
            or_(
                Coupon.visibility == CouponVisibility.public,
                and_(Coupon.visibility == CouponVisibility.assigned, Coupon.id.in_(assignment_ids)),
            ),
        )
        .order_by(Coupon.created_at.desc())
    )
    coupons = list(result.scalars().all())
    # Keep expired/inactive coupons visible in profile/checkout lists so the UI can explain eligibility.
    return coupons


@dataclass(frozen=True)
class CouponEligibility:
    coupon: Coupon
    eligible: bool
    reasons: list[str]
    estimated_discount_ron: Decimal
    estimated_shipping_discount_ron: Decimal
    global_remaining: int | None
    customer_remaining: int | None


def _append_scope_and_subtotal_reasons(
    *,
    reasons: list[str],
    promotion: Promotion,
    eligible_subtotal: Decimal,
    scope_subtotal: Decimal,
    has_includes: bool,
    has_excludes: bool,
) -> None:
    if promotion.discount_type in {PromotionDiscountType.percent, PromotionDiscountType.amount} and eligible_subtotal <= 0:
        reasons.append("no_eligible_items")
    if scope_subtotal <= 0:
        if has_includes:
            reasons.append("scope_no_match")
        elif has_excludes:
            reasons.append("scope_excluded")


def _append_min_subtotal_reason(*, reasons: list[str], promotion: Promotion, subtotal: Decimal) -> None:
    if promotion.min_subtotal is not None and subtotal < Decimal(promotion.min_subtotal):
        reasons.append("min_subtotal_not_met")


async def _maybe_append_first_order_reason(
    session: AsyncSession,
    *,
    reasons: list[str],
    promotion: Promotion,
    user_id: UUID,
    user_has_delivered_orders: bool | None,
) -> None:
    if not getattr(promotion, "first_order_only", False):
        return
    has_delivered = user_has_delivered_orders
    if has_delivered is None:
        has_delivered = await _user_has_delivered_orders(session, user_id=user_id)
    if has_delivered:
        reasons.append("first_order_only")


def _append_shipping_coupon_reason(*, reasons: list[str], promotion: Promotion, savings: CouponComputation) -> None:
    if promotion.discount_type == PromotionDiscountType.free_shipping and savings.shipping_discount_ron <= 0:
        reasons.append("shipping_already_free")


async def _append_assigned_coupon_reason(
    session: AsyncSession,
    *,
    reasons: list[str],
    coupon: Coupon,
    user_id: UUID,
) -> None:
    if coupon.visibility != CouponVisibility.assigned:
        return
    assignment = (
        (
            await session.execute(
                select(CouponAssignment).where(
                    CouponAssignment.coupon_id == coupon.id,
                    CouponAssignment.user_id == user_id,
                    CouponAssignment.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .first()
    )
    if not assignment:
        reasons.append("not_assigned")


async def _remaining_redemption_caps(
    session: AsyncSession,
    *,
    coupon: Coupon,
    user_id: UUID,
    now: datetime,
    reasons: list[str],
) -> tuple[int | None, int | None]:
    global_remaining: int | None = None
    customer_remaining: int | None = None

    if coupon.global_max_redemptions is not None:
        await session.execute(
            delete(CouponReservation).where(CouponReservation.coupon_id == coupon.id, CouponReservation.expires_at < now)
        )
        redeemed = await _count_redemptions(session, coupon_id=coupon.id)
        reserved = await _count_active_reservations(session, coupon_id=coupon.id, now=now)
        remaining = int(coupon.global_max_redemptions) - (redeemed + reserved)
        global_remaining = max(0, remaining)
        if global_remaining <= 0:
            reasons.append("sold_out")

    if coupon.per_customer_max_redemptions is not None:
        redeemed_u = await _count_user_redemptions(session, coupon_id=coupon.id, user_id=user_id)
        reserved_u = await _count_user_active_reservations(session, coupon_id=coupon.id, user_id=user_id, now=now)
        remaining_u = int(coupon.per_customer_max_redemptions) - (redeemed_u + reserved_u)
        customer_remaining = max(0, remaining_u)
        if customer_remaining <= 0:
            reasons.append("per_customer_limit_reached")

    return global_remaining, customer_remaining


async def evaluate_coupon_for_cart(
    session: AsyncSession,
    *,
    user_id: UUID,
    coupon: Coupon,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
    user_has_delivered_orders: bool | None = None,
) -> CouponEligibility:
    now = _now()
    promotion = coupon.promotion
    reasons: list[str] = []
    reasons.extend(_promotion_reasons(promotion, now))
    reasons.extend(_coupon_reasons(coupon, now))

    rounding = checkout.money_rounding
    subtotal = cart_subtotal(cart, rounding=rounding)
    eligible_subtotal, scope_subtotal, has_includes, has_excludes = cart_eligible_subtotals_for_promotion(
        cart, promotion=promotion, rounding=rounding
    )
    _append_scope_and_subtotal_reasons(
        reasons=reasons,
        promotion=promotion,
        eligible_subtotal=eligible_subtotal,
        scope_subtotal=scope_subtotal,
        has_includes=has_includes,
        has_excludes=has_excludes,
    )
    _append_min_subtotal_reason(reasons=reasons, promotion=promotion, subtotal=subtotal)
    await _maybe_append_first_order_reason(
        session,
        reasons=reasons,
        promotion=promotion,
        user_id=user_id,
        user_has_delivered_orders=user_has_delivered_orders,
    )

    savings = compute_coupon_savings(
        promotion=promotion,
        coupon=coupon,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
    )
    _append_shipping_coupon_reason(reasons=reasons, promotion=promotion, savings=savings)
    await _append_assigned_coupon_reason(session, reasons=reasons, coupon=coupon, user_id=user_id)
    global_remaining, customer_remaining = await _remaining_redemption_caps(
        session,
        coupon=coupon,
        user_id=user_id,
        now=now,
        reasons=reasons,
    )

    # Deduplicate overlapping promo/coupon state reasons while preserving order.
    seen: set[str] = set()
    deduped: list[str] = []
    for reason in reasons:
        if reason in seen:
            continue
        seen.add(reason)
        deduped.append(reason)

    eligible = not deduped
    return CouponEligibility(
        coupon=coupon,
        eligible=eligible,
        reasons=deduped,
        estimated_discount_ron=savings.discount_ron,
        estimated_shipping_discount_ron=savings.shipping_discount_ron,
        global_remaining=global_remaining,
        customer_remaining=customer_remaining,
    )


async def evaluate_coupons_for_user_cart(
    session: AsyncSession,
    *,
    user: User,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
) -> list[CouponEligibility]:
    coupons = await get_user_visible_coupons(session, user_id=user.id)
    delivered_flag: bool | None = None
    if any(getattr(getattr(coupon, "promotion", None), "first_order_only", False) for coupon in coupons):
        delivered_flag = await _user_has_delivered_orders(session, user_id=user.id)
    results: list[CouponEligibility] = []
    for coupon in coupons:
        results.append(
            await evaluate_coupon_for_cart(
                session,
                user_id=user.id,
                coupon=coupon,
                cart=cart,
                checkout=checkout,
                shipping_method_rate_flat=shipping_method_rate_flat,
                shipping_method_rate_per_kg=shipping_method_rate_per_kg,
                user_has_delivered_orders=delivered_flag,
            )
        )
    return results


def _validate_coupon_reservation_input(*, user: User, order: Order, coupon: Coupon) -> str:
    if not user.id or not order.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order user is required for coupons")
    cleaned_code = _normalize_code(coupon.code)
    if not cleaned_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid coupon code")
    return cleaned_code


async def _existing_coupon_reservation_for_order(session: AsyncSession, *, order_id: UUID) -> CouponReservation | None:
    return (await session.execute(select(CouponReservation).where(CouponReservation.order_id == order_id))).scalars().first()


async def _lock_coupon_for_reservation(session: AsyncSession, *, coupon_id: UUID) -> Coupon:
    locked = (await session.execute(select(Coupon).where(Coupon.id == coupon_id).with_for_update())).scalars().first()
    if not locked or not locked.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon is not active")
    return locked


async def _ensure_assigned_coupon_visibility(
    session: AsyncSession,
    *,
    locked_coupon: Coupon,
    user: User,
) -> None:
    if locked_coupon.visibility != CouponVisibility.assigned:
        return
    assigned = (
        (
            await session.execute(
                select(func.count())
                .select_from(CouponAssignment)
                .where(
                    CouponAssignment.coupon_id == locked_coupon.id,
                    CouponAssignment.user_id == user.id,
                    CouponAssignment.revoked_at.is_(None),
                )
            )
        )
        .scalar_one()
    )
    if int(assigned or 0) <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon is not assigned to this user")


async def _enforce_coupon_redemption_caps(
    session: AsyncSession,
    *,
    locked_coupon: Coupon,
    coupon_id: UUID,
    user_id: UUID,
    now: datetime,
) -> None:
    await session.execute(delete(CouponReservation).where(CouponReservation.coupon_id == coupon_id, CouponReservation.expires_at < now))

    if locked_coupon.global_max_redemptions is not None:
        redeemed = await _count_redemptions(session, coupon_id=coupon_id)
        reserved = await _count_active_reservations(session, coupon_id=coupon_id, now=now)
        if redeemed + reserved >= int(locked_coupon.global_max_redemptions):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon usage limit reached")

    if locked_coupon.per_customer_max_redemptions is not None:
        redeemed_u = await _count_user_redemptions(session, coupon_id=coupon_id, user_id=user_id)
        reserved_u = await _count_user_active_reservations(session, coupon_id=coupon_id, user_id=user_id, now=now)
        if redeemed_u + reserved_u >= int(locked_coupon.per_customer_max_redemptions):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon per-customer limit reached")


async def reserve_coupon_for_order(
    session: AsyncSession,
    *,
    user: User,
    order: Order,
    coupon: Coupon,
    discount_ron: Decimal,
    shipping_discount_ron: Decimal,
) -> CouponReservation:
    cleaned_code = _validate_coupon_reservation_input(user=user, order=order, coupon=coupon)
    now = _now()
    existing = await _existing_coupon_reservation_for_order(session, order_id=order.id)
    if existing:
        if existing.coupon_id != coupon.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order already has a reserved coupon")
        return existing

    locked = await _lock_coupon_for_reservation(session, coupon_id=coupon.id)
    await _ensure_assigned_coupon_visibility(session, locked_coupon=locked, user=user)
    await _enforce_coupon_redemption_caps(session, locked_coupon=locked, coupon_id=coupon.id, user_id=user.id, now=now)

    ttl_minutes = int(getattr(settings, "coupon_reservation_ttl_minutes", 24 * 60) or (24 * 60))
    expires_at = now + timedelta(minutes=ttl_minutes)
    reservation = CouponReservation(
        coupon_id=coupon.id,
        user_id=user.id,
        order_id=order.id,
        expires_at=expires_at,
        discount_ron=_quantize_money(discount_ron),
        shipping_discount_ron=_quantize_money(shipping_discount_ron),
    )
    session.add(reservation)
    session.add(OrderEvent(order_id=order.id, event="coupon_reserved", note=cleaned_code))
    await session.commit()
    await session.refresh(reservation)
    return reservation


async def redeem_coupon_for_order(session: AsyncSession, *, order: Order, note: str | None = None) -> None:
    code = _normalize_code(getattr(order, "promo_code", "") or "")
    if not code:
        return
    if not order.user_id:
        return

    coupon = await get_coupon_by_code(session, code=code)
    if not coupon:
        return

    existing = (
        (await session.execute(select(CouponRedemption).where(CouponRedemption.order_id == order.id))).scalars().first()
    )
    if existing:
        return

    # Lock coupon row for consistency.
    await session.execute(select(Coupon).where(Coupon.id == coupon.id).with_for_update())

    reservation = (
        (
            await session.execute(
                select(CouponReservation).where(CouponReservation.order_id == order.id, CouponReservation.coupon_id == coupon.id)
            )
        )
        .scalars()
        .first()
    )
    discount_ron = Decimal("0.00")
    shipping_discount_ron = Decimal("0.00")
    if reservation:
        discount_ron = Decimal(reservation.discount_ron or 0)
        shipping_discount_ron = Decimal(reservation.shipping_discount_ron or 0)
        await session.delete(reservation)

    session.add(
        CouponRedemption(
            coupon_id=coupon.id,
            user_id=order.user_id,
            order_id=order.id,
            discount_ron=_quantize_money(discount_ron),
            shipping_discount_ron=_quantize_money(shipping_discount_ron),
        )
    )
    session.add(OrderEvent(order_id=order.id, event="coupon_redeemed", note=note or code))
    await session.commit()


async def release_coupon_for_order(session: AsyncSession, *, order: Order, reason: str) -> None:
    code = _normalize_code(getattr(order, "promo_code", "") or "")
    if not code:
        return
    coupon = await get_coupon_by_code(session, code=code)
    if not coupon:
        return

    await _release_coupon_reservation(session, order_id=order.id, reason=reason)
    await _void_coupon_redemption(session, order_id=order.id, reason=reason)


async def _release_coupon_reservation(session: AsyncSession, *, order_id: UUID, reason: str) -> None:
    reservation = (
        (await session.execute(select(CouponReservation).where(CouponReservation.order_id == order_id))).scalars().first()
    )
    if reservation is None:
        return
    await session.delete(reservation)
    session.add(OrderEvent(order_id=order_id, event="coupon_reservation_released", note=reason))
    await session.commit()


async def _void_coupon_redemption(session: AsyncSession, *, order_id: UUID, reason: str) -> None:
    redemption = (
        (await session.execute(select(CouponRedemption).where(CouponRedemption.order_id == order_id))).scalars().first()
    )
    if redemption is None or redemption.voided_at is not None:
        return
    redemption.voided_at = _now()
    redemption.void_reason = (reason or "")[:255] if reason else None
    session.add(redemption)
    session.add(OrderEvent(order_id=order_id, event="coupon_voided", note=reason))
    await session.commit()


_COUPON_CODE_ALPHABET = string.ascii_uppercase + string.digits
_COUPON_CODE_TOKEN_RE = re.compile(r"\{RAND(?::(\d{1,2}))?\}")


def generate_coupon_code(*, prefix: str = "", length: int = 10, pattern: str | None = None) -> str:
    """Generate a coupon code candidate.

    Supports a limited pattern language:
    - `{RAND}` or `{RAND:n}` tokens are replaced with random uppercase alphanumerics.
    - If the pattern contains no `{RAND}` token, a random suffix is appended.
    """

    default_len = max(1, int(length or 10))
    prefix_clean = (prefix or "").strip().upper()
    pattern_clean = (pattern or "").strip().upper()

    def _rand(n: int) -> str:
        size = max(1, int(n))
        return "".join(secrets.choice(_COUPON_CODE_ALPHABET) for _ in range(size))

    if pattern_clean:
        token_hits = 0

        def _replace(match: re.Match[str]) -> str:
            nonlocal token_hits
            token_hits += 1
            n_raw = match.group(1)
            try:
                n = int(n_raw) if n_raw else default_len
            except Exception:
                n = default_len
            n = max(1, min(n, 32))
            return _rand(n)

        rendered = _COUPON_CODE_TOKEN_RE.sub(_replace, pattern_clean)
        if token_hits == 0:
            rendered = f"{rendered}-{_rand(default_len)}".strip("-")
        base = rendered
    else:
        base = f"{prefix_clean}-{_rand(default_len)}".strip("-")

    cleaned = re.sub(r"[^A-Z0-9-]+", "-", base)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned[:40]


async def generate_unique_coupon_code(
    session: AsyncSession,
    *,
    prefix: str,
    length: int = 12,
    pattern: str | None = None,
    attempts: int = 20,
) -> str:
    prefix_clean = _normalize_code(prefix or "").replace("-", "")[:20] or "COUPON"
    pattern_clean = (pattern or "").strip() or None
    max_attempts = max(1, min(int(attempts or 20), 200))

    for _ in range(max_attempts):
        candidate = generate_coupon_code(prefix=prefix_clean, length=length, pattern=pattern_clean)
        exists = (await session.execute(select(func.count()).select_from(Coupon).where(Coupon.code == candidate))).scalar_one()
        if int(exists) == 0:
            return candidate
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate coupon code")


async def ensure_first_order_promotion(session: AsyncSession) -> Promotion:
    promo = (
        (
            await session.execute(
                select(Promotion).where(Promotion.key == FIRST_ORDER_PROMOTION_KEY)
            )
        )
        .scalars()
        .first()
    )
    if promo:
        return promo

    promo = Promotion(
        key=FIRST_ORDER_PROMOTION_KEY,
        name="First order reward",
        description="20% off your next order (one-time).",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("20.00"),
        allow_on_sale_items=True,
        is_active=True,
        is_automatic=False,
    )
    session.add(promo)
    await session.commit()
    await session.refresh(promo)
    return promo


async def issue_first_order_reward_if_eligible(
    session: AsyncSession,
    *,
    user: User,
    order: Order,
    validity_days: int = 30,
) -> Coupon | None:
    if not user.id:
        return None
    if not order.id:
        return None
    # Only issue on delivered orders.
    if getattr(order, "status", None) != OrderStatus.delivered:
        return None

    # Ensure this is the user's first delivered order.
    delivered_count = int(
        (
            await session.execute(
                select(func.count())
                .select_from(Order)
                .where(
                    Order.user_id == user.id,
                    Order.status == OrderStatus.delivered,
                )
            )
        )
        .scalar_one()
    )
    if delivered_count != 1:
        return None

    existing_reward = (
        (
            await session.execute(
                select(CouponAssignment)
                .join(Coupon, CouponAssignment.coupon_id == Coupon.id)
                .join(Promotion, Coupon.promotion_id == Promotion.id)
                .where(
                    CouponAssignment.user_id == user.id,
                    Promotion.key == FIRST_ORDER_PROMOTION_KEY,
                    CouponAssignment.revoked_at.is_(None),
                )
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if existing_reward:
        return None

    promotion = await ensure_first_order_promotion(session)
    prefix = "FIRST20"
    code = await generate_unique_coupon_code(session, prefix=prefix, length=12)

    starts_at = _now()
    ends_at = starts_at + timedelta(days=int(validity_days))
    coupon = Coupon(
        promotion_id=promotion.id,
        code=code,
        visibility=CouponVisibility.assigned,
        is_active=True,
        starts_at=starts_at,
        ends_at=ends_at,
        global_max_redemptions=None,
        per_customer_max_redemptions=1,
    )
    session.add(coupon)
    await session.commit()
    await session.refresh(coupon)

    assignment = CouponAssignment(coupon_id=coupon.id, user_id=user.id)
    session.add(assignment)
    session.add(OrderEvent(order_id=order.id, event="first_order_coupon_issued", note=code))
    await session.commit()
    return coupon
