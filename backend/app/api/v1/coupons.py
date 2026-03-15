from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, require_admin_section
from app.db.session import get_session
from app.models.catalog import Category, Product
from app.models.coupons import (
    Coupon,
    CouponAssignment,
    CouponBulkJob,
    CouponBulkJobAction,
    CouponBulkJobStatus,
    CouponRedemption,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
    PromotionScope,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import Order, OrderItem, OrderStatus, ShippingMethod
from app.models.user import User
from app.schemas.coupons import (
    CouponAssignRequest,
    CouponAssignmentRead,
    CouponAnalyticsDaily,
    CouponAnalyticsResponse,
    CouponAnalyticsSummary,
    CouponAnalyticsTopProduct,
    CouponCreate,
    CouponBulkJobRead,
    CouponBulkAssignRequest,
    CouponBulkRevokeRequest,
    CouponBulkResult,
    CouponBulkSegmentAssignRequest,
    CouponBulkSegmentPreview,
    CouponBulkSegmentRevokeRequest,
    CouponIssueToUserRequest,
    CouponCodeGenerateRequest,
    CouponCodeGenerateResponse,
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
from app.services import coupons as coupons_service
from app.services import email as email_service
from app.services import audit_chain as audit_chain_service
from app.services import pricing
from app.services import cart as cart_service
from app.api.v1 import cart as cart_api


_ADMIN_SECTION_COUPONS = "coupons"
_DETAIL_COUPON_NOT_FOUND = "Coupon not found"
_DETAIL_PROMOTION_NOT_FOUND = "Promotion not found"
_DETAIL_USER_NOT_FOUND = "User not found"
_DETAIL_JOB_NOT_FOUND = "Job not found"
_DETAIL_MARKETING_OPT_IN_REQUIRED = "User has not opted in to marketing emails."
_DETAIL_DB_ENGINE_UNAVAILABLE = "Database engine unavailable"
_DEFAULT_COUPON_PREFIX = "COUPON"
_FALLBACK_PROMOTION_NAME = "Coupon"
_DETAIL_TOO_MANY_EMAILS = "Too many emails (max 500)"

router = APIRouter(prefix="/coupons", tags=[_ADMIN_SECTION_COUPONS])
_BULK_SEGMENT_BATCH_SIZE = 500
_COUPON_ANALYTICS_EXCLUDED_ORDER_STATUSES = [
    OrderStatus.pending_payment,
    OrderStatus.cancelled,
    OrderStatus.refunded,
]
_admin_coupons_dependency = require_admin_section(_ADMIN_SECTION_COUPONS)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]
AdminCouponsDep = Annotated[User, Depends(_admin_coupons_dependency)]
SessionHeaderDep = Annotated[str | None, Depends(cart_api.session_header)]
ShippingMethodIdQuery = Annotated[UUID | None, Query()]
PromotionIdFilterQuery = Annotated[UUID | None, Query()]
SearchQuery = Annotated[str | None, Query()]
CouponIdFilterQuery = Annotated[UUID | None, Query()]
AnalyticsDaysQuery = Annotated[int, Query(ge=1, le=365)]
AnalyticsTopLimitQuery = Annotated[int, Query(ge=1, le=50)]
BulkJobsLimitQuery = Annotated[int, Query(ge=1, le=50)]


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

    for entity_type, mode, entity_ids in (
        (PromotionScopeEntityType.product, PromotionScopeMode.include, include_product_ids),
        (PromotionScopeEntityType.product, PromotionScopeMode.exclude, exclude_product_ids),
        (PromotionScopeEntityType.category, PromotionScopeMode.include, include_category_ids),
        (PromotionScopeEntityType.category, PromotionScopeMode.exclude, exclude_category_ids),
    ):
        _add_promotion_scopes(
            session,
            promotion_id=promotion_id,
            entity_type=entity_type,
            mode=mode,
            entity_ids=entity_ids,
        )


def _add_promotion_scopes(
    session: AsyncSession,
    *,
    promotion_id: UUID,
    entity_type: PromotionScopeEntityType,
    mode: PromotionScopeMode,
    entity_ids: set[UUID],
) -> None:
    for entity_id in sorted(entity_ids):
        session.add(
            PromotionScope(
                promotion_id=promotion_id,
                entity_type=entity_type,
                entity_id=entity_id,
                mode=mode,
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


def _to_decimal(value: object) -> Decimal:
    if value is None:
        return Decimal("0.00")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0.00")


def _validate_promotion_discount_values(
    *,
    discount_type: str | PromotionDiscountType,
    percentage_off: object,
    amount_off: object,
) -> None:
    if _is_percent_discount_missing(discount_type=discount_type, percentage_off=percentage_off):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="percentage_off is required for percent promotions")
    if _is_amount_discount_missing(discount_type=discount_type, amount_off=amount_off):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="amount_off is required for amount promotions")
    if _has_invalid_free_shipping_values(discount_type=discount_type, percentage_off=percentage_off, amount_off=amount_off):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="free_shipping promotions cannot set percentage_off/amount_off")
    if _has_conflicting_discount_values(percentage_off=percentage_off, amount_off=amount_off):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose percentage_off or amount_off, not both")


def _is_percent_discount_missing(*, discount_type: str | PromotionDiscountType, percentage_off: object) -> bool:
    return discount_type == "percent" and not percentage_off


def _is_amount_discount_missing(*, discount_type: str | PromotionDiscountType, amount_off: object) -> bool:
    return discount_type == "amount" and not amount_off


def _has_invalid_free_shipping_values(
    *, discount_type: str | PromotionDiscountType, percentage_off: object, amount_off: object
) -> bool:
    return discount_type == "free_shipping" and bool(percentage_off or amount_off)


def _has_conflicting_discount_values(*, percentage_off: object, amount_off: object) -> bool:
    return bool(percentage_off and amount_off)


async def _clean_and_validate_promotion_key(
    session: AsyncSession,
    *,
    raw_key: object,
    promotion_id: UUID | None = None,
) -> str | None:
    key_clean = (raw_key or "").strip() or None
    if not key_clean:
        return None
    key_clean = key_clean[:80]
    query = select(Promotion).where(Promotion.key == key_clean)
    if promotion_id is not None:
        query = query.where(Promotion.id != promotion_id)
    exists = (await session.execute(query)).scalars().first()
    if exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promotion key already exists")
    return key_clean


def _apply_promotion_scalar_updates(promo: Promotion, data: dict[str, object]) -> None:
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


def _resolve_scope_updates(
    *,
    promo: Promotion,
    data: dict[str, object],
) -> tuple[set[UUID], set[UUID], set[UUID], set[UUID]] | None:
    scope_fields = {
        "included_product_ids",
        "excluded_product_ids",
        "included_category_ids",
        "excluded_category_ids",
    }
    if not (scope_fields & set(data.keys())):
        return None
    current_in_products, current_ex_products, current_in_categories, current_ex_categories = _scopes_from_promotion(promo)
    include_products = set(data.get("included_product_ids")) if "included_product_ids" in data else current_in_products
    exclude_products = set(data.get("excluded_product_ids")) if "excluded_product_ids" in data else current_ex_products
    include_categories = set(data.get("included_category_ids")) if "included_category_ids" in data else current_in_categories
    exclude_categories = set(data.get("excluded_category_ids")) if "excluded_category_ids" in data else current_ex_categories
    return include_products, exclude_products, include_categories, exclude_categories


def _shipping_method_rates(shipping_method: ShippingMethod | None) -> tuple[Decimal | None, Decimal | None]:
    if not shipping_method:
        return None, None
    rate_flat = Decimal(getattr(shipping_method, "rate_flat", None) or 0)
    rate_per = Decimal(getattr(shipping_method, "rate_per_kg", None) or 0)
    return rate_flat, rate_per


def _partition_coupon_offers(
    results: list[coupons_service.CouponEligibility],
) -> tuple[list[CouponOffer], list[CouponOffer]]:
    eligible: list[CouponOffer] = []
    ineligible: list[CouponOffer] = []
    for result in results:
        target = eligible if result.eligible else ineligible
        target.append(_to_offer(result))
    return eligible, ineligible


