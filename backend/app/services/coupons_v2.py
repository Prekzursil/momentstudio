from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import secrets
import string
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.cart import Cart
from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    CouponRedemption,
    CouponReservation,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
)
from app.models.order import Order, OrderEvent, OrderStatus
from app.models.user import User
from app.services import pricing
from app.services.catalog import is_sale_active
from app.services.checkout_settings import CheckoutSettings
from app.schemas.cart import Totals


FIRST_ORDER_PROMOTION_KEY = "first_order_reward_v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_code(code: str) -> str:
    return (code or "").strip().upper()


def _quantize_money(value: Decimal) -> Decimal:
    if settings.enforce_decimal_prices:
        return pricing.quantize_money(value)
    return Decimal(value)


def cart_subtotal(cart: Cart) -> Decimal:
    subtotal = sum((Decimal(str(item.unit_price_at_add)) * int(item.quantity or 0) for item in cart.items), start=Decimal("0.00"))
    return _quantize_money(subtotal)


def cart_eligible_subtotal(cart: Cart, *, allow_on_sale_items: bool) -> Decimal:
    subtotal = Decimal("0.00")
    for item in cart.items:
        product = getattr(item, "product", None)
        if not allow_on_sale_items and product is not None and is_sale_active(product):
            continue
        subtotal += Decimal(str(item.unit_price_at_add)) * int(item.quantity or 0)
    return _quantize_money(subtotal)


def _calculate_shipping_amount(
    subtotal: Decimal,
    *,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
    shipping_fee_ron: Decimal | None,
) -> Decimal:
    if shipping_fee_ron is not None:
        return _quantize_money(shipping_fee_ron)
    base = _quantize_money(Decimal(shipping_method_rate_flat or 0))
    per = _quantize_money(Decimal(shipping_method_rate_per_kg or 0))
    return _quantize_money(base + per * subtotal)


@dataclass(frozen=True)
class CouponComputation:
    discount_ron: Decimal
    shipping_discount_ron: Decimal


def compute_coupon_savings(
    *,
    promotion: Promotion,
    coupon: Coupon,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
) -> CouponComputation:
    subtotal = cart_subtotal(cart)
    eligible_subtotal = cart_eligible_subtotal(cart, allow_on_sale_items=promotion.allow_on_sale_items)

    # Compute shipping without this coupon (but with free-shipping threshold rules).
    shipping_fee = checkout.shipping_fee_ron
    base_shipping = _calculate_shipping_amount(
        subtotal,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
        shipping_fee_ron=shipping_fee,
    )

    # Apply free-shipping threshold after discount (discount only affects products).
    discount_estimate = Decimal("0.00")
    if promotion.discount_type == PromotionDiscountType.percent:
        pct = Decimal(promotion.percentage_off or 0)
        if pct > 0 and eligible_subtotal > 0:
            discount_estimate = eligible_subtotal * pct / Decimal("100")
    elif promotion.discount_type == PromotionDiscountType.amount:
        amt = Decimal(promotion.amount_off or 0)
        if amt > 0 and eligible_subtotal > 0:
            discount_estimate = min(amt, eligible_subtotal)
    elif promotion.discount_type == PromotionDiscountType.free_shipping:
        discount_estimate = Decimal("0.00")

    if promotion.max_discount_amount is not None:
        discount_estimate = min(discount_estimate, Decimal(promotion.max_discount_amount))

    discount_estimate = _quantize_money(min(discount_estimate, eligible_subtotal))

    threshold = checkout.free_shipping_threshold_ron
    effective_shipping = base_shipping
    if threshold is not None and threshold >= 0 and (subtotal - discount_estimate) >= Decimal(threshold):
        effective_shipping = Decimal("0.00")

    if promotion.discount_type == PromotionDiscountType.free_shipping:
        if effective_shipping > 0:
            return CouponComputation(discount_ron=Decimal("0.00"), shipping_discount_ron=_quantize_money(effective_shipping))
        return CouponComputation(discount_ron=Decimal("0.00"), shipping_discount_ron=Decimal("0.00"))

    return CouponComputation(discount_ron=discount_estimate, shipping_discount_ron=Decimal("0.00"))


