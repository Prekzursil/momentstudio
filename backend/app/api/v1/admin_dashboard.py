import csv
import io
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy import String, Text, cast, delete, func, literal, or_, select, union_all
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.dependencies import require_admin, require_owner
from app.db.session import get_session
from app.models.catalog import Product, ProductAuditLog, Category, ProductStatus
from app.models.content import ContentBlock, ContentAuditLog
from app.schemas.catalog_admin import AdminProductByIdsRequest, AdminProductListItem, AdminProductListResponse
from app.services import exporter as exporter_service
from app.models.order import Order, OrderStatus
from app.models.returns import ReturnRequest, ReturnRequestStatus
from app.models.user import AdminAuditLog, User, RefreshSession, UserRole
from app.models.promo import PromoCode, StripeCouponMapping
from app.services import auth as auth_service
from app.schemas.user_admin import AdminUserListItem, AdminUserListResponse

router = APIRouter(prefix="/admin/dashboard", tags=["admin"])


@router.get("/summary")
async def admin_summary(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> dict:
    now = datetime.now(timezone.utc)

    if (range_from is None) != (range_to is None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="range_from and range_to must be provided together")

    if range_from is not None and range_to is not None:
        if range_to < range_from:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="range_to must be on/after range_from")
        start = datetime.combine(range_from, datetime.min.time(), tzinfo=timezone.utc)
        end = datetime.combine(range_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        effective_range_days = (range_to - range_from).days + 1
    else:
        start = now - timedelta(days=range_days)
        end = now
        effective_range_days = range_days

    products_total = await session.scalar(select(func.count()).select_from(Product).where(Product.is_deleted.is_(False)))
    orders_total = await session.scalar(select(func.count()).select_from(Order))
    users_total = await session.scalar(select(func.count()).select_from(User))

    low_stock = await session.scalar(
        select(func.count())
        .select_from(Product)
        .where(Product.stock_quantity < 5, Product.is_deleted.is_(False), Product.is_active.is_(True))
    )

    since = now - timedelta(days=30)
    sales_30d = await session.scalar(select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.created_at >= since))
    orders_30d = await session.scalar(select(func.count()).select_from(Order).where(Order.created_at >= since))

    sales_range = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.created_at >= start, Order.created_at < end)
    )
    orders_range = await session.scalar(select(func.count()).select_from(Order).where(Order.created_at >= start, Order.created_at < end))

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    today_orders = await session.scalar(select(func.count()).select_from(Order).where(Order.created_at >= today_start, Order.created_at < now))
    yesterday_orders = await session.scalar(
        select(func.count()).select_from(Order).where(Order.created_at >= yesterday_start, Order.created_at < today_start)
    )
    today_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.created_at >= today_start, Order.created_at < now)
    )
    yesterday_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.created_at >= yesterday_start, Order.created_at < today_start)
    )
    today_refunds = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status == OrderStatus.refunded, Order.updated_at >= today_start, Order.updated_at < now)
    )
    yesterday_refunds = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status == OrderStatus.refunded, Order.updated_at >= yesterday_start, Order.updated_at < today_start)
    )

    payment_window_end = now
    payment_window_start = now - timedelta(hours=24)
    payment_prev_start = payment_window_start - timedelta(hours=24)
    failed_payments = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status == OrderStatus.pending_payment, Order.created_at >= payment_window_start, Order.created_at < payment_window_end)
    )
    failed_payments_prev = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status == OrderStatus.pending_payment, Order.created_at >= payment_prev_start, Order.created_at < payment_window_start)
    )

    refund_window_end = now
    refund_window_start = now - timedelta(days=7)
    refund_prev_start = refund_window_start - timedelta(days=7)
    refund_requests = await session.scalar(
        select(func.count())
        .select_from(ReturnRequest)
        .where(
            ReturnRequest.status == ReturnRequestStatus.requested,
            ReturnRequest.created_at >= refund_window_start,
            ReturnRequest.created_at < refund_window_end,
        )
    )
    refund_requests_prev = await session.scalar(
        select(func.count())
        .select_from(ReturnRequest)
        .where(
            ReturnRequest.status == ReturnRequestStatus.requested,
            ReturnRequest.created_at >= refund_prev_start,
            ReturnRequest.created_at < refund_window_start,
        )
    )

    stockouts = await session.scalar(
        select(func.count())
        .select_from(Product)
        .where(Product.stock_quantity <= 0, Product.is_deleted.is_(False), Product.is_active.is_(True))
    )

    def _delta_pct(today_value: float, yesterday_value: float) -> float | None:
        if yesterday_value == 0:
            return None
        return (today_value - yesterday_value) / yesterday_value * 100.0

    return {
        "products": products_total or 0,
        "orders": orders_total or 0,
        "users": users_total or 0,
        "low_stock": low_stock or 0,
        "sales_30d": float(sales_30d or 0),
        "orders_30d": orders_30d or 0,
        "sales_range": float(sales_range or 0),
        "orders_range": int(orders_range or 0),
        "range_days": int(effective_range_days),
        "range_from": start.date().isoformat(),
        "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
        "today_orders": int(today_orders or 0),
        "yesterday_orders": int(yesterday_orders or 0),
        "orders_delta_pct": _delta_pct(float(today_orders or 0), float(yesterday_orders or 0)),
        "today_sales": float(today_sales or 0),
        "yesterday_sales": float(yesterday_sales or 0),
        "sales_delta_pct": _delta_pct(float(today_sales or 0), float(yesterday_sales or 0)),
        "today_refunds": int(today_refunds or 0),
        "yesterday_refunds": int(yesterday_refunds or 0),
        "refunds_delta_pct": _delta_pct(float(today_refunds or 0), float(yesterday_refunds or 0)),
        "anomalies": {
            "failed_payments": {
                "window_hours": 24,
                "current": int(failed_payments or 0),
                "previous": int(failed_payments_prev or 0),
                "delta_pct": _delta_pct(float(failed_payments or 0), float(failed_payments_prev or 0)),
            },
            "refund_requests": {
                "window_days": 7,
                "current": int(refund_requests or 0),
                "previous": int(refund_requests_prev or 0),
                "delta_pct": _delta_pct(float(refund_requests or 0), float(refund_requests_prev or 0)),
            },
            "stockouts": {"count": int(stockouts or 0)},
        },
        "system": {"db_ready": True, "backup_last_at": settings.backup_last_at},
    }


