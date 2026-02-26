import csv
import io
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any
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
from app.core.rate_limit import limiter
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
from app.models.user import (
    AdminAuditLog,
    EmailVerificationToken,
    RefreshSession,
    User,
    UserRole,
    UserSecurityEvent,
    UserSecondaryEmail,
)
from app.models.admin_dashboard_settings import AdminDashboardAlertThresholds
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.coupons import Promotion
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
from app.services import step_up as step_up_service
from app.schemas.user_admin import (
    AdminEmailVerificationHistoryResponse,
    AdminEmailVerificationTokenInfo,
    AdminOwnerTransferRequest,
    AdminPasswordResetResendRequest,
    AdminUserDeleteRequest,
    AdminUserImpersonationResponse,
    AdminUserInternalUpdate,
    AdminUserRoleUpdateRequest,
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
admin_password_reset_resend_rate_limit = limiter(
    "admin:password_reset_resend", settings.auth_rate_limit_reset_request, 60
)


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


def _decimal_or_none(value: float | int | str | Decimal | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


@router.get("/alert-thresholds")
async def admin_get_alert_thresholds(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
) -> AdminDashboardAlertThresholdsResponse:
    record = await _get_dashboard_alert_thresholds(session)
    return AdminDashboardAlertThresholdsResponse(**_dashboard_alert_thresholds_payload(record))


@router.put("/alert-thresholds")
async def admin_update_alert_thresholds(
    payload: AdminDashboardAlertThresholdsUpdateRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_owner)],
) -> AdminDashboardAlertThresholdsResponse:
    record = await _get_dashboard_alert_thresholds(session)
    before_full = _dashboard_alert_thresholds_payload(record)
    before = {k: v for k, v in before_full.items() if k != "updated_at"}

    record.failed_payments_min_count = int(payload.failed_payments_min_count)
    record.failed_payments_min_delta_pct = _decimal_or_none(payload.failed_payments_min_delta_pct)
    record.refund_requests_min_count = int(payload.refund_requests_min_count)
    record.refund_requests_min_rate_pct = _decimal_or_none(payload.refund_requests_min_rate_pct)
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


def _summary_delta_pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return (current - previous) / previous * 100.0


def _summary_rate_pct(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator * 100.0


def _summary_resolve_range(
    now: datetime,
    range_days: int,
    range_from: date | None,
    range_to: date | None,
) -> tuple[datetime, datetime, int]:
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
        return start, end, (range_to - range_from).days + 1
    return now - timedelta(days=range_days), now, range_days


async def _summary_totals(session: AsyncSession, exclude_test_orders: Any) -> dict[str, int]:
    products_total = await session.scalar(
        select(func.count()).select_from(Product).where(Product.is_deleted.is_(False))
    )
    orders_total = await session.scalar(select(func.count()).select_from(Order).where(exclude_test_orders))
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
    return {
        "products": int(products_total or 0),
        "orders": int(orders_total or 0),
        "users": int(users_total or 0),
        "low_stock": int(low_stock or 0),
    }


async def _summary_sales_metrics(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    successful_statuses: tuple[OrderStatus, ...],
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
) -> dict[str, float | int]:
    window_filters = (Order.created_at >= start, Order.created_at < end, exclude_test_orders)
    sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            *window_filters, Order.status.in_(successful_statuses)
        )
    )
    gross_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            *window_filters, Order.status.in_(sales_statuses)
        )
    )
    refunds = await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(*window_filters, Order.status.in_(sales_statuses))
    )
    missing_refunds = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(*window_filters, Order.status == OrderStatus.refunded, OrderRefund.id.is_(None))
    )
    orders = await session.scalar(select(func.count()).select_from(Order).where(*window_filters))
    gross_sales_value = float(gross_sales or 0)
    refunds_value = float(refunds or 0)
    missing_refunds_value = float(missing_refunds or 0)
    return {
        "sales": float(sales or 0),
        "gross_sales": gross_sales_value,
        "net_sales": gross_sales_value - refunds_value - missing_refunds_value,
        "orders": int(orders or 0),
    }


async def _summary_refunded_order_count(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    exclude_test_orders: Any,
) -> int:
    refunded_orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.refunded,
            Order.updated_at >= start,
            Order.updated_at < end,
            exclude_test_orders,
        )
    )
    return int(refunded_orders or 0)


async def _summary_day_metrics(
    session: AsyncSession,
    now: datetime,
    successful_statuses: tuple[OrderStatus, ...],
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
) -> dict[str, float | int | None]:
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    today_metrics = await _summary_sales_metrics(
        session, today_start, now, successful_statuses, sales_statuses, exclude_test_orders
    )
    yesterday_metrics = await _summary_sales_metrics(
        session, yesterday_start, today_start, successful_statuses, sales_statuses, exclude_test_orders
    )
    today_refunds = await _summary_refunded_order_count(session, today_start, now, exclude_test_orders)
    yesterday_refunds = await _summary_refunded_order_count(
        session, yesterday_start, today_start, exclude_test_orders
    )
    today_orders = int(today_metrics["orders"])
    yesterday_orders = int(yesterday_metrics["orders"])
    today_sales = float(today_metrics["sales"])
    yesterday_sales = float(yesterday_metrics["sales"])
    gross_today_sales = float(today_metrics["gross_sales"])
    gross_yesterday_sales = float(yesterday_metrics["gross_sales"])
    net_today_sales = float(today_metrics["net_sales"])
    net_yesterday_sales = float(yesterday_metrics["net_sales"])
    return {
        "today_orders": today_orders,
        "yesterday_orders": yesterday_orders,
        "orders_delta_pct": _summary_delta_pct(float(today_orders), float(yesterday_orders)),
        "today_sales": today_sales,
        "yesterday_sales": yesterday_sales,
        "sales_delta_pct": _summary_delta_pct(today_sales, yesterday_sales),
        "gross_today_sales": gross_today_sales,
        "gross_yesterday_sales": gross_yesterday_sales,
        "gross_sales_delta_pct": _summary_delta_pct(gross_today_sales, gross_yesterday_sales),
        "net_today_sales": net_today_sales,
        "net_yesterday_sales": net_yesterday_sales,
        "net_sales_delta_pct": _summary_delta_pct(net_today_sales, net_yesterday_sales),
        "today_refunds": today_refunds,
        "yesterday_refunds": yesterday_refunds,
        "refunds_delta_pct": _summary_delta_pct(float(today_refunds), float(yesterday_refunds)),
    }


async def _summary_failed_payment_counts(
    session: AsyncSession,
    now: datetime,
    exclude_test_orders: Any,
) -> tuple[int, int]:
    payment_window_start = now - timedelta(hours=24)
    payment_prev_start = payment_window_start - timedelta(hours=24)
    failed_current = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.pending_payment,
            Order.created_at >= payment_window_start,
            Order.created_at < now,
            exclude_test_orders,
        )
    )
    failed_previous = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.pending_payment,
            Order.created_at >= payment_prev_start,
            Order.created_at < payment_window_start,
            exclude_test_orders,
        )
    )
    return int(failed_current or 0), int(failed_previous or 0)


async def _summary_refund_request_counts(
    session: AsyncSession,
    now: datetime,
    exclude_test_orders: Any,
) -> dict[str, int]:
    refund_window_start = now - timedelta(days=7)
    refund_prev_start = refund_window_start - timedelta(days=7)
    requested_current = await session.scalar(
        select(func.count())
        .select_from(ReturnRequest)
        .join(Order, ReturnRequest.order_id == Order.id)
        .where(
            ReturnRequest.status == ReturnRequestStatus.requested,
            ReturnRequest.created_at >= refund_window_start,
            ReturnRequest.created_at < now,
            exclude_test_orders,
        )
    )
    requested_previous = await session.scalar(
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
    orders_current = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= refund_window_start, Order.created_at < now, exclude_test_orders)
    )
    orders_previous = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= refund_prev_start,
            Order.created_at < refund_window_start,
            exclude_test_orders,
        )
    )
    return {
        "refund_requests": int(requested_current or 0),
        "refund_requests_prev": int(requested_previous or 0),
        "refund_window_orders": int(orders_current or 0),
        "refund_window_orders_prev": int(orders_previous or 0),
    }


async def _summary_stockouts_count(session: AsyncSession) -> int:
    stockouts = await session.scalar(
        select(func.count())
        .select_from(Product)
        .where(
            Product.stock_quantity <= 0,
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
        )
    )
    return int(stockouts or 0)


async def _summary_anomaly_inputs(
    session: AsyncSession, now: datetime, exclude_test_orders: Any
) -> dict[str, int]:
    failed_payments, failed_payments_prev = await _summary_failed_payment_counts(
        session, now, exclude_test_orders
    )
    refund_request_counts = await _summary_refund_request_counts(session, now, exclude_test_orders)
    return {
        "failed_payments": failed_payments,
        "failed_payments_prev": failed_payments_prev,
        "stockouts": await _summary_stockouts_count(session),
        **refund_request_counts,
    }


def _summary_failed_payments_is_alert(
    failed_payments: int,
    failed_payments_delta_pct: float | None,
    threshold_min_count: int,
    threshold_min_delta_pct: float | None,
) -> bool:
    if failed_payments < threshold_min_count:
        return False
    if threshold_min_delta_pct is None or failed_payments_delta_pct is None:
        return True
    return failed_payments_delta_pct >= threshold_min_delta_pct


def _summary_refund_requests_is_alert(
    refund_requests: int,
    refund_rate_pct: float | None,
    threshold_min_count: int,
    threshold_min_rate_pct: float | None,
) -> bool:
    if refund_requests < threshold_min_count:
        return False
    if threshold_min_rate_pct is None or refund_rate_pct is None:
        return True
    return refund_rate_pct >= threshold_min_rate_pct


def _summary_failed_payments_payload(
    failed_payments: int,
    failed_payments_prev: int,
    threshold_min_count: int,
    threshold_min_delta_pct: float | None,
) -> dict[str, object]:
    failed_delta_pct = _summary_delta_pct(float(failed_payments), float(failed_payments_prev))
    return {
        "window_hours": 24,
        "current": failed_payments,
        "previous": failed_payments_prev,
        "delta_pct": failed_delta_pct,
        "is_alert": _summary_failed_payments_is_alert(
            failed_payments,
            failed_delta_pct,
            threshold_min_count,
            threshold_min_delta_pct,
        ),
    }


def _summary_refund_requests_payload(
    refund_requests: int,
    refund_requests_prev: int,
    refund_window_orders: int,
    refund_window_orders_prev: int,
    threshold_min_count: int,
    threshold_min_rate_pct: float | None,
) -> dict[str, object]:
    refund_delta_pct = _summary_delta_pct(float(refund_requests), float(refund_requests_prev))
    refund_rate_pct = _summary_rate_pct(float(refund_requests), float(refund_window_orders))
    refund_rate_prev_pct = _summary_rate_pct(float(refund_requests_prev), float(refund_window_orders_prev))
    refund_rate_delta_pct = None
    if refund_rate_pct is not None and refund_rate_prev_pct is not None:
        refund_rate_delta_pct = _summary_delta_pct(refund_rate_pct, refund_rate_prev_pct)
    return {
        "window_days": 7,
        "current": refund_requests,
        "previous": refund_requests_prev,
        "delta_pct": refund_delta_pct,
        "current_denominator": refund_window_orders,
        "previous_denominator": refund_window_orders_prev,
        "current_rate_pct": refund_rate_pct,
        "previous_rate_pct": refund_rate_prev_pct,
        "rate_delta_pct": refund_rate_delta_pct,
        "is_alert": _summary_refund_requests_is_alert(
            refund_requests,
            refund_rate_pct,
            threshold_min_count,
            threshold_min_rate_pct,
        ),
    }


