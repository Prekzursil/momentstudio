from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import re
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, require_admin_section
from app.db.session import get_session
from app.models.catalog import Category, Product
from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    CouponBulkJob,
    CouponBulkJobAction,
    CouponBulkJobStatus,
    CouponVisibility,
    Promotion,
    PromotionScope,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import ShippingMethod
from app.models.user import AdminAuditLog, User
from app.schemas.coupons_v2 import (
    CouponAssignRequest,
    CouponAssignmentRead,
    CouponCreate,
    CouponBulkJobRead,
    CouponBulkAssignRequest,
    CouponBulkRevokeRequest,
    CouponBulkResult,
    CouponBulkSegmentAssignRequest,
    CouponBulkSegmentPreview,
    CouponBulkSegmentRevokeRequest,
    CouponIssueToUserRequest,
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
from app.api.v1 import cart as cart_api


router = APIRouter(prefix="/coupons", tags=["coupons"])
_BULK_SEGMENT_BATCH_SIZE = 500


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


def _sanitize_coupon_prefix(value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]+", "", (value or "").upper()).strip("-")
    return cleaned[:20]


@router.get("/eligibility", response_model=CouponEligibilityResponse)
async def coupon_eligibility(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
    shipping_method_id: UUID | None = Query(default=None),
    session_id: str | None = Depends(cart_api.session_header),
) -> CouponEligibilityResponse:
    user_cart = await cart_service.get_cart(session, current_user.id, session_id)
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
    session_id: str | None = Depends(cart_api.session_header),
) -> CouponOffer:
    code = (payload.code or "").strip().upper()
    coupon = await coupons_service.get_coupon_by_code(session, code=code)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    user_cart = await cart_service.get_cart(session, current_user.id, session_id)
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
    _: User = Depends(require_admin_section("coupons")),
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
    _: User = Depends(require_admin_section("coupons")),
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
    _: User = Depends(require_admin_section("coupons")),
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
        "first_order_only",
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
    _: User = Depends(require_admin_section("coupons")),
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
    _: User = Depends(require_admin_section("coupons")),
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
    _: User = Depends(require_admin_section("coupons")),
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
    _: User = Depends(require_admin_section("coupons")),
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