@router.get("/products")
async def admin_products(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    stmt = (
        select(Product, Category.name)
        .join(Category, Product.category_id == Category.id)
        .where(Product.is_deleted.is_(False))
        .order_by(Product.updated_at.desc())
        .limit(20)
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {
            "id": str(prod.id),
            "slug": prod.slug,
            "name": prod.name,
            "price": float(prod.base_price),
            "currency": prod.currency,
            "status": prod.status,
            "category": cat_name,
            "stock_quantity": prod.stock_quantity,
        }
        for prod, cat_name in rows
    ]


@router.get("/products/search", response_model=AdminProductListResponse)
async def search_products(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
    q: str | None = Query(default=None),
    status: ProductStatus | None = Query(default=None),
    category_slug: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
) -> AdminProductListResponse:
    offset = (page - 1) * limit
    stmt = select(Product, Category).join(Category, Product.category_id == Category.id).where(Product.is_deleted.is_(False))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            Product.name.ilike(like)
            | Product.slug.ilike(like)
            | Product.sku.ilike(like)
        )
    if status is not None:
        stmt = stmt.where(Product.status == status)
    if category_slug:
        stmt = stmt.where(Category.slug == category_slug)

    total = await session.scalar(stmt.with_only_columns(func.count(func.distinct(Product.id))).order_by(None))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        await session.execute(
            stmt.order_by(Product.updated_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    items = [
        AdminProductListItem(
            id=prod.id,
            slug=prod.slug,
            sku=prod.sku,
            name=prod.name,
            base_price=float(prod.base_price),
            currency=prod.currency,
            status=prod.status,
            is_active=prod.is_active,
            is_featured=prod.is_featured,
            stock_quantity=prod.stock_quantity,
            category_slug=cat.slug,
            category_name=cat.name,
            updated_at=prod.updated_at,
            publish_at=prod.publish_at,
        )
        for prod, cat in rows
    ]
    return AdminProductListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


@router.post("/products/by-ids", response_model=list[AdminProductListItem])
async def products_by_ids(
    payload: AdminProductByIdsRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> list[AdminProductListItem]:
    ids = list(dict.fromkeys(payload.ids or []))
    if not ids:
        return []
    if len(ids) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many product ids (max 200)")

    stmt = (
        select(Product, Category)
        .join(Category, Product.category_id == Category.id)
        .where(Product.is_deleted.is_(False), Product.id.in_(ids))
        .order_by(Product.updated_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return [
        AdminProductListItem(
            id=prod.id,
            slug=prod.slug,
            sku=prod.sku,
            name=prod.name,
            base_price=prod.base_price,
            currency=prod.currency,
            status=prod.status,
            is_active=prod.is_active,
            is_featured=prod.is_featured,
            stock_quantity=prod.stock_quantity,
            category_slug=cat.slug,
            category_name=cat.name,
            updated_at=prod.updated_at,
            publish_at=prod.publish_at,
        )
        for prod, cat in rows
    ]


@router.get("/orders")
async def admin_orders(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    stmt = (
        select(Order, User.email)
        .join(User, Order.user_id == User.id, isouter=True)
        .order_by(Order.created_at.desc())
        .limit(20)
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {
            "id": str(order.id),
            "status": order.status,
            "total_amount": float(order.total_amount),
            "currency": order.currency,
            "created_at": order.created_at,
            "customer": email or "guest",
        }
        for order, email in rows
    ]


@router.get("/users")
async def admin_users(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    result = await session.execute(select(User).order_by(User.created_at.desc()).limit(20))
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "username": u.username,
            "name": u.name,
            "name_tag": u.name_tag,
            "role": u.role,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.get("/users/search", response_model=AdminUserListResponse)
async def search_users(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
    q: str | None = Query(default=None),
    role: UserRole | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
) -> AdminUserListResponse:
    offset = (page - 1) * limit
    stmt = select(User).where(User.deleted_at.is_(None))

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(User.email).ilike(like)
            | func.lower(User.username).ilike(like)
            | func.lower(User.name).ilike(like)
        )

    if role is not None:
        stmt = stmt.where(User.role == role)

    total = await session.scalar(stmt.with_only_columns(func.count(func.distinct(User.id))).order_by(None))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (await session.execute(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    items = [
        AdminUserListItem(
            id=u.id,
            email=u.email,
            username=u.username,
            name=u.name,
            name_tag=u.name_tag,
            role=u.role,
            email_verified=bool(u.email_verified),
            created_at=u.created_at,
        )
        for u in rows
    ]

    return AdminUserListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


@router.get("/users/{user_id}/aliases")
async def admin_user_aliases(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    usernames = await auth_service.list_username_history(session, user_id)
    display_names = await auth_service.list_display_name_history(session, user_id)
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "name": user.name,
            "name_tag": user.name_tag,
            "role": user.role,
        },
        "usernames": [{"username": row.username, "created_at": row.created_at} for row in usernames],
        "display_names": [
            {"name": row.name, "name_tag": row.name_tag, "created_at": row.created_at} for row in display_names
        ],
    }


@router.get("/content")
async def admin_content(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    result = await session.execute(select(ContentBlock).order_by(ContentBlock.updated_at.desc()).limit(20))
    blocks = result.scalars().all()
    return [
        {
            "id": str(b.id),
            "key": b.key,
            "title": b.title,
            "updated_at": b.updated_at,
            "version": b.version,
        }
        for b in blocks
    ]


async def _invalidate_stripe_coupon_mappings(session: AsyncSession, promo_id: UUID) -> int:
    total = await session.scalar(
        select(func.count()).select_from(StripeCouponMapping).where(StripeCouponMapping.promo_code_id == promo_id)
    )
    await session.execute(delete(StripeCouponMapping).where(StripeCouponMapping.promo_code_id == promo_id))
    return int(total or 0)


@router.get("/coupons")
async def admin_coupons(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    result = await session.execute(select(PromoCode).order_by(PromoCode.created_at.desc()).limit(20))
    promos = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "percentage_off": float(p.percentage_off) if p.percentage_off is not None else None,
            "amount_off": float(p.amount_off) if p.amount_off is not None else None,
            "currency": p.currency,
            "expires_at": p.expires_at,
            "active": p.active,
            "times_used": p.times_used,
            "max_uses": p.max_uses,
        }
        for p in promos
    ]


@router.post("/coupons/{coupon_id}/stripe/invalidate")
async def admin_invalidate_coupon_stripe(
    coupon_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    promo = await session.get(PromoCode, coupon_id)
    if not promo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    deleted = await _invalidate_stripe_coupon_mappings(session, promo.id)
    await session.commit()
    return {"deleted_mappings": deleted}


@router.post("/coupons", status_code=status.HTTP_201_CREATED)
async def admin_create_coupon(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    code = payload.get("code")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="code required")
    currency = payload.get("currency")
    if currency:
        currency = str(currency).strip().upper()
        if currency != "RON":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only RON currency is supported")
    promo = PromoCode(
        code=code,
        percentage_off=payload.get("percentage_off"),
        amount_off=payload.get("amount_off"),
        currency=currency or None,
        expires_at=payload.get("expires_at"),
        max_uses=payload.get("max_uses"),
        active=payload.get("active", True),
    )
    session.add(promo)
    await session.commit()
    return {
        "id": str(promo.id),
        "code": promo.code,
        "percentage_off": float(promo.percentage_off) if promo.percentage_off is not None else None,
        "amount_off": float(promo.amount_off) if promo.amount_off is not None else None,
        "currency": promo.currency,
        "expires_at": promo.expires_at,
        "active": promo.active,
        "times_used": promo.times_used,
        "max_uses": promo.max_uses,
    }


@router.patch("/coupons/{coupon_id}")
async def admin_update_coupon(
    coupon_id: UUID,
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    promo = await session.get(PromoCode, coupon_id)
    if not promo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    invalidate_stripe = any(field in payload for field in ["percentage_off", "amount_off", "currency", "active"])
    for field in ["percentage_off", "amount_off", "expires_at", "max_uses", "active", "code"]:
        if field in payload:
            setattr(promo, field, payload[field])
    if "currency" in payload:
        currency = payload.get("currency")
        if currency:
            currency = str(currency).strip().upper()
            if currency != "RON":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only RON currency is supported")
            promo.currency = currency
        else:
            promo.currency = None
    if invalidate_stripe:
        await _invalidate_stripe_coupon_mappings(session, promo.id)
    session.add(promo)
    await session.flush()
    await session.commit()
    return {
        "id": str(promo.id),
        "code": promo.code,
        "percentage_off": float(promo.percentage_off) if promo.percentage_off is not None else None,
        "amount_off": float(promo.amount_off) if promo.amount_off is not None else None,
        "currency": promo.currency,
        "expires_at": promo.expires_at,
        "active": promo.active,
        "times_used": promo.times_used,
        "max_uses": promo.max_uses,
    }


@router.get("/audit")
async def admin_audit(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> dict:
    product_audit_stmt = (
        select(ProductAuditLog)
        .options()
        .order_by(ProductAuditLog.created_at.desc())
        .limit(20)
    )
    content_audit_stmt = select(ContentAuditLog).order_by(ContentAuditLog.created_at.desc()).limit(20)
    actor = aliased(User)
    subject = aliased(User)
    security_audit_stmt = (
        select(AdminAuditLog, actor.email, subject.email)
        .join(actor, AdminAuditLog.actor_user_id == actor.id, isouter=True)
        .join(subject, AdminAuditLog.subject_user_id == subject.id, isouter=True)
        .order_by(AdminAuditLog.created_at.desc())
        .limit(20)
    )
    prod_logs = (await session.execute(product_audit_stmt)).scalars().all()
    content_logs = (await session.execute(content_audit_stmt)).scalars().all()
    security_rows = (await session.execute(security_audit_stmt)).all()
    return {
        "products": [
            {
                "id": str(log.id),
                "product_id": str(log.product_id),
                "action": log.action,
                "user_id": str(log.user_id) if log.user_id else None,
                "created_at": log.created_at,
            }
            for log in prod_logs
        ],
        "content": [
            {
                "id": str(log.id),
                "block_id": str(log.content_block_id),
                "action": log.action,
                "version": log.version,
                "user_id": str(log.user_id) if log.user_id else None,
                "created_at": log.created_at,
            }
            for log in content_logs
        ],
        "security": [
            {
                "id": str(log.id),
                "action": log.action,
                "actor_user_id": str(log.actor_user_id) if log.actor_user_id else None,
                "actor_email": actor_email,
                "subject_user_id": str(log.subject_user_id) if log.subject_user_id else None,
                "subject_email": subject_email,
                "data": log.data,
                "created_at": log.created_at,
            }
            for log, actor_email, subject_email in security_rows
        ],
    }


def _audit_union_subquery() -> object:
    prod_actor = aliased(User)
    prod = aliased(Product)
    products_q = (
        select(
            literal("product").label("entity"),
            cast(ProductAuditLog.id, String()).label("id"),
            ProductAuditLog.action.label("action"),
            ProductAuditLog.created_at.label("created_at"),
            cast(ProductAuditLog.user_id, String()).label("actor_user_id"),
            prod_actor.email.label("actor_email"),
            prod_actor.username.label("actor_username"),
            cast(literal(None), String()).label("subject_user_id"),
            cast(literal(None), String()).label("subject_email"),
            cast(literal(None), String()).label("subject_username"),
            cast(ProductAuditLog.product_id, String()).label("ref_id"),
            prod.slug.label("ref_key"),
            cast(ProductAuditLog.payload, Text()).label("data"),
        )
        .select_from(ProductAuditLog)
        .join(prod_actor, ProductAuditLog.user_id == prod_actor.id, isouter=True)
        .join(prod, ProductAuditLog.product_id == prod.id, isouter=True)
    )

    content_actor = aliased(User)
    block = aliased(ContentBlock)
    content_q = (
        select(
            literal("content").label("entity"),
            cast(ContentAuditLog.id, String()).label("id"),
            ContentAuditLog.action.label("action"),
            ContentAuditLog.created_at.label("created_at"),
            cast(ContentAuditLog.user_id, String()).label("actor_user_id"),
            content_actor.email.label("actor_email"),
            content_actor.username.label("actor_username"),
            cast(literal(None), String()).label("subject_user_id"),
            cast(literal(None), String()).label("subject_email"),
            cast(literal(None), String()).label("subject_username"),
            cast(ContentAuditLog.content_block_id, String()).label("ref_id"),
            block.key.label("ref_key"),
            cast(literal(None), Text()).label("data"),
        )
        .select_from(ContentAuditLog)
        .join(content_actor, ContentAuditLog.user_id == content_actor.id, isouter=True)
        .join(block, ContentAuditLog.content_block_id == block.id, isouter=True)
    )

    actor = aliased(User)
    subject = aliased(User)
    security_q = (
        select(
            literal("security").label("entity"),
            cast(AdminAuditLog.id, String()).label("id"),
            AdminAuditLog.action.label("action"),
            AdminAuditLog.created_at.label("created_at"),
            cast(AdminAuditLog.actor_user_id, String()).label("actor_user_id"),
            actor.email.label("actor_email"),
            actor.username.label("actor_username"),
            cast(AdminAuditLog.subject_user_id, String()).label("subject_user_id"),
            subject.email.label("subject_email"),
            subject.username.label("subject_username"),
            cast(literal(None), String()).label("ref_id"),
            cast(literal(None), String()).label("ref_key"),
            cast(AdminAuditLog.data, Text()).label("data"),
        )
        .select_from(AdminAuditLog)
        .join(actor, AdminAuditLog.actor_user_id == actor.id, isouter=True)
        .join(subject, AdminAuditLog.subject_user_id == subject.id, isouter=True)
    )

    return union_all(products_q, content_q, security_q).subquery()


def _audit_filters(
    audit: object,
    *,
    entity: str | None,
    action: str | None,
    user: str | None,
) -> list:
    filters: list = []

    if entity:
        normalized = entity.strip().lower()
        if normalized and normalized != "all":
            filters.append(getattr(audit.c, "entity") == normalized)  # type: ignore[attr-defined]

    if action:
        needle = action.strip().lower()
        if needle:
            filters.append(func.lower(getattr(audit.c, "action")).like(f"%{needle}%"))  # type: ignore[attr-defined]

    if user:
        needle = user.strip().lower()
        if needle:
            actor_email = func.lower(func.coalesce(getattr(audit.c, "actor_email"), ""))  # type: ignore[attr-defined]
            actor_username = func.lower(func.coalesce(getattr(audit.c, "actor_username"), ""))  # type: ignore[attr-defined]
            subject_email = func.lower(func.coalesce(getattr(audit.c, "subject_email"), ""))  # type: ignore[attr-defined]
            subject_username = func.lower(func.coalesce(getattr(audit.c, "subject_username"), ""))  # type: ignore[attr-defined]
            actor_user_id = func.lower(func.coalesce(getattr(audit.c, "actor_user_id"), ""))  # type: ignore[attr-defined]
            subject_user_id = func.lower(func.coalesce(getattr(audit.c, "subject_user_id"), ""))  # type: ignore[attr-defined]
            filters.append(
                or_(
                    actor_email.like(f"%{needle}%"),
                    actor_username.like(f"%{needle}%"),
                    subject_email.like(f"%{needle}%"),
                    subject_username.like(f"%{needle}%"),
                    actor_user_id.like(f"%{needle}%"),
                    subject_user_id.like(f"%{needle}%"),
                )
            )

    return filters


@router.get("/audit/entries")
async def admin_audit_entries(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
    entity: str | None = Query(default="all", pattern="^(all|product|content|security)$"),
    action: str | None = Query(default=None, max_length=120),
    user: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    audit = _audit_union_subquery()
    filters = _audit_filters(audit, entity=entity, action=action, user=user)
    total = await session.scalar(select(func.count()).select_from(audit).where(*filters))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    offset = (page - 1) * limit
    q = select(audit).where(*filters).order_by(getattr(audit.c, "created_at").desc()).offset(offset).limit(limit)  # type: ignore[attr-defined]
    rows = (await session.execute(q)).mappings().all()
    items = [
        {
            "entity": row.get("entity"),
            "id": row.get("id"),
            "action": row.get("action"),
            "created_at": row.get("created_at"),
            "actor_user_id": row.get("actor_user_id"),
            "actor_email": row.get("actor_email"),
            "subject_user_id": row.get("subject_user_id"),
            "subject_email": row.get("subject_email"),
            "ref_id": row.get("ref_id"),
            "ref_key": row.get("ref_key"),
            "data": row.get("data"),
        }
        for row in rows
    ]

    return {
        "items": items,
        "meta": {
            "page": page,
            "limit": limit,
            "total_items": total_items,
            "total_pages": total_pages,
        },
    }


@router.get("/audit/export.csv")
async def admin_audit_export_csv(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
    entity: str | None = Query(default="all", pattern="^(all|product|content|security)$"),
    action: str | None = Query(default=None, max_length=120),
    user: str | None = Query(default=None, max_length=255),
) -> Response:
    audit = _audit_union_subquery()
    filters = _audit_filters(audit, entity=entity, action=action, user=user)

    q = select(audit).where(*filters).order_by(getattr(audit.c, "created_at").desc()).limit(5000)  # type: ignore[attr-defined]
    rows = (await session.execute(q)).mappings().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "created_at",
            "entity",
            "action",
            "actor_email",
            "subject_email",
            "ref_key",
            "ref_id",
            "actor_user_id",
            "subject_user_id",
            "data",
        ]
    )
    for row in rows:
        created_at = row.get("created_at")
        writer.writerow(
            [
                created_at.isoformat() if isinstance(created_at, datetime) else "",
                row.get("entity") or "",
                row.get("action") or "",
                row.get("actor_email") or "",
                row.get("subject_email") or "",
                row.get("ref_key") or "",
                row.get("ref_id") or "",
                row.get("actor_user_id") or "",
                row.get("subject_user_id") or "",
                (row.get("data") or "").replace("\n", " ").replace("\r", " "),
            ]
        )

    filename = f"audit-{(entity or 'all').strip().lower()}-{datetime.now(timezone.utc).date().isoformat()}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.post("/sessions/{user_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_sessions(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    result = await session.execute(select(RefreshSession).where(RefreshSession.user_id == user_id, RefreshSession.revoked.is_(False)))
    sessions = result.scalars().all()
    for s in sessions:
        s.revoked = True
        s.revoked_reason = "admin-forced"
    if sessions:
        session.add_all(sessions)
        await session.commit()
    return None


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: UUID,
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner role can only be transferred")
    role = payload.get("role")
    if role not in (UserRole.admin.value, UserRole.customer.value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    user.role = UserRole(role)
    session.add(user)
    await session.flush()
    await session.commit()
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "name": user.name,
        "name_tag": user.name_tag,
        "role": user.role,
        "created_at": user.created_at,
    }


@router.post("/owner/transfer")
async def transfer_owner(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    current_owner: User = Depends(require_owner),
) -> dict:
    identifier = str(payload.get("identifier") or "").strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier is required")

    confirm = str(payload.get("confirm") or "").strip()
    if confirm.upper() != "TRANSFER":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Type "TRANSFER" to confirm')

    password = str(payload.get("password") or "")
    if not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required")
    if not security.verify_password(password, current_owner.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

    if "@" in identifier:
        target = await auth_service.get_user_by_any_email(session, identifier)
    else:
        target = await auth_service.get_user_by_username(session, identifier)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.id == current_owner.id:
        return {"old_owner_id": str(current_owner.id), "new_owner_id": str(target.id)}

    current_owner.role = UserRole.admin
    session.add(current_owner)
    await session.flush()

    target.role = UserRole.owner
    session.add(target)
    session.add(
        AdminAuditLog(
            action="owner_transfer",
            actor_user_id=current_owner.id,
            subject_user_id=target.id,
            data={"identifier": identifier, "old_owner_id": str(current_owner.id), "new_owner_id": str(target.id)},
        )
    )
    await session.commit()
    await session.refresh(target)

    return {
        "old_owner_id": str(current_owner.id),
        "new_owner_id": str(target.id),
        "email": target.email,
        "username": target.username,
        "name": target.name,
        "name_tag": target.name_tag,
        "role": target.role,
    }


@router.get("/maintenance")
async def get_maintenance(_: str = Depends(require_admin)) -> dict:
    return {"enabled": settings.maintenance_mode}


@router.post("/maintenance")
async def set_maintenance(payload: dict, _: str = Depends(require_admin)) -> dict:
    enabled = bool(payload.get("enabled", False))
    settings.maintenance_mode = enabled
    return {"enabled": settings.maintenance_mode}


@router.get("/export")
async def export_data(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> dict:
    return await exporter_service.export_json(session)


@router.get("/low-stock")
async def low_stock_products(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    stmt = (
        select(Product)
        .where(Product.stock_quantity < 5, Product.is_deleted.is_(False), Product.is_active.is_(True))
        .order_by(Product.stock_quantity.asc())
        .limit(20)
    )
    products = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "stock_quantity": p.stock_quantity,
            "sku": p.sku,
            "slug": p.slug,
        }
        for p in products
    ]
