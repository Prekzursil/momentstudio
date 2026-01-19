from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, require_admin
from app.db.session import get_session
from app.models.catalog import Category, Product
from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    Promotion,
    PromotionScope,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import ShippingMethod
from app.models.user import User
from app.schemas.coupons_v2 import (
    CouponAssignRequest,
    CouponAssignmentRead,
    CouponCreate,
    CouponUpdate,
    CouponEligibilityResponse,
    CouponOffer,
    CouponRead,
    CouponRevokeRequest,
    CouponValidateRequest,
    PromotionCreate,
    PromotionRead,
    PromotionUpdate,
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


def _to_promotion_read(promo: Promotion) -> PromotionRead:
    include_products: list[UUID] = []
    exclude_products: list[UUID] = []
    include_categories: list[UUID] = []
    exclude_categories: list[UUID] = []

    for scope in getattr(promo, "scopes", None) or []:
        if getattr(scope, "entity_type", None) == PromotionScopeEntityType.product:
            if getattr(scope, "mode", None) == PromotionScopeMode.include:
                include_products.append(scope.entity_id)
            else:
                exclude_products.append(scope.entity_id)
        elif getattr(scope, "entity_type", None) == PromotionScopeEntityType.category:
            if getattr(scope, "mode", None) == PromotionScopeMode.include:
                include_categories.append(scope.entity_id)
            else:
                exclude_categories.append(scope.entity_id)

    base = PromotionRead.model_validate(promo, from_attributes=True)
    return base.model_copy(
        update={
            "included_product_ids": include_products,
            "excluded_product_ids": exclude_products,
            "included_category_ids": include_categories,
            "excluded_category_ids": exclude_categories,
        }
    )


async def _validate_scope_ids(
    session: AsyncSession,
    *,
    product_ids: set[UUID],
    category_ids: set[UUID],
) -> None:
    if product_ids:
        found = (await session.execute(select(Product.id).where(Product.id.in_(product_ids)))).scalars().all()
        missing = product_ids - set(found)
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more products in scope do not exist")

    if category_ids:
        found = (await session.execute(select(Category.id).where(Category.id.in_(category_ids)))).scalars().all()
        missing = category_ids - set(found)
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more categories in scope do not exist")


def _scopes_from_promotion(promo: Promotion) -> tuple[set[UUID], set[UUID], set[UUID], set[UUID]]:
    include_products: set[UUID] = set()
    exclude_products: set[UUID] = set()
    include_categories: set[UUID] = set()
    exclude_categories: set[UUID] = set()

    for scope in getattr(promo, "scopes", None) or []:
        if getattr(scope, "entity_type", None) == PromotionScopeEntityType.product:
            target = include_products if getattr(scope, "mode", None) == PromotionScopeMode.include else exclude_products
            target.add(scope.entity_id)
        elif getattr(scope, "entity_type", None) == PromotionScopeEntityType.category:
            target = include_categories if getattr(scope, "mode", None) == PromotionScopeMode.include else exclude_categories
            target.add(scope.entity_id)

    return include_products, exclude_products, include_categories, exclude_categories


async def _replace_promotion_scopes(
    session: AsyncSession,
    *,
    promotion_id: UUID,
    include_product_ids: set[UUID],
    exclude_product_ids: set[UUID],
    include_category_ids: set[UUID],
    exclude_category_ids: set[UUID],
) -> None:
    overlap_products = include_product_ids & exclude_product_ids
    overlap_categories = include_category_ids & exclude_category_ids
    if overlap_products:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Products cannot be both included and excluded")
    if overlap_categories:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categories cannot be both included and excluded")

    await _validate_scope_ids(
        session,
        product_ids=set(include_product_ids) | set(exclude_product_ids),
        category_ids=set(include_category_ids) | set(exclude_category_ids),
    )

    await session.execute(delete(PromotionScope).where(PromotionScope.promotion_id == promotion_id))

    for product_id in sorted(include_product_ids):
        session.add(
            PromotionScope(
                promotion_id=promotion_id,
                entity_type=PromotionScopeEntityType.product,
                entity_id=product_id,
                mode=PromotionScopeMode.include,
            )
        )
    for product_id in sorted(exclude_product_ids):
        session.add(
            PromotionScope(
                promotion_id=promotion_id,
                entity_type=PromotionScopeEntityType.product,
                entity_id=product_id,
                mode=PromotionScopeMode.exclude,
            )
        )
    for category_id in sorted(include_category_ids):
        session.add(
            PromotionScope(
                promotion_id=promotion_id,
                entity_type=PromotionScopeEntityType.category,
                entity_id=category_id,
                mode=PromotionScopeMode.include,
            )
        )
    for category_id in sorted(exclude_category_ids):
        session.add(
            PromotionScope(
                promotion_id=promotion_id,
                entity_type=PromotionScopeEntityType.category,
                entity_id=category_id,
                mode=PromotionScopeMode.exclude,
            )
        )


def _to_offer(result: coupons_service.CouponEligibility) -> CouponOffer:
    coupon_read = CouponRead.model_validate(result.coupon, from_attributes=True)
    if result.coupon.promotion:
        coupon_read.promotion = _to_promotion_read(result.coupon.promotion)
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
            update={"promotion": _to_promotion_read(c.promotion) if c.promotion else None}
        )
        for c in coupons
    ]


