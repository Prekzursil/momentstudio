import csv
import io
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.dependencies import require_admin, require_admin_section, require_owner
from app.db.session import get_session
from app.models.catalog import (
    Category,
    Product,
    ProductAuditLog,
    ProductStatus,
    ProductTranslation,
    ProductVariant,
    StockAdjustment,
    StockAdjustmentReason,
)
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
from app.schemas.admin_dashboard_alert_thresholds import (
    AdminDashboardAlertThresholdsResponse,
    AdminDashboardAlertThresholdsUpdateRequest,
)
from app.schemas.admin_dashboard_scheduled import (
    AdminDashboardScheduledTasksResponse,
    ScheduledPublishItem,
    ScheduledPromoItem,
)
from app.schemas.auth import RefreshSessionResponse
from app.schemas.inventory import (
    CartReservationsResponse,
    OrderReservationsResponse,
    RestockListResponse,
    RestockNoteRead,
    RestockNoteUpsert,
)
from app.services import exporter as exporter_service
from app.services import inventory as inventory_service
from app.services import catalog as catalog_service
from app.models.address import Address
from app.models.order import Order, OrderRefund, OrderStatus, OrderTag, OrderEvent, OrderItem
from app.models.returns import ReturnRequest, ReturnRequestStatus
from app.models.support import ContactSubmission
from app.models.user import AdminAuditLog, EmailVerificationToken, User, RefreshSession, UserRole, UserSecurityEvent
from app.models.admin_dashboard_settings import AdminDashboardAlertThresholds
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.coupons_v2 import Promotion
from app.models.user_export import UserDataExportJob, UserDataExportStatus
from app.models.analytics_event import AnalyticsEvent
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from app.services import auth as auth_service
from app.services import audit_chain as audit_chain_service
from app.services import email as email_service
from app.services import admin_reports as admin_reports_service
from app.services import private_storage
from app.services import user_export as user_export_service
from app.services import self_service
from app.services import pii as pii_service
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
from app.schemas.user_segments_admin import AdminUserSegmentListItem, AdminUserSegmentResponse
from app.schemas.analytics import AdminFunnelConversions, AdminFunnelCounts, AdminFunnelMetricsResponse

router = APIRouter(prefix="/admin/dashboard", tags=["admin"])

DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD = 5


async def _get_dashboard_alert_thresholds(session: AsyncSession) -> AdminDashboardAlertThresholds:
    record = await session.scalar(
        select(AdminDashboardAlertThresholds).where(AdminDashboardAlertThresholds.key == "default")
    )
    if record is not None:
        return record

    record = AdminDashboardAlertThresholds(key="default")
    session.add(record)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        record = await session.scalar(
            select(AdminDashboardAlertThresholds).where(AdminDashboardAlertThresholds.key == "default")
        )
        if record is None:
            raise
    return record


def _dashboard_alert_thresholds_payload(record: AdminDashboardAlertThresholds) -> dict[str, object]:
    return {
        "failed_payments_min_count": int(getattr(record, "failed_payments_min_count", 1) or 1),
        "failed_payments_min_delta_pct": (
            float(getattr(record, "failed_payments_min_delta_pct"))
            if getattr(record, "failed_payments_min_delta_pct", None) is not None
            else None
        ),
        "refund_requests_min_count": int(getattr(record, "refund_requests_min_count", 1) or 1),
        "refund_requests_min_rate_pct": (
            float(getattr(record, "refund_requests_min_rate_pct"))
            if getattr(record, "refund_requests_min_rate_pct", None) is not None
            else None
        ),
        "stockouts_min_count": int(getattr(record, "stockouts_min_count", 1) or 1),
        "updated_at": getattr(record, "updated_at", None),
    }


@router.get("/alert-thresholds", response_model=AdminDashboardAlertThresholdsResponse)
async def admin_get_alert_thresholds(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
) -> AdminDashboardAlertThresholdsResponse:
    record = await _get_dashboard_alert_thresholds(session)
    return AdminDashboardAlertThresholdsResponse(**_dashboard_alert_thresholds_payload(record))