@router.get("/eligibility")
async def coupon_eligibility(
    session: SessionDep,
    current_user: CurrentUserDep,
    shipping_method_id: ShippingMethodIdQuery = None,
    session_id: SessionHeaderDep = None,
) -> CouponEligibilityResponse:
    user_cart = await cart_service.get_cart(session, current_user.id, session_id)
    checkout = await checkout_settings_service.get_checkout_settings(session)
    shipping_method = await _get_shipping_method(session, shipping_method_id)
    rate_flat, rate_per = _shipping_method_rates(shipping_method)
    results = await coupons_service.evaluate_coupons_for_user_cart(
        session,
        user=current_user,
        cart=user_cart,
        checkout=checkout,
        shipping_method_rate_flat=rate_flat,
        shipping_method_rate_per_kg=rate_per,
    )
    eligible, ineligible = _partition_coupon_offers(results)
    return CouponEligibilityResponse(eligible=eligible, ineligible=ineligible)


@router.post("/validate")
async def validate_coupon(
    payload: CouponValidateRequest,
    session: SessionDep,
    current_user: CurrentUserDep,
    shipping_method_id: ShippingMethodIdQuery = None,
    session_id: SessionHeaderDep = None,
) -> CouponOffer:
    code = (payload.code or "").strip().upper()
    coupon = await coupons_service.get_coupon_by_code(session, code=code)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)
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


@router.get("/me")
async def my_coupons(
    session: SessionDep,
    current_user: CurrentUserDep,
) -> list[CouponRead]:
    coupons = await coupons_service.get_user_visible_coupons(session, user_id=current_user.id)
    return [
        CouponRead.model_validate(c, from_attributes=True).model_copy(
            update={"promotion": _to_promotion_read(c.promotion) if c.promotion else None}
        )
        for c in coupons
    ]


@router.get("/admin/promotions")
async def admin_list_promotions(
    session: SessionDep,
    _: AdminCouponsDep,
) -> list[PromotionRead]:
    result = await session.execute(
        select(Promotion).options(selectinload(Promotion.scopes)).order_by(Promotion.created_at.desc())
    )
    promotions = list(result.scalars().all())
    return [_to_promotion_read(p) for p in promotions]


@router.post("/admin/promotions", status_code=status.HTTP_201_CREATED)
async def admin_create_promotion(
    payload: PromotionCreate,
    session: SessionDep,
    _: AdminCouponsDep,
) -> PromotionRead:
    _validate_promotion_discount_values(
        discount_type=payload.discount_type,
        percentage_off=payload.percentage_off,
        amount_off=payload.amount_off,
    )
    key_clean = await _clean_and_validate_promotion_key(session, raw_key=payload.key)

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


@router.patch("/admin/promotions/{promotion_id}")
async def admin_update_promotion(
    promotion_id: UUID,
    payload: PromotionUpdate,
    session: SessionDep,
    _: AdminCouponsDep,
) -> PromotionRead:
    promo = (
        (await session.execute(select(Promotion).options(selectinload(Promotion.scopes)).where(Promotion.id == promotion_id)))
        .scalars()
        .first()
    )
    if not promo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_PROMOTION_NOT_FOUND)

    data = payload.model_dump(exclude_unset=True)

    discount_type = data.get("discount_type", promo.discount_type)
    percentage_off = data.get("percentage_off", promo.percentage_off)
    amount_off = data.get("amount_off", promo.amount_off)
    _validate_promotion_discount_values(
        discount_type=discount_type,
        percentage_off=percentage_off,
        amount_off=amount_off,
    )

    if "key" in data:
        promo.key = await _clean_and_validate_promotion_key(session, raw_key=data.get("key"), promotion_id=promo.id)

    _apply_promotion_scalar_updates(promo, data)
    scope_values = _resolve_scope_updates(promo=promo, data=data)
    if scope_values:
        include_products, exclude_products, include_categories, exclude_categories = scope_values
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


@router.get("/admin/coupons")
async def admin_list_coupons(
    session: SessionDep,
    _: AdminCouponsDep,
    promotion_id: PromotionIdFilterQuery = None,
    q: SearchQuery = None,
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


@router.patch("/admin/coupons/{coupon_id}")
async def admin_update_coupon(
    coupon_id: UUID,
    payload: CouponUpdate,
    session: SessionDep,
    _: AdminCouponsDep,
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)

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


@router.get("/admin/coupons/{coupon_id}/assignments")
async def admin_list_coupon_assignments(
    coupon_id: UUID,
    session: SessionDep,
    _: AdminCouponsDep,
) -> list[CouponAssignmentRead]:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)

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


@router.post("/admin/coupons", status_code=status.HTTP_201_CREATED)
async def admin_create_coupon(
    payload: CouponCreate,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponRead:
    promotion = await session.get(Promotion, payload.promotion_id)
    if not promotion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_PROMOTION_NOT_FOUND)

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


@router.post("/admin/coupons/generate-code")
async def admin_generate_coupon_code(
    payload: CouponCodeGenerateRequest,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponCodeGenerateResponse:
    prefix_source = payload.prefix or _DEFAULT_COUPON_PREFIX
    prefix = _sanitize_coupon_prefix(prefix_source) or _DEFAULT_COUPON_PREFIX
    pattern = (payload.pattern or "").strip() or None
    code = await coupons_service.generate_unique_coupon_code(
        session,
        prefix=prefix,
        length=int(payload.length or 12),
        pattern=pattern,
        attempts=50,
    )
    return CouponCodeGenerateResponse(code=code)


def _normalize_issue_coupon_ends_at(
    *,
    ends_at: datetime | None,
    validity_days: int | None,
    starts_at: datetime,
) -> datetime | None:
    value = ends_at
    if value and getattr(value, "tzinfo", None) is None:
        value = value.replace(tzinfo=timezone.utc)
    if value is None and validity_days is not None:
        value = starts_at + timedelta(days=int(validity_days))
    return value


def _resolve_issue_coupon_should_email(*, send_email: bool, user: User) -> bool:
    should_email = bool(send_email and user.email)
    if should_email and not bool(getattr(user, "notify_marketing", False)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_DETAIL_MARKETING_OPT_IN_REQUIRED)
    return should_email


async def _get_promotion_with_scopes_or_404(session: AsyncSession, *, promotion_id: UUID) -> Promotion:
    promotion = (
        (await session.execute(select(Promotion).options(selectinload(Promotion.scopes)).where(Promotion.id == promotion_id)))
        .scalars()
        .first()
    )
    if not promotion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_PROMOTION_NOT_FOUND)
    return promotion


def _resolve_issue_coupon_ends_at_or_400(
    *,
    payload: CouponIssueToUserRequest,
    starts_at: datetime,
) -> datetime | None:
    ends_at = _normalize_issue_coupon_ends_at(
        ends_at=payload.ends_at,
        validity_days=payload.validity_days,
        starts_at=starts_at,
    )
    if ends_at and ends_at < starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Coupon ends_at must be in the future")
    return ends_at


async def _create_coupon_assignment_and_audit(
    session: AsyncSession,
    *,
    promotion: Promotion,
    user: User,
    actor: User,
    code: str,
    starts_at: datetime,
    ends_at: datetime | None,
    per_customer_max_redemptions: int,
) -> Coupon:
    coupon = Coupon(
        promotion_id=promotion.id,
        code=code,
        visibility=CouponVisibility.assigned,
        is_active=True,
        starts_at=starts_at,
        ends_at=ends_at,
        global_max_redemptions=None,
        per_customer_max_redemptions=per_customer_max_redemptions,
    )
    session.add(coupon)
    await session.flush()
    session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
    await audit_chain_service.add_admin_audit_log(
        session,
        action="coupon_issued",
        actor_user_id=getattr(actor, "id", None),
        subject_user_id=user.id,
        data={
            "promotion_id": str(promotion.id),
            "coupon_id": str(coupon.id),
            "code": coupon.code,
        },
    )
    return coupon


def _queue_coupon_assigned_notification(
    *,
    background_tasks: BackgroundTasks,
    to_email: str,
    coupon_code: str,
    promotion_name: str,
    promotion_description: str | None,
    ends_at: datetime | None,
    preferred_language: str | None,
) -> None:
    background_tasks.add_task(
        email_service.send_coupon_assigned,
        to_email,
        coupon_code=coupon_code,
        promotion_name=promotion_name,
        promotion_description=promotion_description,
        ends_at=ends_at,
        lang=preferred_language,
    )