@router.get("/admin/promotions", response_model=list[PromotionRead])
async def admin_list_promotions(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[PromotionRead]:
    result = await session.execute(
        select(Promotion).options(selectinload(Promotion.scopes)).order_by(Promotion.created_at.desc())
    )
    promotions = list(result.scalars().all())
    return [_to_promotion_read(p) for p in promotions]


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

    promo = Promotion(
        **payload.model_dump(
            exclude={
                "key",
                "included_product_ids",
                "excluded_product_ids",
                "included_category_ids",
                "excluded_category_ids",
            }
        ),
        key=key_clean,
    )
    session.add(promo)
    await session.flush()

    await _replace_promotion_scopes(
        session,
        promotion_id=promo.id,
        include_product_ids=set(payload.included_product_ids),
        exclude_product_ids=set(payload.excluded_product_ids),
        include_category_ids=set(payload.included_category_ids),
        exclude_category_ids=set(payload.excluded_category_ids),
    )

    await session.commit()
    await session.refresh(promo, attribute_names=["scopes"])
    return _to_promotion_read(promo)


@router.patch("/admin/promotions/{promotion_id}", response_model=PromotionRead)
async def admin_update_promotion(
    promotion_id: UUID,
    payload: PromotionUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> PromotionRead:
    promo = (
        (await session.execute(select(Promotion).options(selectinload(Promotion.scopes)).where(Promotion.id == promotion_id)))
        .scalars()
        .first()
    )
    if not promo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")

    data = payload.model_dump(exclude_unset=True)

    discount_type = data.get("discount_type", promo.discount_type)
    percentage_off = data.get("percentage_off", promo.percentage_off)
    amount_off = data.get("amount_off", promo.amount_off)
    if discount_type == "percent" and not percentage_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="percentage_off is required for percent promotions")
    if discount_type == "amount" and not amount_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="amount_off is required for amount promotions")
    if discount_type == "free_shipping":
        if percentage_off or amount_off:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="free_shipping promotions cannot set percentage_off/amount_off")
    if percentage_off and amount_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose percentage_off or amount_off, not both")

    if "key" in data:
        key_clean = (data.get("key") or "").strip() or None
        if key_clean:
            key_clean = key_clean[:80]
            if key_clean != promo.key:
                exists = (
                    (await session.execute(select(Promotion).where(Promotion.key == key_clean, Promotion.id != promo.id)))
                    .scalars()
                    .first()
                )
                if exists:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promotion key already exists")
        promo.key = key_clean

    for attr in [
        "name",
        "description",
        "discount_type",
        "percentage_off",
        "amount_off",
        "max_discount_amount",
        "min_subtotal",
        "allow_on_sale_items",
        "is_active",
        "starts_at",
        "ends_at",
        "is_automatic",
    ]:
        if attr in data:
            setattr(promo, attr, data[attr])

    scope_fields = {
        "included_product_ids",
        "excluded_product_ids",
        "included_category_ids",
        "excluded_category_ids",
    }
    if scope_fields & set(data.keys()):
        current_in_products, current_ex_products, current_in_categories, current_ex_categories = _scopes_from_promotion(promo)
        include_products = set(data.get("included_product_ids")) if "included_product_ids" in data else current_in_products
        exclude_products = set(data.get("excluded_product_ids")) if "excluded_product_ids" in data else current_ex_products
        include_categories = set(data.get("included_category_ids")) if "included_category_ids" in data else current_in_categories
        exclude_categories = set(data.get("excluded_category_ids")) if "excluded_category_ids" in data else current_ex_categories

        await _replace_promotion_scopes(
            session,
            promotion_id=promo.id,
            include_product_ids=include_products,
            exclude_product_ids=exclude_products,
            include_category_ids=include_categories,
            exclude_category_ids=exclude_categories,
        )

    session.add(promo)
    await session.commit()
    await session.refresh(promo, attribute_names=["scopes"])
    return _to_promotion_read(promo)


