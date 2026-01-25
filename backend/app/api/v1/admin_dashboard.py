import csv
import io
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import (
    String,
    Text,
    case,
    cast,
    delete,
    exists,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.dependencies import require_admin, require_admin_section, require_owner
from app.db.session import get_session
from app.models.catalog import Product, ProductAuditLog, Category, ProductStatus, ProductTranslation
from app.models.content import ContentBlock, ContentAuditLog
from app.schemas.catalog_admin import (
    AdminProductByIdsRequest,
    AdminProductDuplicateCheckResponse,
    AdminProductDuplicateMatch,
    AdminProductListItem,
    AdminProductListResponse,
)
from app.schemas.catalog import StockAdjustmentCreate, StockAdjustmentRead
from app.schemas.admin_dashboard_search import (
    AdminDashboardSearchResponse,
    AdminDashboardSearchResult,
)
from app.schemas.admin_dashboard_scheduled import (
    AdminDashboardScheduledTasksResponse,
    ScheduledPublishItem,
    ScheduledPromoItem,
)
from app.schemas.auth import RefreshSessionResponse
from app.schemas.inventory import (
    RestockListResponse,
    RestockNoteRead,
    RestockNoteUpsert,
)
from app.services import exporter as exporter_service
from app.services import inventory as inventory_service
from app.services import catalog as catalog_service
from app.models.address import Address
from app.models.order import Order, OrderStatus
from app.models.returns import ReturnRequest, ReturnRequestStatus
from app.models.support import ContactSubmission
from app.models.user import AdminAuditLog, EmailVerificationToken, User, RefreshSession, UserRole, UserSecurityEvent
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.coupons_v2 import Promotion
from app.models.user_export import UserDataExportJob, UserDataExportStatus
from app.services import auth as auth_service
from app.services import email as email_service
from app.services import private_storage
from app.services import user_export as user_export_service
from app.services import self_service
from app.schemas.user_admin import (
    AdminEmailVerificationHistoryResponse,
    AdminEmailVerificationTokenInfo,
    AdminUserImpersonationResponse,
    AdminUserInternalUpdate,
    AdminUserSecurityUpdate,
    AdminUserListItem,
    AdminUserListResponse,
    AdminUserProfileResponse,
    AdminUserProfileUser,
)
from app.schemas.gdpr_admin import (
    AdminGdprDeletionRequestItem,
    AdminGdprDeletionRequestsResponse,
    AdminGdprExportJobItem,
    AdminGdprExportJobsResponse,
    AdminGdprUserRef,
)

router = APIRouter(prefix="/admin/dashboard", tags=["admin"])

DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD = 5


@router.get("/summary")
async def admin_summary(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> dict:
    now = datetime.now(timezone.utc)

    if (range_from is None) != (range_to is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="range_from and range_to must be provided together",
        )

    if range_from is not None and range_to is not None:
        if range_to < range_from:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="range_to must be on/after range_from",
            )
        start = datetime.combine(range_from, datetime.min.time(), tzinfo=timezone.utc)
        end = datetime.combine(
            range_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
        )
        effective_range_days = (range_to - range_from).days + 1
    else:
        start = now - timedelta(days=range_days)
        end = now
        effective_range_days = range_days

    products_total = await session.scalar(
        select(func.count()).select_from(Product).where(Product.is_deleted.is_(False))
    )
    orders_total = await session.scalar(select(func.count()).select_from(Order))
    users_total = await session.scalar(select(func.count()).select_from(User))

    low_stock_threshold = func.coalesce(
        Product.low_stock_threshold,
        Category.low_stock_threshold,
        DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD,
    )
    low_stock = await session.scalar(
        select(func.count())
        .select_from(Product)
        .join(Category, Product.category_id == Category.id)
        .where(
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
            Product.stock_quantity < low_stock_threshold,
        )
    )

    since = now - timedelta(days=30)
    sales_30d = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= since
        )
    )
    orders_30d = await session.scalar(
        select(func.count()).select_from(Order).where(Order.created_at >= since)
    )

    sales_range = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= start, Order.created_at < end
        )
    )
    orders_range = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= start, Order.created_at < end)
    )

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    today_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= today_start, Order.created_at < now)
    )
    yesterday_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= yesterday_start, Order.created_at < today_start)
    )
    today_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= today_start, Order.created_at < now
        )
    )
    yesterday_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= yesterday_start, Order.created_at < today_start
        )
    )
    today_refunds = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.refunded,
            Order.updated_at >= today_start,
            Order.updated_at < now,
        )
    )
    yesterday_refunds = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.refunded,
            Order.updated_at >= yesterday_start,
            Order.updated_at < today_start,
        )
    )

    payment_window_end = now
    payment_window_start = now - timedelta(hours=24)
    payment_prev_start = payment_window_start - timedelta(hours=24)
    failed_payments = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.pending_payment,
            Order.created_at >= payment_window_start,
            Order.created_at < payment_window_end,
        )
    )
    failed_payments_prev = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.pending_payment,
            Order.created_at >= payment_prev_start,
            Order.created_at < payment_window_start,
        )
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
        .where(
            Product.stock_quantity <= 0,
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
        )
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
        "orders_delta_pct": _delta_pct(
            float(today_orders or 0), float(yesterday_orders or 0)
        ),
        "today_sales": float(today_sales or 0),
        "yesterday_sales": float(yesterday_sales or 0),
        "sales_delta_pct": _delta_pct(
            float(today_sales or 0), float(yesterday_sales or 0)
        ),
        "today_refunds": int(today_refunds or 0),
        "yesterday_refunds": int(yesterday_refunds or 0),
        "refunds_delta_pct": _delta_pct(
            float(today_refunds or 0), float(yesterday_refunds or 0)
        ),
        "anomalies": {
            "failed_payments": {
                "window_hours": 24,
                "current": int(failed_payments or 0),
                "previous": int(failed_payments_prev or 0),
                "delta_pct": _delta_pct(
                    float(failed_payments or 0), float(failed_payments_prev or 0)
                ),
            },
            "refund_requests": {
                "window_days": 7,
                "current": int(refund_requests or 0),
                "previous": int(refund_requests_prev or 0),
                "delta_pct": _delta_pct(
                    float(refund_requests or 0), float(refund_requests_prev or 0)
                ),
            },
            "stockouts": {"count": int(stockouts or 0)},
        },
        "system": {"db_ready": True, "backup_last_at": settings.backup_last_at},
    }


