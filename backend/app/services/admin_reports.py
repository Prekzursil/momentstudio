from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.catalog import Category, Product
from app.models.content import ContentBlock
from app.models.order import Order, OrderItem, OrderRefund, OrderStatus, OrderTag
from app.services import auth as auth_service
from app.services import content as content_service
from app.services import email as email_service

logger = logging.getLogger(__name__)

REPORT_SETTINGS_KEY = "site.reports"

DEFAULT_TOP_PRODUCTS_LIMIT = 5
DEFAULT_LOW_STOCK_LIMIT = 20
DEFAULT_RETRY_COOLDOWN_MINUTES = 60

DEFAULT_WEEKLY_ENABLED = False
DEFAULT_WEEKLY_WEEKDAY = 0  # Monday
DEFAULT_WEEKLY_HOUR_UTC = 8

DEFAULT_MONTHLY_ENABLED = False
DEFAULT_MONTHLY_DAY = 1
DEFAULT_MONTHLY_HOUR_UTC = 8

DEFAULT_LOW_STOCK_THRESHOLD = 5

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass(frozen=True)
class ReportSettings:
    weekly_enabled: bool = DEFAULT_WEEKLY_ENABLED
    weekly_weekday: int = DEFAULT_WEEKLY_WEEKDAY
    weekly_hour_utc: int = DEFAULT_WEEKLY_HOUR_UTC
    monthly_enabled: bool = DEFAULT_MONTHLY_ENABLED
    monthly_day: int = DEFAULT_MONTHLY_DAY
    monthly_hour_utc: int = DEFAULT_MONTHLY_HOUR_UTC
    recipients: list[str] | None = None
    top_products_limit: int = DEFAULT_TOP_PRODUCTS_LIMIT
    low_stock_limit: int = DEFAULT_LOW_STOCK_LIMIT
    retry_cooldown_minutes: int = DEFAULT_RETRY_COOLDOWN_MINUTES


@dataclass(frozen=True)
class ReportState:
    weekly_last_sent_period_end: datetime | None = None
    weekly_last_attempt_at: datetime | None = None
    weekly_last_attempt_period_end: datetime | None = None
    weekly_last_error: str | None = None
    monthly_last_sent_period_end: datetime | None = None
    monthly_last_attempt_at: datetime | None = None
    monthly_last_attempt_period_end: datetime | None = None
    monthly_last_error: str | None = None


def _parse_bool(value: object | None, *, fallback: bool) -> bool:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        candidate = value.strip().lower()
        if candidate in {"1", "true", "yes", "on"}:
            return True
        if candidate in {"0", "false", "no", "off"}:
            return False
    return fallback


def _try_int(value: str | float | int) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def _coerce_int(value: object | None) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return _try_int(value)
    if isinstance(value, str):
        candidate = value.strip()
        return _try_int(candidate) if candidate else None
    return None


def _parse_int(value: object | None, *, fallback: int, min_value: int | None = None, max_value: int | None = None) -> int:
    result = _coerce_int(value)
    result = fallback if result is None else result
    if min_value is not None:
        result = max(min_value, result)
    if max_value is not None:
        result = min(max_value, result)
    return result


def _parse_iso_dt(value: object | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        dt = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _recipient_candidates(value: object | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v or "").strip() for v in value]
    return re.split(r"[,;\n]+", str(value))


def _normalize_recipient_email(value: str) -> str | None:
    email = (value or "").strip()
    if not email:
        return None
    if _EMAIL_RE.match(email) is None:
        return None
    return email.lower()


def _parse_recipients(value: object | None) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for raw in _recipient_candidates(value):
        email = _normalize_recipient_email(raw)
        if email is None or email in seen:
            continue
        unique.append(email)
        seen.add(email)
    return unique