@router.get("/admin/coupons", response_model=list[CouponRead])
async def admin_list_coupons(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
    promotion_id: UUID | None = Query(default=None),
    q: str | None = Query(default=None),
) -> list[CouponRead]:
    query = select(Coupon).options(selectinload(Coupon.promotion).selectinload(Promotion.scopes))
    if promotion_id:
        query = query.where(Coupon.promotion_id == promotion_id)
    if q:
        query = query.where(Coupon.code.ilike(f"%{q.strip()}%"))
    result = await session.execute(query.order_by(Coupon.created_at.desc()))
    coupons = list(result.scalars().all())
    return [
        CouponRead.model_validate(c, from_attributes=True).model_copy(
            update={"promotion": _to_promotion_read(c.promotion) if c.promotion else None}
        )
        for c in coupons
    ]


@router.patch("/admin/coupons/{coupon_id}", response_model=CouponRead)
async def admin_update_coupon(
    coupon_id: UUID,
    payload: CouponUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> CouponRead:
    coupon = (
        (
            await session.execute(
                select(Coupon)
                .options(selectinload(Coupon.promotion).selectinload(Promotion.scopes))
                .where(Coupon.id == coupon_id)
            )
        )
        .scalars()
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    data = payload.model_dump(exclude_unset=True)
    for attr in [
        "is_active",
        "starts_at",
        "ends_at",
        "global_max_redemptions",
        "per_customer_max_redemptions",
    ]:
        if attr in data:
            setattr(coupon, attr, data[attr])

    session.add(coupon)
    await session.commit()
    await session.refresh(coupon, attribute_names=["promotion"])
    coupon_read = CouponRead.model_validate(coupon, from_attributes=True)
    coupon_read.promotion = _to_promotion_read(coupon.promotion) if coupon.promotion else None
    return coupon_read


@router.get("/admin/coupons/{coupon_id}/assignments", response_model=list[CouponAssignmentRead])
async def admin_list_coupon_assignments(
    coupon_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[CouponAssignmentRead]:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    result = await session.execute(
        select(CouponAssignment)
        .options(selectinload(CouponAssignment.user))
        .where(CouponAssignment.coupon_id == coupon_id)
        .order_by(CouponAssignment.issued_at.desc())
    )
    assignments = list(result.scalars().all())
    out: list[CouponAssignmentRead] = []
    for row in assignments:
        user = getattr(row, "user", None)
        out.append(
            CouponAssignmentRead.model_validate(row, from_attributes=True).model_copy(
                update={
                    "user_email": getattr(user, "email", None) if user else None,
                    "user_username": getattr(user, "username", None) if user else None,
                }
            )
        )
    return out


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
    if coupon.promotion:
        await session.refresh(coupon.promotion, attribute_names=["scopes"])
    coupon_read = CouponRead.model_validate(coupon, from_attributes=True)
    coupon_read.promotion = _to_promotion_read(coupon.promotion) if coupon.promotion else None
    return coupon_read


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
