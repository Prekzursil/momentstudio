from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, require_admin
from app.db.session import get_session
from app.models.coupons_v2 import Coupon, CouponAssignment, Promotion
from app.models.order import ShippingMethod
from app.models.user import User
from app.schemas.coupons_v2 import (
    CouponAssignRequest,
    CouponCreate,
    CouponEligibilityResponse,
    CouponOffer,
    CouponRead,
    CouponRevokeRequest,
    CouponValidateRequest,
    PromotionCreate,
    PromotionRead,
)
from app.services import checkout_settings as checkout_settings_service
from app.services import coupons_v2 as coupons_service
from app.services import email as email_service
from app.services import cart as cart_service


router = APIRouter(prefix="/coupons", tags=["coupons"])


async def _get_shipping_method(session: AsyncSession, shipping_method_id: UUID | None) -> ShippingMethod | None:
    if not shipping_method_id:
        return None
    shipping_method = await session.get(ShippingMethod, shipping_method_id)
    if not shipping_method:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    return shipping_method


def _to_offer(result: coupons_service.CouponEligibility) -> CouponOffer:
    coupon_read = CouponRead.model_validate(result.coupon, from_attributes=True)
    if result.coupon.promotion:
        coupon_read.promotion = PromotionRead.model_validate(result.coupon.promotion, from_attributes=True)
    return CouponOffer(
        coupon=coupon_read,
        estimated_discount_ron=result.estimated_discount_ron,
        estimated_shipping_discount_ron=result.estimated_shipping_discount_ron,
        eligible=result.eligible,
        reasons=list(result.reasons),
        global_remaining=result.global_remaining,
        customer_remaining=result.customer_remaining,
    )


@router.get("/eligibility", response_model=CouponEligibilityResponse)
async def coupon_eligibility(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    shipping_method_id: UUID | None = Query(default=None),
) -> CouponEligibilityResponse:
    user_cart = await cart_service.get_cart(session, current_user.id, None)
    checkout = await checkout_settings_service.get_checkout_settings(session)
    shipping_method = await _get_shipping_method(session, shipping_method_id)
    rate_flat = Decimal(getattr(shipping_method, "rate_flat", None) or 0) if shipping_method else None
    rate_per = Decimal(getattr(shipping_method, "rate_per_kg", None) or 0) if shipping_method else None
    results = await coupons_service.evaluate_coupons_for_user_cart(
        session,
        user=current_user,
        cart=user_cart,
        checkout=checkout,
        shipping_method_rate_flat=rate_flat,
        shipping_method_rate_per_kg=rate_per,
    )
    eligible = [_to_offer(r) for r in results if r.eligible]
    ineligible = [_to_offer(r) for r in results if not r.eligible]
    return CouponEligibilityResponse(eligible=eligible, ineligible=ineligible)


@router.post("/validate", response_model=CouponOffer)
async def validate_coupon(
    payload: CouponValidateRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    shipping_method_id: UUID | None = Query(default=None),
) -> CouponOffer:
    code = (payload.code or "").strip().upper()
    coupon = await coupons_service.get_coupon_by_code(session, code=code)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    user_cart = await cart_service.get_cart(session, current_user.id, None)
    checkout = await checkout_settings_service.get_checkout_settings(session)
    shipping_method = await _get_shipping_method(session, shipping_method_id)
    rate_flat = Decimal(getattr(shipping_method, "rate_flat", None) or 0) if shipping_method else None
    rate_per = Decimal(getattr(shipping_method, "rate_per_kg", None) or 0) if shipping_method else None
    result = await coupons_service.evaluate_coupon_for_cart(
        session,
        user_id=current_user.id,
        coupon=coupon,
        cart=user_cart,
        checkout=checkout,
        shipping_method_rate_flat=rate_flat,
        shipping_method_rate_per_kg=rate_per,
    )
    return _to_offer(result)