@router.post("/admin/coupons/issue", response_model=CouponRead, status_code=status.HTTP_201_CREATED)
async def admin_issue_coupon_to_user(
    payload: CouponIssueToUserRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_admin_section("coupons")),
) -> CouponRead:
    user = await session.get(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    promotion = (
        (await session.execute(select(Promotion).options(selectinload(Promotion.scopes)).where(Promotion.id == payload.promotion_id)))
        .scalars()
        .first()
    )
    if not promotion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found")

    prefix_source = payload.prefix or promotion.key or promotion.name or "COUPON"
    prefix = _sanitize_coupon_prefix(prefix_source) or "COUPON"

    code = ""
    for _ in range(10):
        candidate = coupons_service.generate_coupon_code(prefix=prefix, length=12)
        exists = (await session.execute(select(func.count()).select_from(Coupon).where(Coupon.code == candidate))).scalar_one()
        if int(exists) == 0:
            code = candidate
            break
    if not code:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate coupon code")

    starts_at = datetime.now(timezone.utc)
    ends_at = payload.ends_at
    if ends_at and getattr(ends_at, "tzinfo", None) is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    if ends_at is None and payload.validity_days is not None:
        ends_at = starts_at + timedelta(days=int(payload.validity_days))
    if ends_at and ends_at < starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon ends_at must be in the future")

    coupon = Coupon(
        promotion_id=promotion.id,
        code=code,
        visibility=CouponVisibility.assigned,
        is_active=True,
        starts_at=starts_at,
        ends_at=ends_at,
        global_max_redemptions=None,
        per_customer_max_redemptions=int(payload.per_customer_max_redemptions or 1),
    )
    session.add(coupon)
    await session.flush()
    session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
    session.add(
        AdminAuditLog(
            action="coupon_issued",
            actor_user_id=getattr(actor, "id", None),
            subject_user_id=user.id,
            data={
                "promotion_id": str(promotion.id),
                "coupon_id": str(coupon.id),
                "code": coupon.code,
            },
        )
    )
    await session.commit()

    if payload.send_email and user.email:
        background_tasks.add_task(
            email_service.send_coupon_assigned,
            user.email,
            coupon_code=coupon.code,
            promotion_name=promotion.name,
            promotion_description=promotion.description,
            ends_at=ends_at,
            lang=user.preferred_language,
        )

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


def _normalize_bulk_emails(raw: list[str]) -> tuple[list[str], list[str]]:
    invalid: list[str] = []
    seen: set[str] = set()
    emails: list[str] = []
    for value in raw or []:
        if not isinstance(value, str):
            continue
        clean = value.strip().lower()
        if not clean:
            continue
        if len(clean) > 255:
            invalid.append(value)
            continue
        if "@" not in clean:
            invalid.append(value)
            continue
        _, domain = clean.split("@", 1)
        if "." not in domain:
            invalid.append(value)
            continue
        if clean in seen:
            continue
        seen.add(clean)
        emails.append(clean)
    return emails, invalid


def _segment_user_filters(payload: object) -> list[object]:
    filters: list[object] = [User.deleted_at.is_(None)]
    require_marketing = bool(getattr(payload, "require_marketing_opt_in", False))
    require_verified = bool(getattr(payload, "require_email_verified", False))
    if require_marketing:
        filters.append(User.notify_marketing.is_(True))
    if require_verified:
        filters.append(User.email_verified.is_(True))
    return filters


async def _segment_sample_emails(session: AsyncSession, *, filters: list[object], limit: int = 10) -> list[str]:
    rows = (await session.execute(select(User.email).where(*filters).order_by(User.created_at.desc()).limit(limit))).scalars().all()
    return [str(e) for e in rows if e]


async def _preview_segment_assign(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    filters: list[object],
) -> CouponBulkSegmentPreview:
    total = int((await session.execute(select(func.count()).select_from(User).where(*filters))).scalar_one())
    already_active = int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponAssignment)
                .join(User, CouponAssignment.user_id == User.id)
                .where(CouponAssignment.coupon_id == coupon_id, CouponAssignment.revoked_at.is_(None), *filters)
            )
        ).scalar_one()
    )
    restored = int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponAssignment)
                .join(User, CouponAssignment.user_id == User.id)
                .where(CouponAssignment.coupon_id == coupon_id, CouponAssignment.revoked_at.is_not(None), *filters)
            )
        ).scalar_one()
    )
    created = max(total - already_active - restored, 0)
    sample = await _segment_sample_emails(session, filters=filters)
    return CouponBulkSegmentPreview(
        total_candidates=total,
        sample_emails=sample,
        created=created,
        restored=restored,
        already_active=already_active,
    )


async def _preview_segment_revoke(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    filters: list[object],
) -> CouponBulkSegmentPreview:
    total = int((await session.execute(select(func.count()).select_from(User).where(*filters))).scalar_one())
    revoked = int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponAssignment)
                .join(User, CouponAssignment.user_id == User.id)
                .where(CouponAssignment.coupon_id == coupon_id, CouponAssignment.revoked_at.is_(None), *filters)
            )
        ).scalar_one()
    )
    already_revoked = int(
        (
            await session.execute(
                select(func.count())
                .select_from(CouponAssignment)
                .join(User, CouponAssignment.user_id == User.id)
                .where(CouponAssignment.coupon_id == coupon_id, CouponAssignment.revoked_at.is_not(None), *filters)
            )
        ).scalar_one()
    )
    not_assigned = max(total - revoked - already_revoked, 0)
    sample = await _segment_sample_emails(session, filters=filters)
    return CouponBulkSegmentPreview(
        total_candidates=total,
        sample_emails=sample,
        revoked=revoked,
        already_revoked=already_revoked,
        not_assigned=not_assigned,
    )