def _summary_anomalies_payload(
    anomaly_inputs: dict[str, int], thresholds_payload: dict[str, object]
) -> dict[str, object]:
    failed_payments = int(anomaly_inputs["failed_payments"])
    failed_payments_prev = int(anomaly_inputs["failed_payments_prev"])
    refund_requests = int(anomaly_inputs["refund_requests"])
    refund_requests_prev = int(anomaly_inputs["refund_requests_prev"])
    refund_window_orders = int(anomaly_inputs["refund_window_orders"])
    refund_window_orders_prev = int(anomaly_inputs["refund_window_orders_prev"])
    stockouts = int(anomaly_inputs["stockouts"])
    failed_threshold_min_count = int(thresholds_payload.get("failed_payments_min_count", 1) or 1)
    failed_threshold_min_delta_pct = thresholds_payload.get("failed_payments_min_delta_pct")
    refund_threshold_min_count = int(thresholds_payload.get("refund_requests_min_count", 1) or 1)
    refund_threshold_min_rate_pct = thresholds_payload.get("refund_requests_min_rate_pct")
    stockouts_threshold_min_count = int(thresholds_payload.get("stockouts_min_count", 1) or 1)
    return {
        "failed_payments": _summary_failed_payments_payload(
            failed_payments,
            failed_payments_prev,
            failed_threshold_min_count,
            float(failed_threshold_min_delta_pct) if failed_threshold_min_delta_pct is not None else None,
        ),
        "refund_requests": _summary_refund_requests_payload(
            refund_requests,
            refund_requests_prev,
            refund_window_orders,
            refund_window_orders_prev,
            refund_threshold_min_count,
            float(refund_threshold_min_rate_pct) if refund_threshold_min_rate_pct is not None else None,
        ),
        "stockouts": {
            "count": stockouts,
            "is_alert": stockouts >= stockouts_threshold_min_count,
        },
    }


def _summary_overview_payload(
    totals: dict[str, int],
    sales_30d_metrics: dict[str, float | int],
    range_metrics: dict[str, float | int],
    effective_range_days: int,
    start: datetime,
    end: datetime,
) -> dict[str, object]:
    return {
        **totals,
        "sales_30d": float(sales_30d_metrics["sales"]),
        "gross_sales_30d": float(sales_30d_metrics["gross_sales"]),
        "net_sales_30d": float(sales_30d_metrics["net_sales"]),
        "orders_30d": int(sales_30d_metrics["orders"]),
        "sales_range": float(range_metrics["sales"]),
        "gross_sales_range": float(range_metrics["gross_sales"]),
        "net_sales_range": float(range_metrics["net_sales"]),
        "orders_range": int(range_metrics["orders"]),
        "range_days": int(effective_range_days),
        "range_from": start.date().isoformat(),
        "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
    }


def _summary_day_payload(day_metrics: dict[str, float | int | None]) -> dict[str, object]:
    return {
        "today_orders": int(day_metrics["today_orders"]),
        "yesterday_orders": int(day_metrics["yesterday_orders"]),
        "orders_delta_pct": day_metrics["orders_delta_pct"],
        "today_sales": float(day_metrics["today_sales"]),
        "yesterday_sales": float(day_metrics["yesterday_sales"]),
        "sales_delta_pct": day_metrics["sales_delta_pct"],
        "gross_today_sales": float(day_metrics["gross_today_sales"]),
        "gross_yesterday_sales": float(day_metrics["gross_yesterday_sales"]),
        "gross_sales_delta_pct": day_metrics["gross_sales_delta_pct"],
        "net_today_sales": float(day_metrics["net_today_sales"]),
        "net_yesterday_sales": float(day_metrics["net_yesterday_sales"]),
        "net_sales_delta_pct": day_metrics["net_sales_delta_pct"],
        "today_refunds": int(day_metrics["today_refunds"]),
        "yesterday_refunds": int(day_metrics["yesterday_refunds"]),
        "refunds_delta_pct": day_metrics["refunds_delta_pct"],
    }