@router.get("/search", response_model=AdminDashboardSearchResponse)
async def admin_global_search(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    q: str = Query(..., min_length=1, max_length=255),
) -> AdminDashboardSearchResponse:
    needle = (q or "").strip()
    if not needle:
        return AdminDashboardSearchResponse(items=[])

    parsed_uuid: UUID | None = None
    try:
        parsed_uuid = UUID(needle)
    except ValueError:
        parsed_uuid = None

    results: list[AdminDashboardSearchResult] = []

    if parsed_uuid is not None:
        order = await session.get(Order, parsed_uuid)
        if order:
            results.append(
                AdminDashboardSearchResult(
                    type="order",
                    id=str(order.id),
                    label=(order.reference_code or str(order.id)),
                    subtitle=(order.customer_email or "").strip() or None,
                )
            )

        product = await session.get(Product, parsed_uuid)
        if product and not product.is_deleted:
            results.append(
                AdminDashboardSearchResult(
                    type="product",
                    id=str(product.id),
                    slug=product.slug,
                    label=product.name,
                    subtitle=product.slug,
                )
            )

        user = await session.get(User, parsed_uuid)
        if user and user.deleted_at is None:
            subtitle = (user.username or "").strip() or None
            results.append(
                AdminDashboardSearchResult(
                    type="user",
                    id=str(user.id),
                    email=user.email,
                    label=user.email,
                    subtitle=subtitle,
                )
            )

        return AdminDashboardSearchResponse(items=results)

    like = f"%{needle.lower()}%"

    orders = (
        (
            await session.execute(
                select(Order)
                .where(
                    or_(
                        func.lower(Order.customer_email).ilike(like),
                        func.lower(func.coalesce(Order.reference_code, "")).ilike(like),
                    )
                )
                .order_by(Order.created_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    for order in orders:
        results.append(
            AdminDashboardSearchResult(
                type="order",
                id=str(order.id),
                label=(order.reference_code or str(order.id)),
                subtitle=(order.customer_email or "").strip() or None,
            )
        )

    products = (
        (
            await session.execute(
                select(Product)
                .where(
                    Product.is_deleted.is_(False),
                    or_(
                        Product.slug.ilike(like),
                        Product.name.ilike(like),
                        Product.sku.ilike(like),
                    ),
                )
                .order_by(Product.updated_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    for product in products:
        results.append(
            AdminDashboardSearchResult(
                type="product",
                id=str(product.id),
                slug=product.slug,
                label=product.name,
                subtitle=product.slug,
            )
        )

    users = (
        (
            await session.execute(
                select(User)
                .where(
                    User.deleted_at.is_(None),
                    or_(
                        func.lower(User.email).ilike(like),
                        func.lower(User.username).ilike(like),
                        func.lower(User.name).ilike(like),
                    ),
                )
                .order_by(User.created_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    for user in users:
        subtitle = (user.username or "").strip() or None
        results.append(
            AdminDashboardSearchResult(
                type="user",
                id=str(user.id),
                email=user.email,
                label=user.email,
                subtitle=subtitle,
            )
        )

    return AdminDashboardSearchResponse(items=results)


@router.get("/products")
async def admin_products(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("products")),
) -> list[dict]:
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
    _: User = Depends(require_admin_section("products")),
    q: str | None = Query(default=None),
    status: ProductStatus | None = Query(default=None),
    category_slug: str | None = Query(default=None),
    missing_translations: bool = Query(default=False),
    missing_translation_lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    deleted: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
) -> AdminProductListResponse:
    offset = (page - 1) * limit
    stmt = (
        select(Product, Category)
        .join(Category, Product.category_id == Category.id)
        .where(Product.is_deleted.is_(deleted))
    )
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
    missing_lang = (missing_translation_lang or "").strip().lower() or None
    if missing_lang:
        has_lang = exists().where(ProductTranslation.product_id == Product.id, ProductTranslation.lang == missing_lang)
        stmt = stmt.where(~has_lang)
    elif missing_translations:
        has_en = exists().where(ProductTranslation.product_id == Product.id, ProductTranslation.lang == "en")
        has_ro = exists().where(ProductTranslation.product_id == Product.id, ProductTranslation.lang == "ro")
        stmt = stmt.where(or_(~has_en, ~has_ro))

    total = await session.scalar(
        stmt.with_only_columns(func.count(func.distinct(Product.id))).order_by(None)
    )
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        await session.execute(
            stmt.order_by(Product.updated_at.desc()).limit(limit).offset(offset)
        )
    ).all()

    langs_by_product: dict[UUID, set[str]] = {}
    product_ids = [prod.id for prod, _ in rows]
    if product_ids:
        translation_rows = (
            await session.execute(
                select(ProductTranslation.product_id, ProductTranslation.lang).where(
                    ProductTranslation.product_id.in_(product_ids),
                    ProductTranslation.lang.in_(["en", "ro"]),
                )
            )
        ).all()
        for pid, lang in translation_rows:
            if not pid or not lang:
                continue
            langs_by_product.setdefault(pid, set()).add(str(lang))

    items = [
        AdminProductListItem(
            id=prod.id,
            slug=prod.slug,
            deleted_slug=getattr(prod, "deleted_slug", None),
            sku=prod.sku,
            name=prod.name,
            base_price=float(prod.base_price),
            sale_type=prod.sale_type,
            sale_value=float(prod.sale_value) if prod.sale_value is not None else None,
            currency=prod.currency,
            status=prod.status,
            is_active=prod.is_active,
            is_featured=prod.is_featured,
            stock_quantity=prod.stock_quantity,
            category_slug=cat.slug,
            category_name=cat.name,
            updated_at=prod.updated_at,
            deleted_at=getattr(prod, "deleted_at", None),
            publish_at=prod.publish_at,
            publish_scheduled_for=getattr(prod, "publish_scheduled_for", None),
            unpublish_scheduled_for=getattr(prod, "unpublish_scheduled_for", None),
            missing_translations=[
                lang for lang in ["en", "ro"] if lang not in langs_by_product.get(prod.id, set())
            ],
        )
        for prod, cat in rows
    ]
    return AdminProductListResponse(
        items=items,
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


@router.post("/products/{product_id}/restore", response_model=AdminProductListItem)
async def restore_product(
    product_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("products")),
) -> AdminProductListItem:
    product = await session.get(Product, product_id)
    if not product or not getattr(product, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.restore_soft_deleted_product(session, product, user_id=current_user.id)
    row = (
        await session.execute(
            select(Product, Category)
            .join(Category, Product.category_id == Category.id)
            .where(Product.id == product_id)
        )
    ).one()
    prod, cat = row
    return AdminProductListItem(
        id=prod.id,
        slug=prod.slug,
        deleted_slug=getattr(prod, "deleted_slug", None),
        sku=prod.sku,
        name=prod.name,
        base_price=float(prod.base_price),
        sale_type=prod.sale_type,
        sale_value=float(prod.sale_value) if prod.sale_value is not None else None,
        currency=prod.currency,
        status=prod.status,
        is_active=prod.is_active,
        is_featured=prod.is_featured,
        stock_quantity=prod.stock_quantity,
        category_slug=cat.slug,
        category_name=cat.name,
        updated_at=prod.updated_at,
        deleted_at=getattr(prod, "deleted_at", None),
        publish_at=prod.publish_at,
        publish_scheduled_for=getattr(prod, "publish_scheduled_for", None),
        unpublish_scheduled_for=getattr(prod, "unpublish_scheduled_for", None),
    )


@router.get("/products/duplicate-check", response_model=AdminProductDuplicateCheckResponse)
async def duplicate_check_products(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("products")),
    name: str | None = Query(default=None),
    sku: str | None = Query(default=None),
    exclude_slug: str | None = Query(default=None),
) -> AdminProductDuplicateCheckResponse:
    name_value = (name or "").strip()
    sku_value = (sku or "").strip()
    exclude_slug_value = (exclude_slug or "").strip()

    def to_match(product: Product) -> AdminProductDuplicateMatch:
        return AdminProductDuplicateMatch(
            id=product.id,
            slug=product.slug,
            sku=product.sku,
            name=product.name,
            status=product.status,
            is_active=product.is_active,
        )

    slug_base = (catalog_service.slugify(name_value) or "")[:160] if name_value else None
    slug_matches: list[AdminProductDuplicateMatch] = []
    suggested_slug: str | None = None

    if slug_base:
        slug_stmt = select(Product).where(
            Product.is_deleted.is_(False),
            or_(Product.slug == slug_base, Product.slug.like(f"{slug_base}-%")),
        )
        if exclude_slug_value:
            slug_stmt = slug_stmt.where(Product.slug != exclude_slug_value)

        slug_rows = (await session.execute(slug_stmt.order_by(Product.updated_at.desc()).limit(10))).scalars().all()
        slug_matches = [to_match(prod) for prod in slug_rows]

        slug_values = set(
            await session.scalars(
                select(Product.slug).where(
                    Product.is_deleted.is_(False),
                    or_(Product.slug == slug_base, Product.slug.like(f"{slug_base}-%")),
                )
            )
        )
        if exclude_slug_value:
            slug_values.discard(exclude_slug_value)

        if slug_base not in slug_values:
            suggested_slug = slug_base
        else:
            counter = 2
            while True:
                suffix = f"-{counter}"
                candidate = f"{slug_base[: 160 - len(suffix)]}{suffix}"
                if candidate not in slug_values:
                    suggested_slug = candidate
                    break
                counter += 1

    sku_matches: list[AdminProductDuplicateMatch] = []
    if sku_value:
        sku_stmt = select(Product).where(Product.is_deleted.is_(False), Product.sku == sku_value)
        if exclude_slug_value:
            sku_stmt = sku_stmt.where(Product.slug != exclude_slug_value)
        sku_rows = (await session.execute(sku_stmt.order_by(Product.updated_at.desc()).limit(10))).scalars().all()
        sku_matches = [to_match(prod) for prod in sku_rows]

    name_matches: list[AdminProductDuplicateMatch] = []
    if name_value:
        name_norm = name_value.lower()
        name_stmt = select(Product).where(
            Product.is_deleted.is_(False),
            func.lower(Product.name) == name_norm,
        )
        if exclude_slug_value:
            name_stmt = name_stmt.where(Product.slug != exclude_slug_value)
        name_rows = (await session.execute(name_stmt.order_by(Product.updated_at.desc()).limit(10))).scalars().all()
        name_matches = [to_match(prod) for prod in name_rows]

    return AdminProductDuplicateCheckResponse(
        slug_base=slug_base,
        suggested_slug=suggested_slug,
        slug_matches=slug_matches,
        sku_matches=sku_matches,
        name_matches=name_matches,
    )


@router.post("/products/by-ids", response_model=list[AdminProductListItem])
async def products_by_ids(
    payload: AdminProductByIdsRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("products")),
) -> list[AdminProductListItem]:
    ids = list(dict.fromkeys(payload.ids or []))
    if not ids:
        return []
    if len(ids) > 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many product ids (max 200)",
        )

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
            base_price=float(prod.base_price),
            sale_type=prod.sale_type,
            sale_value=float(prod.sale_value) if prod.sale_value is not None else None,
            currency=prod.currency,
            status=prod.status,
            is_active=prod.is_active,
            is_featured=prod.is_featured,
            stock_quantity=prod.stock_quantity,
            category_slug=cat.slug,
            category_name=cat.name,
            updated_at=prod.updated_at,
            publish_at=prod.publish_at,
            publish_scheduled_for=getattr(prod, "publish_scheduled_for", None),
            unpublish_scheduled_for=getattr(prod, "unpublish_scheduled_for", None),
        )
        for prod, cat in rows
    ]


@router.get("/orders")
async def admin_orders(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
) -> list[dict]:
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
async def admin_users(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
) -> list[dict]:
    result = await session.execute(
        select(User).order_by(User.created_at.desc()).limit(20)
    )
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
    _: User = Depends(require_admin_section("users")),
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

    total = await session.scalar(
        stmt.with_only_columns(func.count(func.distinct(User.id))).order_by(None)
    )
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        (
            await session.execute(
                stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
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
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


@router.get("/users/{user_id}/aliases")
async def admin_user_aliases(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("users")),
) -> dict:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
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
        "usernames": [
            {"username": row.username, "created_at": row.created_at}
            for row in usernames
        ],
        "display_names": [
            {"name": row.name, "name_tag": row.name_tag, "created_at": row.created_at}
            for row in display_names
        ],
    }


@router.get("/users/{user_id}/profile", response_model=AdminUserProfileResponse)
async def admin_user_profile(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("users")),
) -> AdminUserProfileResponse:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    addresses = (
        (await session.execute(select(Address).where(Address.user_id == user_id).order_by(Address.created_at.desc())))
        .scalars()
        .all()
    )
    orders = (
        (
            await session.execute(
                select(Order).where(Order.user_id == user_id).order_by(Order.created_at.desc()).limit(25)
            )
        )
        .scalars()
        .all()
    )
    tickets = (
        (
            await session.execute(
                select(ContactSubmission)
                .where(ContactSubmission.user_id == user_id)
                .order_by(ContactSubmission.created_at.desc())
                .limit(25)
            )
        )
        .scalars()
        .all()
    )
    security_events = (
        (
            await session.execute(
                select(UserSecurityEvent)
                .where(UserSecurityEvent.user_id == user_id)
                .order_by(UserSecurityEvent.created_at.desc())
                .limit(25)
            )
        )
        .scalars()
        .all()
    )

    return AdminUserProfileResponse(
        user=AdminUserProfileUser(
            id=user.id,
            email=user.email,
            username=user.username,
            name=user.name,
            name_tag=user.name_tag,
            role=user.role,
            email_verified=bool(user.email_verified),
            created_at=user.created_at,
            vip=bool(getattr(user, "vip", False)),
            admin_note=getattr(user, "admin_note", None),
            locked_until=getattr(user, "locked_until", None),
            locked_reason=getattr(user, "locked_reason", None),
            password_reset_required=bool(getattr(user, "password_reset_required", False)),
        ),
        addresses=addresses,
        orders=orders,
        tickets=tickets,
        security_events=security_events,
    )


@router.get("/content")
async def admin_content(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> list[dict]:
    result = await session.execute(
        select(ContentBlock).order_by(ContentBlock.updated_at.desc()).limit(20)
    )
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


async def _invalidate_stripe_coupon_mappings(
    session: AsyncSession, promo_id: UUID
) -> int:
    total = await session.scalar(
        select(func.count())
        .select_from(StripeCouponMapping)
        .where(StripeCouponMapping.promo_code_id == promo_id)
    )
    await session.execute(
        delete(StripeCouponMapping).where(StripeCouponMapping.promo_code_id == promo_id)
    )
    return int(total or 0)


@router.get("/coupons")
async def admin_coupons(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> list[dict]:
    result = await session.execute(
        select(PromoCode).order_by(PromoCode.created_at.desc()).limit(20)
    )
    promos = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "percentage_off": float(p.percentage_off)
            if p.percentage_off is not None
            else None,
            "amount_off": float(p.amount_off) if p.amount_off is not None else None,
            "currency": p.currency,
            "expires_at": p.expires_at,
            "active": p.active,
            "times_used": p.times_used,
            "max_uses": p.max_uses,
        }
        for p in promos
    ]


@router.get("/scheduled-tasks", response_model=AdminDashboardScheduledTasksResponse)
async def scheduled_tasks_overview(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    limit: int = Query(default=10, ge=1, le=50),
) -> AdminDashboardScheduledTasksResponse:
    now = datetime.now(timezone.utc)

    publish_stmt = (
        select(
            Product.id,
            Product.slug,
            Product.name,
            Product.sale_start_at,
            Product.sale_end_at,
        )
        .where(
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
            Product.status == ProductStatus.draft,
            Product.sale_auto_publish.is_(True),
            Product.sale_start_at.is_not(None),
            Product.sale_start_at > now,
        )
        .order_by(Product.sale_start_at.asc())
        .limit(limit)
    )
    publish_rows = (await session.execute(publish_stmt)).all()
    publish_items = [
        ScheduledPublishItem(
            id=str(row.id),
            slug=row.slug,
            name=row.name,
            scheduled_for=row.sale_start_at,
            sale_end_at=row.sale_end_at,
        )
        for row in publish_rows
    ]

    promo_next_at = case(
        (
            Promotion.starts_at.is_not(None) & (Promotion.starts_at > now),
            Promotion.starts_at,
        ),
        else_=Promotion.ends_at,
    ).label("next_event_at")
    promo_next_type = case(
        (
            Promotion.starts_at.is_not(None) & (Promotion.starts_at > now),
            literal("starts_at"),
        ),
        else_=literal("ends_at"),
    ).label("next_event_type")
    promo_stmt = (
        select(
            Promotion.id,
            Promotion.name,
            Promotion.starts_at,
            Promotion.ends_at,
            promo_next_at,
            promo_next_type,
        )
        .where(
            Promotion.is_active.is_(True),
            or_(Promotion.starts_at > now, Promotion.ends_at > now),
        )
        .order_by(promo_next_at.asc())
        .limit(limit)
    )
    promo_rows = (await session.execute(promo_stmt)).all()
    promo_items = [
        ScheduledPromoItem(
            id=str(row.id),
            name=row.name,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            next_event_at=row.next_event_at,
            next_event_type=row.next_event_type,
        )
        for row in promo_rows
        if row.next_event_at is not None
    ]

    return AdminDashboardScheduledTasksResponse(
        publish_schedules=publish_items, promo_schedules=promo_items
    )


@router.post("/coupons/{coupon_id}/stripe/invalidate")
async def admin_invalidate_coupon_stripe(
    coupon_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> dict:
    promo = await session.get(PromoCode, coupon_id)
    if not promo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found"
        )
    deleted = await _invalidate_stripe_coupon_mappings(session, promo.id)
    await session.commit()
    return {"deleted_mappings": deleted}


@router.post("/coupons", status_code=status.HTTP_201_CREATED)
async def admin_create_coupon(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("coupons")),
) -> dict:
    code = payload.get("code")
    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="code required"
        )
    currency = payload.get("currency")
    if currency:
        currency = str(currency).strip().upper()
        if currency != "RON":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only RON currency is supported",
            )
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
        "percentage_off": float(promo.percentage_off)
        if promo.percentage_off is not None
        else None,
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
    _: User = Depends(require_admin_section("coupons")),
) -> dict:
    promo = await session.get(PromoCode, coupon_id)
    if not promo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found"
        )
    invalidate_stripe = any(
        field in payload
        for field in ["percentage_off", "amount_off", "currency", "active"]
    )
    for field in [
        "percentage_off",
        "amount_off",
        "expires_at",
        "max_uses",
        "active",
        "code",
    ]:
        if field in payload:
            setattr(promo, field, payload[field])
    if "currency" in payload:
        currency = payload.get("currency")
        if currency:
            currency = str(currency).strip().upper()
            if currency != "RON":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Only RON currency is supported",
                )
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
        "percentage_off": float(promo.percentage_off)
        if promo.percentage_off is not None
        else None,
        "amount_off": float(promo.amount_off) if promo.amount_off is not None else None,
        "currency": promo.currency,
        "expires_at": promo.expires_at,
        "active": promo.active,
        "times_used": promo.times_used,
        "max_uses": promo.max_uses,
    }