async def _run_bulk_segment_job(engine: AsyncEngine, *, job_id: UUID) -> None:
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False, class_=AsyncSession)
    async with SessionLocal() as session:
        job = (
            (
                await session.execute(
                    select(CouponBulkJob)
                    .options(selectinload(CouponBulkJob.coupon).selectinload(Coupon.promotion))
                    .where(CouponBulkJob.id == job_id)
                )
            )
            .scalars()
            .first()
        )
        if not job:
            return
        if job.status not in (CouponBulkJobStatus.pending, CouponBulkJobStatus.running):
            return

        try:
            job.status = CouponBulkJobStatus.running
            job.started_at = datetime.now(timezone.utc)
            job.error_message = None
            await session.commit()

            filters = _segment_user_filters(job)
            total = int((await session.execute(select(func.count()).select_from(User).where(*filters))).scalar_one())
            job.total_candidates = total
            job.processed = 0
            job.created = 0
            job.restored = 0
            job.already_active = 0
            job.revoked = 0
            job.already_revoked = 0
            job.not_assigned = 0
            await session.commit()

            coupon = job.coupon
            promotion = getattr(coupon, "promotion", None) if coupon else None
            coupon_code = getattr(coupon, "code", "") if coupon else ""
            promo_name = getattr(promotion, "name", None) or "Coupon"
            promo_desc = getattr(promotion, "description", None) if promotion else None
            ends_at = getattr(coupon, "ends_at", None)

            last_id: UUID | None = None
            now = datetime.now(timezone.utc)

            while True:
                await session.refresh(job, attribute_names=["status"])
                if job.status == CouponBulkJobStatus.cancelled:
                    job.finished_at = datetime.now(timezone.utc)
                    await session.commit()
                    return

                q = select(User.id, User.email, User.preferred_language).where(*filters).order_by(User.id).limit(_BULK_SEGMENT_BATCH_SIZE)
                if last_id is not None:
                    q = q.where(User.id > last_id)
                rows = (await session.execute(q)).all()
                if not rows:
                    break

                user_ids = [row[0] for row in rows]
                existing = (
                    (
                        await session.execute(
                            select(CouponAssignment).where(
                                CouponAssignment.coupon_id == job.coupon_id,
                                CouponAssignment.user_id.in_(user_ids),
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                assignments_by_user_id = {a.user_id: a for a in existing}

                notify: list[tuple[str, str | None]] = []

                for user_id, email, preferred_language in rows:
                    assignment = assignments_by_user_id.get(user_id)
                    if job.action == CouponBulkJobAction.assign:
                        if assignment and assignment.revoked_at is None:
                            job.already_active += 1
                        elif assignment and assignment.revoked_at is not None:
                            assignment.revoked_at = None
                            assignment.revoked_reason = None
                            session.add(assignment)
                            job.restored += 1
                            if job.send_email and email:
                                notify.append((email, preferred_language))
                        else:
                            session.add(CouponAssignment(coupon_id=job.coupon_id, user_id=user_id))
                            job.created += 1
                            if job.send_email and email:
                                notify.append((email, preferred_language))
                    else:
                        if not assignment:
                            job.not_assigned += 1
                        elif assignment.revoked_at is not None:
                            job.already_revoked += 1
                        else:
                            assignment.revoked_at = now
                            assignment.revoked_reason = (job.revoke_reason or "").strip()[:255] or None
                            session.add(assignment)
                            job.revoked += 1
                            if job.send_email and email:
                                notify.append((email, preferred_language))

                    job.processed += 1

                await session.commit()

                await session.refresh(job, attribute_names=["status"])
                if job.status == CouponBulkJobStatus.cancelled:
                    job.finished_at = datetime.now(timezone.utc)
                    await session.commit()
                    return

                if notify:
                    if job.action == CouponBulkJobAction.assign:
                        for to_email, lang in notify:
                            await email_service.send_coupon_assigned(
                                to_email,
                                coupon_code=coupon_code,
                                promotion_name=promo_name,
                                promotion_description=promo_desc,
                                ends_at=ends_at,
                                lang=lang,
                            )
                    else:
                        for to_email, lang in notify:
                            await email_service.send_coupon_revoked(
                                to_email,
                                coupon_code=coupon_code,
                                promotion_name=promo_name,
                                reason=(job.revoke_reason or "").strip() or None,
                                lang=lang,
                            )

                last_id = rows[-1][0]

            await session.refresh(job, attribute_names=["status"])
            if job.status == CouponBulkJobStatus.cancelled:
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
                return

            job.status = CouponBulkJobStatus.succeeded
            job.finished_at = datetime.now(timezone.utc)
            await session.commit()
        except Exception as exc:
            await session.refresh(job, attribute_names=["status"])
            if job.status == CouponBulkJobStatus.cancelled:
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
                return
            job.status = CouponBulkJobStatus.failed
            job.error_message = str(exc)[:1000]
            job.finished_at = datetime.now(timezone.utc)
            await session.commit()


@router.post("/admin/coupons/{coupon_id}/assign", status_code=status.HTTP_204_NO_CONTENT)
async def admin_assign_coupon(
    coupon_id: UUID,
    payload: CouponAssignRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
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


@router.post("/admin/coupons/{coupon_id}/assign/bulk", response_model=CouponBulkResult)
async def admin_bulk_assign_coupon(
    coupon_id: UUID,
    payload: CouponBulkAssignRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> CouponBulkResult:
    requested = len(payload.emails or [])
    emails, invalid = _normalize_bulk_emails(payload.emails or [])
    if not emails:
        return CouponBulkResult(requested=requested, unique=0, invalid_emails=invalid)
    if len(emails) > 500:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many emails (max 500)")

    coupon = (
        (
            await session.execute(select(Coupon).options(selectinload(Coupon.promotion)).where(Coupon.id == coupon_id))
        )
        .scalars()
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    users = (await session.execute(select(User).where(User.email.in_(emails)))).scalars().all()
    users_by_email = {u.email: u for u in users if u.email}
    not_found = [e for e in emails if e not in users_by_email]
    user_ids = [u.id for u in users_by_email.values()]

    assignments_by_user_id: dict[UUID, CouponAssignment] = {}
    if user_ids:
        existing = (
            (
                await session.execute(
                    select(CouponAssignment).where(CouponAssignment.coupon_id == coupon.id, CouponAssignment.user_id.in_(user_ids))
                )
            )
            .scalars()
            .all()
        )
        assignments_by_user_id = {a.user_id: a for a in existing}

    created = 0
    restored = 0
    already_active = 0
    notify_user_ids: set[UUID] = set()
    for email in emails:
        user = users_by_email.get(email)
        if not user:
            continue
        assignment = assignments_by_user_id.get(user.id)
        if assignment and assignment.revoked_at is None:
            already_active += 1
            continue
        if assignment and assignment.revoked_at is not None:
            assignment.revoked_at = None
            assignment.revoked_reason = None
            session.add(assignment)
            restored += 1
            notify_user_ids.add(user.id)
        else:
            session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
            created += 1
            notify_user_ids.add(user.id)

    await session.commit()

    if payload.send_email and notify_user_ids:
        ends_at = getattr(coupon, "ends_at", None)
        for user in users_by_email.values():
            if user.id not in notify_user_ids or not user.email:
                continue
            background_tasks.add_task(
                email_service.send_coupon_assigned,
                user.email,
                coupon_code=coupon.code,
                promotion_name=coupon.promotion.name if coupon.promotion else "Coupon",
                promotion_description=coupon.promotion.description if coupon.promotion else None,
                ends_at=ends_at,
                lang=user.preferred_language,
            )

    return CouponBulkResult(
        requested=requested,
        unique=len(emails),
        invalid_emails=invalid,
        not_found_emails=not_found,
        created=created,
        restored=restored,
        already_active=already_active,
    )


@router.post("/admin/coupons/{coupon_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_coupon(
    coupon_id: UUID,
    payload: CouponRevokeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
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


@router.post("/admin/coupons/{coupon_id}/revoke/bulk", response_model=CouponBulkResult)
async def admin_bulk_revoke_coupon(
    coupon_id: UUID,
    payload: CouponBulkRevokeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> CouponBulkResult:
    requested = len(payload.emails or [])
    emails, invalid = _normalize_bulk_emails(payload.emails or [])
    if not emails:
        return CouponBulkResult(requested=requested, unique=0, invalid_emails=invalid)
    if len(emails) > 500:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many emails (max 500)")

    coupon = (
        (
            await session.execute(select(Coupon).options(selectinload(Coupon.promotion)).where(Coupon.id == coupon_id))
        )
        .scalars()
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    users = (await session.execute(select(User).where(User.email.in_(emails)))).scalars().all()
    users_by_email = {u.email: u for u in users if u.email}
    not_found = [e for e in emails if e not in users_by_email]
    user_ids = [u.id for u in users_by_email.values()]

    assignments_by_user_id: dict[UUID, CouponAssignment] = {}
    if user_ids:
        existing = (
            (
                await session.execute(
                    select(CouponAssignment).where(CouponAssignment.coupon_id == coupon.id, CouponAssignment.user_id.in_(user_ids))
                )
            )
            .scalars()
            .all()
        )
        assignments_by_user_id = {a.user_id: a for a in existing}

    revoked = 0
    already_revoked = 0
    not_assigned = 0
    revoked_user_ids: set[UUID] = set()
    now = datetime.now(timezone.utc)
    reason = (payload.reason or "").strip()[:255] or None
    for email in emails:
        user = users_by_email.get(email)
        if not user:
            continue
        assignment = assignments_by_user_id.get(user.id)
        if not assignment:
            not_assigned += 1
            continue
        if assignment.revoked_at is not None:
            already_revoked += 1
            continue
        assignment.revoked_at = now
        assignment.revoked_reason = reason
        session.add(assignment)
        revoked += 1
        revoked_user_ids.add(user.id)

    await session.commit()

    if payload.send_email and revoked_user_ids:
        for user in users_by_email.values():
            if user.id not in revoked_user_ids or not user.email:
                continue
            background_tasks.add_task(
                email_service.send_coupon_revoked,
                user.email,
                coupon_code=coupon.code,
                promotion_name=coupon.promotion.name if coupon.promotion else "Coupon",
                reason=reason,
                lang=user.preferred_language,
            )

    return CouponBulkResult(
        requested=requested,
        unique=len(emails),
        invalid_emails=invalid,
        not_found_emails=not_found,
        revoked=revoked,
        already_revoked=already_revoked,
        not_assigned=not_assigned,
    )


@router.post("/admin/coupons/{coupon_id}/assign/segment/preview", response_model=CouponBulkSegmentPreview)
async def admin_preview_segment_assign(
    coupon_id: UUID,
    payload: CouponBulkSegmentAssignRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> CouponBulkSegmentPreview:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    filters = _segment_user_filters(payload)
    return await _preview_segment_assign(session, coupon_id=coupon_id, filters=filters)


@router.post("/admin/coupons/{coupon_id}/revoke/segment/preview", response_model=CouponBulkSegmentPreview)
async def admin_preview_segment_revoke(
    coupon_id: UUID,
    payload: CouponBulkSegmentRevokeRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> CouponBulkSegmentPreview:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    filters = _segment_user_filters(payload)
    return await _preview_segment_revoke(session, coupon_id=coupon_id, filters=filters)


@router.post("/admin/coupons/{coupon_id}/assign/segment", response_model=CouponBulkJobRead, status_code=status.HTTP_201_CREATED)
async def admin_start_segment_assign_job(
    coupon_id: UUID,
    payload: CouponBulkSegmentAssignRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_admin_section("coupons")),
) -> CouponBulkJobRead:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    filters = _segment_user_filters(payload)
    preview = await _preview_segment_assign(session, coupon_id=coupon_id, filters=filters)

    job = CouponBulkJob(
        coupon_id=coupon_id,
        created_by_user_id=admin_user.id,
        action=CouponBulkJobAction.assign,
        status=CouponBulkJobStatus.pending,
        require_marketing_opt_in=payload.require_marketing_opt_in,
        require_email_verified=payload.require_email_verified,
        send_email=payload.send_email,
        total_candidates=preview.total_candidates,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database engine unavailable")
    background_tasks.add_task(_run_bulk_segment_job, engine, job_id=job.id)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.post("/admin/coupons/{coupon_id}/revoke/segment", response_model=CouponBulkJobRead, status_code=status.HTTP_201_CREATED)
async def admin_start_segment_revoke_job(
    coupon_id: UUID,
    payload: CouponBulkSegmentRevokeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_admin_section("coupons")),
) -> CouponBulkJobRead:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")

    filters = _segment_user_filters(payload)
    preview = await _preview_segment_revoke(session, coupon_id=coupon_id, filters=filters)

    job = CouponBulkJob(
        coupon_id=coupon_id,
        created_by_user_id=admin_user.id,
        action=CouponBulkJobAction.revoke,
        status=CouponBulkJobStatus.pending,
        require_marketing_opt_in=payload.require_marketing_opt_in,
        require_email_verified=payload.require_email_verified,
        send_email=payload.send_email,
        revoke_reason=(payload.reason or "").strip()[:255] or None,
        total_candidates=preview.total_candidates,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database engine unavailable")
    background_tasks.add_task(_run_bulk_segment_job, engine, job_id=job.id)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.get("/admin/coupons/bulk-jobs/{job_id}", response_model=CouponBulkJobRead)
async def admin_get_bulk_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> CouponBulkJobRead:
    job = await session.get(CouponBulkJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.get("/admin/coupons/{coupon_id}/bulk-jobs", response_model=list[CouponBulkJobRead])
async def admin_list_bulk_jobs(
    coupon_id: UUID,
    session: AsyncSession = Depends(get_session),
    limit: int = Query(default=10, ge=1, le=50),
    _: User = Depends(require_admin_section("coupons")),
) -> list[CouponBulkJobRead]:
    jobs = (
        (
            await session.execute(
                select(CouponBulkJob)
                .where(CouponBulkJob.coupon_id == coupon_id)
                .order_by(CouponBulkJob.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [CouponBulkJobRead.model_validate(job, from_attributes=True) for job in jobs]


@router.post("/admin/coupons/bulk-jobs/{job_id}/cancel", response_model=CouponBulkJobRead)
async def admin_cancel_bulk_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> CouponBulkJobRead:
    job = await session.get(CouponBulkJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job.status in (CouponBulkJobStatus.succeeded, CouponBulkJobStatus.failed, CouponBulkJobStatus.cancelled):
        return CouponBulkJobRead.model_validate(job, from_attributes=True)
    job.status = CouponBulkJobStatus.cancelled
    job.finished_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(job)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.post(
    "/admin/coupons/bulk-jobs/{job_id}/retry",
    response_model=CouponBulkJobRead,
    status_code=status.HTTP_201_CREATED,
)
async def admin_retry_bulk_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_admin_section("coupons")),
) -> CouponBulkJobRead:
    job = await session.get(CouponBulkJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job.status in (CouponBulkJobStatus.pending, CouponBulkJobStatus.running):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job is still in progress")

    filters = _segment_user_filters(job)
    if job.action == CouponBulkJobAction.assign:
        preview = await _preview_segment_assign(session, coupon_id=job.coupon_id, filters=filters)
    else:
        preview = await _preview_segment_revoke(session, coupon_id=job.coupon_id, filters=filters)

    new_job = CouponBulkJob(
        coupon_id=job.coupon_id,
        created_by_user_id=admin_user.id,
        action=job.action,
        status=CouponBulkJobStatus.pending,
        require_marketing_opt_in=job.require_marketing_opt_in,
        require_email_verified=job.require_email_verified,
        send_email=job.send_email,
        revoke_reason=job.revoke_reason,
        total_candidates=preview.total_candidates,
    )
    session.add(new_job)
    await session.commit()
    await session.refresh(new_job)

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database engine unavailable")
    background_tasks.add_task(_run_bulk_segment_job, engine, job_id=new_job.id)
    return CouponBulkJobRead.model_validate(new_job, from_attributes=True)