def _weekly_period_end(now: datetime, *, weekday: int, hour_utc: int) -> datetime:
    now_utc = now.astimezone(timezone.utc)
    weekday = max(0, min(6, int(weekday)))
    hour_utc = max(0, min(23, int(hour_utc)))
    days_since = (now_utc.weekday() - weekday) % 7
    candidate_date = (now_utc - timedelta(days=days_since)).date()
    candidate = datetime(
        candidate_date.year,
        candidate_date.month,
        candidate_date.day,
        hour_utc,
        0,
        0,
        tzinfo=timezone.utc,
    )
    if candidate > now_utc:
        candidate -= timedelta(days=7)
    return candidate


def _previous_month(year: int, month: int) -> tuple[int, int]:
    if month <= 1:
        return year - 1, 12
    return year, month - 1


def _monthly_period_end(now: datetime, *, day: int, hour_utc: int) -> datetime:
    now_utc = now.astimezone(timezone.utc)
    day = max(1, min(28, int(day)))
    hour_utc = max(0, min(23, int(hour_utc)))
    candidate = datetime(now_utc.year, now_utc.month, day, hour_utc, 0, 0, tzinfo=timezone.utc)
    if candidate > now_utc:
        prev_year, prev_month = _previous_month(now_utc.year, now_utc.month)
        candidate = datetime(prev_year, prev_month, day, hour_utc, 0, 0, tzinfo=timezone.utc)
    return candidate


def _subtract_one_month(dt: datetime) -> datetime:
    prev_year, prev_month = _previous_month(dt.year, dt.month)
    return dt.replace(year=prev_year, month=prev_month)


def _cooldown_active(
    *,
    now: datetime,
    period_end: datetime,
    last_attempt_at: datetime | None,
    last_attempt_period_end: datetime | None,
    cooldown_minutes: int,
) -> bool:
    if not last_attempt_at:
        return False
    if not last_attempt_period_end:
        return False
    if last_attempt_period_end != period_end:
        return False
    return now - last_attempt_at < timedelta(minutes=max(1, cooldown_minutes))


async def _load_settings_block(session: AsyncSession) -> ContentBlock | None:
    return await content_service.get_published_by_key_following_redirects(session, REPORT_SETTINGS_KEY)


def _parse_settings(meta: dict | None) -> tuple[ReportSettings, ReportState]:
    meta = dict(meta or {})
    settings_obj = ReportSettings(
        weekly_enabled=_parse_bool(meta.get("reports_weekly_enabled"), fallback=DEFAULT_WEEKLY_ENABLED),
        weekly_weekday=_parse_int(meta.get("reports_weekly_weekday"), fallback=DEFAULT_WEEKLY_WEEKDAY, min_value=0, max_value=6),
        weekly_hour_utc=_parse_int(meta.get("reports_weekly_hour_utc"), fallback=DEFAULT_WEEKLY_HOUR_UTC, min_value=0, max_value=23),
        monthly_enabled=_parse_bool(meta.get("reports_monthly_enabled"), fallback=DEFAULT_MONTHLY_ENABLED),
        monthly_day=_parse_int(meta.get("reports_monthly_day"), fallback=DEFAULT_MONTHLY_DAY, min_value=1, max_value=28),
        monthly_hour_utc=_parse_int(meta.get("reports_monthly_hour_utc"), fallback=DEFAULT_MONTHLY_HOUR_UTC, min_value=0, max_value=23),
        recipients=_parse_recipients(meta.get("reports_recipients")) or None,
        top_products_limit=_parse_int(
            meta.get("reports_top_products_limit"),
            fallback=DEFAULT_TOP_PRODUCTS_LIMIT,
            min_value=1,
            max_value=50,
        ),
        low_stock_limit=_parse_int(
            meta.get("reports_low_stock_limit"),
            fallback=DEFAULT_LOW_STOCK_LIMIT,
            min_value=1,
            max_value=200,
        ),
        retry_cooldown_minutes=_parse_int(
            meta.get("reports_retry_cooldown_minutes"),
            fallback=DEFAULT_RETRY_COOLDOWN_MINUTES,
            min_value=1,
            max_value=24 * 60,
        ),
    )
    state_obj = ReportState(
        weekly_last_sent_period_end=_parse_iso_dt(meta.get("reports_weekly_last_sent_period_end")),
        weekly_last_attempt_at=_parse_iso_dt(meta.get("reports_weekly_last_attempt_at")),
        weekly_last_attempt_period_end=_parse_iso_dt(meta.get("reports_weekly_last_attempt_period_end")),
        weekly_last_error=(str(meta.get("reports_weekly_last_error") or "").strip()[:500] or None),
        monthly_last_sent_period_end=_parse_iso_dt(meta.get("reports_monthly_last_sent_period_end")),
        monthly_last_attempt_at=_parse_iso_dt(meta.get("reports_monthly_last_attempt_at")),
        monthly_last_attempt_period_end=_parse_iso_dt(meta.get("reports_monthly_last_attempt_period_end")),
        monthly_last_error=(str(meta.get("reports_monthly_last_error") or "").strip()[:500] or None),
    )
    return settings_obj, state_obj