@router.get("/summary")
async def admin_summary(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> dict:
    now = datetime.now(timezone.utc)
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    sales_statuses = (*successful_statuses, OrderStatus.refunded)
    exclude_test_orders = Order.id.notin_(select(OrderTag.order_id).where(OrderTag.tag == "test"))
    start, end, effective_range_days = _summary_resolve_range(now, range_days, range_from, range_to)
    totals = await _summary_totals(session, exclude_test_orders)
    sales_30d_metrics = await _summary_sales_metrics(
        session, now - timedelta(days=30), now, successful_statuses, sales_statuses, exclude_test_orders
    )
    range_metrics = await _summary_sales_metrics(
        session, start, end, successful_statuses, sales_statuses, exclude_test_orders
    )
    day_metrics = await _summary_day_metrics(
        session, now, successful_statuses, sales_statuses, exclude_test_orders
    )
    thresholds_payload = _dashboard_alert_thresholds_payload(await _get_dashboard_alert_thresholds(session))
    anomalies = _summary_anomalies_payload(
        await _summary_anomaly_inputs(session, now, exclude_test_orders), thresholds_payload
    )
    return {
        **_summary_overview_payload(
            totals, sales_30d_metrics, range_metrics, effective_range_days, start, end
        ),
        **_summary_day_payload(day_metrics),
        "anomalies": anomalies,
        "alert_thresholds": thresholds_payload,
        "system": {"db_ready": True, "backup_last_at": settings.backup_last_at},
    }


def _admin_request_metadata(request: Request) -> dict[str, str | None]:
    return {
        "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
        "ip_address": (request.client.host if request.client else None),
    }


def _admin_send_report_audit_data(
    kind: str,
    force: bool,
    request_meta: dict[str, str | None],
    *,
    result: dict | None = None,
    error: Exception | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {"kind": kind, "force": force, **request_meta}
    if result is not None:
        payload["result"] = result
    if error is not None:
        payload["error"] = str(error)[:500]
    return payload


async def _admin_send_report_audit_log(
    session: AsyncSession,
    actor_user_id: UUID,
    action: str,
    kind: str,
    force: bool,
    request_meta: dict[str, str | None],
    *,
    result: dict | None = None,
    error: Exception | None = None,
) -> None:
    await audit_chain_service.add_admin_audit_log(
        session,
        action=action,
        actor_user_id=actor_user_id,
        subject_user_id=None,
        data=_admin_send_report_audit_data(
            kind=kind,
            force=force,
            request_meta=request_meta,
            result=result,
            error=error,
        ),
    )


@router.post("/reports/send")
async def admin_send_scheduled_report(
    request: Request,
    payload: dict = Body(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> dict:
    kind = str(payload.get("kind") or "").strip().lower()
    force = bool(payload.get("force", False))
    request_meta = _admin_request_metadata(request)
    try:
        result = await admin_reports_service.send_report_now(session, kind=kind, force=force)
    except ValueError as exc:
        await session.rollback()
        await _admin_send_report_audit_log(
            session,
            action="admin_reports.send_now_failed",
            actor_user_id=current_user.id,
            kind=kind,
            force=force,
            request_meta=request_meta,
            error=exc,
        )
        await session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await session.rollback()
        await _admin_send_report_audit_log(
            session,
            action="admin_reports.send_now_error",
            actor_user_id=current_user.id,
            kind=kind,
            force=force,
            request_meta=request_meta,
            error=exc,
        )
        await session.commit()
        raise

    await _admin_send_report_audit_log(
        session,
        action="admin_reports.send_now",
        actor_user_id=current_user.id,
        kind=kind,
        force=force,
        request_meta=request_meta,
        result=result,
    )
    await session.commit()
    return result


async def _funnel_distinct_sessions(
    session: AsyncSession, window_filters: tuple[Any, ...], event: str
) -> int:
    value = await session.scalar(
        select(func.count(func.distinct(AnalyticsEvent.session_id))).where(
            *window_filters,
            AnalyticsEvent.event == event,
        )
    )
    return int(value or 0)


async def _funnel_counts(
    session: AsyncSession, window_filters: tuple[Any, ...]
) -> tuple[int, int, int, int]:
    return (
        await _funnel_distinct_sessions(session, window_filters, "session_start"),
        await _funnel_distinct_sessions(session, window_filters, "view_cart"),
        await _funnel_distinct_sessions(session, window_filters, "checkout_start"),
        await _funnel_distinct_sessions(session, window_filters, "checkout_success"),
    )


def _funnel_rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


@router.get("/funnel")
async def admin_funnel_metrics(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> AdminFunnelMetricsResponse:
    now = datetime.now(timezone.utc)
    start, end, effective_range_days = _summary_resolve_range(now, range_days, range_from, range_to)
    window_filters = (AnalyticsEvent.created_at >= start, AnalyticsEvent.created_at < end)
    sessions_count, carts_count, checkouts_count, orders_count = await _funnel_counts(session, window_filters)

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
            to_cart=_funnel_rate(carts_count, sessions_count),
            to_checkout=_funnel_rate(checkouts_count, carts_count),
            to_order=_funnel_rate(orders_count, checkouts_count),
        ),
    )


def _channel_window_filters(start: datetime, end: datetime, exclude_test_orders: Any) -> tuple[Any, ...]:
    return (Order.created_at >= start, Order.created_at < end, exclude_test_orders)


async def _channel_gross_rows(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
    col: Any,
) -> list[Any]:
    rows = await session.execute(
        select(
            col,
            func.count().label("orders"),
            func.coalesce(func.sum(Order.total_amount), 0).label("gross_sales"),
        )
        .select_from(Order)
        .where(
            *_channel_window_filters(start, end, exclude_test_orders),
            Order.status.in_(sales_statuses),
        )
        .group_by(col)
    )
    return rows.all()


async def _channel_refunds_rows(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
    col: Any,
) -> list[Any]:
    rows = await session.execute(
        select(col, func.coalesce(func.sum(OrderRefund.amount), 0).label("refunds"))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(
            *_channel_window_filters(start, end, exclude_test_orders),
            Order.status.in_(sales_statuses),
        )
        .group_by(col)
    )
    return rows.all()


async def _channel_missing_refunds_rows(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    exclude_test_orders: Any,
    col: Any,
) -> list[Any]:
    rows = await session.execute(
        select(col, func.coalesce(func.sum(Order.total_amount), 0).label("missing"))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(
            *_channel_window_filters(start, end, exclude_test_orders),
            Order.status == OrderStatus.refunded,
            OrderRefund.id.is_(None),
        )
        .group_by(col)
    )
    return rows.all()


def _channel_rows_value_map(rows: list[Any]) -> dict[Any, Any]:
    return {row[0]: row[1] for row in rows}


def _channel_number_or_zero(value: Any) -> Any:
    return value if value is not None else 0


def _channel_int_or_zero(value: Any) -> int:
    return int(_channel_number_or_zero(value))


def _channel_items(
    gross_rows: list[Any],
    refunds_map: dict[Any, Any],
    missing_map: dict[Any, Any],
    label_unknown: str,
) -> list[dict]:
    items: list[dict] = []
    for key, orders_count, gross in gross_rows:
        gross_value = _channel_number_or_zero(gross)
        refunds = _channel_number_or_zero(refunds_map.get(key))
        missing = _channel_number_or_zero(missing_map.get(key))
        net = gross_value - refunds - missing
        items.append(
            {
                "key": key if key else label_unknown,
                "orders": _channel_int_or_zero(orders_count),
                "gross_sales": float(gross_value),
                "net_sales": float(_channel_number_or_zero(net)),
            }
        )
    items.sort(key=lambda row: (row.get("orders", 0), row.get("gross_sales", 0)), reverse=True)
    return items


async def _channel_breakdown_items(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
    col: Any,
    label_unknown: str = "unknown",
) -> list[dict]:
    gross_rows = await _channel_gross_rows(session, start, end, sales_statuses, exclude_test_orders, col)
    refunds_rows = await _channel_refunds_rows(session, start, end, sales_statuses, exclude_test_orders, col)
    missing_rows = await _channel_missing_refunds_rows(session, start, end, exclude_test_orders, col)
    refunds_map = _channel_rows_value_map(refunds_rows)
    missing_map = _channel_rows_value_map(missing_rows)
    return _channel_items(gross_rows, refunds_map, missing_map, label_unknown)


@router.get("/channel-breakdown")
async def admin_channel_breakdown(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
) -> dict:
    now = datetime.now(timezone.utc)
    sales_statuses = (
        OrderStatus.paid,
        OrderStatus.shipped,
        OrderStatus.delivered,
        OrderStatus.refunded,
    )
    start, end, effective_range_days = _summary_resolve_range(now, range_days, range_from, range_to)
    exclude_test_orders = _exclude_test_orders_clause()

    return {
        "range_days": int(effective_range_days),
        "range_from": start.date().isoformat(),
        "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
        "payment_methods": await _channel_breakdown_items(
            session, start, end, sales_statuses, exclude_test_orders, Order.payment_method
        ),
        "couriers": await _channel_breakdown_items(
            session, start, end, sales_statuses, exclude_test_orders, Order.courier
        ),
        "delivery_types": await _channel_breakdown_items(
            session, start, end, sales_statuses, exclude_test_orders, Order.delivery_type
        ),
    }


@router.get("/payments-health")
async def admin_payments_health(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("ops"))],
    since_hours: int = Query(default=24, ge=1, le=168),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=int(since_hours))
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    exclude_test_orders = _exclude_test_orders_clause()
    success_map = await _payments_method_counts(
        session,
        since,
        now,
        exclude_test_orders,
        Order.status.in_(successful_statuses),
    )
    pending_map = await _payments_method_counts(
        session,
        since,
        now,
        exclude_test_orders,
        Order.status == OrderStatus.pending_payment,
    )
    webhook_counts = await _payments_webhook_counts(session, since)
    stripe_recent_rows = await _payments_recent_webhook_rows(session, since, StripeWebhookEvent)
    paypal_recent_rows = await _payments_recent_webhook_rows(session, since, PayPalWebhookEvent)
    return {
        "window_hours": int(since_hours),
        "window_start": since,
        "window_end": now,
        "providers": _payments_provider_rows(success_map, pending_map, webhook_counts),
        "recent_webhook_errors": _payments_recent_webhook_errors(stripe_recent_rows, paypal_recent_rows),
    }


def _exclude_test_orders_clause() -> Any:
    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    return Order.id.notin_(test_order_ids)


def _payments_success_rate(success: int, pending: int) -> float | None:
    denominator = success + pending
    if denominator <= 0:
        return None
    return success / denominator


async def _payments_method_counts(
    session: AsyncSession,
    since: datetime,
    now: datetime,
    exclude_test_orders: Any,
    status_clause: Any,
) -> dict[str, int]:
    method_col = func.lower(func.coalesce(Order.payment_method, literal("unknown")))
    rows = await session.execute(
        select(method_col, func.count().label("count"))
        .select_from(Order)
        .where(
            Order.created_at >= since,
            Order.created_at < now,
            status_clause,
            exclude_test_orders,
        )
        .group_by(method_col)
    )
    return {str(method or "unknown"): int(count or 0) for method, count in rows.all()}


def _payments_error_filter(model: Any, since: datetime) -> tuple[Any, ...]:
    return (
        model.last_attempt_at >= since,
        model.last_error.is_not(None),
        model.last_error != "",
    )


def _payments_backlog_filter(model: Any, since: datetime) -> tuple[Any, ...]:
    return (
        model.last_attempt_at >= since,
        model.processed_at.is_(None),
        or_(model.last_error.is_(None), model.last_error == ""),
    )


async def _payments_webhook_count(session: AsyncSession, model: Any, *filters: Any) -> int:
    value = await session.scalar(select(func.count()).select_from(model).where(*filters))
    return int(value or 0)


async def _payments_webhook_counts(session: AsyncSession, since: datetime) -> dict[str, dict[str, int]]:
    return {
        "stripe": {
            "errors": await _payments_webhook_count(session, StripeWebhookEvent, *_payments_error_filter(StripeWebhookEvent, since)),
            "backlog": await _payments_webhook_count(
                session,
                StripeWebhookEvent,
                *_payments_backlog_filter(StripeWebhookEvent, since),
            ),
        },
        "paypal": {
            "errors": await _payments_webhook_count(session, PayPalWebhookEvent, *_payments_error_filter(PayPalWebhookEvent, since)),
            "backlog": await _payments_webhook_count(
                session,
                PayPalWebhookEvent,
                *_payments_backlog_filter(PayPalWebhookEvent, since),
            ),
        },
    }


async def _payments_recent_webhook_rows(session: AsyncSession, since: datetime, model: Any) -> list[Any]:
    rows = (
        (
            await session.execute(
                select(model)
                .where(*_payments_error_filter(model, since))
                .order_by(model.last_attempt_at.desc())
                .limit(8)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _payments_recent_webhook_errors(stripe_recent_rows: list[Any], paypal_recent_rows: list[Any]) -> list[dict]:
    recent_errors = [
        {
            "provider": "stripe",
            "event_id": row.stripe_event_id,
            "event_type": row.event_type,
            "attempts": int(row.attempts or 0),
            "last_attempt_at": row.last_attempt_at,
            "last_error": row.last_error,
        }
        for row in stripe_recent_rows
    ]
    recent_errors.extend(
        [
            {
                "provider": "paypal",
                "event_id": row.paypal_event_id,
                "event_type": row.event_type,
                "attempts": int(row.attempts or 0),
                "last_attempt_at": row.last_attempt_at,
                "last_error": row.last_error,
            }
            for row in paypal_recent_rows
        ]
    )
    recent_errors.sort(
        key=lambda item: item.get("last_attempt_at") or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return recent_errors[:12]


def _payments_sorted_methods(success_map: dict[str, int], pending_map: dict[str, int]) -> list[str]:
    preferred_order = ["stripe", "paypal", "netopia", "cod", "unknown"]
    methods = list({*success_map.keys(), *pending_map.keys(), *preferred_order})
    methods.sort(
        key=lambda key: (
            preferred_order.index(key) if key in preferred_order else len(preferred_order),
            key,
        )
    )
    return methods


def _payments_provider_row(
    method: str,
    success_map: dict[str, int],
    pending_map: dict[str, int],
    webhook_counts: dict[str, dict[str, int]],
) -> dict:
    success = int(success_map.get(method) or 0)
    pending = int(pending_map.get(method) or 0)
    webhook_entry = webhook_counts.get(method, {})
    webhook_error_count = int(webhook_entry.get("errors", 0) or 0)
    webhook_backlog_count = int(webhook_entry.get("backlog", 0) or 0)
    return {
        "provider": method,
        "successful_orders": success,
        "pending_payment_orders": pending,
        "success_rate": _payments_success_rate(success, pending),
        "webhook_errors": webhook_error_count,
        "webhook_backlog": webhook_backlog_count,
    }


def _payments_provider_rows(
    success_map: dict[str, int],
    pending_map: dict[str, int],
    webhook_counts: dict[str, dict[str, int]],
) -> list[dict]:
    return [
        _payments_provider_row(method, success_map, pending_map, webhook_counts)
        for method in _payments_sorted_methods(success_map, pending_map)
    ]


def _refund_delta_pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return (current - previous) / previous * 100.0


async def _refund_provider_rows(
    session: AsyncSession,
    provider_col: Any,
    exclude_test_orders: Any,
    window_start: datetime,
    window_end: datetime,
) -> list[tuple[str, int, float]]:
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


def _refund_provider_payload(
    current_provider: list[tuple[str, int, float]],
    previous_provider: list[tuple[str, int, float]],
) -> list[dict]:
    prev_provider_map = {row[0]: row for row in previous_provider}
    providers: list[dict] = []
    for provider, count, amount in current_provider:
        _, prev_count, prev_amount = prev_provider_map.get(provider, (provider, 0, 0.0))
        providers.append(
            {
                "provider": provider,
                "current": {"count": int(count), "amount": float(amount)},
                "previous": {"count": int(prev_count), "amount": float(prev_amount)},
                "delta_pct": {
                    "count": _refund_delta_pct(float(count), float(prev_count)),
                    "amount": _refund_delta_pct(float(amount), float(prev_amount)),
                },
            }
        )
    providers.sort(
        key=lambda row: (
            row.get("current", {}).get("amount", 0),
            row.get("current", {}).get("count", 0),
        ),
        reverse=True,
    )
    return providers


async def _refund_missing_refunds(
    session: AsyncSession,
    exclude_test_orders: Any,
    window_start: datetime,
    window_end: datetime,
) -> tuple[int, float]:
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


def _normalize_refund_reason_text(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw)
    return normalized.encode("ascii", "ignore").decode("ascii").lower()


_REFUND_REASON_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("damaged", ("damaged", "broken", "defect", "defective", "crack", "spart", "stricat", "zgariat", "deterior")),
    ("wrong_item", ("wrong", "different", "gresit", "incorect", "alt produs", "other item", "not the one")),
    (
        "not_as_described",
        (
            "not as described",
            "different than expected",
            "nu corespunde",
            "nu este ca",
            "description",
            "poza",
            "picture",
        ),
    ),
    ("size_fit", ("size", "fit", "too big", "too small", "marime", "potriv")),
    ("delivery_issue", ("delivery", "shipping", "ship", "courier", "curier", "livrare", "intarzi", "intarzier")),
    ("changed_mind", ("changed my mind", "dont want", "do not want", "no longer", "nu mai", "razgand", "renunt")),
)
_REFUND_REASON_CATEGORIES = [
    "damaged",
    "wrong_item",
    "not_as_described",
    "size_fit",
    "delivery_issue",
    "changed_mind",
    "other",
]


def _refund_reason_category(reason: str) -> str:
    text = _normalize_refund_reason_text(reason)
    if not text:
        return "other"
    for category, keywords in _REFUND_REASON_RULES:
        if any(keyword in text for keyword in keywords):
            return category
    return "other"


async def _refund_reason_counts(
    session: AsyncSession,
    exclude_test_orders: Any,
    window_start: datetime,
    window_end: datetime,
) -> dict[str, int]:
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
        category = _refund_reason_category(str(reason or ""))
        counts[category] = counts.get(category, 0) + 1
    return counts


def _refund_reasons_payload(
    current_reasons: dict[str, int],
    previous_reasons: dict[str, int],
) -> list[dict]:
    reasons: list[dict] = []
    for category in _REFUND_REASON_CATEGORIES:
        cur = int(current_reasons.get(category, 0))
        prev = int(previous_reasons.get(category, 0))
        reasons.append(
            {
                "category": category,
                "current": cur,
                "previous": prev,
                "delta_pct": _refund_delta_pct(float(cur), float(prev)),
            }
        )
    reasons.sort(key=lambda row: row.get("current", 0), reverse=True)
    return reasons


def _refund_breakdown_payload(
    *,
    window_days: int,
    window_start: datetime,
    window_end: datetime,
    current_provider: list[tuple[str, int, float]],
    previous_provider: list[tuple[str, int, float]],
    missing_current_count: int,
    missing_current_amount: float,
    missing_prev_count: int,
    missing_prev_amount: float,
    current_reasons: dict[str, int],
    previous_reasons: dict[str, int],
) -> dict:
    return {
        "window_days": int(window_days),
        "window_start": window_start,
        "window_end": window_end,
        "providers": _refund_provider_payload(current_provider, previous_provider),
        "missing_refunds": {
            "current": {"count": missing_current_count, "amount": float(missing_current_amount)},
            "previous": {"count": missing_prev_count, "amount": float(missing_prev_amount)},
            "delta_pct": {
                "count": _refund_delta_pct(float(missing_current_count), float(missing_prev_count)),
                "amount": _refund_delta_pct(float(missing_current_amount), float(missing_prev_amount)),
            },
        },
        "reasons": _refund_reasons_payload(current_reasons, previous_reasons),
    }


@router.get("/refunds-breakdown")
async def admin_refunds_breakdown(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
    window_days: int = Query(default=30, ge=1, le=365),
) -> dict:
    now = datetime.now(timezone.utc)
    window = timedelta(days=int(window_days))
    start = now - window
    prev_start = start - window

    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)
    provider_col = func.lower(func.coalesce(OrderRefund.provider, literal("unknown")))
    current_provider = await _refund_provider_rows(session, provider_col, exclude_test_orders, start, now)
    previous_provider = await _refund_provider_rows(
        session, provider_col, exclude_test_orders, prev_start, start
    )
    missing_current_count, missing_current_amount = await _refund_missing_refunds(
        session, exclude_test_orders, start, now
    )
    missing_prev_count, missing_prev_amount = await _refund_missing_refunds(
        session, exclude_test_orders, prev_start, start
    )
    current_reasons = await _refund_reason_counts(session, exclude_test_orders, start, now)
    previous_reasons = await _refund_reason_counts(session, exclude_test_orders, prev_start, start)

    return _refund_breakdown_payload(
        window_days=window_days,
        window_start=start,
        window_end=now,
        current_provider=current_provider,
        previous_provider=previous_provider,
        missing_current_count=missing_current_count,
        missing_current_amount=missing_current_amount,
        missing_prev_count=missing_prev_count,
        missing_prev_amount=missing_prev_amount,
        current_reasons=current_reasons,
        previous_reasons=previous_reasons,
    )


def _shipping_delta_pct(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / previous * 100.0


def _shipping_avg(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _shipping_duration_map(
    rows: list[tuple[Any, Any, Any]],
    *,
    courier_idx: int,
    start_idx: int,
    end_idx: int,
) -> dict[str, list[float]]:
    durations: dict[str, list[float]] = {}
    for row in rows:
        courier = row[courier_idx]
        start_at = row[start_idx]
        end_at = row[end_idx]
        if not start_at or not end_at:
            continue
        hours = (end_at - start_at).total_seconds() / 3600.0
        if hours < 0 or hours > 24 * 365:
            continue
        key = str(courier or "unknown")
        durations.setdefault(key, []).append(float(hours))
    return durations


async def _shipping_collect_ship_durations(
    session: AsyncSession,
    *,
    window_start: datetime,
    window_end: datetime,
    exclude_test_orders: Any,
    courier_col: Any,
    shipped_subq: Any,
) -> dict[str, list[float]]:
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
    return _shipping_duration_map(
        rows.all(), courier_idx=1, start_idx=0, end_idx=2
    )


async def _shipping_collect_delivery_durations(
    session: AsyncSession,
    *,
    window_start: datetime,
    window_end: datetime,
    exclude_test_orders: Any,
    courier_col: Any,
    shipped_subq: Any,
    delivered_subq: Any,
) -> dict[str, list[float]]:
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
    return _shipping_duration_map(
        rows.all(), courier_idx=0, start_idx=1, end_idx=2
    )


def _shipping_rows(
    current_durations: dict[str, list[float]],
    previous_durations: dict[str, list[float]],
) -> list[dict]:
    rows: list[dict] = []
    for courier in sorted(set(current_durations) | set(previous_durations)):
        current_values = current_durations.get(courier, [])
        previous_values = previous_durations.get(courier, [])
        cur_avg = _shipping_avg(current_values)
        prev_avg = _shipping_avg(previous_values)
        rows.append(
            {
                "courier": courier,
                "current": {"count": len(current_values), "avg_hours": cur_avg},
                "previous": {"count": len(previous_values), "avg_hours": prev_avg},
                "delta_pct": {
                    "avg_hours": _shipping_delta_pct(cur_avg, prev_avg),
                    "count": _shipping_delta_pct(
                        float(len(current_values)),
                        float(len(previous_values)),
                    ),
                },
            }
        )
    rows.sort(
        key=lambda row: (row.get("current", {}).get("count", 0), row.get("courier", "")),
        reverse=True,
    )
    return rows


def _shipping_window_bounds(window_days: int) -> tuple[datetime, datetime, datetime]:
    now = datetime.now(timezone.utc)
    window = timedelta(days=int(window_days))
    start = now - window
    return now, start, start - window


def _shipping_exclude_test_orders_clause() -> Any:
    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    return Order.id.notin_(test_order_ids)


def _shipping_shipped_subquery() -> Any:
    return (
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


def _shipping_delivered_subquery() -> Any:
    return (
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


def _shipping_courier_col() -> Any:
    return func.lower(func.coalesce(Order.courier, literal("unknown"))).label("courier")


def _shipping_response_payload(
    window_days: int,
    start: datetime,
    now: datetime,
    current_ship: dict[str, list[float]],
    previous_ship: dict[str, list[float]],
    current_delivery: dict[str, list[float]],
    previous_delivery: dict[str, list[float]],
) -> dict:
    return {
        "window_days": int(window_days),
        "window_start": start,
        "window_end": now,
        "time_to_ship": _shipping_rows(current_ship, previous_ship),
        "delivery_time": _shipping_rows(current_delivery, previous_delivery),
    }


def _shipping_query_context() -> tuple[Any, Any, Any, Any]:
    return (
        _shipping_exclude_test_orders_clause(),
        _shipping_shipped_subquery(),
        _shipping_delivered_subquery(),
        _shipping_courier_col(),
    )


async def _shipping_period_durations(
    session: AsyncSession,
    *,
    start: datetime,
    now: datetime,
    prev_start: datetime,
    exclude_test_orders: Any,
    courier_col: Any,
    shipped_subq: Any,
    delivered_subq: Any,
) -> tuple[dict[str, list[float]], dict[str, list[float]], dict[str, list[float]], dict[str, list[float]]]:
    current_ship = await _shipping_collect_ship_durations(
        session,
        window_start=start,
        window_end=now,
        exclude_test_orders=exclude_test_orders,
        courier_col=courier_col,
        shipped_subq=shipped_subq,
    )
    previous_ship = await _shipping_collect_ship_durations(
        session,
        window_start=prev_start,
        window_end=start,
        exclude_test_orders=exclude_test_orders,
        courier_col=courier_col,
        shipped_subq=shipped_subq,
    )
    current_delivery = await _shipping_collect_delivery_durations(
        session,
        window_start=start,
        window_end=now,
        exclude_test_orders=exclude_test_orders,
        courier_col=courier_col,
        shipped_subq=shipped_subq,
        delivered_subq=delivered_subq,
    )
    previous_delivery = await _shipping_collect_delivery_durations(
        session,
        window_start=prev_start,
        window_end=start,
        exclude_test_orders=exclude_test_orders,
        courier_col=courier_col,
        shipped_subq=shipped_subq,
        delivered_subq=delivered_subq,
    )
    return current_ship, previous_ship, current_delivery, previous_delivery


@router.get("/shipping-performance")
async def admin_shipping_performance(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("orders"))],
    window_days: int = Query(default=30, ge=1, le=365),
) -> dict:
    now, start, prev_start = _shipping_window_bounds(window_days)
    exclude_test_orders, shipped_subq, delivered_subq, courier_col = _shipping_query_context()
    current_ship, previous_ship, current_delivery, previous_delivery = await _shipping_period_durations(
        session,
        start=start,
        now=now,
        prev_start=prev_start,
        exclude_test_orders=exclude_test_orders,
        courier_col=courier_col,
        shipped_subq=shipped_subq,
        delivered_subq=delivered_subq,
    )
    return _shipping_response_payload(window_days, start, now, current_ship, previous_ship, current_delivery, previous_delivery)


def _stockout_rows(restock_rows: list[Any]) -> list[Any]:
    return [
        row
        for row in restock_rows
        if int(getattr(row, "available_quantity", 0) or 0) <= 0
    ]


async def _stockout_demand_map(
    session: AsyncSession,
    *,
    since: datetime,
    now: datetime,
    successful_statuses: tuple[OrderStatus, ...],
    product_ids: list[UUID],
    exclude_test_orders: Any,
) -> dict[UUID, tuple[int, float]]:
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
    return {row[0]: (int(row[1] or 0), float(row[2] or 0)) for row in demand_rows.all()}


async def _stockout_product_map(
    session: AsyncSession, *, product_ids: list[UUID]
) -> dict[UUID, dict[str, object]]:
    product_rows = await session.execute(
        select(
            Product.id,
            Product.base_price,
            Product.sale_price,
            Product.currency,
            Product.allow_backorder,
        ).where(Product.id.in_(product_ids))
    )
    return {
        row[0]: {
            "base_price": float(row[1] or 0),
            "sale_price": float(row[2] or 0) if row[2] is not None else None,
            "currency": str(row[3] or "RON"),
            "allow_backorder": bool(row[4]),
        }
        for row in product_rows.all()
    }


def _stockout_current_price(meta: dict[str, object]) -> float:
    sale_price = meta.get("sale_price")
    if sale_price is not None:
        return float(sale_price)
    return float(meta.get("base_price", 0) or 0)


def _stockout_int_attr(row: Any, field_name: str) -> int:
    return int(getattr(row, field_name, 0) or 0)


def _stockout_avg_price(demand_units: int, demand_revenue: float, current_price: float) -> float:
    if demand_units <= 0:
        return current_price
    return float(demand_revenue / demand_units)


def _stockout_estimated_missed_revenue(
    allow_backorder: bool, reserved_carts: int, avg_price: float
) -> float:
    if allow_backorder:
        return 0.0
    return float(reserved_carts) * avg_price


def _stockout_currency(meta: dict[str, object]) -> str:
    return str(meta.get("currency") or "RON")


def _stockout_item(
    row: Any,
    *,
    demand_map: dict[UUID, tuple[int, float]],
    product_map: dict[UUID, dict[str, object]],
) -> dict[str, object]:
    meta = product_map.get(row.product_id, {})
    allow_backorder = bool(meta.get("allow_backorder", False))
    current_price = _stockout_current_price(meta)
    demand_units_raw, demand_revenue_raw = demand_map.get(row.product_id, (0, 0.0))
    demand_units = int(demand_units_raw)
    demand_revenue = float(demand_revenue_raw)
    reserved_carts = _stockout_int_attr(row, "reserved_in_carts")
    reserved_orders = _stockout_int_attr(row, "reserved_in_orders")
    available_quantity = _stockout_int_attr(row, "available_quantity")
    stock_quantity = _stockout_int_attr(row, "stock_quantity")
    avg_price = _stockout_avg_price(demand_units, demand_revenue, current_price)
    estimated_missed = _stockout_estimated_missed_revenue(allow_backorder, reserved_carts, avg_price)

    return {
        "product_id": str(row.product_id),
        "product_slug": row.product_slug,
        "product_name": row.product_name,
        "available_quantity": available_quantity,
        "reserved_in_carts": reserved_carts,
        "reserved_in_orders": reserved_orders,
        "stock_quantity": stock_quantity,
        "demand_units": demand_units,
        "demand_revenue": demand_revenue,
        "estimated_missed_revenue": float(estimated_missed),
        "currency": _stockout_currency(meta),
        "allow_backorder": allow_backorder,
    }


def _stockout_items(
    stockout_rows: list[Any],
    *,
    demand_map: dict[UUID, tuple[int, float]],
    product_map: dict[UUID, dict[str, object]],
) -> list[dict[str, object]]:
    items = [_stockout_item(row, demand_map=demand_map, product_map=product_map) for row in stockout_rows]
    items.sort(
        key=lambda item: (
            float(item.get("estimated_missed_revenue", 0)),
            float(item.get("demand_revenue", 0)),
            int(item.get("reserved_in_carts", 0)),
        ),
        reverse=True,
    )
    return items


@router.get("/stockout-impact")
async def admin_stockout_impact(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("inventory"))],
    window_days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=8, ge=1, le=30),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=int(window_days))
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    exclude_test_orders = _exclude_test_orders_clause()

    restock_rows = await inventory_service.list_restock_list(
        session,
        include_variants=False,
        default_threshold=DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD,
    )
    stockouts = _stockout_rows(restock_rows)
    if not stockouts:
        return {"window_days": int(window_days), "window_start": since, "window_end": now, "items": []}

    product_ids = [row.product_id for row in stockouts]
    demand_map = await _stockout_demand_map(
        session,
        since=since,
        now=now,
        successful_statuses=successful_statuses,
        product_ids=product_ids,
        exclude_test_orders=exclude_test_orders,
    )
    product_map = await _stockout_product_map(session, product_ids=product_ids)
    items = _stockout_items(stockouts, demand_map=demand_map, product_map=product_map)

    return {
        "window_days": int(window_days),
        "window_start": since,
        "window_end": now,
        "items": items[: int(limit)],
    }


@router.get("/channel-attribution")
async def admin_channel_attribution(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
    range_days: int = Query(default=30, ge=1, le=365),
    range_from: date | None = Query(default=None),
    range_to: date | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=50),
) -> dict:
    now = datetime.now(timezone.utc)
    sales_statuses = (
        OrderStatus.paid,
        OrderStatus.shipped,
        OrderStatus.delivered,
        OrderStatus.refunded,
    )
    start, end, effective_range_days = _summary_resolve_range(
        now,
        int(range_days),
        range_from,
        range_to,
    )
    exclude_test_orders = _exclude_test_orders_clause()
    total_orders, total_gross_sales = await _channel_totals(
        session,
        start,
        end,
        sales_statuses,
        exclude_test_orders,
    )
    order_to_session, session_ids = await _channel_order_to_session_map(session, start, end)
    if not order_to_session:
        return _channel_attribution_response(
            effective_range_days=effective_range_days,
            start=start,
            end=end,
            total_orders=total_orders,
            total_gross_sales=total_gross_sales,
            tracked_orders=0,
            tracked_gross_sales=0.0,
            coverage_pct=None if total_orders == 0 else 0.0,
            channels=[],
        )
    channels, tracked_orders, tracked_gross_sales = await _channel_tracked_data(
        session,
        order_to_session,
        session_ids,
        start,
        end,
        sales_statuses,
        exclude_test_orders,
    )
    return _channel_attribution_response(
        effective_range_days=effective_range_days,
        start=start,
        end=end,
        total_orders=total_orders,
        total_gross_sales=total_gross_sales,
        tracked_orders=tracked_orders,
        tracked_gross_sales=tracked_gross_sales,
        coverage_pct=_channel_coverage_pct(tracked_orders, total_orders),
        channels=channels[: int(limit)],
    )


async def _channel_totals(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
) -> tuple[int, float]:
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
    return int(total_orders or 0), float(total_gross_sales or 0)


async def _channel_order_to_session_map(
    session: AsyncSession,
    start: datetime,
    end: datetime,
) -> tuple[dict[UUID, str], set[str]]:
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
        session_key = str(session_id)
        if order_id in order_to_session:
            continue
        order_to_session[order_id] = session_key
        session_ids.add(session_key)
    return order_to_session, session_ids


async def _channel_order_amounts(
    session: AsyncSession,
    order_ids: list[UUID],
    start: datetime,
    end: datetime,
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
) -> dict[UUID, float]:
    if not order_ids:
        return {}
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
    return {order_id: float(total_amount or 0) for order_id, total_amount in order_rows.all()}


async def _channel_tracked_data(
    session: AsyncSession,
    order_to_session: dict[UUID, str],
    session_ids: set[str],
    start: datetime,
    end: datetime,
    sales_statuses: tuple[OrderStatus, ...],
    exclude_test_orders: Any,
) -> tuple[list[dict], int, float]:
    order_amounts = await _channel_order_amounts(
        session,
        list(order_to_session.keys()),
        start,
        end,
        sales_statuses,
        exclude_test_orders,
    )
    session_payload = await _channel_session_payloads(session, session_ids)
    return _channel_aggregate(order_to_session, order_amounts, session_payload)


async def _channel_session_payloads(session: AsyncSession, session_ids: set[str]) -> dict[str, dict | None]:
    if not session_ids:
        return {}
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
        session_key = str(session_id)
        if session_key in session_payload:
            continue
        session_payload[session_key] = payload if isinstance(payload, dict) else None
    return session_payload


def _channel_normalize_value(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _channel_extract(payload: dict | None) -> tuple[str, str | None, str | None]:
    source = _channel_normalize_value((payload or {}).get("utm_source")).lower()
    medium = _channel_normalize_value((payload or {}).get("utm_medium")).lower() or None
    campaign = _channel_normalize_value((payload or {}).get("utm_campaign")) or None
    if not source:
        return "direct", None, None
    return source, medium, campaign


def _channel_aggregate(
    order_to_session: dict[UUID, str],
    order_amounts: dict[UUID, float],
    session_payload: dict[str, dict | None],
) -> tuple[list[dict], int, float]:
    channels: dict[tuple[str, str | None, str | None], dict[str, float]] = {}
    tracked_orders = 0
    tracked_gross_sales = 0.0
    for order_id, session_id in order_to_session.items():
        amount = order_amounts.get(order_id)
        if amount is None:
            continue
        tracked_orders += 1
        tracked_gross_sales += float(amount)
        key = _channel_extract(session_payload.get(session_id))
        entry = channels.setdefault(key, {"orders": 0.0, "gross_sales": 0.0})
        entry["orders"] += 1.0
        entry["gross_sales"] += float(amount)
    rows = [
        {
            "source": source,
            "medium": medium,
            "campaign": campaign,
            "orders": int(entry.get("orders", 0) or 0),
            "gross_sales": float(entry.get("gross_sales", 0) or 0),
        }
        for (source, medium, campaign), entry in channels.items()
    ]
    rows.sort(
        key=lambda row: (row.get("gross_sales", 0), row.get("orders", 0)),
        reverse=True,
    )
    return rows, tracked_orders, tracked_gross_sales


def _channel_coverage_pct(tracked_orders: int, total_orders: int) -> float | None:
    if total_orders <= 0:
        return None
    return tracked_orders / int(total_orders or 1)


def _channel_attribution_response(
    effective_range_days: int,
    start: datetime,
    end: datetime,
    total_orders: int,
    total_gross_sales: float,
    tracked_orders: int,
    tracked_gross_sales: float,
    coverage_pct: float | None,
    channels: list[dict],
) -> dict:
    return {
        "range_days": int(effective_range_days),
        "range_from": start.date().isoformat(),
        "range_to": (end - timedelta(microseconds=1)).date().isoformat(),
        "tracked_orders": int(tracked_orders),
        "tracked_gross_sales": float(tracked_gross_sales),
        "coverage_pct": coverage_pct,
        "channels": channels,
        "total_orders": int(total_orders),
        "total_gross_sales": float(total_gross_sales),
    }


@router.get("/search")
async def admin_global_search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=255),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("dashboard")),
) -> AdminDashboardSearchResponse:
    needle = (q or "").strip()
    if not needle:
        return AdminDashboardSearchResponse(items=[])
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
    parsed_uuid = _global_search_parse_uuid(needle)
    if parsed_uuid is not None:
        return AdminDashboardSearchResponse(
            items=await _global_search_by_uuid(session, parsed_uuid, include_pii)
        )
    return AdminDashboardSearchResponse(
        items=await _global_search_by_text(session, needle, include_pii)
    )