def _queue_coupon_revoked_notification(
    *,
    background_tasks: BackgroundTasks,
    to_email: str,
    coupon_code: str,
    promotion_name: str,
    reason: str | None,
    preferred_language: str | None,
) -> None:
    background_tasks.add_task(
        email_service.send_coupon_revoked,
        to_email,
        coupon_code=coupon_code,
        promotion_name=promotion_name,
        reason=reason,
        lang=preferred_language,
    )


async def _refresh_coupon_for_read(session: AsyncSession, *, coupon: Coupon) -> CouponRead:
    await session.refresh(coupon, attribute_names=["promotion"])
    if coupon.promotion:
        await session.refresh(coupon.promotion, attribute_names=["scopes"])
    coupon_read = CouponRead.model_validate(coupon, from_attributes=True)
    coupon_read.promotion = _to_promotion_read(coupon.promotion) if coupon.promotion else None
    return coupon_read


@router.post("/admin/coupons/issue", status_code=status.HTTP_201_CREATED)
async def admin_issue_coupon_to_user(
    payload: CouponIssueToUserRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    actor: AdminCouponsDep,
) -> CouponRead:
    user = await _find_user(session, user_id=payload.user_id, email=None)
    promotion = await _get_promotion_with_scopes_or_404(session, promotion_id=payload.promotion_id)

    prefix_source = payload.prefix or promotion.key or promotion.name or _DEFAULT_COUPON_PREFIX
    prefix = _sanitize_coupon_prefix(prefix_source) or _DEFAULT_COUPON_PREFIX
    code = await coupons_service.generate_unique_coupon_code(session, prefix=prefix, length=12)

    starts_at = datetime.now(timezone.utc)
    ends_at = _resolve_issue_coupon_ends_at_or_400(payload=payload, starts_at=starts_at)
    coupon = await _create_coupon_assignment_and_audit(
        session,
        promotion=promotion,
        user=user,
        actor=actor,
        code=code,
        starts_at=starts_at,
        ends_at=ends_at,
        per_customer_max_redemptions=int(payload.per_customer_max_redemptions or 1),
    )
    should_email = _resolve_issue_coupon_should_email(send_email=bool(payload.send_email), user=user)
    await session.commit()

    if should_email and user.email:
        _queue_coupon_assigned_notification(
            background_tasks=background_tasks,
            to_email=user.email,
            coupon_code=coupon.code,
            promotion_name=promotion.name,
            promotion_description=promotion.description,
            ends_at=ends_at,
            preferred_language=user.preferred_language,
        )

    return await _refresh_coupon_for_read(session, coupon=coupon)


@dataclass
class _AnalyticsTopProductAgg:
    product_id: UUID
    slug: str | None
    name: str
    orders: set[UUID]
    quantity: int
    gross: Decimal
    allocated: Decimal


def _coupon_redemption_filters(
    *,
    promotion_id: UUID,
    coupon_id: UUID | None,
    start: datetime,
    end: datetime,
) -> list[object]:
    filters: list[object] = [
        CouponRedemption.voided_at.is_(None),
        CouponRedemption.redeemed_at >= start,
        CouponRedemption.redeemed_at <= end,
        Coupon.promotion_id == promotion_id,
        Order.status.notin_(_COUPON_ANALYTICS_EXCLUDED_ORDER_STATUSES),
    ]
    if coupon_id:
        filters.append(Coupon.id == coupon_id)
    return filters


async def _coupon_analytics_summary(
    session: AsyncSession,
    *,
    redemption_filters: list[object],
    start: datetime,
    end: datetime,
) -> CouponAnalyticsSummary:
    summary_row = (
        await session.execute(
            select(
                func.count(CouponRedemption.id),
                func.coalesce(func.sum(CouponRedemption.discount_ron), 0),
                func.coalesce(func.sum(CouponRedemption.shipping_discount_ron), 0),
                func.avg(Order.total_amount),
            )
            .select_from(CouponRedemption)
            .join(Coupon, CouponRedemption.coupon_id == Coupon.id)
            .join(Order, CouponRedemption.order_id == Order.id)
            .where(*redemption_filters)
        )
    ).one()
    avg_with_val = summary_row[3]
    avg_with = pricing.quantize_money(_to_decimal(avg_with_val)) if avg_with_val is not None else None

    baseline_avg_val = (
        await session.execute(
            select(func.avg(Order.total_amount)).where(
                Order.created_at >= start,
                Order.created_at <= end,
                Order.status.notin_(_COUPON_ANALYTICS_EXCLUDED_ORDER_STATUSES),
                or_(Order.promo_code.is_(None), func.length(func.trim(Order.promo_code)) == 0),
            )
        )
    ).scalar_one()
    avg_without = pricing.quantize_money(_to_decimal(baseline_avg_val)) if baseline_avg_val is not None else None
    aov_lift = pricing.quantize_money(avg_with - avg_without) if avg_with is not None and avg_without is not None else None
    return CouponAnalyticsSummary(
        redemptions=int(summary_row[0] or 0),
        total_discount_ron=pricing.quantize_money(_to_decimal(summary_row[1])),
        total_shipping_discount_ron=pricing.quantize_money(_to_decimal(summary_row[2])),
        avg_order_total_with_coupon=avg_with,
        avg_order_total_without_coupon=avg_without,
        aov_lift=aov_lift,
    )


async def _coupon_analytics_daily(
    session: AsyncSession,
    *,
    redemption_filters: list[object],
) -> list[CouponAnalyticsDaily]:
    daily_rows = (
        await session.execute(
            select(
                func.date(CouponRedemption.redeemed_at).label("day"),
                func.count(CouponRedemption.id),
                func.coalesce(func.sum(CouponRedemption.discount_ron), 0),
                func.coalesce(func.sum(CouponRedemption.shipping_discount_ron), 0),
            )
            .select_from(CouponRedemption)
            .join(Coupon, CouponRedemption.coupon_id == Coupon.id)
            .join(Order, CouponRedemption.order_id == Order.id)
            .where(*redemption_filters)
            .group_by("day")
            .order_by("day")
        )
    ).all()
    return [
        CouponAnalyticsDaily(
            date=str(day_val),
            redemptions=int(count_val or 0),
            discount_ron=pricing.quantize_money(_to_decimal(disc_val)),
            shipping_discount_ron=pricing.quantize_money(_to_decimal(ship_val)),
        )
        for day_val, count_val, disc_val, ship_val in daily_rows
    ]


async def _coupon_analytics_order_discounts(
    session: AsyncSession,
    *,
    redemption_filters: list[object],
) -> dict[UUID, Decimal]:
    redemption_orders = (
        await session.execute(
            select(CouponRedemption.order_id, CouponRedemption.discount_ron)
            .select_from(CouponRedemption)
            .join(Coupon, CouponRedemption.coupon_id == Coupon.id)
            .join(Order, CouponRedemption.order_id == Order.id)
            .where(*redemption_filters)
        )
    ).all()
    return {
        order_id: _to_decimal(discount_val) for order_id, discount_val in redemption_orders if order_id
    }


def _coupon_order_subtotals(
    item_rows: list[tuple[UUID | None, UUID | None, str | None, str | None, int | None, Decimal | None]],
) -> dict[UUID, Decimal]:
    order_subtotals: dict[UUID, Decimal] = {}
    for order_id, _, _, _, _, subtotal_val in item_rows:
        if not order_id:
            continue
        order_subtotals[order_id] = order_subtotals.get(order_id, Decimal("0.00")) + _to_decimal(subtotal_val)
    return order_subtotals


def _coupon_analytics_aggregates(
    *,
    item_rows: list[tuple[UUID | None, UUID | None, str | None, str | None, int | None, Decimal | None]],
    order_discount_by_id: dict[UUID, Decimal],
) -> dict[UUID, _AnalyticsTopProductAgg]:
    aggregates: dict[UUID, _AnalyticsTopProductAgg] = {}
    order_subtotals = _coupon_order_subtotals(item_rows)
    for order_id, product_id, slug, name, qty, subtotal_val in item_rows:
        if not order_id or not product_id:
            continue
        subtotal = _to_decimal(subtotal_val)
        order_subtotal = order_subtotals.get(order_id, Decimal("0.00"))
        order_discount = order_discount_by_id.get(order_id, Decimal("0.00"))
        allocated = _allocated_discount(order_discount=order_discount, subtotal=subtotal, order_subtotal=order_subtotal)
        bucket = _get_or_create_product_aggregate(
            aggregates=aggregates,
            product_id=product_id,
            slug=slug,
            name=name,
        )
        bucket.orders.add(order_id)
        bucket.quantity += int(qty or 0)
        bucket.gross += subtotal
        bucket.allocated += allocated
    return aggregates