@router.get("/audit")
async def admin_audit(
    session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)
) -> dict:
    product_audit_stmt = (
        select(ProductAuditLog)
        .options()
        .order_by(ProductAuditLog.created_at.desc())
        .limit(20)
    )
    content_audit_stmt = (
        select(ContentAuditLog).order_by(ContentAuditLog.created_at.desc()).limit(20)
    )
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
                "subject_user_id": str(log.subject_user_id)
                if log.subject_user_id
                else None,
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
            actor_username = func.lower(
                func.coalesce(getattr(audit.c, "actor_username"), "")
            )  # type: ignore[attr-defined]
            subject_email = func.lower(
                func.coalesce(getattr(audit.c, "subject_email"), "")
            )  # type: ignore[attr-defined]
            subject_username = func.lower(
                func.coalesce(getattr(audit.c, "subject_username"), "")
            )  # type: ignore[attr-defined]
            actor_user_id = func.lower(
                func.coalesce(getattr(audit.c, "actor_user_id"), "")
            )  # type: ignore[attr-defined]
            subject_user_id = func.lower(
                func.coalesce(getattr(audit.c, "subject_user_id"), "")
            )  # type: ignore[attr-defined]
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
    entity: str | None = Query(
        default="all", pattern="^(all|product|content|security)$"
    ),
    action: str | None = Query(default=None, max_length=120),
    user: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    audit = _audit_union_subquery()
    filters = _audit_filters(audit, entity=entity, action=action, user=user)
    total = await session.scalar(
        select(func.count()).select_from(audit).where(*filters)
    )
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    offset = (page - 1) * limit
    q = (
        select(audit)
        .where(*filters)
        .order_by(getattr(audit.c, "created_at").desc())
        .offset(offset)
        .limit(limit)
    )  # type: ignore[attr-defined]
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
    entity: str | None = Query(
        default="all", pattern="^(all|product|content|security)$"
    ),
    action: str | None = Query(default=None, max_length=120),
    user: str | None = Query(default=None, max_length=255),
) -> Response:
    audit = _audit_union_subquery()
    filters = _audit_filters(audit, entity=entity, action=action, user=user)

    q = (
        select(audit)
        .where(*filters)
        .order_by(getattr(audit.c, "created_at").desc())
        .limit(5000)
    )  # type: ignore[attr-defined]
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
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    result = await session.execute(
        select(RefreshSession).where(
            RefreshSession.user_id == user_id, RefreshSession.revoked.is_(False)
        )
    )
    sessions = result.scalars().all()
    for s in sessions:
        s.revoked = True
        s.revoked_reason = "admin-forced"
    if sessions:
        session.add_all(sessions)
        session.add(
            AdminAuditLog(
                action="user.sessions.revoke_all",
                actor_user_id=current_user.id,
                subject_user_id=user.id,
                data={
                    "revoked_count": len(sessions),
                    "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                    "ip_address": (request.client.host if request.client else None),
                },
            )
        )
        await session.commit()
    return None