def _global_search_parse_uuid(value: str) -> UUID | None:
    try:
        return UUID(value)
    except ValueError:
        return None


def _global_search_order_subtitle(order: Order, include_pii: bool) -> str | None:
    subtitle = (order.customer_email or "").strip() or None
    if include_pii:
        return subtitle
    return pii_service.mask_email(subtitle)


def _global_search_user_email(user: User, include_pii: bool) -> str:
    if include_pii:
        return user.email
    return pii_service.mask_email(user.email) or user.email


def _global_search_order_result(order: Order, include_pii: bool) -> AdminDashboardSearchResult:
    return AdminDashboardSearchResult(
        type="order",
        id=str(order.id),
        label=(order.reference_code or str(order.id)),
        subtitle=_global_search_order_subtitle(order, include_pii),
    )


def _global_search_product_result(product: Product) -> AdminDashboardSearchResult:
    return AdminDashboardSearchResult(
        type="product",
        id=str(product.id),
        slug=product.slug,
        label=product.name,
        subtitle=product.slug,
    )


def _global_search_user_result(user: User, include_pii: bool) -> AdminDashboardSearchResult:
    email_value = _global_search_user_email(user, include_pii)
    subtitle = (user.username or "").strip() or None
    return AdminDashboardSearchResult(
        type="user",
        id=str(user.id),
        email=email_value,
        label=email_value,
        subtitle=subtitle,
    )