@router.put("/alert-thresholds", response_model=AdminDashboardAlertThresholdsResponse)
async def admin_update_alert_thresholds(
    payload: AdminDashboardAlertThresholdsUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_owner),
) -> AdminDashboardAlertThresholdsResponse:
    record = await _get_dashboard_alert_thresholds(session)
    before_full = _dashboard_alert_thresholds_payload(record)
    before = {k: v for k, v in before_full.items() if k != "updated_at"}

    record.failed_payments_min_count = int(payload.failed_payments_min_count)
    record.failed_payments_min_delta_pct = (
        Decimal(str(payload.failed_payments_min_delta_pct))
        if payload.failed_payments_min_delta_pct is not None
        else None
    )
    record.refund_requests_min_count = int(payload.refund_requests_min_count)
    record.refund_requests_min_rate_pct = (
        Decimal(str(payload.refund_requests_min_rate_pct))
        if payload.refund_requests_min_rate_pct is not None
        else None
    )
    record.stockouts_min_count = int(payload.stockouts_min_count)
    session.add(record)

    after_full = _dashboard_alert_thresholds_payload(record)
    after = {k: v for k, v in after_full.items() if k != "updated_at"}
    await audit_chain_service.add_admin_audit_log(
        session,
        action="dashboard.alert_thresholds.update",
        actor_user_id=current_user.id,
        subject_user_id=None,
        data={
            "before": before,
            "after": after,
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
    )
    await session.commit()
    await session.refresh(record)
    return AdminDashboardAlertThresholdsResponse(**_dashboard_alert_thresholds_payload(record))


@router.get("/summary")
async def admin_summary(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> dict:
    now = datetime.now(timezone.utc)
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    sales_statuses = (*successful_statuses, OrderStatus.refunded)
    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

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
    orders_total = await session.scalar(
        select(func.count()).select_from(Order).where(exclude_test_orders)
    )
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
            Order.created_at >= since,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
    )
    gross_sales_30d = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= since,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    refunds_30d = await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= since,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    missing_refunds_30d = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= since,
            Order.status == OrderStatus.refunded,
            OrderRefund.id.is_(None),
            exclude_test_orders,
        )
    )
    net_sales_30d = (
        (gross_sales_30d or 0)
        - (refunds_30d or 0)
        - (missing_refunds_30d or 0)
    )
    orders_30d = await session.scalar(
        select(func.count()).select_from(Order).where(Order.created_at >= since, exclude_test_orders)
    )

    sales_range = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
    )
    gross_sales_range = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    refunds_range = await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    missing_refunds_range = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status == OrderStatus.refunded,
            OrderRefund.id.is_(None),
            exclude_test_orders,
        )
    )
    net_sales_range = (
        (gross_sales_range or 0)
        - (refunds_range or 0)
        - (missing_refunds_range or 0)
    )
    orders_range = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= start, Order.created_at < end, exclude_test_orders)
    )

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    today_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= today_start, Order.created_at < now, exclude_test_orders)
    )
    yesterday_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= yesterday_start,
            Order.created_at < today_start,
            exclude_test_orders,
        )
    )
    today_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= today_start,
            Order.created_at < now,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
    )
    yesterday_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= yesterday_start,
            Order.created_at < today_start,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
    )
    gross_today_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= today_start,
            Order.created_at < now,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    gross_yesterday_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= yesterday_start,
            Order.created_at < today_start,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    refunds_today = await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= today_start,
            Order.created_at < now,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    refunds_yesterday = await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= yesterday_start,
            Order.created_at < today_start,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    missing_refunds_today = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= today_start,
            Order.created_at < now,
            Order.status == OrderStatus.refunded,
            OrderRefund.id.is_(None),
            exclude_test_orders,
        )
    )
    missing_refunds_yesterday = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= yesterday_start,
            Order.created_at < today_start,
            Order.status == OrderStatus.refunded,
            OrderRefund.id.is_(None),
            exclude_test_orders,
        )
    )
    net_today_sales = (
        (gross_today_sales or 0)
        - (refunds_today or 0)
        - (missing_refunds_today or 0)
    )
    net_yesterday_sales = (
        (gross_yesterday_sales or 0)
        - (refunds_yesterday or 0)
        - (missing_refunds_yesterday or 0)
    )
    today_refunds = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.refunded,
            Order.updated_at >= today_start,
            Order.updated_at < now,
            exclude_test_orders,
        )
    )
    yesterday_refunds = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.refunded,
            Order.updated_at >= yesterday_start,
            Order.updated_at < today_start,
            exclude_test_orders,
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
            exclude_test_orders,
        )
    )
    failed_payments_prev = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.pending_payment,
            Order.created_at >= payment_prev_start,
            Order.created_at < payment_window_start,
            exclude_test_orders,
        )
    )

    refund_window_end = now
    refund_window_start = now - timedelta(days=7)
    refund_prev_start = refund_window_start - timedelta(days=7)
    refund_requests = await session.scalar(
        select(func.count())
        .select_from(ReturnRequest)
        .join(Order, ReturnRequest.order_id == Order.id)
        .where(
            ReturnRequest.status == ReturnRequestStatus.requested,
            ReturnRequest.created_at >= refund_window_start,
            ReturnRequest.created_at < refund_window_end,
            exclude_test_orders,
        )
    )
    refund_requests_prev = await session.scalar(
        select(func.count())
        .select_from(ReturnRequest)
        .join(Order, ReturnRequest.order_id == Order.id)
        .where(
            ReturnRequest.status == ReturnRequestStatus.requested,
            ReturnRequest.created_at >= refund_prev_start,
            ReturnRequest.created_at < refund_window_start,
            exclude_test_orders,
        )
    )
    refund_window_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= refund_window_start,
            Order.created_at < refund_window_end,
            exclude_test_orders,
        )
    )
    refund_window_orders_prev = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= refund_prev_start,
            Order.created_at < refund_window_start,
            exclude_test_orders,
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

    def _rate_pct(numer: float, denom: float) -> float | None:
        if denom <= 0:
            return None
        return numer / denom * 100.0

    thresholds = await _get_dashboard_alert_thresholds(session)
    failed_payments_threshold_min_count = int(getattr(thresholds, "failed_payments_min_count", 1) or 1)
    failed_payments_threshold_min_delta_pct = (
        float(getattr(thresholds, "failed_payments_min_delta_pct"))
        if getattr(thresholds, "failed_payments_min_delta_pct", None) is not None
        else None
    )
    refund_requests_threshold_min_count = int(getattr(thresholds, "refund_requests_min_count", 1) or 1)
    refund_requests_threshold_min_rate_pct = (
        float(getattr(thresholds, "refund_requests_min_rate_pct"))
        if getattr(thresholds, "refund_requests_min_rate_pct", None) is not None
        else None
    )
    stockouts_threshold_min_count = int(getattr(thresholds, "stockouts_min_count", 1) or 1)

    failed_payments_delta_pct = _delta_pct(float(failed_payments or 0), float(failed_payments_prev or 0))
    failed_payments_is_alert = bool(int(failed_payments or 0) >= failed_payments_threshold_min_count) and (
        failed_payments_threshold_min_delta_pct is None
        or failed_payments_delta_pct is None
        or failed_payments_delta_pct >= failed_payments_threshold_min_delta_pct
    )

    refund_rate_pct = _rate_pct(float(refund_requests or 0), float(refund_window_orders or 0))
    refund_rate_prev_pct = _rate_pct(float(refund_requests_prev or 0), float(refund_window_orders_prev or 0))
    refund_rate_delta_pct = (
        _delta_pct(refund_rate_pct, refund_rate_prev_pct)
        if refund_rate_pct is not None and refund_rate_prev_pct is not None
        else None
    )
    refund_requests_is_alert = bool(int(refund_requests or 0) >= refund_requests_threshold_min_count) and (
        refund_requests_threshold_min_rate_pct is None
        or refund_rate_pct is None
        or refund_rate_pct >= refund_requests_threshold_min_rate_pct
    )

    stockouts_is_alert = bool(int(stockouts or 0) >= stockouts_threshold_min_count)

    return {
        "products": products_total or 0,
        "orders": orders_total or 0,
        "users": users_total or 0,
        "low_stock": low_stock or 0,
        "sales_30d": float(sales_30d or 0),
        "gross_sales_30d": float(gross_sales_30d or 0),
        "net_sales_30d": float(net_sales_30d or 0),
        "orders_30d": orders_30d or 0,
        "sales_range": float(sales_range or 0),
        "gross_sales_range": float(gross_sales_range or 0),
        "net_sales_range": float(net_sales_range or 0),
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
        "gross_today_sales": float(gross_today_sales or 0),
        "gross_yesterday_sales": float(gross_yesterday_sales or 0),
        "gross_sales_delta_pct": _delta_pct(
            float(gross_today_sales or 0), float(gross_yesterday_sales or 0)
        ),
        "net_today_sales": float(net_today_sales or 0),
        "net_yesterday_sales": float(net_yesterday_sales or 0),
        "net_sales_delta_pct": _delta_pct(
            float(net_today_sales or 0), float(net_yesterday_sales or 0)
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
                "delta_pct": failed_payments_delta_pct,
                "is_alert": failed_payments_is_alert,
            },
            "refund_requests": {
                "window_days": 7,
                "current": int(refund_requests or 0),
                "previous": int(refund_requests_prev or 0),
                "delta_pct": _delta_pct(
                    float(refund_requests or 0), float(refund_requests_prev or 0)
                ),
                "current_denominator": int(refund_window_orders or 0),
                "previous_denominator": int(refund_window_orders_prev or 0),
                "current_rate_pct": refund_rate_pct,
                "previous_rate_pct": refund_rate_prev_pct,
                "rate_delta_pct": refund_rate_delta_pct,
                "is_alert": refund_requests_is_alert,
            },
            "stockouts": {"count": int(stockouts or 0), "is_alert": stockouts_is_alert},
        },
        "alert_thresholds": _dashboard_alert_thresholds_payload(thresholds),
        "system": {"db_ready": True, "backup_last_at": settings.backup_last_at},
    }