def _allocated_discount(*, order_discount: Decimal, subtotal: Decimal, order_subtotal: Decimal) -> Decimal:
    if order_discount > 0 and subtotal > 0 and order_subtotal > 0:
        return order_discount * subtotal / order_subtotal
    return Decimal("0.00")


def _get_or_create_product_aggregate(
    *,
    aggregates: dict[UUID, _AnalyticsTopProductAgg],
    product_id: UUID,
    slug: str | None,
    name: str | None,
) -> _AnalyticsTopProductAgg:
    bucket = aggregates.get(product_id)
    if bucket is not None:
        return bucket
    bucket = _AnalyticsTopProductAgg(
        product_id=product_id,
        slug=(slug or None),
        name=(name or str(product_id)),
        orders=set(),
        quantity=0,
        gross=Decimal("0.00"),
        allocated=Decimal("0.00"),
    )
    aggregates[product_id] = bucket
    return bucket


async def _coupon_analytics_top_products(
    session: AsyncSession,
    *,
    order_discount_by_id: dict[UUID, Decimal],
    top_limit: int,
) -> list[CouponAnalyticsTopProduct]:
    order_ids = list(order_discount_by_id.keys())
    if not order_ids:
        return []
    item_rows = (
        await session.execute(
            select(
                OrderItem.order_id,
                OrderItem.product_id,
                Product.slug,
                Product.name,
                OrderItem.quantity,
                OrderItem.subtotal,
            )
            .select_from(OrderItem)
            .join(Product, OrderItem.product_id == Product.id)
            .where(OrderItem.order_id.in_(order_ids))
        )
    ).all()
    aggregates = _coupon_analytics_aggregates(item_rows=item_rows, order_discount_by_id=order_discount_by_id)
    if not aggregates:
        return []
    items_sorted = sorted(aggregates.values(), key=lambda item: item.allocated, reverse=True)
    return [
        CouponAnalyticsTopProduct(
            product_id=bucket.product_id,
            product_slug=bucket.slug,
            product_name=bucket.name,
            orders_count=len(bucket.orders),
            quantity=bucket.quantity,
            gross_sales_ron=pricing.quantize_money(bucket.gross),
            allocated_discount_ron=pricing.quantize_money(bucket.allocated),
        )
        for bucket in items_sorted[: int(top_limit)]
    ]


@router.get("/admin/analytics")
async def admin_coupon_analytics(
    promotion_id: UUID,
    session: SessionDep,
    _: AdminCouponsDep,
    coupon_id: CouponIdFilterQuery = None,
    days: AnalyticsDaysQuery = 30,
    top_limit: AnalyticsTopLimitQuery = 10,
) -> CouponAnalyticsResponse:
    promotion = await session.get(Promotion, promotion_id)
    if not promotion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_PROMOTION_NOT_FOUND)
    if coupon_id:
        coupon = await session.get(Coupon, coupon_id)
        if not coupon or coupon.promotion_id != promotion_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=int(days))
    redemption_filters = _coupon_redemption_filters(
        promotion_id=promotion_id,
        coupon_id=coupon_id,
        start=start,
        end=end,
    )
    summary = await _coupon_analytics_summary(
        session,
        redemption_filters=redemption_filters,
        start=start,
        end=end,
    )
    daily = await _coupon_analytics_daily(session, redemption_filters=redemption_filters)
    order_discount_by_id = await _coupon_analytics_order_discounts(session, redemption_filters=redemption_filters)
    top_products = await _coupon_analytics_top_products(
        session,
        order_discount_by_id=order_discount_by_id,
        top_limit=int(top_limit),
    )
    return CouponAnalyticsResponse(summary=summary, daily=daily, top_products=top_products)


async def _find_user(session: AsyncSession, *, user_id: UUID | None, email: str | None) -> User:
    if user_id:
        user = await session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_USER_NOT_FOUND)
        return user
    if email:
        email_clean = email.strip().lower()
        user = (await session.execute(select(User).where(User.email == email_clean))).scalars().first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_USER_NOT_FOUND)
        return user
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide user_id or email")


@dataclass(frozen=True)
class _CouponEmailContext:
    coupon_code: str
    promotion_name: str
    promotion_description: str | None
    ends_at: datetime | None


def _coupon_email_context(coupon: Coupon | None) -> _CouponEmailContext:
    promotion = getattr(coupon, "promotion", None) if coupon else None
    return _CouponEmailContext(
        coupon_code=(getattr(coupon, "code", "") if coupon else ""),
        promotion_name=(getattr(promotion, "name", None) or _FALLBACK_PROMOTION_NAME),
        promotion_description=(getattr(promotion, "description", None) if promotion else None),
        ends_at=(getattr(coupon, "ends_at", None) if coupon else None),
    )


def _trimmed_revoke_reason(value: str | None, *, max_len: int = 255) -> str | None:
    return (value or "").strip()[:max_len] or None


def _notification_revoke_reason(value: str | None) -> str | None:
    return (value or "").strip() or None


async def _get_coupon_with_promotion_or_404(session: AsyncSession, *, coupon_id: UUID) -> Coupon:
    coupon = (
        (
            await session.execute(select(Coupon).options(selectinload(Coupon.promotion)).where(Coupon.id == coupon_id))
        )
        .scalars()
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)
    return coupon


async def _coupon_assignment_for_user(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    user_id: UUID,
) -> CouponAssignment | None:
    return (
        (
            await session.execute(
                select(CouponAssignment).where(CouponAssignment.coupon_id == coupon_id, CouponAssignment.user_id == user_id)
            )
        )
        .scalars()
        .first()
    )


def _activate_coupon_assignment(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    user_id: UUID,
    assignment: CouponAssignment | None,
) -> bool:
    if assignment and assignment.revoked_at is None:
        return False
    if assignment and assignment.revoked_at is not None:
        assignment.revoked_at = None
        assignment.revoked_reason = None
        session.add(assignment)
        return True
    session.add(CouponAssignment(coupon_id=coupon_id, user_id=user_id))
    return True


def _revoke_coupon_assignment(
    session: AsyncSession,
    *,
    assignment: CouponAssignment | None,
    now: datetime,
    reason: str | None,
) -> bool:
    if not assignment or assignment.revoked_at is not None:
        return False
    assignment.revoked_at = now
    assignment.revoked_reason = reason
    session.add(assignment)
    return True


def _normalize_bulk_email_request(emails: list[str] | None) -> tuple[int, list[str], list[str]]:
    requested = len(emails or [])
    normalized, invalid = _normalize_bulk_emails(emails or [])
    if len(normalized) > 500:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_DETAIL_TOO_MANY_EMAILS)
    return requested, normalized, invalid


def _not_found_emails(emails: list[str], users_by_email: dict[str, User]) -> list[str]:
    return [email for email in emails if email not in users_by_email]


async def _bulk_coupon_context(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    emails: list[str],
) -> tuple[Coupon, dict[str, User], list[str], dict[UUID, CouponAssignment]]:
    coupon = await _get_coupon_with_promotion_or_404(session, coupon_id=coupon_id)
    users_by_email = await _users_by_email(session, emails=emails)
    not_found = _not_found_emails(emails, users_by_email)
    user_ids = [user.id for user in users_by_email.values()]
    assignments_by_user_id = await _coupon_assignments_by_user_id(session, coupon_id=coupon.id, user_ids=user_ids)
    return coupon, users_by_email, not_found, assignments_by_user_id


async def _users_by_email(
    session: AsyncSession,
    *,
    emails: list[str],
) -> dict[str, User]:
    if not emails:
        return {}
    users = (await session.execute(select(User).where(User.email.in_(emails)))).scalars().all()
    return {u.email: u for u in users if u.email}