@router.get("/me", response_model=list[CouponRead])
async def my_coupons(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[CouponRead]:
    coupons = await coupons_service.get_user_visible_coupons(session, user_id=current_user.id)
    return [
        CouponRead.model_validate(c, from_attributes=True).model_copy(
            update={"promotion": PromotionRead.model_validate(c.promotion, from_attributes=True) if c.promotion else None}
        )
        for c in coupons
    ]


@router.post("/admin/promotions", response_model=PromotionRead, status_code=status.HTTP_201_CREATED)
async def admin_create_promotion(
    payload: PromotionCreate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> PromotionRead:
    if payload.discount_type == "percent" and not payload.percentage_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="percentage_off is required for percent promotions")
    if payload.discount_type == "amount" and not payload.amount_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="amount_off is required for amount promotions")
    if payload.discount_type == "free_shipping":
        if payload.percentage_off or payload.amount_off:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="free_shipping promotions cannot set percentage_off/amount_off")
    if payload.percentage_off and payload.amount_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose percentage_off or amount_off, not both")

    key_clean = (payload.key or "").strip() or None
    if key_clean:
        key_clean = key_clean[:80]
        exists = (
            (await session.execute(select(Promotion).where(Promotion.key == key_clean))).scalars().first()
        )
        if exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promotion key already exists")

    promo = Promotion(**payload.model_dump(exclude={"key"}), key=key_clean)
    session.add(promo)
    await session.commit()
    await session.refresh(promo)
    return PromotionRead.model_validate(promo, from_attributes=True)


@router.post("/admin/coupons", response_model=CouponRead, status_code=status.HTTP_201_CREATED)
async def admin_create_coupon(
    payload: CouponCreate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> CouponRead:
    promotion = await session.get(Promotion, payload.promotion_id)
    if not promotion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")

    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon code is required")
    if len(code) > 40:
        code = code[:40]
    existing = (await session.execute(select(Coupon).where(Coupon.code == code))).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon code already exists")

    coupon = Coupon(
        promotion_id=promotion.id,
        code=code,
        visibility=payload.visibility,
        is_active=payload.is_active,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        global_max_redemptions=payload.global_max_redemptions,
        per_customer_max_redemptions=payload.per_customer_max_redemptions,
    )
    session.add(coupon)
    await session.commit()
    await session.refresh(coupon)
    await session.refresh(coupon, attribute_names=["promotion"])
    return CouponRead.model_validate(coupon, from_attributes=True)


async def _find_user(session: AsyncSession, *, user_id: UUID | None, email: str | None) -> User:
    if user_id:
        user = await session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return user
    if email:
        email_clean = email.strip().lower()
        user = (await session.execute(select(User).where(User.email == email_clean))).scalars().first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return user
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide user_id or email")


@router.post("/admin/coupons/{coupon_id}/assign", status_code=status.HTTP_204_NO_CONTENT)
async def admin_assign_coupon(
    coupon_id: UUID,
    payload: CouponAssignRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    coupon = (
        (
            await session.execute(select(Coupon).options(selectinload(Coupon.promotion)).where(Coupon.id == coupon_id))
        )
        .scalars()
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    user = await _find_user(session, user_id=payload.user_id, email=payload.email)

    assignment = (
        (
            await session.execute(
                select(CouponAssignment).where(CouponAssignment.coupon_id == coupon.id, CouponAssignment.user_id == user.id)
            )
        )
        .scalars()
        .first()
    )
    if assignment and assignment.revoked_at is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    if assignment and assignment.revoked_at is not None:
        assignment.revoked_at = None
        assignment.revoked_reason = None
        session.add(assignment)
    else:
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
    await session.commit()

    if payload.send_email and user.email:
        ends_at = getattr(coupon, "ends_at", None)
        background_tasks.add_task(
            email_service.send_coupon_assigned,
            user.email,
            coupon_code=coupon.code,
            promotion_name=coupon.promotion.name if coupon.promotion else "Coupon",
            promotion_description=coupon.promotion.description if coupon.promotion else None,
            ends_at=ends_at,
            lang=user.preferred_language,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/coupons/{coupon_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_coupon(
    coupon_id: UUID,
    payload: CouponRevokeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> Response:
    coupon = (
        (
            await session.execute(select(Coupon).options(selectinload(Coupon.promotion)).where(Coupon.id == coupon_id))
        )
        .scalars()
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    user = await _find_user(session, user_id=payload.user_id, email=payload.email)
    assignment = (
        (
            await session.execute(
                select(CouponAssignment).where(CouponAssignment.coupon_id == coupon.id, CouponAssignment.user_id == user.id)
            )
        )
        .scalars()
        .first()
    )
    if not assignment or assignment.revoked_at is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    assignment.revoked_at = datetime.now(timezone.utc)
    assignment.revoked_reason = (payload.reason or "").strip()[:255] or None
    session.add(assignment)
    await session.commit()

    if payload.send_email and user.email:
        background_tasks.add_task(
            email_service.send_coupon_revoked,
            user.email,
            coupon_code=coupon.code,
            promotion_name=coupon.promotion.name if coupon.promotion else "Coupon",
            reason=assignment.revoked_reason,
            lang=user.preferred_language,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