@router.post("/reports/send")
async def admin_send_scheduled_report(
    request: Request,
    payload: dict = Body(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> dict:
    kind = str(payload.get("kind") or "").strip().lower()
    force = bool(payload.get("force", False))
    try:
        result = await admin_reports_service.send_report_now(session, kind=kind, force=force)
    except ValueError as exc:
        await session.rollback()
        await audit_chain_service.add_admin_audit_log(
            session,
            action="admin_reports.send_now_failed",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={
                "kind": kind,
                "force": force,
                "error": str(exc)[:500],
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
        await session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await session.rollback()
        await audit_chain_service.add_admin_audit_log(
            session,
            action="admin_reports.send_now_error",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={
                "kind": kind,
                "force": force,
                "error": str(exc)[:500],
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
        await session.commit()
        raise

    await audit_chain_service.add_admin_audit_log(
        session,
        action="admin_reports.send_now",
        actor_user_id=current_user.id,
        subject_user_id=None,
        data={
            "kind": kind,
            "force": force,
            "result": result,
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
    )
    await session.commit()
    return result


@router.get("/funnel", response_model=AdminFunnelMetricsResponse)
async def admin_funnel_metrics(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> AdminFunnelMetricsResponse:
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
        end = datetime.combine(range_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        effective_range_days = (range_to - range_from).days + 1
    else:
        start = now - timedelta(days=range_days)
        end = now
        effective_range_days = range_days

    window_filters = [AnalyticsEvent.created_at >= start, AnalyticsEvent.created_at < end]

    async def _distinct_sessions(event: str) -> int:
        value = await session.scalar(
            select(func.count(func.distinct(AnalyticsEvent.session_id))).where(
                *window_filters,
                AnalyticsEvent.event == event,
            )
        )
        return int(value or 0)

    sessions_count = await _distinct_sessions("session_start")
    carts_count = await _distinct_sessions("view_cart")
    checkouts_count = await _distinct_sessions("checkout_start")
    orders_count = await _distinct_sessions("checkout_success")

    def _rate(numer: int, denom: int) -> float | None:
        if denom <= 0:
            return None
        return numer / denom

    return AdminFunnelMetricsResponse(
        range_days=int(effective_range_days),
        range_from=start.date(),
        range_to=(end - timedelta(microseconds=1)).date(),
        counts=AdminFunnelCounts(
            sessions=sessions_count,
            carts=carts_count,
            checkouts=checkouts_count,
            orders=orders_count,
        ),
        conversions=AdminFunnelConversions(
            to_cart=_rate(carts_count, sessions_count),
            to_checkout=_rate(checkouts_count, carts_count),
            to_order=_rate(orders_count, checkouts_count),
        ),
    )


@router.get("/channel-breakdown")
async def admin_channel_breakdown(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> dict:
    now = datetime.now(timezone.utc)
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    sales_statuses = (*successful_statuses, OrderStatus.refunded)

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

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

    async def _gross_by(col):
        rows = await session.execute(
            select(
                col,
                func.count().label("orders"),
                func.coalesce(func.sum(Order.total_amount), 0).label("gross_sales"),
            )
            .select_from(Order)
            .where(
                Order.created_at >= start,
                Order.created_at < end,
                Order.status.in_(sales_statuses),
                exclude_test_orders,
            )
            .group_by(col)
        )
        return rows.all()

    async def _refunds_by(col):
        rows = await session.execute(
            select(col, func.coalesce(func.sum(OrderRefund.amount), 0).label("refunds"))
            .select_from(OrderRefund)
            .join(Order, OrderRefund.order_id == Order.id)
            .where(
                Order.created_at >= start,
                Order.created_at < end,
                Order.status.in_(sales_statuses),
                exclude_test_orders,
            )
            .group_by(col)
        )
        return rows.all()

    async def _missing_refunds_by(col):
        rows = await session.execute(
            select(col, func.coalesce(func.sum(Order.total_amount), 0).label("missing"))
            .select_from(Order)
            .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
            .where(
                Order.created_at >= start,
                Order.created_at < end,
                Order.status == OrderStatus.refunded,
                OrderRefund.id.is_(None),
                exclude_test_orders,
            )
            .group_by(col)
        )
        return rows.all()

    async def _build(col, label_unknown: str = "unknown") -> list[dict]:
        gross_rows = await _gross_by(col)
        refunds_rows = await _refunds_by(col)
        missing_rows = await _missing_refunds_by(col)

        refunds_map = {row[0]: row[1] for row in refunds_rows}
        missing_map = {row[0]: row[1] for row in missing_rows}

        items: list[dict] = []
        for key, orders_count, gross in gross_rows:
            refunds = refunds_map.get(key, 0) or 0
            missing = missing_map.get(key, 0) or 0
            net = (gross or 0) - refunds - missing
            items.append(
                {
                    "key": (key or label_unknown),
                    "orders": int(orders_count or 0),
                    "gross_sales": float(gross or 0),
                    "net_sales": float(net or 0),
                }
            )
        items.sort(key=lambda row: (row.get("orders", 0), row.get("gross_sales", 0)), reverse=True)
        return items

    return {
        "range_days": int(effective_range_days),
        "range_from": start.date().isoformat(),
        "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
        "payment_methods": await _build(Order.payment_method),
        "couriers": await _build(Order.courier),
        "delivery_types": await _build(Order.delivery_type),
    }


@router.get("/payments-health")
async def admin_payments_health(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
    since_hours: int = Query(default=24, ge=1, le=168),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=int(since_hours))
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

    method_col = func.lower(func.coalesce(Order.payment_method, literal("unknown")))
    success_rows = await session.execute(
        select(method_col, func.count().label("count"))
        .select_from(Order)
        .where(
            Order.created_at >= since,
            Order.created_at < now,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
        .group_by(method_col)
    )
    pending_rows = await session.execute(
        select(method_col, func.count().label("count"))
        .select_from(Order)
        .where(
            Order.created_at >= since,
            Order.created_at < now,
            Order.status == OrderStatus.pending_payment,
            exclude_test_orders,
        )
        .group_by(method_col)
    )
    success_map = {str(row[0] or "unknown"): int(row[1] or 0) for row in success_rows.all()}
    pending_map = {str(row[0] or "unknown"): int(row[1] or 0) for row in pending_rows.all()}

    def _safe_int(value: int | None) -> int:
        return int(value or 0)

    def _success_rate(success: int, pending: int) -> float | None:
        denom = success + pending
        if denom <= 0:
            return None
        return success / denom

    def _error_filter(model) -> Any:
        return (
            model.last_attempt_at >= since,
            model.last_error.is_not(None),
            model.last_error != "",
        )

    def _backlog_filter(model) -> Any:
        return (
            model.last_attempt_at >= since,
            model.processed_at.is_(None),
            or_(model.last_error.is_(None), model.last_error == ""),
        )

    stripe_errors = await session.scalar(select(func.count()).select_from(StripeWebhookEvent).where(*_error_filter(StripeWebhookEvent)))
    stripe_backlog = await session.scalar(select(func.count()).select_from(StripeWebhookEvent).where(*_backlog_filter(StripeWebhookEvent)))
    paypal_errors = await session.scalar(select(func.count()).select_from(PayPalWebhookEvent).where(*_error_filter(PayPalWebhookEvent)))
    paypal_backlog = await session.scalar(select(func.count()).select_from(PayPalWebhookEvent).where(*_backlog_filter(PayPalWebhookEvent)))

    stripe_recent_rows = (
        (
            await session.execute(
                select(StripeWebhookEvent)
                .where(*_error_filter(StripeWebhookEvent))
                .order_by(StripeWebhookEvent.last_attempt_at.desc())
                .limit(8)
            )
        )
        .scalars()
        .all()
    )
    paypal_recent_rows = (
        (
            await session.execute(
                select(PayPalWebhookEvent)
                .where(*_error_filter(PayPalWebhookEvent))
                .order_by(PayPalWebhookEvent.last_attempt_at.desc())
                .limit(8)
            )
        )
        .scalars()
        .all()
    )

    recent_errors: list[dict] = []
    for row in stripe_recent_rows:
        recent_errors.append(
            {
                "provider": "stripe",
                "event_id": row.stripe_event_id,
                "event_type": row.event_type,
                "attempts": int(row.attempts or 0),
                "last_attempt_at": row.last_attempt_at,
                "last_error": row.last_error,
            }
        )
    for row in paypal_recent_rows:
        recent_errors.append(
            {
                "provider": "paypal",
                "event_id": row.paypal_event_id,
                "event_type": row.event_type,
                "attempts": int(row.attempts or 0),
                "last_attempt_at": row.last_attempt_at,
                "last_error": row.last_error,
            }
        )
    recent_errors.sort(key=lambda item: item.get("last_attempt_at") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    recent_errors = recent_errors[:12]

    preferred_order = ["stripe", "paypal", "netopia", "cod", "unknown"]
    methods = list({*success_map.keys(), *pending_map.keys(), *preferred_order})
    methods.sort(key=lambda key: (preferred_order.index(key) if key in preferred_order else len(preferred_order), key))

    providers: list[dict] = []
    for method in methods:
        success = _safe_int(success_map.get(method))
        pending = _safe_int(pending_map.get(method))
        if method == "stripe":
            webhook_error_count = _safe_int(int(stripe_errors or 0))
            webhook_backlog_count = _safe_int(int(stripe_backlog or 0))
        elif method == "paypal":
            webhook_error_count = _safe_int(int(paypal_errors or 0))
            webhook_backlog_count = _safe_int(int(paypal_backlog or 0))
        else:
            webhook_error_count = 0
            webhook_backlog_count = 0

        providers.append(
            {
                "provider": method,
                "successful_orders": success,
                "pending_payment_orders": pending,
                "success_rate": _success_rate(success, pending),
                "webhook_errors": webhook_error_count,
                "webhook_backlog": webhook_backlog_count,
            }
        )

    return {
        "window_hours": int(since_hours),
        "window_start": since,
        "window_end": now,
        "providers": providers,
        "recent_webhook_errors": recent_errors,
    }


@router.get("/refunds-breakdown")
async def admin_refunds_breakdown(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    window_days: int = Query(default=30, ge=1, le=365),
) -> dict:
    now = datetime.now(timezone.utc)
    window = timedelta(days=int(window_days))
    start = now - window
    prev_start = start - window

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

    provider_col = func.lower(func.coalesce(OrderRefund.provider, literal("unknown")))

    async def _provider_rows(window_start: datetime, window_end: datetime) -> list[tuple[str, int, float]]:
        rows = await session.execute(
            select(
                provider_col,
                func.count().label("count"),
                func.coalesce(func.sum(OrderRefund.amount), 0).label("amount"),
            )
            .select_from(OrderRefund)
            .join(Order, OrderRefund.order_id == Order.id)
            .where(
                OrderRefund.created_at >= window_start,
                OrderRefund.created_at < window_end,
                exclude_test_orders,
            )
            .group_by(provider_col)
        )
        items: list[tuple[str, int, float]] = []
        for provider, count, amount in rows.all():
            items.append((str(provider or "unknown"), int(count or 0), float(amount or 0)))
        return items

    current_provider = await _provider_rows(start, now)
    previous_provider = await _provider_rows(prev_start, start)
    prev_provider_map = {row[0]: row for row in previous_provider}

    def _delta_pct(current: float, previous: float) -> float | None:
        if previous == 0:
            return None
        return (current - previous) / previous * 100.0

    providers: list[dict] = []
    for provider, count, amount in current_provider:
        _, prev_count, prev_amount = prev_provider_map.get(provider, (provider, 0, 0.0))
        providers.append(
            {
                "provider": provider,
                "current": {"count": int(count), "amount": float(amount)},
                "previous": {"count": int(prev_count), "amount": float(prev_amount)},
                "delta_pct": {
                    "count": _delta_pct(float(count), float(prev_count)),
                    "amount": _delta_pct(float(amount), float(prev_amount)),
                },
            }
        )
    providers.sort(key=lambda row: (row.get("current", {}).get("amount", 0), row.get("current", {}).get("count", 0)), reverse=True)

    async def _missing_refunds(window_start: datetime, window_end: datetime) -> tuple[int, float]:
        row = await session.execute(
            select(
                func.count().label("count"),
                func.coalesce(func.sum(Order.total_amount), 0).label("amount"),
            )
            .select_from(Order)
            .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
            .where(
                Order.status == OrderStatus.refunded,
                Order.updated_at >= window_start,
                Order.updated_at < window_end,
                OrderRefund.id.is_(None),
                exclude_test_orders,
            )
        )
        count, amount = row.one()
        return int(count or 0), float(amount or 0)

    missing_current_count, missing_current_amount = await _missing_refunds(start, now)
    missing_prev_count, missing_prev_amount = await _missing_refunds(prev_start, start)

    def _normalize_text(value: str) -> str:
        raw = (value or "").strip()
        if not raw:
            return ""
        normalized = unicodedata.normalize("NFKD", raw)
        return normalized.encode("ascii", "ignore").decode("ascii").lower()

    def _reason_category(reason: str) -> str:
        t = _normalize_text(reason)
        if not t:
            return "other"
        if any(key in t for key in ("damaged", "broken", "defect", "defective", "crack", "spart", "stricat", "zgariat", "deterior")):
            return "damaged"
        if any(key in t for key in ("wrong", "different", "gresit", "incorect", "alt produs", "other item", "not the one")):
            return "wrong_item"
        if any(key in t for key in ("not as described", "different than expected", "nu corespunde", "nu este ca", "description", "poza", "picture")):
            return "not_as_described"
        if any(key in t for key in ("size", "fit", "too big", "too small", "marime", "potriv")):
            return "size_fit"
        if any(key in t for key in ("delivery", "shipping", "ship", "courier", "curier", "livrare", "intarzi", "intarzier")):
            return "delivery_issue"
        if any(key in t for key in ("changed my mind", "dont want", "do not want", "no longer", "nu mai", "razgand", "renunt")):
            return "changed_mind"
        return "other"

    async def _reason_counts(window_start: datetime, window_end: datetime) -> dict[str, int]:
        rows = await session.execute(
            select(ReturnRequest.reason)
            .select_from(ReturnRequest)
            .join(Order, ReturnRequest.order_id == Order.id)
            .where(
                ReturnRequest.status == ReturnRequestStatus.refunded,
                ReturnRequest.updated_at >= window_start,
                ReturnRequest.updated_at < window_end,
                exclude_test_orders,
            )
        )
        counts: dict[str, int] = {}
        for reason in rows.scalars().all():
            category = _reason_category(str(reason or ""))
            counts[category] = counts.get(category, 0) + 1
        return counts

    current_reasons = await _reason_counts(start, now)
    previous_reasons = await _reason_counts(prev_start, start)

    categories = ["damaged", "wrong_item", "not_as_described", "size_fit", "delivery_issue", "changed_mind", "other"]
    reasons: list[dict] = []
    for category in categories:
        cur = int(current_reasons.get(category, 0))
        prev = int(previous_reasons.get(category, 0))
        reasons.append(
            {
                "category": category,
                "current": cur,
                "previous": prev,
                "delta_pct": _delta_pct(float(cur), float(prev)),
            }
        )
    reasons.sort(key=lambda row: row.get("current", 0), reverse=True)

    return {
        "window_days": int(window_days),
        "window_start": start,
        "window_end": now,
        "providers": providers,
        "missing_refunds": {
            "current": {"count": missing_current_count, "amount": float(missing_current_amount)},
            "previous": {"count": missing_prev_count, "amount": float(missing_prev_amount)},
            "delta_pct": {
                "count": _delta_pct(float(missing_current_count), float(missing_prev_count)),
                "amount": _delta_pct(float(missing_current_amount), float(missing_prev_amount)),
            },
        },
        "reasons": reasons,
    }


@router.get("/shipping-performance")
async def admin_shipping_performance(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("orders")),
    window_days: int = Query(default=30, ge=1, le=365),
) -> dict:
    now = datetime.now(timezone.utc)
    window = timedelta(days=int(window_days))
    start = now - window
    prev_start = start - window

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

    shipped_subq = (
        select(
            OrderEvent.order_id.label("order_id"),
            func.min(OrderEvent.created_at).label("shipped_at"),
        )
        .where(
            OrderEvent.event.in_(("status_change", "status_auto_ship")),
            OrderEvent.note.is_not(None),
            OrderEvent.note.like("% -> shipped"),
        )
        .group_by(OrderEvent.order_id)
        .subquery()
    )
    delivered_subq = (
        select(
            OrderEvent.order_id.label("order_id"),
            func.min(OrderEvent.created_at).label("delivered_at"),
        )
        .where(
            OrderEvent.event == "status_change",
            OrderEvent.note.is_not(None),
            OrderEvent.note.like("% -> delivered"),
        )
        .group_by(OrderEvent.order_id)
        .subquery()
    )

    courier_col = func.lower(func.coalesce(Order.courier, literal("unknown"))).label("courier")

    def _delta_pct(current: float | None, previous: float | None) -> float | None:
        if current is None or previous is None or previous == 0:
            return None
        return (current - previous) / previous * 100.0

    async def _collect_ship_durations(window_start: datetime, window_end: datetime) -> dict[str, list[float]]:
        rows = await session.execute(
            select(Order.created_at, courier_col, shipped_subq.c.shipped_at)
            .select_from(Order)
            .join(shipped_subq, shipped_subq.c.order_id == Order.id)
            .where(
                shipped_subq.c.shipped_at >= window_start,
                shipped_subq.c.shipped_at < window_end,
                exclude_test_orders,
            )
        )
        durations: dict[str, list[float]] = {}
        for created_at, courier, shipped_at in rows.all():
            if not created_at or not shipped_at:
                continue
            hours = (shipped_at - created_at).total_seconds() / 3600.0
            if hours < 0 or hours > 24 * 365:
                continue
            key = str(courier or "unknown")
            durations.setdefault(key, []).append(float(hours))
        return durations

    async def _collect_delivery_durations(window_start: datetime, window_end: datetime) -> dict[str, list[float]]:
        rows = await session.execute(
            select(courier_col, shipped_subq.c.shipped_at, delivered_subq.c.delivered_at)
            .select_from(Order)
            .join(delivered_subq, delivered_subq.c.order_id == Order.id)
            .join(shipped_subq, shipped_subq.c.order_id == Order.id)
            .where(
                delivered_subq.c.delivered_at >= window_start,
                delivered_subq.c.delivered_at < window_end,
                exclude_test_orders,
            )
        )
        durations: dict[str, list[float]] = {}
        for courier, shipped_at, delivered_at in rows.all():
            if not shipped_at or not delivered_at:
                continue
            hours = (delivered_at - shipped_at).total_seconds() / 3600.0
            if hours < 0 or hours > 24 * 365:
                continue
            key = str(courier or "unknown")
            durations.setdefault(key, []).append(float(hours))
        return durations

    def _avg(values: list[float]) -> float | None:
        if not values:
            return None
        return sum(values) / len(values)

    current_ship = await _collect_ship_durations(start, now)
    previous_ship = await _collect_ship_durations(prev_start, start)

    ship_rows: list[dict] = []
    for courier in sorted(set(current_ship) | set(previous_ship)):
        cur_avg = _avg(current_ship.get(courier, []))
        prev_avg = _avg(previous_ship.get(courier, []))
        ship_rows.append(
            {
                "courier": courier,
                "current": {"count": len(current_ship.get(courier, [])), "avg_hours": cur_avg},
                "previous": {"count": len(previous_ship.get(courier, [])), "avg_hours": prev_avg},
                "delta_pct": {
                    "avg_hours": _delta_pct(cur_avg, prev_avg),
                    "count": _delta_pct(float(len(current_ship.get(courier, []))), float(len(previous_ship.get(courier, [])))),
                },
            }
        )
    ship_rows.sort(key=lambda row: (row.get("current", {}).get("count", 0), row.get("courier", "")), reverse=True)

    current_delivery = await _collect_delivery_durations(start, now)
    previous_delivery = await _collect_delivery_durations(prev_start, start)

    delivery_rows: list[dict] = []
    for courier in sorted(set(current_delivery) | set(previous_delivery)):
        cur_avg = _avg(current_delivery.get(courier, []))
        prev_avg = _avg(previous_delivery.get(courier, []))
        delivery_rows.append(
            {
                "courier": courier,
                "current": {"count": len(current_delivery.get(courier, [])), "avg_hours": cur_avg},
                "previous": {"count": len(previous_delivery.get(courier, [])), "avg_hours": prev_avg},
                "delta_pct": {
                    "avg_hours": _delta_pct(cur_avg, prev_avg),
                    "count": _delta_pct(float(len(current_delivery.get(courier, []))), float(len(previous_delivery.get(courier, [])))),
                },
            }
        )
    delivery_rows.sort(key=lambda row: (row.get("current", {}).get("count", 0), row.get("courier", "")), reverse=True)

    return {
        "window_days": int(window_days),
        "window_start": start,
        "window_end": now,
        "time_to_ship": ship_rows,
        "delivery_time": delivery_rows,
    }


@router.get("/stockout-impact")
async def admin_stockout_impact(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("inventory")),
    window_days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=8, ge=1, le=30),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=int(window_days))
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

    restock_rows = await inventory_service.list_restock_list(
        session,
        include_variants=False,
        default_threshold=DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD,
    )
    stockouts = [row for row in restock_rows if int(getattr(row, "available_quantity", 0) or 0) <= 0]
    if not stockouts:
        return {"window_days": int(window_days), "window_start": since, "window_end": now, "items": []}

    product_ids = [row.product_id for row in stockouts]

    demand_rows = await session.execute(
        select(
            OrderItem.product_id,
            func.coalesce(func.sum(OrderItem.quantity), 0).label("units"),
            func.coalesce(func.sum(OrderItem.subtotal), 0).label("revenue"),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.created_at >= since,
            Order.created_at < now,
            Order.status.in_(successful_statuses),
            OrderItem.product_id.in_(product_ids),
            exclude_test_orders,
        )
        .group_by(OrderItem.product_id)
    )
    demand_map = {
        row[0]: (int(row[1] or 0), float(row[2] or 0))
        for row in demand_rows.all()
    }

    product_rows = await session.execute(
        select(
            Product.id,
            Product.base_price,
            Product.sale_price,
            Product.currency,
            Product.allow_backorder,
        ).where(Product.id.in_(product_ids))
    )
    product_map = {
        row[0]: {
            "base_price": float(row[1] or 0),
            "sale_price": float(row[2] or 0) if row[2] is not None else None,
            "currency": str(row[3] or "RON"),
            "allow_backorder": bool(row[4]),
        }
        for row in product_rows.all()
    }

    items: list[dict] = []
    for row in stockouts:
        meta = product_map.get(row.product_id, {})
        allow_backorder = bool(meta.get("allow_backorder", False))
        base_price = float(meta.get("base_price", 0) or 0)
        sale_price = meta.get("sale_price")
        current_price = float(sale_price if sale_price is not None else base_price)

        demand_units, demand_revenue = demand_map.get(row.product_id, (0, 0.0))
        avg_price = float(demand_revenue / demand_units) if demand_units > 0 else current_price
        reserved_carts = int(getattr(row, "reserved_in_carts", 0) or 0)
        reserved_orders = int(getattr(row, "reserved_in_orders", 0) or 0)
        estimated_missed = 0.0 if allow_backorder else float(reserved_carts) * avg_price

        items.append(
            {
                "product_id": str(row.product_id),
                "product_slug": row.product_slug,
                "product_name": row.product_name,
                "available_quantity": int(getattr(row, "available_quantity", 0) or 0),
                "reserved_in_carts": reserved_carts,
                "reserved_in_orders": reserved_orders,
                "stock_quantity": int(getattr(row, "stock_quantity", 0) or 0),
                "demand_units": int(demand_units),
                "demand_revenue": float(demand_revenue),
                "estimated_missed_revenue": float(estimated_missed),
                "currency": str(meta.get("currency") or "RON"),
                "allow_backorder": allow_backorder,
            }
        )

    items.sort(
        key=lambda item: (
            float(item.get("estimated_missed_revenue", 0)),
            float(item.get("demand_revenue", 0)),
            int(item.get("reserved_in_carts", 0)),
        ),
        reverse=True,
    )

    return {
        "window_days": int(window_days),
        "window_start": since,
        "window_end": now,
        "items": items[: int(limit)],
    }


@router.get("/channel-attribution")
async def admin_channel_attribution(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("dashboard")),
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=50),
) -> dict:
    now = datetime.now(timezone.utc)
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    sales_statuses = (*successful_statuses, OrderStatus.refunded)

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
        end = datetime.combine(range_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        effective_range_days = (range_to - range_from).days + 1
    else:
        start = now - timedelta(days=range_days)
        end = now
        effective_range_days = range_days

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)

    total_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    total_gross_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .where(
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )

    checkout_rows = await session.execute(
        select(AnalyticsEvent.session_id, AnalyticsEvent.order_id)
        .select_from(AnalyticsEvent)
        .where(
            AnalyticsEvent.event == "checkout_success",
            AnalyticsEvent.created_at >= start,
            AnalyticsEvent.created_at < end,
            AnalyticsEvent.order_id.is_not(None),
        )
        .order_by(AnalyticsEvent.created_at.asc())
    )
    order_to_session: dict[UUID, str] = {}
    session_ids: set[str] = set()
    for session_id, order_id in checkout_rows.all():
        if not session_id or not order_id:
            continue
        if order_id in order_to_session:
            continue
        order_to_session[order_id] = str(session_id)
        session_ids.add(str(session_id))

    if not order_to_session:
        return {
            "range_days": int(effective_range_days),
            "range_from": start.date().isoformat(),
            "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
            "total_orders": int(total_orders or 0),
            "total_gross_sales": float(total_gross_sales or 0),
            "tracked_orders": 0,
            "tracked_gross_sales": 0.0,
            "coverage_pct": None if not total_orders else 0.0,
            "channels": [],
        }

    order_ids = list(order_to_session.keys())
    order_rows = await session.execute(
        select(Order.id, Order.total_amount)
        .select_from(Order)
        .where(
            Order.id.in_(order_ids),
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    order_amounts = {row[0]: float(row[1] or 0) for row in order_rows.all()}

    session_start_rows = await session.execute(
        select(AnalyticsEvent.session_id, AnalyticsEvent.payload, AnalyticsEvent.created_at)
        .select_from(AnalyticsEvent)
        .where(
            AnalyticsEvent.event == "session_start",
            AnalyticsEvent.session_id.in_(session_ids),
        )
        .order_by(AnalyticsEvent.created_at.asc())
    )
    session_payload: dict[str, dict | None] = {}
    for session_id, payload, _created_at in session_start_rows.all():
        key = str(session_id)
        if key in session_payload:
            continue
        session_payload[key] = payload if isinstance(payload, dict) else None

    def _normalize(value: object) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip()

    def _extract_channel(payload: dict | None) -> tuple[str, str | None, str | None]:
        src = _normalize((payload or {}).get("utm_source")).lower()
        med = _normalize((payload or {}).get("utm_medium")).lower() or None
        camp = _normalize((payload or {}).get("utm_campaign")) or None
        if not src:
            return ("direct", None, None)
        return (src, med, camp)

    channels: dict[tuple[str, str | None, str | None], dict[str, float]] = {}
    tracked_orders = 0
    tracked_sales = 0.0
    for order_id, session_id in order_to_session.items():
        amount = order_amounts.get(order_id)
        if amount is None:
            continue
        tracked_orders += 1
        tracked_sales += float(amount)
        payload = session_payload.get(session_id)
        src, med, camp = _extract_channel(payload)
        key = (src, med, camp)
        entry = channels.setdefault(key, {"orders": 0.0, "gross_sales": 0.0})
        entry["orders"] += 1.0
        entry["gross_sales"] += float(amount)

    channel_rows: list[dict] = []
    for (src, med, camp), entry in channels.items():
        channel_rows.append(
            {
                "source": src,
                "medium": med,
                "campaign": camp,
                "orders": int(entry.get("orders", 0) or 0),
                "gross_sales": float(entry.get("gross_sales", 0) or 0),
            }
        )
    channel_rows.sort(key=lambda row: (row.get("gross_sales", 0), row.get("orders", 0)), reverse=True)

    coverage_pct = None
    if total_orders:
        coverage_pct = tracked_orders / int(total_orders or 1)

    return {
        "range_days": int(effective_range_days),
        "range_from": start.date().isoformat(),
        "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
        "total_orders": int(total_orders or 0),
        "total_gross_sales": float(total_gross_sales or 0),
        "tracked_orders": int(tracked_orders),
        "tracked_gross_sales": float(tracked_sales),
        "coverage_pct": coverage_pct,
        "channels": channel_rows[: int(limit)],
    }


@router.get("/search", response_model=AdminDashboardSearchResponse)
async def admin_global_search(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("dashboard")),
    q: str = Query(..., min_length=1, max_length=255),
    include_pii: bool = Query(default=False),
) -> AdminDashboardSearchResponse:
    needle = (q or "").strip()
    if not needle:
        return AdminDashboardSearchResponse(items=[])
    if include_pii:
        pii_service.require_pii_reveal(current_user)

    parsed_uuid: UUID | None = None
    try:
        parsed_uuid = UUID(needle)
    except ValueError:
        parsed_uuid = None

    results: list[AdminDashboardSearchResult] = []

    if parsed_uuid is not None:
        order = await session.get(Order, parsed_uuid)
        if order:
            subtitle = (order.customer_email or "").strip() or None
            if not include_pii:
                subtitle = pii_service.mask_email(subtitle)
            results.append(
                AdminDashboardSearchResult(
                    type="order",
                    id=str(order.id),
                    label=(order.reference_code or str(order.id)),
                    subtitle=subtitle,
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
            email_value = user.email if include_pii else (pii_service.mask_email(user.email) or user.email)
            subtitle = (user.username or "").strip() or None
            results.append(
                AdminDashboardSearchResult(
                    type="user",
                    id=str(user.id),
                    email=email_value,
                    label=email_value,
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
        subtitle = (order.customer_email or "").strip() or None
        if not include_pii:
            subtitle = pii_service.mask_email(subtitle)
        results.append(
            AdminDashboardSearchResult(
                type="order",
                id=str(order.id),
                label=(order.reference_code or str(order.id)),
                subtitle=subtitle,
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
        email_value = user.email if include_pii else (pii_service.mask_email(user.email) or user.email)
        subtitle = (user.username or "").strip() or None
        results.append(
            AdminDashboardSearchResult(
                type="user",
                id=str(user.id),
                email=email_value,
                label=email_value,
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
    current_user: User = Depends(require_admin_section("dashboard")),
    include_pii: bool = Query(default=False),
) -> list[dict]:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
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
            "customer": (email or "guest") if include_pii or not email else (pii_service.mask_email(email) or email),
        }
        for order, email in rows
    ]


@router.get("/users")
async def admin_users(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("dashboard")),
    include_pii: bool = Query(default=False),
) -> list[dict]:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
    result = await session.execute(
        select(User).order_by(User.created_at.desc()).limit(20)
    )
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "email": u.email if include_pii else (pii_service.mask_email(u.email) or u.email),
            "username": u.username,
            "name": u.name if include_pii else pii_service.mask_text(u.name, keep=1),
            "name_tag": u.name_tag,
            "role": u.role,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.get("/users/search", response_model=AdminUserListResponse)
async def search_users(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    role: UserRole | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
) -> AdminUserListResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
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
            email=u.email if include_pii else (pii_service.mask_email(u.email) or u.email),
            username=u.username,
            name=u.name if include_pii else pii_service.mask_text(u.name, keep=1),
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


def _user_order_stats_subquery() -> object:
    successful = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    return (
        select(
            Order.user_id.label("user_id"),
            func.count(Order.id).label("orders_count"),
            func.coalesce(func.sum(Order.total_amount), 0).label("total_spent"),
            func.coalesce(func.avg(Order.total_amount), 0).label("avg_order_value"),
        )
        .where(Order.user_id.is_not(None), Order.status.in_(successful))
        .group_by(Order.user_id)
        .subquery()
    )


@router.get("/users/segments/repeat-buyers", response_model=AdminUserSegmentResponse)
async def admin_user_segment_repeat_buyers(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    min_orders: int = Query(default=2, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
) -> AdminUserSegmentResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
    offset = (page - 1) * limit
    stats = _user_order_stats_subquery()

    stmt = (
        select(User, stats.c.orders_count, stats.c.total_spent, stats.c.avg_order_value)  # type: ignore[attr-defined]
        .join(stats, stats.c.user_id == User.id)  # type: ignore[attr-defined]
        .where(
            User.deleted_at.is_(None),
            User.role == UserRole.customer,
            stats.c.orders_count >= min_orders,  # type: ignore[attr-defined]
        )
    )
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(User.email).ilike(like)
            | func.lower(User.username).ilike(like)
            | func.lower(User.name).ilike(like)
        )

    total_items = int(
        await session.scalar(stmt.with_only_columns(func.count()).order_by(None)) or 0
    )
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        await session.execute(
            stmt.order_by(
                stats.c.orders_count.desc(),  # type: ignore[attr-defined]
                stats.c.total_spent.desc(),  # type: ignore[attr-defined]
                User.created_at.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items: list[AdminUserSegmentListItem] = []
    for user, orders_count, total_spent, avg_order_value in rows:
        items.append(
            AdminUserSegmentListItem(
                user=AdminUserListItem(
                    id=user.id,
                    email=user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
                    username=user.username,
                    name=user.name if include_pii else pii_service.mask_text(user.name, keep=1),
                    name_tag=user.name_tag,
                    role=user.role,
                    email_verified=bool(user.email_verified),
                    created_at=user.created_at,
                ),
                orders_count=int(orders_count or 0),
                total_spent=float(total_spent or 0),
                avg_order_value=float(avg_order_value or 0),
            )
        )

    return AdminUserSegmentResponse(
        items=items,
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


@router.get("/users/segments/high-aov", response_model=AdminUserSegmentResponse)
async def admin_user_segment_high_aov(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    min_orders: int = Query(default=1, ge=1, le=100),
    min_aov: float = Query(default=0, ge=0),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=True),
) -> AdminUserSegmentResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
    offset = (page - 1) * limit
    stats = _user_order_stats_subquery()

    stmt = (
        select(User, stats.c.orders_count, stats.c.total_spent, stats.c.avg_order_value)  # type: ignore[attr-defined]
        .join(stats, stats.c.user_id == User.id)  # type: ignore[attr-defined]
        .where(
            User.deleted_at.is_(None),
            User.role == UserRole.customer,
            stats.c.orders_count >= min_orders,  # type: ignore[attr-defined]
            stats.c.avg_order_value >= min_aov,  # type: ignore[attr-defined]
        )
    )
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(User.email).ilike(like)
            | func.lower(User.username).ilike(like)
            | func.lower(User.name).ilike(like)
        )

    total_items = int(
        await session.scalar(stmt.with_only_columns(func.count()).order_by(None)) or 0
    )
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1

    rows = (
        await session.execute(
            stmt.order_by(
                stats.c.avg_order_value.desc(),  # type: ignore[attr-defined]
                stats.c.orders_count.desc(),  # type: ignore[attr-defined]
                stats.c.total_spent.desc(),  # type: ignore[attr-defined]
                User.created_at.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items: list[AdminUserSegmentListItem] = []
    for user, orders_count, total_spent, avg_order_value in rows:
        items.append(
            AdminUserSegmentListItem(
                user=AdminUserListItem(
                    id=user.id,
                    email=user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
                    username=user.username,
                    name=user.name if include_pii else pii_service.mask_text(user.name, keep=1),
                    name_tag=user.name_tag,
                    role=user.role,
                    email_verified=bool(user.email_verified),
                    created_at=user.created_at,
                ),
                orders_count=int(orders_count or 0),
                total_spent=float(total_spent or 0),
                avg_order_value=float(avg_order_value or 0),
            )
        )

    return AdminUserSegmentResponse(
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
    current_user: User = Depends(require_admin_section("users")),
    include_pii: bool = Query(default=False),
) -> dict:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
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
            "email": user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
            "username": user.username,
            "name": user.name if include_pii else pii_service.mask_text(user.name, keep=1),
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
    current_user: User = Depends(require_admin_section("users")),
    include_pii: bool = Query(default=False),
) -> AdminUserProfileResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
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

    addresses_payload: list[dict[str, Any]] | list[Address]
    if include_pii:
        addresses_payload = addresses
    else:
        addresses_payload = [
            {
                "id": addr.id,
                "label": addr.label,
                "phone": pii_service.mask_phone(addr.phone),
                "line1": "***",
                "line2": "***" if (addr.line2 or "").strip() else None,
                "city": "***",
                "region": "***" if (addr.region or "").strip() else None,
                "postal_code": "***",
                "country": addr.country,
                "is_default_shipping": bool(getattr(addr, "is_default_shipping", False)),
                "is_default_billing": bool(getattr(addr, "is_default_billing", False)),
                "created_at": addr.created_at,
                "updated_at": addr.updated_at,
            }
            for addr in addresses
        ]

    user_email = user.email if include_pii else (pii_service.mask_email(user.email) or user.email)
    user_name = user.name if include_pii else pii_service.mask_text(user.name, keep=1)

    return AdminUserProfileResponse(
        user=AdminUserProfileUser(
            id=user.id,
            email=user_email,
            username=user.username,
            name=user_name,
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
        addresses=addresses_payload,
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
        select(ContentBlock)
        .options(selectinload(ContentBlock.author))
        .order_by(ContentBlock.updated_at.desc())
        .limit(200)
    )
    blocks = result.scalars().all()
    return [
        {
            "id": str(b.id),
            "key": b.key,
            "title": b.title,
            "updated_at": b.updated_at,
            "version": b.version,
            "status": b.status,
            "lang": b.lang,
            "published_at": b.published_at,
            "published_until": b.published_until,
            "needs_translation_en": bool(getattr(b, "needs_translation_en", False)),
            "needs_translation_ro": bool(getattr(b, "needs_translation_ro", False)),
            "author": (
                {
                    "id": str(b.author.id),
                    "username": b.author.username,
                    "name": b.author.name,
                    "name_tag": b.author.name_tag,
                }
                if getattr(b, "author", None)
                else None
            ),
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
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("audit")),
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
            tokens = [token.strip() for token in re.split(r"[|,]+", needle) if token.strip()]
            if len(tokens) <= 1:
                filters.append(
                    func.lower(getattr(audit.c, "action")).like(f"%{needle}%")  # type: ignore[attr-defined]
                )
            else:
                action_col = func.lower(getattr(audit.c, "action"))  # type: ignore[attr-defined]
                filters.append(or_(*[action_col.like(f"%{token}%") for token in tokens]))

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


_AUDIT_EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])([\w.+-]{1,64})@([\w-]{1,255}(?:\.[\w-]{2,})+)")
_AUDIT_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_AUDIT_IPV6_RE = re.compile(r"\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b")
_AUDIT_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@")


def _audit_mask_email(value: str) -> str:
    raw = (value or "").strip()
    if not raw or "@" not in raw:
        return raw
    local, _, domain = raw.partition("@")
    if not local or not domain:
        return raw
    if len(local) <= 1:
        masked_local = "*"
    else:
        masked_local = f"{local[0]}{'*' * (min(len(local) - 1, 8))}"
    return f"{masked_local}@{domain}"


def _audit_redact_text(value: str) -> str:
    text = value or ""

    def _mask(match: re.Match) -> str:
        return _audit_mask_email(match.group(0))

    text = _AUDIT_EMAIL_RE.sub(_mask, text)
    text = _AUDIT_IPV4_RE.sub("***.***.***.***", text)
    text = _AUDIT_IPV6_RE.sub("****:****:****:****", text)
    return text


def _audit_csv_cell(value: str) -> str:
    cleaned = (value or "").replace("\n", " ").replace("\r", " ").strip()
    if cleaned and cleaned[0] in _AUDIT_CSV_FORMULA_PREFIXES:
        return f"'{cleaned}"
    return cleaned


@router.get("/audit/entries")
async def admin_audit_entries(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("audit")),
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
    current_user: User = Depends(require_admin_section("audit")),
    entity: str | None = Query(
        default="all", pattern="^(all|product|content|security)$"
    ),
    action: str | None = Query(default=None, max_length=120),
    user: str | None = Query(default=None, max_length=255),
    redact: bool = Query(default=True),
) -> Response:
    if not redact and current_user.role != UserRole.owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner access required for unredacted exports",
        )

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
        actor_email = str(row.get("actor_email") or "")
        subject_email = str(row.get("subject_email") or "")
        data_raw = str(row.get("data") or "")

        if redact:
            actor_email = _audit_mask_email(actor_email)
            subject_email = _audit_mask_email(subject_email)
            data_raw = _audit_redact_text(data_raw)

        writer.writerow(
            [
                created_at.isoformat() if isinstance(created_at, datetime) else "",
                _audit_csv_cell(str(row.get("entity") or "")),
                _audit_csv_cell(str(row.get("action") or "")),
                _audit_csv_cell(actor_email),
                _audit_csv_cell(subject_email),
                _audit_csv_cell(str(row.get("ref_key") or "")),
                _audit_csv_cell(str(row.get("ref_id") or "")),
                _audit_csv_cell(str(row.get("actor_user_id") or "")),
                _audit_csv_cell(str(row.get("subject_user_id") or "")),
                _audit_csv_cell(data_raw),
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


def _audit_retention_policies(now: datetime) -> dict[str, dict]:
    policies = {
        "product": int(getattr(settings, "audit_retention_days_product", 0) or 0),
        "content": int(getattr(settings, "audit_retention_days_content", 0) or 0),
        "security": int(getattr(settings, "audit_retention_days_security", 0) or 0),
    }
    out: dict[str, dict] = {}
    for key, days in policies.items():
        enabled = days > 0
        cutoff = now - timedelta(days=days) if enabled else None
        out[key] = {"days": days, "enabled": enabled, "cutoff": cutoff.isoformat() if cutoff else None}
    return out


async def _audit_retention_counts(session: AsyncSession, model: Any, cutoff: datetime | None) -> dict:
    table = model.__table__
    total = await session.scalar(select(func.count()).select_from(table))
    total_int = int(total or 0)
    expired_int = 0
    if cutoff is not None:
        expired = await session.scalar(
            select(func.count()).select_from(table).where(table.c.created_at < cutoff)
        )
        expired_int = int(expired or 0)
    return {"total": total_int, "expired": expired_int}


@router.get("/audit/retention")
async def admin_audit_retention(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("audit")),
) -> dict:
    now = datetime.now(timezone.utc)
    policies = _audit_retention_policies(now)
    counts = {
        "product": await _audit_retention_counts(session, ProductAuditLog, _iso_to_dt(policies["product"]["cutoff"])),
        "content": await _audit_retention_counts(session, ContentAuditLog, _iso_to_dt(policies["content"]["cutoff"])),
        "security": await _audit_retention_counts(session, AdminAuditLog, _iso_to_dt(policies["security"]["cutoff"])),
    }
    return {"now": now.isoformat(), "policies": policies, "counts": counts}


def _iso_to_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


@router.post("/audit/retention/purge")
async def admin_audit_retention_purge(
    payload: dict = Body(default_factory=dict),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("audit")),
) -> dict:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    confirm = str(payload.get("confirm") or "").strip()
    if confirm.upper() != "PURGE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Type "PURGE" to confirm')
    dry_run = bool(payload.get("dry_run"))

    now = datetime.now(timezone.utc)
    policies = _audit_retention_policies(now)
    cutoffs = {
        "product": _iso_to_dt(policies["product"]["cutoff"]),
        "content": _iso_to_dt(policies["content"]["cutoff"]),
        "security": _iso_to_dt(policies["security"]["cutoff"]),
    }

    counts = {
        "product": await _audit_retention_counts(session, ProductAuditLog, cutoffs["product"]),
        "content": await _audit_retention_counts(session, ContentAuditLog, cutoffs["content"]),
        "security": await _audit_retention_counts(session, AdminAuditLog, cutoffs["security"]),
    }

    deleted: dict[str, int] = {"product": 0, "content": 0, "security": 0}
    if not dry_run:
        for key, model in (
            ("product", ProductAuditLog),
            ("content", ContentAuditLog),
            ("security", AdminAuditLog),
        ):
            cutoff = cutoffs[key]
            expired = int(counts[key]["expired"] or 0)
            if cutoff is None or expired <= 0:
                continue
            table = model.__table__
            await session.execute(delete(table).where(table.c.created_at < cutoff))
            deleted[key] = expired

        await audit_chain_service.add_admin_audit_log(
            session,
            action="audit.retention.purge",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={
                "dry_run": dry_run,
                "deleted": deleted,
                "policies": {k: v["days"] for k, v in policies.items()},
            },
        )
        await session.commit()

    return {
        "dry_run": dry_run,
        "now": now.isoformat(),
        "policies": policies,
        "counts": counts,
        "deleted": deleted,
    }


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
        await audit_chain_service.add_admin_audit_log(
            session,
            action="user.sessions.revoke_all",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "revoked_count": len(sessions),
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
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
        await audit_chain_service.add_admin_audit_log(
            session,
            action="user.sessions.revoke_one",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "refresh_session_id": str(row.id),
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
        await session.commit()

    return None


@router.get("/gdpr/exports", response_model=AdminGdprExportJobsResponse)
async def admin_gdpr_export_jobs(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    status_filter: UserDataExportStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
) -> AdminGdprExportJobsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
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
                    email=user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
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
    await audit_chain_service.add_admin_audit_log(
        session,
        action="gdpr.export.retry",
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        data={
            "job_id": str(job.id),
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
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

    await audit_chain_service.add_admin_audit_log(
        session,
        action="gdpr.export.download",
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        data={
            "job_id": str(job.id),
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
    )
    await session.commit()

    stamp = (job.finished_at or job.created_at or datetime.now(timezone.utc)).date().isoformat()
    filename = f"moment-studio-export-{stamp}.json"
    return FileResponse(path, media_type="application/json", filename=filename, headers={"Cache-Control": "no-store"})


@router.get("/gdpr/deletions", response_model=AdminGdprDeletionRequestsResponse)
async def admin_gdpr_deletion_requests(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
) -> AdminGdprDeletionRequestsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
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
                user=AdminGdprUserRef(
                    id=user.id,
                    email=user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
                    username=user.username,
                    role=user.role,
                ),
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
    await audit_chain_service.add_admin_audit_log(
        session,
        action="gdpr.deletion.execute",
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        data={
            "email_before": email_before,
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
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
        await audit_chain_service.add_admin_audit_log(
            session,
            action="gdpr.deletion.cancel",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
        )
        await session.commit()
    return None


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: UUID,
    payload: dict,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> dict:
    if current_user.role not in (UserRole.owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner/admin can change user roles")

    password = str(payload.get("password") or "")
    if not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required")
    if not security.verify_password(password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

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
    before_role = user.role
    user.role = UserRole(role)
    session.add(user)
    await session.flush()
    await audit_chain_service.add_admin_audit_log(
        session,
        action="user.role.update",
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        data={
            "before": getattr(before_role, "value", str(before_role)),
            "after": getattr(user.role, "value", str(user.role)),
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
    )
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
        await audit_chain_service.add_admin_audit_log(
            session,
            action="user.internal.update",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={"changes": changes},
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
        await audit_chain_service.add_admin_audit_log(
            session,
            action="user.security.update",
            actor_user_id=current_user.id,
            subject_user_id=user.id,
            data={
                "changes": changes,
                "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
                "ip_address": (request.client.host if request.client else None),
            },
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
    await audit_chain_service.add_admin_audit_log(
        session,
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
        await audit_chain_service.add_admin_audit_log(
            session,
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

    await audit_chain_service.add_admin_audit_log(
        session,
        action="user.impersonation.start",
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        data={
            "expires_minutes": expires_minutes,
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
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
    await audit_chain_service.add_admin_audit_log(
        session,
        action="owner_transfer",
        actor_user_id=current_owner.id,
        subject_user_id=target.id,
        data={
            "identifier": identifier,
            "old_owner_id": str(current_owner.id),
            "new_owner_id": str(target.id),
        },
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


@router.get("/stock-adjustments/export")
async def export_stock_adjustments(
    product_id: UUID = Query(...),
    reason: StockAdjustmentReason | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("inventory")),
) -> Response:
    if from_date and to_date and to_date < from_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid date range")

    product = await session.get(Product, product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    stmt = (
        select(StockAdjustment, ProductVariant, User)
        .select_from(StockAdjustment)
        .outerjoin(ProductVariant, ProductVariant.id == StockAdjustment.variant_id)
        .outerjoin(User, User.id == StockAdjustment.actor_user_id)
        .where(StockAdjustment.product_id == product_id)
    )
    if reason is not None:
        stmt = stmt.where(StockAdjustment.reason == reason)
    if from_date is not None:
        stmt = stmt.where(func.date(StockAdjustment.created_at) >= from_date)
    if to_date is not None:
        stmt = stmt.where(func.date(StockAdjustment.created_at) <= to_date)

    rows = (
        (await session.execute(stmt.order_by(StockAdjustment.created_at.desc()).limit(limit)))
        .all()
    )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "created_at",
            "product_slug",
            "product_name",
            "sku",
            "variant_id",
            "variant_name",
            "reason",
            "delta",
            "before_quantity",
            "after_quantity",
            "note",
            "actor_email",
            "actor_user_id",
        ]
    )
    for adjustment, variant, actor in rows:
        created_at = getattr(adjustment, "created_at", None)
        writer.writerow(
            [
                created_at.isoformat() if isinstance(created_at, datetime) else "",
                product.slug,
                product.name,
                product.sku,
                str(adjustment.variant_id) if adjustment.variant_id else "",
                getattr(variant, "name", "") or "",
                adjustment.reason.value,
                int(adjustment.delta),
                int(adjustment.before_quantity),
                int(adjustment.after_quantity),
                (adjustment.note or ""),
                getattr(actor, "email", "") or "",
                str(adjustment.actor_user_id) if adjustment.actor_user_id else "",
            ]
        )

    filename = f"stock-adjustments-{product.slug}-{datetime.now(timezone.utc).date().isoformat()}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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


@router.get("/inventory/reservations/carts", response_model=CartReservationsResponse)
async def inventory_reserved_carts(
    product_id: UUID = Query(...),
    variant_id: UUID | None = Query(default=None),
    include_pii: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("inventory")),
) -> CartReservationsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)

    product = await session.get(Product, product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if variant_id is not None:
        variant = await session.get(ProductVariant, variant_id)
        if not variant or variant.product_id != product.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")

    cutoff, rows = await inventory_service.list_cart_reservations(
        session,
        product_id=product.id,
        variant_id=variant_id,
        limit=limit,
        offset=offset,
    )
    items: list[dict] = []
    for row in rows:
        email_raw = str(row.get("customer_email") or "").strip() or None
        email_value = email_raw
        if email_value and not include_pii:
            email_value = pii_service.mask_email(email_value) or email_value
        items.append(
            {
                "cart_id": row.get("cart_id"),
                "updated_at": row.get("updated_at"),
                "customer_email": email_value,
                "quantity": int(row.get("quantity") or 0),
            }
        )

    return CartReservationsResponse(cutoff=cutoff, items=items)


@router.get("/inventory/reservations/orders", response_model=OrderReservationsResponse)
async def inventory_reserved_orders(
    product_id: UUID = Query(...),
    variant_id: UUID | None = Query(default=None),
    include_pii: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("inventory")),
) -> OrderReservationsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user)

    product = await session.get(Product, product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if variant_id is not None:
        variant = await session.get(ProductVariant, variant_id)
        if not variant or variant.product_id != product.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")

    rows = await inventory_service.list_order_reservations(
        session,
        product_id=product.id,
        variant_id=variant_id,
        limit=limit,
        offset=offset,
    )
    items: list[dict] = []
    for row in rows:
        email_raw = str(row.get("customer_email") or "").strip() or None
        email_value = email_raw
        if email_value and not include_pii:
            email_value = pii_service.mask_email(email_value) or email_value
        items.append(
            {
                "order_id": row.get("order_id"),
                "reference_code": row.get("reference_code"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "customer_email": email_value,
                "quantity": int(row.get("quantity") or 0),
            }
        )

    return OrderReservationsResponse(items=items)


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