async def _coupon_assignments_by_user_id(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    user_ids: list[UUID],
) -> dict[UUID, CouponAssignment]:
    if not user_ids:
        return {}
    existing = (
        (
            await session.execute(
                select(CouponAssignment).where(
                    CouponAssignment.coupon_id == coupon_id,
                    CouponAssignment.user_id.in_(user_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    assignments_by_user_id: dict[UUID, CouponAssignment] = {}
    for assignment in existing:
        assignments_by_user_id[assignment.user_id] = assignment
    return assignments_by_user_id


async def _coupon_assignment_status_by_user_id(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    user_ids: list[UUID],
) -> dict[UUID, datetime | None]:
    if not user_ids:
        return {}
    existing = (
        (
            await session.execute(
                select(CouponAssignment.user_id, CouponAssignment.revoked_at).where(
                    CouponAssignment.coupon_id == coupon_id,
                    CouponAssignment.user_id.in_(user_ids),
                )
            )
        )
        .all()
    )
    return dict(existing)


def _normalize_bulk_emails(raw: list[str]) -> tuple[list[str], list[str]]:
    invalid: list[str] = []
    seen: set[str] = set()
    emails: list[str] = []
    for value in raw or []:
        clean = _normalize_bulk_email_value(value)
        if clean is None:
            continue
        if not _is_valid_bulk_email(clean):
            invalid.append(value)
            continue
        if clean in seen:
            continue
        seen.add(clean)
        emails.append(clean)
    return emails, invalid


def _normalize_bulk_email_value(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    clean = value.strip().lower()
    return clean or None


def _is_valid_bulk_email(clean: str) -> bool:
    if len(clean) > 255:
        return False
    if "@" not in clean:
        return False
    _, domain = clean.split("@", 1)
    return "." in domain


def _segment_user_filters(payload: object) -> list[object]:
    filters: list[object] = [User.deleted_at.is_(None)]
    require_marketing = bool(getattr(payload, "require_marketing_opt_in", False)) or bool(getattr(payload, "send_email", False))
    require_verified = bool(getattr(payload, "require_email_verified", False))
    if require_marketing:
        filters.append(User.notify_marketing.is_(True))
    if require_verified:
        filters.append(User.email_verified.is_(True))
    return filters


@dataclass(frozen=True)
class _BucketConfig:
    total: int
    index: int
    seed: str


def _parse_bucket_config(*, bucket_total: object, bucket_index: object, bucket_seed: object) -> _BucketConfig | None:
    seed = (str(bucket_seed) if bucket_seed is not None else "").strip()
    if _bucket_config_not_provided(bucket_total=bucket_total, bucket_index=bucket_index, seed=seed):
        return None
    if _bucket_config_incomplete(bucket_total=bucket_total, bucket_index=bucket_index, seed=seed):
        raise ValueError("Bucket config requires bucket_total, bucket_index, and bucket_seed")
    total = int(bucket_total)
    index = int(bucket_index)
    if not _bucket_total_in_range(total):
        raise ValueError("bucket_total must be between 2 and 100")
    if not _bucket_index_in_range(index=index, total=total):
        raise ValueError("bucket_index must be within bucket_total range")
    return _BucketConfig(total=total, index=index, seed=seed[:80])


def _bucket_config_not_provided(*, bucket_total: object, bucket_index: object, seed: str) -> bool:
    return bucket_total is None and bucket_index is None and not seed


def _bucket_config_incomplete(*, bucket_total: object, bucket_index: object, seed: str) -> bool:
    return bucket_total is None or bucket_index is None or not seed


def _bucket_total_in_range(total: int) -> bool:
    return 2 <= total <= 100


def _bucket_index_in_range(*, index: int, total: int) -> bool:
    return 0 <= index < total


def _bucket_index_for_user(*, user_id: UUID, seed: str, total: int) -> int:
    payload = f"{seed}:{user_id}".encode("utf-8")
    digest = hashlib.sha256(payload).digest()
    value = int.from_bytes(digest[:8], "big")
    return int(value % total)


async def _segment_sample_emails(session: AsyncSession, *, filters: list[object], limit: int = 10) -> list[str]:
    rows = (await session.execute(select(User.email).where(*filters).order_by(User.created_at.desc()).limit(limit))).scalars().all()
    return [str(e) for e in rows if e]


def _add_sample_email(sample: list[str], email: str | None, *, limit: int = 10) -> None:
    if email and len(sample) < limit:
        sample.append(str(email))


async def _segment_user_batch(
    session: AsyncSession,
    *,
    filters: list[object],
    last_id: UUID | None,
) -> list[tuple[UUID, str | None]]:
    q = select(User.id, User.email).where(*filters).order_by(User.id).limit(_BULK_SEGMENT_BATCH_SIZE)
    if last_id is not None:
        q = q.where(User.id > last_id)
    return (await session.execute(q)).all()


async def _segment_user_batch_with_language(
    session: AsyncSession,
    *,
    filters: list[object],
    last_id: UUID | None,
) -> list[tuple[UUID, str | None, str | None]]:
    q = select(User.id, User.email, User.preferred_language).where(*filters).order_by(User.id).limit(_BULK_SEGMENT_BATCH_SIZE)
    if last_id is not None:
        q = q.where(User.id > last_id)
    return (await session.execute(q)).all()


def _bucket_preview_rows(
    rows: list[tuple[UUID, str | None]],
    *,
    bucket: _BucketConfig | None,
) -> list[tuple[UUID, str | None]]:
    if bucket is None:
        return rows
    return [
        (user_id, email)
        for user_id, email in rows
        if _bucket_index_for_user(user_id=user_id, seed=bucket.seed, total=bucket.total) == bucket.index
    ]


def _bucket_job_rows(
    rows: list[tuple[UUID, str | None, str | None]],
    *,
    bucket: _BucketConfig | None,
) -> list[tuple[UUID, str | None, str | None]]:
    if bucket is None:
        return rows
    return [
        (user_id, email, preferred_language)
        for user_id, email, preferred_language in rows
        if _bucket_index_for_user(user_id=user_id, seed=bucket.seed, total=bucket.total) == bucket.index
    ]


async def _preview_segment_assign_bucketed(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    filters: list[object],
    bucket: _BucketConfig,
) -> CouponBulkSegmentPreview:
    total = 0
    already_active = 0
    restored = 0
    sample: list[str] = []
    last_id: UUID | None = None
    while True:
        rows = await _segment_user_batch(session, filters=filters, last_id=last_id)
        if not rows:
            break
        last_id = rows[-1][0]
        bucketed = _bucket_preview_rows(rows, bucket=bucket)
        if not bucketed:
            continue
        user_ids = [user_id for user_id, _ in bucketed]
        status_by_user_id = await _coupon_assignment_status_by_user_id(
            session,
            coupon_id=coupon_id,
            user_ids=user_ids,
        )
        batch_total, batch_active, batch_restored = _preview_bucket_assignment_counts(
            bucketed=bucketed,
            status_by_user_id=status_by_user_id,
            sample=sample,
        )
        total += batch_total
        already_active += batch_active
        restored += batch_restored
    created = max(total - already_active - restored, 0)
    return CouponBulkSegmentPreview(
        total_candidates=total,
        sample_emails=sample,
        created=created,
        restored=restored,
        already_active=already_active,
    )


def _preview_bucket_assignment_counts(
    *,
    bucketed: list[tuple[UUID, str | None]],
    status_by_user_id: dict[UUID, datetime | None],
    sample: list[str],
) -> tuple[int, int, int]:
    total = 0
    already_active = 0
    restored = 0
    for user_id, email in bucketed:
        total += 1
        _add_sample_email(sample, email)
        revoked_at = status_by_user_id.get(user_id)
        if revoked_at is None and user_id in status_by_user_id:
            already_active += 1
            continue
        if revoked_at is not None:
            restored += 1
    return total, already_active, restored


async def _preview_segment_assign_all(
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


async def _preview_segment_assign(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    filters: list[object],
    bucket: _BucketConfig | None = None,
) -> CouponBulkSegmentPreview:
    if bucket is None:
        return await _preview_segment_assign_all(session, coupon_id=coupon_id, filters=filters)
    return await _preview_segment_assign_bucketed(session, coupon_id=coupon_id, filters=filters, bucket=bucket)


async def _preview_segment_revoke_bucketed(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    filters: list[object],
    bucket: _BucketConfig,
) -> CouponBulkSegmentPreview:
    total = 0
    revoked = 0
    already_revoked = 0
    not_assigned = 0
    sample: list[str] = []
    last_id: UUID | None = None
    while True:
        rows = await _segment_user_batch(session, filters=filters, last_id=last_id)
        if not rows:
            break
        last_id = rows[-1][0]
        bucketed = _bucket_preview_rows(rows, bucket=bucket)
        if not bucketed:
            continue
        user_ids = [user_id for user_id, _ in bucketed]
        status_by_user_id = await _coupon_assignment_status_by_user_id(
            session,
            coupon_id=coupon_id,
            user_ids=user_ids,
        )
        for user_id, email in bucketed:
            total += 1
            _add_sample_email(sample, email)
            if user_id not in status_by_user_id:
                not_assigned += 1
                continue
            revoked_at = status_by_user_id.get(user_id)
            if revoked_at is None:
                revoked += 1
                continue
            already_revoked += 1
    return CouponBulkSegmentPreview(
        total_candidates=total,
        sample_emails=sample,
        revoked=revoked,
        already_revoked=already_revoked,
        not_assigned=not_assigned,
    )


async def _preview_segment_revoke_all(
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


async def _preview_segment_revoke(
    session: AsyncSession,
    *,
    coupon_id: UUID,
    filters: list[object],
    bucket: _BucketConfig | None = None,
) -> CouponBulkSegmentPreview:
    if bucket is None:
        return await _preview_segment_revoke_all(session, coupon_id=coupon_id, filters=filters)
    return await _preview_segment_revoke_bucketed(session, coupon_id=coupon_id, filters=filters, bucket=bucket)


async def _load_bulk_job_for_run(session: AsyncSession, *, job_id: UUID) -> CouponBulkJob | None:
    return (
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


async def _mark_bulk_job_running(session: AsyncSession, *, job: CouponBulkJob) -> None:
    job.status = CouponBulkJobStatus.running
    job.started_at = datetime.now(timezone.utc)
    job.error_message = None
    await session.commit()


async def _initialize_bulk_job_counters(
    session: AsyncSession,
    *,
    job: CouponBulkJob,
    filters: list[object],
    bucket: _BucketConfig | None,
) -> None:
    if bucket is None:
        job.total_candidates = int((await session.execute(select(func.count()).select_from(User).where(*filters))).scalar_one())
    else:
        job.total_candidates = int(getattr(job, "total_candidates", 0) or 0)
    job.processed = 0
    job.created = 0
    job.restored = 0
    job.already_active = 0
    job.revoked = 0
    job.already_revoked = 0
    job.not_assigned = 0
    await session.commit()


async def _finish_bulk_job_if_cancelled(session: AsyncSession, *, job: CouponBulkJob) -> bool:
    await session.refresh(job, attribute_names=["status"])
    if job.status != CouponBulkJobStatus.cancelled:
        return False
    job.finished_at = datetime.now(timezone.utc)
    await session.commit()
    return True


def _append_job_notification(
    notify: list[tuple[str, str | None]],
    *,
    send_email: bool,
    email: str | None,
    preferred_language: str | None,
) -> None:
    if send_email and email:
        notify.append((email, preferred_language))


def _apply_bulk_job_assign_row(
    *,
    session: AsyncSession,
    job: CouponBulkJob,
    assignment: CouponAssignment | None,
    user_id: UUID,
    email: str | None,
    preferred_language: str | None,
    notify: list[tuple[str, str | None]],
) -> None:
    if assignment and assignment.revoked_at is None:
        job.already_active += 1
        return
    if assignment and assignment.revoked_at is not None:
        assignment.revoked_at = None
        assignment.revoked_reason = None
        session.add(assignment)
        job.restored += 1
        _append_job_notification(
            notify,
            send_email=job.send_email,
            email=email,
            preferred_language=preferred_language,
        )
        return
    session.add(CouponAssignment(coupon_id=job.coupon_id, user_id=user_id))
    job.created += 1
    _append_job_notification(
        notify,
        send_email=job.send_email,
        email=email,
        preferred_language=preferred_language,
    )


def _apply_bulk_job_revoke_row(
    *,
    session: AsyncSession,
    job: CouponBulkJob,
    assignment: CouponAssignment | None,
    email: str | None,
    preferred_language: str | None,
    notify: list[tuple[str, str | None]],
    now: datetime,
    revoke_reason: str | None,
) -> None:
    if not assignment:
        job.not_assigned += 1
        return
    if assignment.revoked_at is not None:
        job.already_revoked += 1
        return
    assignment.revoked_at = now
    assignment.revoked_reason = revoke_reason
    session.add(assignment)
    job.revoked += 1
    _append_job_notification(
        notify,
        send_email=job.send_email,
        email=email,
        preferred_language=preferred_language,
    )


def _apply_bulk_job_rows(
    *,
    session: AsyncSession,
    job: CouponBulkJob,
    rows: list[tuple[UUID, str | None, str | None]],
    assignments_by_user_id: dict[UUID, CouponAssignment],
    now: datetime,
    revoke_reason: str | None,
) -> list[tuple[str, str | None]]:
    notify: list[tuple[str, str | None]] = []
    if job.action == CouponBulkJobAction.assign:
        for user_id, email, preferred_language in rows:
            _apply_bulk_job_assign_row(
                session=session,
                job=job,
                assignment=assignments_by_user_id.get(user_id),
                user_id=user_id,
                email=email,
                preferred_language=preferred_language,
                notify=notify,
            )
            job.processed += 1
        return notify
    for user_id, email, preferred_language in rows:
        _apply_bulk_job_revoke_row(
            session=session,
            job=job,
            assignment=assignments_by_user_id.get(user_id),
            email=email,
            preferred_language=preferred_language,
            notify=notify,
            now=now,
            revoke_reason=revoke_reason,
        )
        job.processed += 1
    return notify


async def _send_bulk_assign_notifications(
    *,
    notify: list[tuple[str, str | None]],
    context: _CouponEmailContext,
) -> None:
    for to_email, lang in notify:
        await email_service.send_coupon_assigned(
            to_email,
            coupon_code=context.coupon_code,
            promotion_name=context.promotion_name,
            promotion_description=context.promotion_description,
            ends_at=context.ends_at,
            lang=lang,
        )


async def _send_bulk_revoke_notifications(
    *,
    notify: list[tuple[str, str | None]],
    context: _CouponEmailContext,
    revoke_reason: str | None,
) -> None:
    for to_email, lang in notify:
        await email_service.send_coupon_revoked(
            to_email,
            coupon_code=context.coupon_code,
            promotion_name=context.promotion_name,
            reason=revoke_reason,
            lang=lang,
        )


async def _send_bulk_job_notifications(
    *,
    job: CouponBulkJob,
    notify: list[tuple[str, str | None]],
    context: _CouponEmailContext,
    revoke_reason: str | None,
) -> None:
    if not notify:
        return
    if job.action == CouponBulkJobAction.assign:
        await _send_bulk_assign_notifications(notify=notify, context=context)
        return
    await _send_bulk_revoke_notifications(notify=notify, context=context, revoke_reason=revoke_reason)


def _is_bulk_job_runnable(job: CouponBulkJob | None) -> bool:
    return bool(job and job.status in (CouponBulkJobStatus.pending, CouponBulkJobStatus.running))


async def _process_bulk_segment_batch(
    session: AsyncSession,
    *,
    job: CouponBulkJob,
    rows: list[tuple[UUID, str | None, str | None]],
    context: _CouponEmailContext,
    now: datetime,
    revoke_reason: str | None,
    revoke_notify_reason: str | None,
) -> bool:
    user_ids = [row[0] for row in rows]
    assignments_by_user_id = await _coupon_assignments_by_user_id(session, coupon_id=job.coupon_id, user_ids=user_ids)
    notify = _apply_bulk_job_rows(
        session=session,
        job=job,
        rows=rows,
        assignments_by_user_id=assignments_by_user_id,
        now=now,
        revoke_reason=revoke_reason,
    )
    await session.commit()
    if await _finish_bulk_job_if_cancelled(session, job=job):
        return True
    await _send_bulk_job_notifications(
        job=job,
        notify=notify,
        context=context,
        revoke_reason=revoke_notify_reason,
    )
    return False


async def _run_bulk_segment_batches(
    session: AsyncSession,
    *,
    job: CouponBulkJob,
    bucket: _BucketConfig | None,
    filters: list[object],
    context: _CouponEmailContext,
    now: datetime,
    revoke_reason: str | None,
    revoke_notify_reason: str | None,
) -> bool:
    last_id: UUID | None = None
    while True:
        if await _finish_bulk_job_if_cancelled(session, job=job):
            return True
        rows = await _segment_user_batch_with_language(session, filters=filters, last_id=last_id)
        if not rows:
            return False
        last_id = rows[-1][0]
        bucketed_rows = _bucket_job_rows(rows, bucket=bucket)
        if not bucketed_rows:
            continue
        if await _process_bulk_segment_batch(
            session,
            job=job,
            rows=bucketed_rows,
            context=context,
            now=now,
            revoke_reason=revoke_reason,
            revoke_notify_reason=revoke_notify_reason,
        ):
            return True


async def _mark_bulk_job_succeeded(session: AsyncSession, *, job: CouponBulkJob) -> None:
    job.status = CouponBulkJobStatus.succeeded
    job.finished_at = datetime.now(timezone.utc)
    await session.commit()


async def _mark_bulk_job_failed(session: AsyncSession, *, job: CouponBulkJob, error: Exception) -> None:
    job.status = CouponBulkJobStatus.failed
    job.error_message = str(error)[:1000]
    job.finished_at = datetime.now(timezone.utc)
    await session.commit()


async def _run_bulk_segment_job(engine: AsyncEngine, *, job_id: UUID) -> None:
    session_local = async_sessionmaker(engine, expire_on_commit=False, autoflush=False, class_=AsyncSession)
    async with session_local() as session:
        job = await _load_bulk_job_for_run(session, job_id=job_id)
        if not _is_bulk_job_runnable(job):
            return

        try:
            assert job is not None
            await _mark_bulk_job_running(session, job=job)

            bucket = _parse_bucket_config(
                bucket_total=getattr(job, "bucket_total", None),
                bucket_index=getattr(job, "bucket_index", None),
                bucket_seed=getattr(job, "bucket_seed", None),
            )
            filters = _segment_user_filters(job)
            await _initialize_bulk_job_counters(session, job=job, filters=filters, bucket=bucket)

            context = _coupon_email_context(job.coupon)
            revoke_reason = _trimmed_revoke_reason(job.revoke_reason)
            revoke_notify_reason = _notification_revoke_reason(job.revoke_reason)
            now = datetime.now(timezone.utc)
            if await _run_bulk_segment_batches(
                session,
                job=job,
                bucket=bucket,
                filters=filters,
                context=context,
                now=now,
                revoke_reason=revoke_reason,
                revoke_notify_reason=revoke_notify_reason,
            ):
                return
            if await _finish_bulk_job_if_cancelled(session, job=job):
                return
            await _mark_bulk_job_succeeded(session, job=job)
        except Exception as exc:
            if await _finish_bulk_job_if_cancelled(session, job=job):
                return
            await _mark_bulk_job_failed(session, job=job, error=exc)


@router.post("/admin/coupons/{coupon_id}/assign", status_code=status.HTTP_204_NO_CONTENT)
async def admin_assign_coupon(
    coupon_id: UUID,
    payload: CouponAssignRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    _: AdminCouponsDep,
) -> Response:
    coupon = await _get_coupon_with_promotion_or_404(session, coupon_id=coupon_id)
    user = await _find_user(session, user_id=payload.user_id, email=payload.email)
    assignment = await _coupon_assignment_for_user(session, coupon_id=coupon.id, user_id=user.id)
    if not _activate_coupon_assignment(
        session,
        coupon_id=coupon.id,
        user_id=user.id,
        assignment=assignment,
    ):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    should_email = _resolve_issue_coupon_should_email(send_email=bool(payload.send_email), user=user)
    await session.commit()

    if should_email and user.email:
        _queue_coupon_assigned_notification(
            background_tasks=background_tasks,
            to_email=user.email,
            coupon_code=coupon.code,
            promotion_name=coupon.promotion.name if coupon.promotion else _FALLBACK_PROMOTION_NAME,
            promotion_description=coupon.promotion.description if coupon.promotion else None,
            ends_at=getattr(coupon, "ends_at", None),
            preferred_language=user.preferred_language,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _apply_bulk_assignments(
    *,
    session: AsyncSession,
    coupon: Coupon,
    emails: list[str],
    users_by_email: dict[str, User],
    assignments_by_user_id: dict[UUID, CouponAssignment],
) -> tuple[int, int, int, set[UUID]]:
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
            continue
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
        created += 1
        notify_user_ids.add(user.id)
    return created, restored, already_active, notify_user_ids


def _enqueue_bulk_assign_notifications(
    *,
    background_tasks: BackgroundTasks,
    coupon: Coupon,
    users_by_email: dict[str, User],
    notify_user_ids: set[UUID],
) -> None:
    if not notify_user_ids:
        return
    ends_at = getattr(coupon, "ends_at", None)
    for user in users_by_email.values():
        if user.id not in notify_user_ids or not user.email or not bool(getattr(user, "notify_marketing", False)):
            continue
        background_tasks.add_task(
            email_service.send_coupon_assigned,
            user.email,
            coupon_code=coupon.code,
            promotion_name=coupon.promotion.name if coupon.promotion else _FALLBACK_PROMOTION_NAME,
            promotion_description=coupon.promotion.description if coupon.promotion else None,
            ends_at=ends_at,
            lang=user.preferred_language,
        )


@router.post("/admin/coupons/{coupon_id}/assign/bulk")
async def admin_bulk_assign_coupon(
    coupon_id: UUID,
    payload: CouponBulkAssignRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponBulkResult:
    requested, emails, invalid = _normalize_bulk_email_request(payload.emails)
    if not emails:
        return CouponBulkResult(requested=requested, unique=0, invalid_emails=invalid)
    coupon, users_by_email, not_found, assignments_by_user_id = await _bulk_coupon_context(
        session,
        coupon_id=coupon_id,
        emails=emails,
    )
    created, restored, already_active, notify_user_ids = _apply_bulk_assignments(
        session=session,
        coupon=coupon,
        emails=emails,
        users_by_email=users_by_email,
        assignments_by_user_id=assignments_by_user_id,
    )

    await session.commit()

    if payload.send_email:
        _enqueue_bulk_assign_notifications(
            background_tasks=background_tasks,
            coupon=coupon,
            users_by_email=users_by_email,
            notify_user_ids=notify_user_ids,
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


def _apply_bulk_revocations(
    *,
    session: AsyncSession,
    emails: list[str],
    users_by_email: dict[str, User],
    assignments_by_user_id: dict[UUID, CouponAssignment],
    now: datetime,
    reason: str | None,
) -> tuple[int, int, int, set[UUID]]:
    revoked = 0
    already_revoked = 0
    not_assigned = 0
    revoked_user_ids: set[UUID] = set()
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
    return revoked, already_revoked, not_assigned, revoked_user_ids


def _enqueue_bulk_revoke_notifications(
    *,
    background_tasks: BackgroundTasks,
    coupon: Coupon,
    users_by_email: dict[str, User],
    revoked_user_ids: set[UUID],
    reason: str | None,
) -> None:
    if not revoked_user_ids:
        return
    for user in users_by_email.values():
        if user.id not in revoked_user_ids or not user.email or not bool(getattr(user, "notify_marketing", False)):
            continue
        background_tasks.add_task(
            email_service.send_coupon_revoked,
            user.email,
            coupon_code=coupon.code,
            promotion_name=coupon.promotion.name if coupon.promotion else _FALLBACK_PROMOTION_NAME,
            reason=reason,
            lang=user.preferred_language,
        )


@router.post("/admin/coupons/{coupon_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_coupon(
    coupon_id: UUID,
    payload: CouponRevokeRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    _: AdminCouponsDep,
) -> Response:
    coupon = await _get_coupon_with_promotion_or_404(session, coupon_id=coupon_id)
    user = await _find_user(session, user_id=payload.user_id, email=payload.email)
    assignment = await _coupon_assignment_for_user(session, coupon_id=coupon.id, user_id=user.id)
    if not _revoke_coupon_assignment(
        session,
        assignment=assignment,
        now=datetime.now(timezone.utc),
        reason=_trimmed_revoke_reason(payload.reason),
    ):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    should_email = _resolve_issue_coupon_should_email(send_email=bool(payload.send_email), user=user)
    await session.commit()

    if should_email and user.email and assignment:
        _queue_coupon_revoked_notification(
            background_tasks=background_tasks,
            to_email=user.email,
            coupon_code=coupon.code,
            promotion_name=coupon.promotion.name if coupon.promotion else _FALLBACK_PROMOTION_NAME,
            reason=assignment.revoked_reason,
            preferred_language=user.preferred_language,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/coupons/{coupon_id}/revoke/bulk")
async def admin_bulk_revoke_coupon(
    coupon_id: UUID,
    payload: CouponBulkRevokeRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponBulkResult:
    requested, emails, invalid = _normalize_bulk_email_request(payload.emails)
    if not emails:
        return CouponBulkResult(requested=requested, unique=0, invalid_emails=invalid)
    coupon, users_by_email, not_found, assignments_by_user_id = await _bulk_coupon_context(
        session,
        coupon_id=coupon_id,
        emails=emails,
    )
    now = datetime.now(timezone.utc)
    reason = _trimmed_revoke_reason(payload.reason)
    revoked, already_revoked, not_assigned, revoked_user_ids = _apply_bulk_revocations(
        session=session,
        emails=emails,
        users_by_email=users_by_email,
        assignments_by_user_id=assignments_by_user_id,
        now=now,
        reason=reason,
    )

    await session.commit()

    if payload.send_email:
        _enqueue_bulk_revoke_notifications(
            background_tasks=background_tasks,
            coupon=coupon,
            users_by_email=users_by_email,
            revoked_user_ids=revoked_user_ids,
            reason=reason,
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


@router.post("/admin/coupons/{coupon_id}/assign/segment/preview")
async def admin_preview_segment_assign(
    coupon_id: UUID,
    payload: CouponBulkSegmentAssignRequest,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponBulkSegmentPreview:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)
    try:
        bucket = _parse_bucket_config(
            bucket_total=payload.bucket_total,
            bucket_index=payload.bucket_index,
            bucket_seed=payload.bucket_seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filters = _segment_user_filters(payload)
    return await _preview_segment_assign(session, coupon_id=coupon_id, filters=filters, bucket=bucket)


@router.post("/admin/coupons/{coupon_id}/revoke/segment/preview")
async def admin_preview_segment_revoke(
    coupon_id: UUID,
    payload: CouponBulkSegmentRevokeRequest,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponBulkSegmentPreview:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)
    try:
        bucket = _parse_bucket_config(
            bucket_total=payload.bucket_total,
            bucket_index=payload.bucket_index,
            bucket_seed=payload.bucket_seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filters = _segment_user_filters(payload)
    return await _preview_segment_revoke(session, coupon_id=coupon_id, filters=filters, bucket=bucket)


@router.post("/admin/coupons/{coupon_id}/assign/segment", status_code=status.HTTP_201_CREATED)
async def admin_start_segment_assign_job(
    coupon_id: UUID,
    payload: CouponBulkSegmentAssignRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    admin_user: AdminCouponsDep,
) -> CouponBulkJobRead:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)

    try:
        bucket = _parse_bucket_config(
            bucket_total=payload.bucket_total,
            bucket_index=payload.bucket_index,
            bucket_seed=payload.bucket_seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filters = _segment_user_filters(payload)
    preview = await _preview_segment_assign(session, coupon_id=coupon_id, filters=filters, bucket=bucket)

    job = CouponBulkJob(
        coupon_id=coupon_id,
        created_by_user_id=admin_user.id,
        action=CouponBulkJobAction.assign,
        status=CouponBulkJobStatus.pending,
        require_marketing_opt_in=payload.require_marketing_opt_in,
        require_email_verified=payload.require_email_verified,
        bucket_total=payload.bucket_total,
        bucket_index=payload.bucket_index,
        bucket_seed=(payload.bucket_seed or "").strip()[:80] or None,
        send_email=payload.send_email,
        total_candidates=preview.total_candidates,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_DETAIL_DB_ENGINE_UNAVAILABLE)
    background_tasks.add_task(_run_bulk_segment_job, engine, job_id=job.id)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.post("/admin/coupons/{coupon_id}/revoke/segment", status_code=status.HTTP_201_CREATED)
async def admin_start_segment_revoke_job(
    coupon_id: UUID,
    payload: CouponBulkSegmentRevokeRequest,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    admin_user: AdminCouponsDep,
) -> CouponBulkJobRead:
    coupon = await session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_COUPON_NOT_FOUND)

    try:
        bucket = _parse_bucket_config(
            bucket_total=payload.bucket_total,
            bucket_index=payload.bucket_index,
            bucket_seed=payload.bucket_seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filters = _segment_user_filters(payload)
    preview = await _preview_segment_revoke(session, coupon_id=coupon_id, filters=filters, bucket=bucket)

    job = CouponBulkJob(
        coupon_id=coupon_id,
        created_by_user_id=admin_user.id,
        action=CouponBulkJobAction.revoke,
        status=CouponBulkJobStatus.pending,
        require_marketing_opt_in=payload.require_marketing_opt_in,
        require_email_verified=payload.require_email_verified,
        bucket_total=payload.bucket_total,
        bucket_index=payload.bucket_index,
        bucket_seed=(payload.bucket_seed or "").strip()[:80] or None,
        send_email=payload.send_email,
        revoke_reason=(payload.reason or "").strip()[:255] or None,
        total_candidates=preview.total_candidates,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_DETAIL_DB_ENGINE_UNAVAILABLE)
    background_tasks.add_task(_run_bulk_segment_job, engine, job_id=job.id)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.get("/admin/coupons/bulk-jobs/{job_id}")
async def admin_get_bulk_job(
    job_id: UUID,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponBulkJobRead:
    job = await session.get(CouponBulkJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_JOB_NOT_FOUND)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.get("/admin/coupons/bulk-jobs")
async def admin_list_bulk_jobs_global(
    session: SessionDep,
    _: AdminCouponsDep,
    limit: BulkJobsLimitQuery = 10,
) -> list[CouponBulkJobRead]:
    jobs = (
        (
            await session.execute(
                select(CouponBulkJob)
                .order_by(CouponBulkJob.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [CouponBulkJobRead.model_validate(job, from_attributes=True) for job in jobs]


@router.get("/admin/coupons/{coupon_id}/bulk-jobs")
async def admin_list_bulk_jobs(
    coupon_id: UUID,
    session: SessionDep,
    _: AdminCouponsDep,
    limit: BulkJobsLimitQuery = 10,
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


@router.post("/admin/coupons/bulk-jobs/{job_id}/cancel")
async def admin_cancel_bulk_job(
    job_id: UUID,
    session: SessionDep,
    _: AdminCouponsDep,
) -> CouponBulkJobRead:
    job = await session.get(CouponBulkJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_JOB_NOT_FOUND)
    if job.status in (CouponBulkJobStatus.succeeded, CouponBulkJobStatus.failed, CouponBulkJobStatus.cancelled):
        return CouponBulkJobRead.model_validate(job, from_attributes=True)
    job.status = CouponBulkJobStatus.cancelled
    job.finished_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(job)
    return CouponBulkJobRead.model_validate(job, from_attributes=True)


@router.post(
    "/admin/coupons/bulk-jobs/{job_id}/retry",
    status_code=status.HTTP_201_CREATED,
)
async def admin_retry_bulk_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    admin_user: AdminCouponsDep,
) -> CouponBulkJobRead:
    job = await session.get(CouponBulkJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DETAIL_JOB_NOT_FOUND)
    if job.status in (CouponBulkJobStatus.pending, CouponBulkJobStatus.running):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job is still in progress")

    try:
        bucket = _parse_bucket_config(
            bucket_total=getattr(job, "bucket_total", None),
            bucket_index=getattr(job, "bucket_index", None),
            bucket_seed=getattr(job, "bucket_seed", None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    filters = _segment_user_filters(job)
    if job.action == CouponBulkJobAction.assign:
        preview = await _preview_segment_assign(session, coupon_id=job.coupon_id, filters=filters, bucket=bucket)
    else:
        preview = await _preview_segment_revoke(session, coupon_id=job.coupon_id, filters=filters, bucket=bucket)

    new_job = CouponBulkJob(
        coupon_id=job.coupon_id,
        created_by_user_id=admin_user.id,
        action=job.action,
        status=CouponBulkJobStatus.pending,
        require_marketing_opt_in=job.require_marketing_opt_in,
        require_email_verified=job.require_email_verified,
        bucket_total=getattr(job, "bucket_total", None),
        bucket_index=getattr(job, "bucket_index", None),
        bucket_seed=getattr(job, "bucket_seed", None),
        send_email=job.send_email,
        revoke_reason=job.revoke_reason,
        total_candidates=preview.total_candidates,
    )
    session.add(new_job)
    await session.commit()
    await session.refresh(new_job)

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=_DETAIL_DB_ENGINE_UNAVAILABLE)
    background_tasks.add_task(_run_bulk_segment_job, engine, job_id=new_job.id)
    return CouponBulkJobRead.model_validate(new_job, from_attributes=True)