def compute_totals_with_coupon(
    *,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
    discount_ron: Decimal,
    free_shipping: bool,
) -> Totals:
    subtotal = cart_subtotal(cart)
    shipping_fee = checkout.shipping_fee_ron
    base_shipping = _calculate_shipping_amount(
        subtotal,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
        shipping_fee_ron=shipping_fee,
    )

    threshold = checkout.free_shipping_threshold_ron
    shipping = base_shipping
    if threshold is not None and threshold >= 0 and (subtotal - discount_ron) >= Decimal(threshold):
        shipping = Decimal("0.00")
    if free_shipping:
        shipping = Decimal("0.00")

    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=_quantize_money(discount_ron),
        shipping=_quantize_money(shipping),
        fee_enabled=checkout.fee_enabled,
        fee_type=checkout.fee_type,
        fee_value=checkout.fee_value,
        vat_enabled=checkout.vat_enabled,
        vat_rate_percent=checkout.vat_rate_percent,
        vat_apply_to_shipping=checkout.vat_apply_to_shipping,
        vat_apply_to_fee=checkout.vat_apply_to_fee,
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
) -> AppliedDiscount:
    cleaned = _normalize_code(code or "")
    if not cleaned:
        totals = compute_totals_with_coupon(
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=shipping_method_rate_flat,
            shipping_method_rate_per_kg=shipping_method_rate_per_kg,
            discount_ron=Decimal("0.00"),
            free_shipping=False,
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
    totals = compute_totals_with_coupon(
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
        discount_ron=eval_result.estimated_discount_ron,
        free_shipping=free_shipping,
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


async def get_coupon_by_code(session: AsyncSession, *, code: str) -> Coupon | None:
    cleaned = _normalize_code(code)
    if not cleaned:
        return None
    res = await session.execute(select(Coupon).options(selectinload(Coupon.promotion)).where(Coupon.code == cleaned))
    return res.scalar_one_or_none()


async def get_user_visible_coupons(session: AsyncSession, *, user_id: UUID) -> list[Coupon]:
    assignment_ids = select(CouponAssignment.coupon_id).where(
        CouponAssignment.user_id == user_id,
        CouponAssignment.revoked_at.is_(None),
    )
    result = await session.execute(
        select(Coupon)
        .options(selectinload(Coupon.promotion))
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


async def evaluate_coupon_for_cart(
    session: AsyncSession,
    *,
    user_id: UUID,
    coupon: Coupon,
    cart: Cart,
    checkout: CheckoutSettings,
    shipping_method_rate_flat: Decimal | None,
    shipping_method_rate_per_kg: Decimal | None,
) -> CouponEligibility:
    now = _now()
    promotion = coupon.promotion
    reasons: list[str] = []
    reasons.extend(_promotion_reasons(promotion, now))
    reasons.extend(_coupon_reasons(coupon, now))

    subtotal = cart_subtotal(cart)
    eligible_subtotal = cart_eligible_subtotal(cart, allow_on_sale_items=promotion.allow_on_sale_items)
    if promotion.discount_type in {PromotionDiscountType.percent, PromotionDiscountType.amount} and eligible_subtotal <= 0:
        reasons.append("no_eligible_items")

    if promotion.min_subtotal is not None:
        min_required = Decimal(promotion.min_subtotal)
        if subtotal < min_required:
            reasons.append("min_subtotal_not_met")

    savings = compute_coupon_savings(
        promotion=promotion,
        coupon=coupon,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=shipping_method_rate_flat,
        shipping_method_rate_per_kg=shipping_method_rate_per_kg,
    )
    if promotion.discount_type == PromotionDiscountType.free_shipping and savings.shipping_discount_ron <= 0:
        reasons.append("shipping_already_free")

    # Eligibility requires assignment if coupon is assigned.
    if coupon.visibility == CouponVisibility.assigned:
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

    # Global and per-customer caps.
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
            )
        )
    return results


async def reserve_coupon_for_order(
    session: AsyncSession,
    *,
    user: User,
    order: Order,
    coupon: Coupon,
    discount_ron: Decimal,
    shipping_discount_ron: Decimal,
) -> CouponReservation:
    if not user.id or not order.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order user is required for coupons")

    now = _now()
    cleaned_code = _normalize_code(coupon.code)
    if not cleaned_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid coupon code")

    existing = (
        (await session.execute(select(CouponReservation).where(CouponReservation.order_id == order.id))).scalars().first()
    )
    if existing:
        if existing.coupon_id != coupon.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order already has a reserved coupon")
        return existing

    # Lock coupon row to enforce strict caps.
    locked = (
        (await session.execute(select(Coupon).where(Coupon.id == coupon.id).with_for_update()))
        .scalars()
        .first()
    )
    if not locked or not locked.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon is not active")

    if locked.visibility == CouponVisibility.assigned:
        assigned = (
            (
                await session.execute(
                    select(func.count())
                    .select_from(CouponAssignment)
                    .where(
                        CouponAssignment.coupon_id == locked.id,
                        CouponAssignment.user_id == user.id,
                        CouponAssignment.revoked_at.is_(None),
                    )
                )
            )
            .scalar_one()
        )
        if int(assigned or 0) <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon is not assigned to this user")

    # Cleanup expired reservations under lock.
    await session.execute(delete(CouponReservation).where(CouponReservation.coupon_id == coupon.id, CouponReservation.expires_at < now))

    if locked.global_max_redemptions is not None:
        redeemed = await _count_redemptions(session, coupon_id=coupon.id)
        reserved = await _count_active_reservations(session, coupon_id=coupon.id, now=now)
        if redeemed + reserved >= int(locked.global_max_redemptions):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon usage limit reached")

    if locked.per_customer_max_redemptions is not None:
        redeemed_u = await _count_user_redemptions(session, coupon_id=coupon.id, user_id=user.id)
        reserved_u = await _count_user_active_reservations(session, coupon_id=coupon.id, user_id=user.id, now=now)
        if redeemed_u + reserved_u >= int(locked.per_customer_max_redemptions):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon per-customer limit reached")

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

    reservation = (
        (await session.execute(select(CouponReservation).where(CouponReservation.order_id == order.id))).scalars().first()
    )
    if reservation:
        await session.delete(reservation)
        session.add(OrderEvent(order_id=order.id, event="coupon_reservation_released", note=reason))
        await session.commit()

    redemption = (
        (await session.execute(select(CouponRedemption).where(CouponRedemption.order_id == order.id))).scalars().first()
    )
    if redemption and redemption.voided_at is None:
        redemption.voided_at = _now()
        redemption.void_reason = (reason or "")[:255] if reason else None
        session.add(redemption)
        session.add(OrderEvent(order_id=order.id, event="coupon_voided", note=reason))
        await session.commit()


def generate_coupon_code(*, prefix: str, length: int = 10) -> str:
    alphabet = string.ascii_uppercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(length))
    base = f"{prefix}-{suffix}".strip("-").upper()
    return base[:40]


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
    code = ""
    for _ in range(10):
        candidate = generate_coupon_code(prefix=prefix, length=12)
        exists = (
            (await session.execute(select(func.count()).select_from(Coupon).where(Coupon.code == candidate))).scalar_one()
        )
        if int(exists) == 0:
            code = candidate
            break
    if not code:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate coupon code")

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