async def _global_search_by_uuid(
    session: AsyncSession,
    parsed_uuid: UUID,
    include_pii: bool,
) -> list[AdminDashboardSearchResult]:
    results: list[AdminDashboardSearchResult] = []
    order = await session.get(Order, parsed_uuid)
    if order:
        results.append(_global_search_order_result(order, include_pii))
    product = await session.get(Product, parsed_uuid)
    if product and not product.is_deleted:
        results.append(_global_search_product_result(product))
    user = await session.get(User, parsed_uuid)
    if user and user.deleted_at is None:
        results.append(_global_search_user_result(user, include_pii))
    return results


async def _global_search_orders_by_text(
    session: AsyncSession,
    like: str,
    include_pii: bool,
) -> list[AdminDashboardSearchResult]:
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
    return [_global_search_order_result(order, include_pii) for order in orders]


async def _global_search_products_by_text(
    session: AsyncSession,
    like: str,
) -> list[AdminDashboardSearchResult]:
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
    return [_global_search_product_result(product) for product in products]


async def _global_search_users_by_text(
    session: AsyncSession,
    like: str,
    include_pii: bool,
) -> list[AdminDashboardSearchResult]:
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
    return [_global_search_user_result(user, include_pii) for user in users]


async def _global_search_by_text(
    session: AsyncSession,
    needle: str,
    include_pii: bool,
) -> list[AdminDashboardSearchResult]:
    like = f"%{needle.lower()}%"
    results: list[AdminDashboardSearchResult] = []
    results.extend(await _global_search_orders_by_text(session, like, include_pii))
    results.extend(await _global_search_products_by_text(session, like))
    results.extend(await _global_search_users_by_text(session, like, include_pii))
    return results