async def _update_block_meta(session: AsyncSession, block: ContentBlock, updates: dict[str, object | None]) -> None:
    meta = dict(getattr(block, "meta", None) or {})
    for key, value in updates.items():
        if value is None:
            meta.pop(key, None)
        else:
            meta[key] = value
    block.meta = meta
    session.add(block)
    await session.commit()


def _order_period_filters(period_start: datetime, period_end: datetime, exclude_test_orders: Any) -> tuple[Any, Any, Any]:
    return (
        Order.created_at >= period_start,
        Order.created_at < period_end,
        exclude_test_orders,
    )


async def _sum_gross_sales(
    session: AsyncSession,
    *,
    filters: tuple[Any, ...],
    sales_statuses: tuple[OrderStatus, ...],
) -> Any:
    return await session.scalar(select(func.coalesce(func.sum(Order.total_amount), 0)).where(*filters, Order.status.in_(sales_statuses)))


async def _sum_refunds(
    session: AsyncSession,
    *,
    filters: tuple[Any, ...],
    sales_statuses: tuple[OrderStatus, ...],
) -> Any:
    return await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(*filters, Order.status.in_(sales_statuses))
    )


async def _sum_missing_refunds(
    session: AsyncSession,
    *,
    filters: tuple[Any, ...],
) -> Any:
    return await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(*filters, Order.status == OrderStatus.refunded, OrderRefund.id.is_(None))
    )


async def _count_orders(
    session: AsyncSession,
    *,
    filters: tuple[Any, ...],
    status: OrderStatus | None = None,
    statuses: tuple[OrderStatus, ...] | None = None,
) -> int:
    stmt = select(func.count()).select_from(Order).where(*filters)
    if statuses is not None:
        stmt = stmt.where(Order.status.in_(statuses))
    elif status is not None:
        stmt = stmt.where(Order.status == status)
    count = await session.scalar(stmt)
    return int(count or 0)


async def _compute_summary(
    session: AsyncSession,
    *,
    period_start: datetime,
    period_end: datetime,
) -> dict:
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    sales_statuses = (*successful_statuses, OrderStatus.refunded)
    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)
    filters = _order_period_filters(period_start, period_end, exclude_test_orders)

    gross_sales = await _sum_gross_sales(session, filters=filters, sales_statuses=sales_statuses)
    refunds = await _sum_refunds(session, filters=filters, sales_statuses=sales_statuses)
    missing_refunds = await _sum_missing_refunds(session, filters=filters)
    net_sales = (gross_sales or 0) - (refunds or 0) - (missing_refunds or 0)
    orders_total = await _count_orders(session, filters=filters)
    orders_success = await _count_orders(session, filters=filters, statuses=successful_statuses)
    orders_refunded = await _count_orders(session, filters=filters, status=OrderStatus.refunded)

    return {
        "gross_sales": Decimal(str(gross_sales or 0)),
        "net_sales": Decimal(str(net_sales or 0)),
        "refunds": Decimal(str(refunds or 0)),
        "missing_refunds": Decimal(str(missing_refunds or 0)),
        "orders_total": orders_total,
        "orders_success": orders_success,
        "orders_refunded": orders_refunded,
    }