@router.get("/sessions/{user_id}", response_model=list[RefreshSessionResponse])
async def admin_list_user_sessions(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("users")),
) -> list[RefreshSessionResponse]:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    rows = (
        await session.execute(
            select(RefreshSession)
            .where(RefreshSession.user_id == user_id, RefreshSession.revoked.is_(False))
            .order_by(RefreshSession.created_at.desc())
        )
    ).scalars().all()

    now = datetime.now(timezone.utc)
    sessions: list[RefreshSessionResponse] = []
    for row in rows:
        expires_at = row.expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not expires_at or expires_at < now:
            continue
        created_at = row.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        sessions.append(
            RefreshSessionResponse(
                id=row.id,
                created_at=created_at,
                expires_at=expires_at,
                persistent=bool(getattr(row, "persistent", True)),
                is_current=False,
                user_agent=getattr(row, "user_agent", None),
                ip_address=getattr(row, "ip_address", None),
                country_code=getattr(row, "country_code", None),
            )
        )

    return sessions


@router.post("/sessions/{user_id}/{session_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_user_session(
    user_id: UUID,
    session_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    row = await session.get(RefreshSession, session_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if not row.revoked:
        row.revoked = True
        row.revoked_reason = "admin-forced"
        session.add(row)
        session.add(
            AdminAuditLog(
                action="user.sessions.revoke_one",
                actor_user_id=current_user.id,
                subject_user_id=user.id,
                data={
                    "refresh_session_id": str(row.id),
                    "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                    "ip_address": (request.client.host if request.client else None),
                },
            )
        )
        await session.commit()

    return None


@router.get("/gdpr/exports", response_model=AdminGdprExportJobsResponse)
async def admin_gdpr_export_jobs(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    status_filter: UserDataExportStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
) -> AdminGdprExportJobsResponse:
    offset = (page - 1) * limit
    stmt = select(UserDataExportJob, User).join(User, UserDataExportJob.user_id == User.id)

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(User.email).ilike(like)
            | func.lower(User.username).ilike(like)
            | func.lower(User.name).ilike(like)
        )

    if status_filter is not None:
        stmt = stmt.where(UserDataExportJob.status == status_filter)

    total_items = int(
        await session.scalar(stmt.with_only_columns(func.count()).order_by(None)) or 0
    )
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        await session.execute(
            stmt.order_by(UserDataExportJob.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()

    now = datetime.now(timezone.utc)
    sla_days = max(1, int(getattr(settings, "gdpr_export_sla_days", 30) or 30))
    items: list[AdminGdprExportJobItem] = []
    for job, user in rows:
        created_at = job.created_at if job.created_at.tzinfo else job.created_at.replace(tzinfo=timezone.utc)
        updated_at = job.updated_at if job.updated_at.tzinfo else job.updated_at.replace(tzinfo=timezone.utc)
        started_at = job.started_at
        if started_at and started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        finished_at = job.finished_at
        if finished_at and finished_at.tzinfo is None:
            finished_at = finished_at.replace(tzinfo=timezone.utc)
        expires_at = job.expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        sla_due_at = created_at + timedelta(days=sla_days)
        sla_breached = False
        if job.status != UserDataExportStatus.succeeded and now > sla_due_at:
            sla_breached = True

        items.append(
            AdminGdprExportJobItem(
                id=job.id,
                user=AdminGdprUserRef(
                    id=user.id,
                    email=user.email,
                    username=user.username,
                    role=user.role,
                ),
                status=job.status,
                progress=int(job.progress or 0),
                created_at=created_at,
                updated_at=updated_at,
                started_at=started_at,
                finished_at=finished_at,
                expires_at=expires_at,
                has_file=bool(job.file_path),
                sla_due_at=sla_due_at,
                sla_breached=sla_breached,
            )
        )

    return AdminGdprExportJobsResponse(
        items=items,
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


@router.post("/gdpr/exports/{job_id}/retry", response_model=AdminGdprExportJobItem)
async def admin_gdpr_retry_export_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> AdminGdprExportJobItem:
    job = await session.get(UserDataExportJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    user = await session.get(User, job.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database engine unavailable")

    job.status = UserDataExportStatus.pending
    job.progress = 0
    job.error_message = None
    job.started_at = None
    job.finished_at = None
    job.expires_at = None
    job.file_path = None
    session.add(job)
    session.add(
        AdminAuditLog(
            action="gdpr.export.retry",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "job_id": str(job.id),
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
    )
    await session.commit()

    background_tasks.add_task(user_export_service.run_user_export_job, engine, job_id=job.id)

    now = datetime.now(timezone.utc)
    created_at = job.created_at if job.created_at.tzinfo else job.created_at.replace(tzinfo=timezone.utc)
    updated_at = job.updated_at if job.updated_at.tzinfo else job.updated_at.replace(tzinfo=timezone.utc)
    sla_days = max(1, int(getattr(settings, "gdpr_export_sla_days", 30) or 30))
    sla_due_at = created_at + timedelta(days=sla_days)
    return AdminGdprExportJobItem(
        id=job.id,
        user=AdminGdprUserRef(id=user.id, email=user.email, username=user.username, role=user.role),
        status=job.status,
        progress=int(job.progress or 0),
        created_at=created_at,
        updated_at=updated_at,
        started_at=None,
        finished_at=None,
        expires_at=None,
        has_file=False,
        sla_due_at=sla_due_at,
        sla_breached=bool(now > sla_due_at),
    )


@router.get("/gdpr/exports/{job_id}/download")
async def admin_gdpr_download_export_job(
    job_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> FileResponse:
    job = await session.get(UserDataExportJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    if job.status != UserDataExportStatus.succeeded or not job.file_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Export is not ready")

    expires_at = job.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")

    path = private_storage.resolve_private_path(job.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file not found")

    user = await session.get(User, job.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    session.add(
        AdminAuditLog(
            action="gdpr.export.download",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "job_id": str(job.id),
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
    )
    await session.commit()

    stamp = (job.finished_at or job.created_at or datetime.now(timezone.utc)).date().isoformat()
    filename = f"moment-studio-export-{stamp}.json"
    return FileResponse(path, media_type="application/json", filename=filename, headers={"Cache-Control": "no-store"})


@router.get("/gdpr/deletions", response_model=AdminGdprDeletionRequestsResponse)
async def admin_gdpr_deletion_requests(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
) -> AdminGdprDeletionRequestsResponse:
    offset = (page - 1) * limit
    stmt = select(User).where(User.deleted_at.is_(None), User.deletion_requested_at.is_not(None))

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(User.email).ilike(like)
            | func.lower(User.username).ilike(like)
            | func.lower(User.name).ilike(like)
        )

    total_items = int(await session.scalar(stmt.with_only_columns(func.count()).order_by(None)) or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        (
            await session.execute(
                stmt.order_by(User.deletion_requested_at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )

    now = datetime.now(timezone.utc)
    sla_days = max(1, int(getattr(settings, "gdpr_deletion_sla_days", 30) or 30))
    items: list[AdminGdprDeletionRequestItem] = []
    for user in rows:
        requested_at = user.deletion_requested_at
        if requested_at and requested_at.tzinfo is None:
            requested_at = requested_at.replace(tzinfo=timezone.utc)
        scheduled_for = user.deletion_scheduled_for
        if scheduled_for and scheduled_for.tzinfo is None:
            scheduled_for = scheduled_for.replace(tzinfo=timezone.utc)

        sla_due_at = (requested_at or now) + timedelta(days=sla_days)
        status_label = "scheduled"
        if scheduled_for and scheduled_for <= now:
            status_label = "due"
        elif scheduled_for:
            status_label = "cooldown"

        items.append(
            AdminGdprDeletionRequestItem(
                user=AdminGdprUserRef(id=user.id, email=user.email, username=user.username, role=user.role),
                requested_at=requested_at or now,
                scheduled_for=scheduled_for,
                status=status_label,
                sla_due_at=sla_due_at,
                sla_breached=bool(now > sla_due_at),
            )
        )

    return AdminGdprDeletionRequestsResponse(
        items=items,
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


@router.post("/gdpr/deletions/{user_id}/execute", status_code=status.HTTP_204_NO_CONTENT)
async def admin_gdpr_execute_deletion(
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner account cannot be deleted")
    if user.role in (
        UserRole.admin,
        UserRole.support,
        UserRole.fulfillment,
        UserRole.content,
    ) and current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete staff accounts")

    email_before = user.email
    await self_service.execute_account_deletion(session, user)
    session.add(
        AdminAuditLog(
            action="gdpr.deletion.execute",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "email_before": email_before,
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
    )
    await session.commit()
    return None


@router.post("/gdpr/deletions/{user_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def admin_gdpr_cancel_deletion(
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner account cannot be modified")
    if user.role in (
        UserRole.admin,
        UserRole.support,
        UserRole.fulfillment,
        UserRole.content,
    ) and current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can modify staff accounts")

    if user.deletion_requested_at is not None or user.deletion_scheduled_for is not None:
        user.deletion_requested_at = None
        user.deletion_scheduled_for = None
        session.add(user)
        session.add(
            AdminAuditLog(
                action="gdpr.deletion.cancel",
                actor_user_id=current_user.id,
                subject_user_id=user.id,
                data={
                    "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                    "ip_address": (request.client.host if request.client else None),
                },
            )
        )
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.role == UserRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner role can only be transferred",
        )
    role = payload.get("role")
    if role not in (
        UserRole.customer.value,
        UserRole.support.value,
        UserRole.fulfillment.value,
        UserRole.content.value,
        UserRole.admin.value,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role"
        )
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


@router.patch("/users/{user_id}/internal", response_model=AdminUserProfileUser)
async def update_user_internal(
    user_id: UUID,
    payload: AdminUserInternalUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserProfileUser:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    before_vip = bool(getattr(user, "vip", False))
    before_note = getattr(user, "admin_note", None)

    data = payload.model_dump(exclude_unset=True)
    if "vip" in data and data["vip"] is not None:
        user.vip = bool(data["vip"])
    if "admin_note" in data:
        note = data.get("admin_note")
        if note is None:
            user.admin_note = None
        else:
            trimmed = str(note).strip()
            user.admin_note = trimmed or None

    changes: dict[str, object] = {}
    if before_vip != bool(getattr(user, "vip", False)):
        changes["vip"] = {"before": before_vip, "after": bool(getattr(user, "vip", False))}
    if before_note != getattr(user, "admin_note", None):
        changes["admin_note"] = {
            "before_length": len(before_note or ""),
            "after_length": len((getattr(user, "admin_note", None) or "")),
        }

    session.add(user)
    await session.flush()
    if changes:
        session.add(
            AdminAuditLog(
                action="user.internal.update",
                actor_user_id=current_user.id,
                subject_user_id=user.id,
                data={"changes": changes},
            )
        )
    await session.commit()

    return AdminUserProfileUser(
        id=user.id,
        email=user.email,
        username=user.username,
        name=user.name,
        name_tag=user.name_tag,
        role=user.role,
        email_verified=bool(user.email_verified),
        created_at=user.created_at,
        vip=bool(getattr(user, "vip", False)),
        admin_note=getattr(user, "admin_note", None),
        locked_until=getattr(user, "locked_until", None),
        locked_reason=getattr(user, "locked_reason", None),
        password_reset_required=bool(getattr(user, "password_reset_required", False)),
    )


@router.patch("/users/{user_id}/security", response_model=AdminUserProfileUser)
async def update_user_security(
    user_id: UUID,
    payload: AdminUserSecurityUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserProfileUser:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify owner security settings")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify your own security settings")

    now = datetime.now(timezone.utc)
    before_locked_until = getattr(user, "locked_until", None)
    if before_locked_until and before_locked_until.tzinfo is None:
        before_locked_until = before_locked_until.replace(tzinfo=timezone.utc)
    before_locked_reason = getattr(user, "locked_reason", None)
    before_password_reset_required = bool(getattr(user, "password_reset_required", False))

    data = payload.model_dump(exclude_unset=True)
    if "locked_until" in data:
        locked_until = data.get("locked_until")
        if locked_until and locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        if locked_until and locked_until <= now:
            locked_until = None
        user.locked_until = locked_until

    if "locked_reason" in data:
        raw_reason = data.get("locked_reason")
        cleaned = (raw_reason or "").strip()[:255] or None
        user.locked_reason = cleaned

    if getattr(user, "locked_until", None) is None:
        user.locked_reason = None

    if "password_reset_required" in data and data.get("password_reset_required") is not None:
        user.password_reset_required = bool(data["password_reset_required"])

    after_locked_until = getattr(user, "locked_until", None)
    if after_locked_until and after_locked_until.tzinfo is None:
        after_locked_until = after_locked_until.replace(tzinfo=timezone.utc)
    after_locked_reason = getattr(user, "locked_reason", None)
    after_password_reset_required = bool(getattr(user, "password_reset_required", False))

    changes: dict[str, object] = {}
    if before_locked_until != after_locked_until:
        changes["locked_until"] = {
            "before": before_locked_until.isoformat() if before_locked_until else None,
            "after": after_locked_until.isoformat() if after_locked_until else None,
        }
    if before_locked_reason != after_locked_reason:
        changes["locked_reason"] = {"before_length": len(before_locked_reason or ""), "after_length": len(after_locked_reason or "")}
    if before_password_reset_required != after_password_reset_required:
        changes["password_reset_required"] = {"before": before_password_reset_required, "after": after_password_reset_required}

    session.add(user)
    await session.flush()
    if changes:
        session.add(
            AdminAuditLog(
                action="user.security.update",
                actor_user_id=current_user.id,
                subject_user_id=user.id,
                data={
                    "changes": changes,
                    "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                    "ip_address": (request.client.host if request.client else None),
                },
            )
        )
    await session.commit()

    return AdminUserProfileUser(
        id=user.id,
        email=user.email,
        username=user.username,
        name=user.name,
        name_tag=user.name_tag,
        role=user.role,
        email_verified=bool(user.email_verified),
        created_at=user.created_at,
        vip=bool(getattr(user, "vip", False)),
        admin_note=getattr(user, "admin_note", None),
        locked_until=getattr(user, "locked_until", None),
        locked_reason=getattr(user, "locked_reason", None),
        password_reset_required=bool(getattr(user, "password_reset_required", False)),
    )


@router.get("/users/{user_id}/email/verification", response_model=AdminEmailVerificationHistoryResponse)
async def email_verification_history(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("users")),
) -> AdminEmailVerificationHistoryResponse:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    rows = (
        await session.execute(
            select(EmailVerificationToken)
            .where(EmailVerificationToken.user_id == user.id)
            .order_by(EmailVerificationToken.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    tokens = [
        AdminEmailVerificationTokenInfo(
            id=row.id,
            created_at=row.created_at,
            expires_at=row.expires_at,
            used=bool(row.used),
        )
        for row in rows
    ]
    return AdminEmailVerificationHistoryResponse(tokens=tokens)


@router.post("/users/{user_id}/email/verification/resend", status_code=status.HTTP_202_ACCEPTED)
async def resend_email_verification(
    user_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> dict:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if bool(user.email_verified):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already verified")

    record = await auth_service.create_email_verification(session, user)
    background_tasks.add_task(
        email_service.send_verification_email,
        user.email,
        record.token,
        user.preferred_language,
    )
    session.add(
        AdminAuditLog(
            action="user.email_verification.resend",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "verification_token_id": str(record.id),
                "expires_at": record.expires_at.isoformat() if record.expires_at else None,
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
    )
    await session.commit()
    return {"detail": "Verification email sent"}


@router.post("/users/{user_id}/email/verification/override", response_model=AdminUserProfileUser)
async def override_email_verification(
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_owner),
) -> AdminUserProfileUser:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    before_verified = bool(getattr(user, "email_verified", False))
    if not before_verified:
        user.email_verified = True
        tokens = (
            await session.execute(
                select(EmailVerificationToken).where(
                    EmailVerificationToken.user_id == user.id, EmailVerificationToken.used.is_(False)
                )
            )
        ).scalars().all()
        for tok in tokens:
            tok.used = True
        if tokens:
            session.add_all(tokens)

    session.add(user)
    await session.flush()
    if before_verified != bool(getattr(user, "email_verified", False)):
        session.add(
            AdminAuditLog(
                action="user.email_verification.override",
                actor_user_id=current_user.id,
                subject_user_id=user.id,
                data={
                    "before": before_verified,
                    "after": bool(getattr(user, "email_verified", False)),
                    "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                    "ip_address": (request.client.host if request.client else None),
                },
            )
        )
    await session.commit()

    return AdminUserProfileUser(
        id=user.id,
        email=user.email,
        username=user.username,
        name=user.name,
        name_tag=user.name_tag,
        role=user.role,
        email_verified=bool(user.email_verified),
        created_at=user.created_at,
        vip=bool(getattr(user, "vip", False)),
        admin_note=getattr(user, "admin_note", None),
        locked_until=getattr(user, "locked_until", None),
        locked_reason=getattr(user, "locked_reason", None),
        password_reset_required=bool(getattr(user, "password_reset_required", False)),
    )


@router.post("/users/{user_id}/impersonate", response_model=AdminUserImpersonationResponse)
async def impersonate_user(
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserImpersonationResponse:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role != UserRole.customer:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only customer accounts can be impersonated")

    expires_minutes = max(1, int(settings.admin_impersonation_exp_minutes or 10))
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    access_token = security.create_impersonation_access_token(
        str(user.id),
        impersonator_user_id=str(current_user.id),
        expires_minutes=expires_minutes,
    )

    session.add(
        AdminAuditLog(
            action="user.impersonation.start",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "expires_minutes": expires_minutes,
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
    )
    await session.commit()

    return AdminUserImpersonationResponse(access_token=access_token, expires_at=expires_at)


@router.post("/owner/transfer")
async def transfer_owner(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    current_owner: User = Depends(require_owner),
) -> dict:
    identifier = str(payload.get("identifier") or "").strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier is required"
        )

    confirm = str(payload.get("confirm") or "").strip()
    if confirm.upper() != "TRANSFER":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='Type "TRANSFER" to confirm'
        )

    password = str(payload.get("password") or "")
    if not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required"
        )
    if not security.verify_password(password, current_owner.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password"
        )

    if "@" in identifier:
        target = await auth_service.get_user_by_any_email(session, identifier)
    else:
        target = await auth_service.get_user_by_username(session, identifier)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

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
            data={
                "identifier": identifier,
                "old_owner_id": str(current_owner.id),
                "new_owner_id": str(target.id),
            },
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
async def export_data(
    session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)
) -> dict:
    return await exporter_service.export_json(session)


@router.get("/low-stock")
async def low_stock_products(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("inventory")),
) -> list[dict]:
    threshold_expr = func.coalesce(
        Product.low_stock_threshold,
        Category.low_stock_threshold,
        DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD,
    )
    stmt = (
        select(Product, threshold_expr.label("threshold"))
        .join(Category, Product.category_id == Category.id)
        .where(
            Product.stock_quantity < threshold_expr,
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
        )
        .order_by(Product.stock_quantity.asc())
        .limit(20)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "stock_quantity": p.stock_quantity,
            "threshold": int(threshold or DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD),
            "is_critical": bool(
                p.stock_quantity <= 0
                or p.stock_quantity
                < max(1, int((threshold or DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD) // 2))
            ),
            "sku": p.sku,
            "slug": p.slug,
        }
        for p, threshold in rows
    ]


@router.get("/stock-adjustments", response_model=list[StockAdjustmentRead])
async def list_stock_adjustments(
    product_id: UUID = Query(...),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("inventory")),
) -> list[StockAdjustmentRead]:
    return await catalog_service.list_stock_adjustments(
        session, product_id=product_id, limit=limit, offset=offset
    )


@router.post(
    "/stock-adjustments",
    response_model=StockAdjustmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def apply_stock_adjustment(
    payload: StockAdjustmentCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("inventory")),
) -> StockAdjustmentRead:
    return await catalog_service.apply_stock_adjustment(
        session, payload=payload, user_id=current_user.id
    )


@router.get("/inventory/restock-list", response_model=RestockListResponse)
async def inventory_restock_list(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("inventory")),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    include_variants: bool = Query(default=True),
    default_threshold: int = Query(
        default=DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD, ge=1, le=1000
    ),
) -> RestockListResponse:
    return await inventory_service.paginate_restock_list(
        session,
        page=page,
        limit=limit,
        include_variants=include_variants,
        default_threshold=default_threshold,
    )


@router.put("/inventory/restock-notes", response_model=RestockNoteRead | None)
async def upsert_inventory_restock_note(
    payload: RestockNoteUpsert,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("inventory")),
) -> RestockNoteRead | None:
    return await inventory_service.upsert_restock_note(
        session, payload=payload, user_id=current_user.id
    )


@router.get("/inventory/restock-list/export")
async def export_inventory_restock_list(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("inventory")),
    include_variants: bool = Query(default=True),
    default_threshold: int = Query(
        default=DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD, ge=1, le=1000
    ),
) -> Response:
    rows = await inventory_service.list_restock_list(
        session,
        include_variants=include_variants,
        default_threshold=default_threshold,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "kind",
            "sku",
            "product_slug",
            "product_name",
            "variant_name",
            "stock_quantity",
            "reserved_in_carts",
            "reserved_in_orders",
            "available_quantity",
            "threshold",
            "supplier",
            "desired_quantity",
            "note",
            "restock_at",
            "note_updated_at",
            "product_id",
            "variant_id",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.kind,
                row.sku,
                row.product_slug,
                row.product_name,
                row.variant_name or "",
                row.stock_quantity,
                row.reserved_in_carts,
                row.reserved_in_orders,
                row.available_quantity,
                row.threshold,
                row.supplier or "",
                "" if row.desired_quantity is None else row.desired_quantity,
                row.note or "",
                row.restock_at.isoformat() if row.restock_at else "",
                row.note_updated_at.isoformat() if row.note_updated_at else "",
                str(row.product_id),
                str(row.variant_id) if row.variant_id else "",
            ]
        )

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="restock-list.csv"'},
    )