@router.get("/products")
async def admin_products(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("products"))],
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


def _search_products_stmt(deleted: bool) -> Any:
    return (
        select(Product, Category)
        .join(Category, Product.category_id == Category.id)
        .where(Product.is_deleted.is_(deleted))
    )


def _search_products_apply_filters(
    stmt: Any,
    *,
    q: str | None,
    status_filter: ProductStatus | None,
    category_slug: str | None,
    missing_translations: bool,
    missing_translation_lang: str | None,
) -> Any:
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            Product.name.ilike(like) | Product.slug.ilike(like) | Product.sku.ilike(like)
        )
    if status_filter is not None:
        stmt = stmt.where(Product.status == status_filter)
    if category_slug:
        stmt = stmt.where(Category.slug == category_slug)

    missing_lang = (missing_translation_lang or "").strip().lower() or None
    if missing_lang:
        has_lang = exists().where(
            ProductTranslation.product_id == Product.id,
            ProductTranslation.lang == missing_lang,
        )
        return stmt.where(~has_lang)
    if missing_translations:
        has_en = exists().where(
            ProductTranslation.product_id == Product.id,
            ProductTranslation.lang == "en",
        )
        has_ro = exists().where(
            ProductTranslation.product_id == Product.id,
            ProductTranslation.lang == "ro",
        )
        return stmt.where(or_(~has_en, ~has_ro))
    return stmt


async def _search_products_translation_langs(
    session: AsyncSession, product_ids: list[UUID]
) -> dict[UUID, set[str]]:
    langs_by_product: dict[UUID, set[str]] = {}
    if not product_ids:
        return langs_by_product

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
    return langs_by_product


def _search_product_item(
    prod: Product,
    cat: Category,
    langs_by_product: dict[UUID, set[str]],
) -> AdminProductListItem:
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
        missing_translations=[
            lang for lang in ["en", "ro"] if lang not in langs_by_product.get(prod.id, set())
        ],
    )


@router.get("/products/search")
async def search_products(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("products"))],
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
    stmt = _search_products_stmt(deleted)
    stmt = _search_products_apply_filters(
        stmt,
        q=q,
        status_filter=status,
        category_slug=category_slug,
        missing_translations=missing_translations,
        missing_translation_lang=missing_translation_lang,
    )

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

    product_ids = [prod.id for prod, _ in rows]
    langs_by_product = await _search_products_translation_langs(session, product_ids)

    items = [
        _search_product_item(prod, cat, langs_by_product)
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


@router.post("/products/{product_id}/restore")
async def restore_product(
    product_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("products"))],
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


@router.get("/products/duplicate-check")
async def duplicate_check_products(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("products"))],
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


@router.post("/products/by-ids")
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
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("dashboard")),
) -> list[dict]:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
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
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("dashboard")),
) -> list[dict]:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
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


def _search_users_stmt(q: str | None, role: UserRole | None) -> Any:
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
    return stmt


def _admin_user_list_item_payload(user: User, include_pii: bool) -> AdminUserListItem:
    return AdminUserListItem(
        id=user.id,
        email=user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
        username=user.username,
        name=user.name if include_pii else pii_service.mask_text(user.name, keep=1),
        name_tag=user.name_tag,
        role=user.role,
        email_verified=bool(user.email_verified),
        created_at=user.created_at,
    )