async def _top_products(
    session: AsyncSession,
    *,
    period_start: datetime,
    period_end: datetime,
    limit: int,
) -> list[dict]:
    successful_statuses = (OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered)
    test_order_ids = select(OrderTag.order_id).where(OrderTag.tag == "test")
    exclude_test_orders = Order.id.notin_(test_order_ids)
    stmt = (
        select(
            Product.id.label("id"),
            Product.name.label("name"),
            Product.slug.label("slug"),
            func.coalesce(func.sum(OrderItem.quantity), 0).label("quantity"),
            func.coalesce(func.sum(OrderItem.subtotal), 0).label("gross_sales"),
        )
        .select_from(OrderItem)
        .join(Order, OrderItem.order_id == Order.id)
        .join(Product, OrderItem.product_id == Product.id)
        .where(
            Order.created_at >= period_start,
            Order.created_at < period_end,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
        .group_by(Product.id)
        .order_by(func.sum(OrderItem.quantity).desc(), func.sum(OrderItem.subtotal).desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(row.id),
            "name": str(row.name or ""),
            "slug": str(row.slug or ""),
            "quantity": int(row.quantity or 0),
            "gross_sales": Decimal(str(row.gross_sales or 0)),
        }
        for row in rows
    ]


async def _low_stock(
    session: AsyncSession,
    *,
    limit: int,
) -> list[dict]:
    threshold_expr = func.coalesce(
        Product.low_stock_threshold,
        Category.low_stock_threshold,
        DEFAULT_LOW_STOCK_THRESHOLD,
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
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    items: list[dict] = []
    for product, threshold in rows:
        threshold_int = int(threshold or DEFAULT_LOW_STOCK_THRESHOLD)
        stock = int(getattr(product, "stock_quantity", 0) or 0)
        items.append(
            {
                "id": str(product.id),
                "name": product.name,
                "slug": product.slug,
                "sku": product.sku,
                "stock_quantity": stock,
                "threshold": threshold_int,
                "is_critical": bool(stock <= 0 or stock < max(1, int(threshold_int // 2))),
            }
        )
    return items


async def _send_report_email(
    session: AsyncSession,
    *,
    kind: str,
    period_start: datetime,
    period_end: datetime,
    recipients: list[str],
    top_products_limit: int,
    low_stock_limit: int,
) -> tuple[int, int]:
    summary = await _compute_summary(session, period_start=period_start, period_end=period_end)
    top_products = await _top_products(
        session,
        period_start=period_start,
        period_end=period_end,
        limit=top_products_limit,
    )
    low_stock = await _low_stock(session, limit=low_stock_limit)

    owner = await auth_service.get_owner_user(session)
    preferred_language = owner.preferred_language if owner else None
    attempted = 0
    delivered = 0
    for to_email in recipients:
        attempted += 1
        ok = await email_service.send_admin_report_summary(
            to_email,
            kind=kind,
            period_start=period_start,
            period_end=period_end,
            currency="RON",
            summary=summary,
            top_products=top_products,
            low_stock=low_stock,
            lang=preferred_language,
        )
        if ok:
            delivered += 1
    return attempted, delivered


async def _effective_recipients(session: AsyncSession, recipients: list[str] | None) -> list[str]:
    if recipients:
        return recipients
    owner = await auth_service.get_owner_user(session)
    fallback = ((owner.email if owner and owner.email else None) or settings.admin_alert_email or "").strip()
    if fallback and _EMAIL_RE.match(fallback):
        return [fallback.lower()]
    return []


@dataclass(frozen=True)
class _ScheduledReportSpec:
    kind: str
    period_start: datetime
    period_end: datetime
    last_sent_period_end: datetime | None
    last_attempt_at: datetime | None
    last_attempt_period_end: datetime | None
    attempt_at_key: str
    attempt_period_end_key: str
    sent_period_end_key: str
    error_key: str


def _weekly_due_spec(now: datetime, settings_obj: ReportSettings, state_obj: ReportState) -> _ScheduledReportSpec:
    period_end = _weekly_period_end(now, weekday=settings_obj.weekly_weekday, hour_utc=settings_obj.weekly_hour_utc)
    return _ScheduledReportSpec(
        kind="weekly",
        period_start=period_end - timedelta(days=7),
        period_end=period_end,
        last_sent_period_end=state_obj.weekly_last_sent_period_end,
        last_attempt_at=state_obj.weekly_last_attempt_at,
        last_attempt_period_end=state_obj.weekly_last_attempt_period_end,
        attempt_at_key="reports_weekly_last_attempt_at",
        attempt_period_end_key="reports_weekly_last_attempt_period_end",
        sent_period_end_key="reports_weekly_last_sent_period_end",
        error_key="reports_weekly_last_error",
    )


def _monthly_due_spec(now: datetime, settings_obj: ReportSettings, state_obj: ReportState) -> _ScheduledReportSpec:
    period_end = _monthly_period_end(now, day=settings_obj.monthly_day, hour_utc=settings_obj.monthly_hour_utc)
    return _ScheduledReportSpec(
        kind="monthly",
        period_start=_subtract_one_month(period_end),
        period_end=period_end,
        last_sent_period_end=state_obj.monthly_last_sent_period_end,
        last_attempt_at=state_obj.monthly_last_attempt_at,
        last_attempt_period_end=state_obj.monthly_last_attempt_period_end,
        attempt_at_key="reports_monthly_last_attempt_at",
        attempt_period_end_key="reports_monthly_last_attempt_period_end",
        sent_period_end_key="reports_monthly_last_sent_period_end",
        error_key="reports_monthly_last_error",
    )


async def _update_due_report_outcome(
    session: AsyncSession,
    block: ContentBlock,
    *,
    spec: _ScheduledReportSpec,
    attempted: int,
    delivered: int,
) -> None:
    if delivered > 0:
        await _update_block_meta(
            session,
            block,
            {spec.sent_period_end_key: spec.period_end.isoformat(), spec.error_key: None},
        )
        return
    await _update_block_meta(session, block, {spec.error_key: f"Delivery failed (attempted={attempted})."})


async def _send_due_report_for_spec(
    session: AsyncSession,
    *,
    now: datetime,
    block: ContentBlock,
    settings_obj: ReportSettings,
    recipients: list[str],
    spec: _ScheduledReportSpec,
) -> None:
    if spec.last_sent_period_end == spec.period_end:
        return
    if _cooldown_active(
        now=now,
        period_end=spec.period_end,
        last_attempt_at=spec.last_attempt_at,
        last_attempt_period_end=spec.last_attempt_period_end,
        cooldown_minutes=settings_obj.retry_cooldown_minutes,
    ):
        return

    await _update_block_meta(
        session,
        block,
        {
            spec.attempt_at_key: now.isoformat(),
            spec.attempt_period_end_key: spec.period_end.isoformat(),
            spec.error_key: None,
        },
    )
    attempted, delivered = await _send_report_email(
        session,
        kind=spec.kind,
        period_start=spec.period_start,
        period_end=spec.period_end,
        recipients=recipients,
        top_products_limit=settings_obj.top_products_limit,
        low_stock_limit=settings_obj.low_stock_limit,
    )
    await _update_due_report_outcome(session, block, spec=spec, attempted=attempted, delivered=delivered)


async def send_due_reports(session: AsyncSession, *, now: datetime | None = None) -> None:
    if not settings.smtp_enabled:
        return

    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    block = await _load_settings_block(session)
    if not block:
        return

    settings_obj, state_obj = _parse_settings(getattr(block, "meta", None))
    recipients = await _effective_recipients(session, settings_obj.recipients)
    if not recipients:
        return

    if settings_obj.weekly_enabled:
        await _send_due_report_for_spec(
            session,
            now=now,
            block=block,
            settings_obj=settings_obj,
            recipients=recipients,
            spec=_weekly_due_spec(now, settings_obj, state_obj),
        )

    if settings_obj.monthly_enabled:
        await _send_due_report_for_spec(
            session,
            now=now,
            block=block,
            settings_obj=settings_obj,
            recipients=recipients,
            spec=_monthly_due_spec(now, settings_obj, state_obj),
        )


def _clean_report_kind(kind: str) -> str:
    kind_clean = (kind or "").strip().lower()
    if kind_clean not in {"weekly", "monthly"}:
        raise ValueError("Invalid report kind")
    return kind_clean


def _report_period(kind: str, now: datetime, settings_obj: ReportSettings) -> tuple[datetime, datetime]:
    if kind == "weekly":
        period_end = _weekly_period_end(now, weekday=settings_obj.weekly_weekday, hour_utc=settings_obj.weekly_hour_utc)
        return period_end - timedelta(days=7), period_end
    period_end = _monthly_period_end(now, day=settings_obj.monthly_day, hour_utc=settings_obj.monthly_hour_utc)
    return _subtract_one_month(period_end), period_end


def _last_sent_period_end(kind: str, state_obj: ReportState) -> datetime | None:
    if kind == "weekly":
        return state_obj.weekly_last_sent_period_end
    return state_obj.monthly_last_sent_period_end


def _last_sent_meta_key(kind: str) -> str:
    if kind == "weekly":
        return "reports_weekly_last_sent_period_end"
    return "reports_monthly_last_sent_period_end"


def _report_result(
    *,
    kind: str,
    period_start: datetime,
    period_end: datetime,
    attempted: int,
    delivered: int,
    skipped: bool,
) -> dict[str, object]:
    return {
        "kind": kind,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "attempted": attempted,
        "delivered": delivered,
        "skipped": skipped,
    }


async def send_report_now(
    session: AsyncSession,
    *,
    kind: str,
    force: bool = False,
    now: datetime | None = None,
) -> dict:
    if not settings.smtp_enabled:
        raise ValueError("SMTP is disabled")
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    block = await _load_settings_block(session)
    if not block:
        raise ValueError("Reports settings not configured")
    settings_obj, state_obj = _parse_settings(getattr(block, "meta", None))
    recipients = await _effective_recipients(session, settings_obj.recipients)
    if not recipients:
        raise ValueError("No report recipients configured")
    kind_clean = _clean_report_kind(kind)
    period_start, period_end = _report_period(kind_clean, now, settings_obj)
    if not force and _last_sent_period_end(kind_clean, state_obj) == period_end:
        return _report_result(
            kind=kind_clean,
            period_start=period_start,
            period_end=period_end,
            attempted=0,
            delivered=0,
            skipped=True,
        )
    attempted, delivered = await _send_report_email(
        session,
        kind=kind_clean,
        period_start=period_start,
        period_end=period_end,
        recipients=recipients,
        top_products_limit=settings_obj.top_products_limit,
        low_stock_limit=settings_obj.low_stock_limit,
    )
    if delivered > 0:
        await _update_block_meta(session, block, {_last_sent_meta_key(kind_clean): period_end.isoformat()})
    return _report_result(
        kind=kind_clean,
        period_start=period_start,
        period_end=period_end,
        attempted=attempted,
        delivered=delivered,
        skipped=False,
    )