def _pagination_total_pages(total_items: int, limit: int) -> int:
    if total_items <= 0:
        return 1
    return max(1, (total_items + limit - 1) // limit)


@router.get("/users/search")
async def search_users(
    request: Request,
    q: str | None = Query(default=None),
    role: UserRole | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserListResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
    offset = (page - 1) * limit
    stmt = _search_users_stmt(q, role)

    total = await session.scalar(
        stmt.with_only_columns(func.count(func.distinct(User.id))).order_by(None)
    )
    total_items = int(total or 0)
    total_pages = _pagination_total_pages(total_items, limit)

    rows = (
        (
            await session.execute(
                stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
    items = [_admin_user_list_item_payload(user, include_pii) for user in rows]

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


@router.get("/users/segments/repeat-buyers")
async def admin_user_segment_repeat_buyers(
    request: Request,
    q: str | None = Query(default=None),
    min_orders: int = Query(default=2, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserSegmentResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
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


@router.get("/users/segments/high-aov")
async def admin_user_segment_high_aov(
    request: Request,
    q: str | None = Query(default=None),
    min_orders: int = Query(default=1, ge=1, le=100),
    min_aov: float = Query(default=0, ge=0),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserSegmentResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
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
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> dict:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
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


@router.get("/users/{user_id}/profile")
async def admin_user_profile(
    user_id: UUID,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminUserProfileResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("content"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("coupons"))],
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


@router.get("/scheduled-tasks")
async def scheduled_tasks_overview(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("dashboard"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("coupons"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("coupons"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("coupons"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("audit"))],
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
    return union_all(
        _audit_products_union_query(),
        _audit_content_union_query(),
        _audit_security_union_query(),
    ).subquery()


def _audit_products_union_query() -> object:
    prod_actor = aliased(User)
    prod = aliased(Product)
    return (
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


def _audit_content_union_query() -> object:
    content_actor = aliased(User)
    block = aliased(ContentBlock)
    return (
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


def _audit_security_union_query() -> object:
    actor = aliased(User)
    subject = aliased(User)
    return (
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


def _audit_entity_filter(audit: object, entity: str | None) -> object | None:
    if not entity:
        return None
    normalized = entity.strip().lower()
    if not normalized or normalized == "all":
        return None
    return getattr(audit.c, "entity") == normalized  # type: ignore[attr-defined]


def _audit_action_filter(audit: object, action: str | None) -> object | None:
    if not action:
        return None
    needle = action.strip().lower()
    if not needle:
        return None
    tokens = [token.strip() for token in re.split(r"[|,]+", needle) if token.strip()]
    action_col = func.lower(getattr(audit.c, "action"))  # type: ignore[attr-defined]
    if len(tokens) <= 1:
        return action_col.like(f"%{needle}%")
    return or_(*[action_col.like(f"%{token}%") for token in tokens])


def _audit_user_filter(audit: object, user: str | None) -> object | None:
    if not user:
        return None
    needle = user.strip().lower()
    if not needle:
        return None
    actor_email = func.lower(func.coalesce(getattr(audit.c, "actor_email"), ""))  # type: ignore[attr-defined]
    actor_username = func.lower(func.coalesce(getattr(audit.c, "actor_username"), ""))  # type: ignore[attr-defined]
    subject_email = func.lower(func.coalesce(getattr(audit.c, "subject_email"), ""))  # type: ignore[attr-defined]
    subject_username = func.lower(func.coalesce(getattr(audit.c, "subject_username"), ""))  # type: ignore[attr-defined]
    actor_user_id = func.lower(func.coalesce(getattr(audit.c, "actor_user_id"), ""))  # type: ignore[attr-defined]
    subject_user_id = func.lower(func.coalesce(getattr(audit.c, "subject_user_id"), ""))  # type: ignore[attr-defined]
    return or_(
        actor_email.like(f"%{needle}%"),
        actor_username.like(f"%{needle}%"),
        subject_email.like(f"%{needle}%"),
        subject_username.like(f"%{needle}%"),
        actor_user_id.like(f"%{needle}%"),
        subject_user_id.like(f"%{needle}%"),
    )


def _audit_filters(
    audit: object,
    *,
    entity: str | None,
    action: str | None,
    user: str | None,
) -> list:
    filters: list = []
    entity_filter = _audit_entity_filter(audit, entity)
    if entity_filter is not None:
        filters.append(entity_filter)
    action_filter = _audit_action_filter(audit, action)
    if action_filter is not None:
        filters.append(action_filter)
    user_filter = _audit_user_filter(audit, user)
    if user_filter is not None:
        filters.append(user_filter)
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


def _audit_total_pages(total_items: int, limit: int) -> int:
    if not total_items:
        return 1
    return max(1, (total_items + limit - 1) // limit)


def _audit_entries_query(audit: object, filters: list, *, page: int, limit: int) -> object:
    offset = (page - 1) * limit
    return (
        select(audit)
        .where(*filters)
        .order_by(getattr(audit.c, "created_at").desc())
        .offset(offset)
        .limit(limit)
    )  # type: ignore[attr-defined]


def _audit_entry_item(row: Any) -> dict[str, Any]:
    return {
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


_AUDIT_EXPORT_CSV_HEADER = [
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


def _audit_export_query(audit: object, filters: list) -> object:
    return (
        select(audit)
        .where(*filters)
        .order_by(getattr(audit.c, "created_at").desc())
        .limit(5000)
    )  # type: ignore[attr-defined]


async def _audit_export_rows(
    session: AsyncSession,
    *,
    entity: str | None,
    action: str | None,
    user: str | None,
) -> list[Any]:
    audit = _audit_union_subquery()
    filters = _audit_filters(audit, entity=entity, action=action, user=user)
    q = _audit_export_query(audit, filters)
    return (await session.execute(q)).mappings().all()


def _audit_export_csv_row(row: Any, *, redact: bool) -> list[str]:
    created_at = row.get("created_at")
    actor_email = str(row.get("actor_email") or "")
    subject_email = str(row.get("subject_email") or "")
    data_raw = str(row.get("data") or "")

    if redact:
        actor_email = _audit_mask_email(actor_email)
        subject_email = _audit_mask_email(subject_email)
        data_raw = _audit_redact_text(data_raw)

    return [
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


def _audit_export_csv_content(rows: list[Any], *, redact: bool) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_AUDIT_EXPORT_CSV_HEADER)
    for row in rows:
        writer.writerow(_audit_export_csv_row(row, redact=redact))
    return buf.getvalue()


def _audit_export_filename(entity: str | None) -> str:
    date_part = datetime.now(timezone.utc).date().isoformat()
    return f"audit-{(entity or 'all').strip().lower()}-{date_part}.csv"


@router.get("/audit/entries")
async def admin_audit_entries(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("audit"))],
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
    total = await session.scalar(select(func.count()).select_from(audit).where(*filters))
    total_items = int(total or 0)
    total_pages = _audit_total_pages(total_items, limit)
    q = _audit_entries_query(audit, filters, page=page, limit=limit)
    rows = (await session.execute(q)).mappings().all()
    items = [_audit_entry_item(row) for row in rows]

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
    request: Request,
    entity: str | None = Query(
        default="all", pattern="^(all|product|content|security)$"
    ),
    action: str | None = Query(default=None, max_length=120),
    user: str | None = Query(default=None, max_length=255),
    redact: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("audit")),
) -> Response:
    step_up_service.require_step_up(request, current_user)
    if not redact and current_user.role != UserRole.owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner access required for unredacted exports",
        )

    rows = await _audit_export_rows(session, entity=entity, action=action, user=user)
    content = _audit_export_csv_content(rows, redact=redact)
    filename = _audit_export_filename(entity)
    return Response(
        content=content,
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
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("audit"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
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


def _as_utc(value: datetime | None) -> datetime | None:
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _refresh_session_to_response(row: RefreshSession, now: datetime) -> RefreshSessionResponse | None:
    expires_at = _as_utc(row.expires_at)
    if not expires_at or expires_at < now:
        return None
    return RefreshSessionResponse(
        id=row.id,
        created_at=_as_utc(row.created_at),
        expires_at=expires_at,
        persistent=bool(getattr(row, "persistent", True)),
        is_current=False,
        user_agent=getattr(row, "user_agent", None),
        ip_address=getattr(row, "ip_address", None),
        country_code=getattr(row, "country_code", None),
    )


@router.get("/sessions/{user_id}")
async def admin_list_user_sessions(
    user_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("users"))],
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
        payload = _refresh_session_to_response(row, now)
        if payload is not None:
            sessions.append(payload)

    return sessions


@router.post("/sessions/{user_id}/{session_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_user_session(
    user_id: UUID,
    session_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
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


def _gdpr_user_text_filter(stmt: Any, q: str | None) -> Any:
    if not q:
        return stmt
    like = f"%{q.strip().lower()}%"
    return stmt.where(
        func.lower(User.email).ilike(like)
        | func.lower(User.username).ilike(like)
        | func.lower(User.name).ilike(like)
    )


def _gdpr_export_jobs_stmt(
    q: str | None, status_filter: UserDataExportStatus | None
) -> Any:
    stmt = select(UserDataExportJob, User).join(User, UserDataExportJob.user_id == User.id)
    stmt = _gdpr_user_text_filter(stmt, q)
    if status_filter is not None:
        stmt = stmt.where(UserDataExportJob.status == status_filter)
    return stmt


async def _gdpr_export_jobs_page(
    session: AsyncSession, stmt: Any, *, limit: int, offset: int
) -> tuple[int, int, list[Any]]:
    total_items = int(
        await session.scalar(stmt.with_only_columns(func.count()).order_by(None)) or 0
    )
    total_pages = _pagination_total_pages(total_items, limit)
    rows = (
        await session.execute(
            stmt.order_by(UserDataExportJob.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return total_items, total_pages, rows


def _gdpr_export_sla_days() -> int:
    return max(1, int(getattr(settings, "gdpr_export_sla_days", 30) or 30))


def _gdpr_user_ref(user: User, *, include_pii: bool) -> AdminGdprUserRef:
    return AdminGdprUserRef(
        id=user.id,
        email=user.email if include_pii else (pii_service.mask_email(user.email) or user.email),
        username=user.username,
        role=user.role,
    )


def _gdpr_export_job_item(
    job: UserDataExportJob,
    user: User,
    *,
    include_pii: bool,
    now: datetime,
    sla_days: int,
) -> AdminGdprExportJobItem:
    created_at = _as_utc(job.created_at) or job.created_at
    updated_at = _as_utc(job.updated_at) or job.updated_at
    started_at = _as_utc(job.started_at)
    finished_at = _as_utc(job.finished_at)
    expires_at = _as_utc(job.expires_at)
    sla_due_at = created_at + timedelta(days=sla_days)
    sla_breached = job.status != UserDataExportStatus.succeeded and now > sla_due_at
    return AdminGdprExportJobItem(
        id=job.id,
        user=_gdpr_user_ref(user, include_pii=include_pii),
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


async def _gdpr_export_job_and_user(
    session: AsyncSession, job_id: UUID
) -> tuple[UserDataExportJob, User]:
    job = await session.get(UserDataExportJob, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    user = await session.get(User, job.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return job, user


def _gdpr_require_engine(session: AsyncSession) -> Any:
    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database engine unavailable")
    return engine


def _gdpr_reset_export_job(job: UserDataExportJob) -> None:
    job.status = UserDataExportStatus.pending
    job.progress = 0
    job.error_message = None
    job.started_at = None
    job.finished_at = None
    job.expires_at = None
    job.file_path = None


def _gdpr_deletion_requests_stmt(q: str | None) -> Any:
    stmt = select(User).where(User.deleted_at.is_(None), User.deletion_requested_at.is_not(None))
    return _gdpr_user_text_filter(stmt, q)


async def _gdpr_deletion_requests_page(
    session: AsyncSession, stmt: Any, *, limit: int, offset: int
) -> tuple[int, int, list[User]]:
    total_items = int(await session.scalar(stmt.with_only_columns(func.count()).order_by(None)) or 0)
    total_pages = _pagination_total_pages(total_items, limit)
    rows = (
        (
            await session.execute(
                stmt.order_by(User.deletion_requested_at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return total_items, total_pages, rows


def _gdpr_deletion_sla_days() -> int:
    return max(1, int(getattr(settings, "gdpr_deletion_sla_days", 30) or 30))


def _gdpr_deletion_status(scheduled_for: datetime | None, now: datetime) -> str:
    if not scheduled_for:
        return "scheduled"
    if scheduled_for <= now:
        return "due"
    return "cooldown"


def _gdpr_deletion_request_item(
    user: User,
    *,
    include_pii: bool,
    now: datetime,
    sla_days: int,
) -> AdminGdprDeletionRequestItem:
    requested_at = _as_utc(user.deletion_requested_at)
    scheduled_for = _as_utc(user.deletion_scheduled_for)
    resolved_requested_at = requested_at or now
    sla_due_at = resolved_requested_at + timedelta(days=sla_days)
    return AdminGdprDeletionRequestItem(
        user=_gdpr_user_ref(user, include_pii=include_pii),
        requested_at=resolved_requested_at,
        scheduled_for=scheduled_for,
        status=_gdpr_deletion_status(scheduled_for, now),
        sla_due_at=sla_due_at,
        sla_breached=bool(now > sla_due_at),
    )


@router.get("/gdpr/exports")
async def admin_gdpr_export_jobs(
    request: Request,
    q: str | None = Query(default=None),
    status_filter: UserDataExportStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminGdprExportJobsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
    offset = (page - 1) * limit
    stmt = _gdpr_export_jobs_stmt(q, status_filter)
    total_items, total_pages, rows = await _gdpr_export_jobs_page(
        session, stmt, limit=limit, offset=offset
    )

    now = datetime.now(timezone.utc)
    sla_days = _gdpr_export_sla_days()
    items = [
        _gdpr_export_job_item(
            job,
            user,
            include_pii=include_pii,
            now=now,
            sla_days=sla_days,
        )
        for job, user in rows
    ]

    return AdminGdprExportJobsResponse(
        items=items,
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


@router.post("/gdpr/exports/{job_id}/retry")
async def admin_gdpr_retry_export_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> AdminGdprExportJobItem:
    job, user = await _gdpr_export_job_and_user(session, job_id)
    engine = _gdpr_require_engine(session)
    _gdpr_reset_export_job(job)
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
    return _gdpr_export_job_item(
        job,
        user,
        include_pii=True,
        now=now,
        sla_days=_gdpr_export_sla_days(),
    )


@router.get("/gdpr/exports/{job_id}/download")
async def admin_gdpr_download_export_job(
    job_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> FileResponse:
    step_up_service.require_step_up(request, current_user)
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


@router.get("/gdpr/deletions")
async def admin_gdpr_deletion_requests(
    request: Request,
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("users")),
) -> AdminGdprDeletionRequestsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)
    offset = (page - 1) * limit
    stmt = _gdpr_deletion_requests_stmt(q)
    total_items, total_pages, rows = await _gdpr_deletion_requests_page(
        session, stmt, limit=limit, offset=offset
    )

    now = datetime.now(timezone.utc)
    sla_days = _gdpr_deletion_sla_days()
    items = [
        _gdpr_deletion_request_item(
            user,
            include_pii=include_pii,
            now=now,
            sla_days=sla_days,
        )
        for user in rows
    ]

    return AdminGdprDeletionRequestsResponse(
        items=items,
        meta={
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "limit": limit,
        },
    )


def _assert_gdpr_deletion_target_allowed(
    user: User,
    current_user: User,
    *,
    owner_error: str,
    staff_error: str,
) -> None:
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=owner_error)

    staff_roles = {
        UserRole.admin,
        UserRole.support,
        UserRole.fulfillment,
        UserRole.content,
    }
    if user.role in staff_roles and current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=staff_error)


@router.post("/gdpr/deletions/{user_id}/execute", status_code=status.HTTP_204_NO_CONTENT)
async def admin_gdpr_execute_deletion(
    user_id: UUID,
    payload: AdminUserDeleteRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> None:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _assert_gdpr_deletion_target_allowed(
        user,
        current_user,
        owner_error="Owner account cannot be deleted",
        staff_error="Only the owner can delete staff accounts",
    )

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
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _assert_gdpr_deletion_target_allowed(
        user,
        current_user,
        owner_error="Owner account cannot be modified",
        staff_error="Only the owner can modify staff accounts",
    )

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
    payload: AdminUserRoleUpdateRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> dict:
    if current_user.role not in (UserRole.owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner/admin can change user roles")

    if not security.verify_password(payload.password, current_user.hashed_password):
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
    role = payload.role
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


@router.patch("/users/{user_id}/internal")
async def update_user_internal(
    user_id: UUID,
    payload: AdminUserInternalUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
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

    return _admin_user_profile(user)


def _admin_user_profile(user: User) -> AdminUserProfileUser:
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


def _user_security_snapshot(user: User) -> tuple[datetime | None, str | None, bool]:
    return (
        _as_utc(getattr(user, "locked_until", None)),
        getattr(user, "locked_reason", None),
        bool(getattr(user, "password_reset_required", False)),
    )


def _normalized_locked_until(value: Any, *, now: datetime) -> datetime | None:
    locked_until = _as_utc(value)
    if locked_until and locked_until <= now:
        return None
    return locked_until


def _apply_locked_until_update(user: User, data: dict[str, Any], *, now: datetime) -> None:
    if "locked_until" not in data:
        return
    user.locked_until = _normalized_locked_until(data.get("locked_until"), now=now)


def _apply_locked_reason_update(user: User, data: dict[str, Any]) -> None:
    if "locked_reason" not in data:
        return
    raw_reason = data.get("locked_reason")
    user.locked_reason = (raw_reason or "").strip()[:255] or None


def _clear_locked_reason_for_unlocked_user(user: User) -> None:
    if getattr(user, "locked_until", None) is not None:
        return
    user.locked_reason = None


def _apply_password_reset_required_update(user: User, data: dict[str, Any]) -> None:
    if "password_reset_required" not in data:
        return
    password_reset_required = data.get("password_reset_required")
    if password_reset_required is None:
        return
    user.password_reset_required = bool(password_reset_required)


def _apply_user_security_update(user: User, data: dict[str, Any], *, now: datetime) -> None:
    _apply_locked_until_update(user, data, now=now)
    _apply_locked_reason_update(user, data)
    _clear_locked_reason_for_unlocked_user(user)
    _apply_password_reset_required_update(user, data)


def _user_security_changes(
    before: tuple[datetime | None, str | None, bool],
    after: tuple[datetime | None, str | None, bool],
) -> dict[str, object]:
    before_locked_until, before_locked_reason, before_password_reset_required = before
    after_locked_until, after_locked_reason, after_password_reset_required = after
    changes: dict[str, object] = {}
    if before_locked_until != after_locked_until:
        changes["locked_until"] = {
            "before": before_locked_until.isoformat() if before_locked_until else None,
            "after": after_locked_until.isoformat() if after_locked_until else None,
        }
    if before_locked_reason != after_locked_reason:
        changes["locked_reason"] = {
            "before_length": len(before_locked_reason or ""),
            "after_length": len(after_locked_reason or ""),
        }
    if before_password_reset_required != after_password_reset_required:
        changes["password_reset_required"] = {
            "before": before_password_reset_required,
            "after": after_password_reset_required,
        }
    return changes


def _require_security_update_target(user: User | None, current_user: User) -> User:
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify owner security settings")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify your own security settings")
    return user


async def _audit_user_security_update(
    session: AsyncSession,
    *,
    changes: dict[str, object],
    actor_user_id: UUID,
    subject_user_id: UUID,
    request: Request,
) -> None:
    if not changes:
        return
    await audit_chain_service.add_admin_audit_log(
        session,
        action="user.security.update",
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        data={
            "changes": changes,
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
    )


@router.patch("/users/{user_id}/security")
async def update_user_security(
    user_id: UUID,
    payload: AdminUserSecurityUpdate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
) -> AdminUserProfileUser:
    user = _require_security_update_target(await session.get(User, user_id), current_user)

    now = datetime.now(timezone.utc)
    before_snapshot = _user_security_snapshot(user)
    data = payload.model_dump(exclude_unset=True)
    _apply_user_security_update(user, data, now=now)
    after_snapshot = _user_security_snapshot(user)
    changes = _user_security_changes(before_snapshot, after_snapshot)

    session.add(user)
    await session.flush()
    await _audit_user_security_update(
        session,
        changes=changes,
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        request=request,
    )
    await session.commit()

    return _admin_user_profile(user)


@router.get("/users/{user_id}/email/verification")
async def email_verification_history(
    user_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("users"))],
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
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
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


@router.post("/users/{user_id}/password-reset/resend", status_code=status.HTTP_202_ACCEPTED)
async def resend_password_reset(
    user_id: UUID,
    payload: AdminPasswordResetResendRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
    _: Annotated[None, Depends(admin_password_reset_resend_rate_limit)],
) -> dict:
    user = await session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    requested_email = (payload.email or "").strip().lower()
    target_email = (user.email or "").strip()
    target_kind = "primary"
    if requested_email:
        if requested_email == (user.email or "").strip().lower():
            target_email = (user.email or "").strip()
        else:
            secondary = await session.scalar(
                select(UserSecondaryEmail).where(
                    UserSecondaryEmail.user_id == user.id,
                    func.lower(UserSecondaryEmail.email) == requested_email,
                    UserSecondaryEmail.verified.is_(True),
                )
            )
            if not secondary:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")
            target_email = (secondary.email or "").strip()
            target_kind = "secondary"

    if not target_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User email missing")

    reset = await auth_service.create_reset_token(session, target_email.lower())
    if not reset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    background_tasks.add_task(
        email_service.send_password_reset,
        target_email,
        reset.token,
        user.preferred_language,
    )
    await audit_chain_service.add_admin_audit_log(
        session,
        action="user.password_reset.resend",
        actor_user_id=current_user.id,
        subject_user_id=user.id,
        data={
            "password_reset_token_id": str(reset.id),
            "expires_at": reset.expires_at.isoformat() if reset.expires_at else None,
            "to_email_masked": pii_service.mask_email(target_email),
            "to_email_kind": target_kind,
            "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
            "ip_address": (request.client.host if request.client else None),
        },
    )
    await session.commit()
    return {"detail": "Password reset email sent"}


@router.post("/users/{user_id}/email/verification/override")
async def override_email_verification(
    user_id: UUID,
    payload: AdminUserDeleteRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> AdminUserProfileUser:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

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


@router.post("/users/{user_id}/impersonate")
async def impersonate_user(
    user_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("users"))],
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
    payload: AdminOwnerTransferRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_owner: Annotated[User, Depends(require_owner)],
) -> dict:
    identifier = str(payload.identifier or "").strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier is required"
        )

    confirm = str(payload.confirm or "").strip()
    if confirm.upper() != "TRANSFER":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='Type "TRANSFER" to confirm'
        )

    if not security.verify_password(payload.password, current_owner.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

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
async def get_maintenance(_: Annotated[str, Depends(require_admin)]) -> dict:
    return {"enabled": settings.maintenance_mode}


@router.post("/maintenance")
async def set_maintenance(payload: dict, _: Annotated[str, Depends(require_admin)]) -> dict:
    enabled = bool(payload.get("enabled", False))
    settings.maintenance_mode = enabled
    return {"enabled": settings.maintenance_mode}


@router.get("/export")
async def export_data(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict:
    step_up_service.require_step_up(request, admin)
    return await exporter_service.export_json(session)


@router.get("/low-stock")
async def low_stock_products(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("inventory"))],
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


@router.get("/stock-adjustments")
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
    request: Request,
    product_id: UUID = Query(...),
    reason: StockAdjustmentReason | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("inventory")),
) -> Response:
    step_up_service.require_step_up(request, admin)
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

    status_code=status.HTTP_201_CREATED,
)
async def apply_stock_adjustment(
    payload: StockAdjustmentCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("inventory"))],
) -> StockAdjustmentRead:
    return await catalog_service.apply_stock_adjustment(
        session, payload=payload, user_id=current_user.id
    )


@router.get("/inventory/restock-list")
async def inventory_restock_list(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin_section("inventory"))],
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


async def _resolve_inventory_product_for_reservations(
    session: AsyncSession,
    *,
    product_id: UUID,
    variant_id: UUID | None,
) -> Product:
    product = await session.get(Product, product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if variant_id is not None:
        variant = await session.get(ProductVariant, variant_id)
        if not variant or variant.product_id != product.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")

    return product


def _masked_reservation_email(row: dict[str, Any], *, include_pii: bool) -> str | None:
    email_value = str(row.get("customer_email") or "").strip() or None
    if email_value and not include_pii:
        email_value = pii_service.mask_email(email_value) or email_value
    return email_value


@router.get("/inventory/reservations/carts")
async def inventory_reserved_carts(
    request: Request,
    product_id: UUID = Query(...),
    variant_id: UUID | None = Query(default=None),
    include_pii: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("inventory")),
) -> CartReservationsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)

    product = await _resolve_inventory_product_for_reservations(
        session, product_id=product_id, variant_id=variant_id
    )

    cutoff, rows = await inventory_service.list_cart_reservations(
        session,
        product_id=product.id,
        variant_id=variant_id,
        limit=limit,
        offset=offset,
    )
    items: list[dict] = []
    for row in rows:
        items.append(
            {
                "cart_id": row.get("cart_id"),
                "updated_at": row.get("updated_at"),
                "customer_email": _masked_reservation_email(row, include_pii=include_pii),
                "quantity": int(row.get("quantity") or 0),
            }
        )

    return CartReservationsResponse(cutoff=cutoff, items=items)


@router.get("/inventory/reservations/orders")
async def inventory_reserved_orders(
    request: Request,
    product_id: UUID = Query(...),
    variant_id: UUID | None = Query(default=None),
    include_pii: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin_section("inventory")),
) -> OrderReservationsResponse:
    if include_pii:
        pii_service.require_pii_reveal(current_user, request=request)

    product = await _resolve_inventory_product_for_reservations(
        session, product_id=product_id, variant_id=variant_id
    )

    rows = await inventory_service.list_order_reservations(
        session,
        product_id=product.id,
        variant_id=variant_id,
        limit=limit,
        offset=offset,
    )
    items: list[dict] = []
    for row in rows:
        items.append(
            {
                "order_id": row.get("order_id"),
                "reference_code": row.get("reference_code"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "customer_email": _masked_reservation_email(row, include_pii=include_pii),
                "quantity": int(row.get("quantity") or 0),
            }
        )

    return OrderReservationsResponse(items=items)


@router.put("/inventory/restock-notes")
async def upsert_inventory_restock_note(
    payload: RestockNoteUpsert,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("inventory"))],
) -> RestockNoteRead | None:
    return await inventory_service.upsert_restock_note(
        session, payload=payload, user_id=current_user.id
    )


@router.get("/inventory/restock-list/export")
async def export_inventory_restock_list(
    request: Request,
    include_variants: bool = Query(default=True),
    default_threshold: int = Query(
        default=DEFAULT_LOW_STOCK_DASHBOARD_THRESHOLD, ge=1, le=1000
    ),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("inventory")),
) -> Response:
    step_up_service.require_step_up(request, admin)
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
