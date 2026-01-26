from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

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


def _parse_int(value: object | None, *, fallback: int, min_value: int | None = None, max_value: int | None = None) -> int:
    raw: int | None = None
    if value is None:
        raw = None
    elif isinstance(value, bool):
        raw = None
    elif isinstance(value, int):
        raw = value
    elif isinstance(value, float):
        try:
            raw = int(value)
        except Exception:
            raw = None
    elif isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            raw = None
        else:
            try:
                raw = int(candidate)
            except Exception:
                raw = None

    result = fallback if raw is None else raw
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


def _parse_recipients(value: object | None) -> list[str]:
    emails: list[str] = []
    if value is None:
        return emails
    if isinstance(value, list):
        candidates = [str(v or "").strip() for v in value]
    else:
        candidates = re.split(r"[,;\n]+", str(value))

    for raw in candidates:
        email = (raw or "").strip()
        if not email:
            continue
        if _EMAIL_RE.match(email) is None:
            continue
        emails.append(email.lower())
    unique: list[str] = []
    seen = set()
    for e in emails:
        if e in seen:
            continue
        unique.append(e)
        seen.add(e)
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

    gross_sales = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.created_at >= period_start,
            Order.created_at < period_end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    refunds = await session.scalar(
        select(func.coalesce(func.sum(OrderRefund.amount), 0))
        .select_from(OrderRefund)
        .join(Order, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= period_start,
            Order.created_at < period_end,
            Order.status.in_(sales_statuses),
            exclude_test_orders,
        )
    )
    missing_refunds = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .outerjoin(OrderRefund, OrderRefund.order_id == Order.id)
        .where(
            Order.created_at >= period_start,
            Order.created_at < period_end,
            Order.status == OrderStatus.refunded,
            OrderRefund.id.is_(None),
            exclude_test_orders,
        )
    )
    net_sales = (gross_sales or 0) - (refunds or 0) - (missing_refunds or 0)

    orders_total = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.created_at >= period_start, Order.created_at < period_end, exclude_test_orders)
    )
    orders_success = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= period_start,
            Order.created_at < period_end,
            Order.status.in_(successful_statuses),
            exclude_test_orders,
        )
    )
    orders_refunded = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(
            Order.created_at >= period_start,
            Order.created_at < period_end,
            Order.status == OrderStatus.refunded,
            exclude_test_orders,
        )
    )

    return {
        "gross_sales": Decimal(str(gross_sales or 0)),
        "net_sales": Decimal(str(net_sales or 0)),
        "refunds": Decimal(str(refunds or 0)),
        "missing_refunds": Decimal(str(missing_refunds or 0)),
        "orders_total": int(orders_total or 0),
        "orders_success": int(orders_success or 0),
        "orders_refunded": int(orders_refunded or 0),
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
        period_end = _weekly_period_end(now, weekday=settings_obj.weekly_weekday, hour_utc=settings_obj.weekly_hour_utc)
        if state_obj.weekly_last_sent_period_end == period_end:
            pass
        elif _cooldown_active(
            now=now,
            period_end=period_end,
            last_attempt_at=state_obj.weekly_last_attempt_at,
            last_attempt_period_end=state_obj.weekly_last_attempt_period_end,
            cooldown_minutes=settings_obj.retry_cooldown_minutes,
        ):
            pass
        else:
            await _update_block_meta(
                session,
                block,
                {
                    "reports_weekly_last_attempt_at": now.isoformat(),
                    "reports_weekly_last_attempt_period_end": period_end.isoformat(),
                    "reports_weekly_last_error": None,
                },
            )
            period_start = period_end - timedelta(days=7)
            attempted, delivered = await _send_report_email(
                session,
                kind="weekly",
                period_start=period_start,
                period_end=period_end,
                recipients=recipients,
                top_products_limit=settings_obj.top_products_limit,
                low_stock_limit=settings_obj.low_stock_limit,
            )
            if delivered > 0:
                await _update_block_meta(
                    session,
                    block,
                    {
                        "reports_weekly_last_sent_period_end": period_end.isoformat(),
                        "reports_weekly_last_error": None,
                    },
                )
            else:
                await _update_block_meta(
                    session,
                    block,
                    {
                        "reports_weekly_last_error": f"Delivery failed (attempted={attempted}).",
                    },
                )

    if settings_obj.monthly_enabled:
        period_end = _monthly_period_end(now, day=settings_obj.monthly_day, hour_utc=settings_obj.monthly_hour_utc)
        if state_obj.monthly_last_sent_period_end == period_end:
            pass
        elif _cooldown_active(
            now=now,
            period_end=period_end,
            last_attempt_at=state_obj.monthly_last_attempt_at,
            last_attempt_period_end=state_obj.monthly_last_attempt_period_end,
            cooldown_minutes=settings_obj.retry_cooldown_minutes,
        ):
            pass
        else:
            await _update_block_meta(
                session,
                block,
                {
                    "reports_monthly_last_attempt_at": now.isoformat(),
                    "reports_monthly_last_attempt_period_end": period_end.isoformat(),
                    "reports_monthly_last_error": None,
                },
            )
            period_start = _subtract_one_month(period_end)
            attempted, delivered = await _send_report_email(
                session,
                kind="monthly",
                period_start=period_start,
                period_end=period_end,
                recipients=recipients,
                top_products_limit=settings_obj.top_products_limit,
                low_stock_limit=settings_obj.low_stock_limit,
            )
            if delivered > 0:
                await _update_block_meta(
                    session,
                    block,
                    {
                        "reports_monthly_last_sent_period_end": period_end.isoformat(),
                        "reports_monthly_last_error": None,
                    },
                )
            else:
                await _update_block_meta(
                    session,
                    block,
                    {
                        "reports_monthly_last_error": f"Delivery failed (attempted={attempted}).",
                    },
                )


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

    kind_clean = (kind or "").strip().lower()
    if kind_clean not in {"weekly", "monthly"}:
        raise ValueError("Invalid report kind")

    if kind_clean == "weekly":
        period_end = _weekly_period_end(now, weekday=settings_obj.weekly_weekday, hour_utc=settings_obj.weekly_hour_utc)
        period_start = period_end - timedelta(days=7)
        last_sent = state_obj.weekly_last_sent_period_end
        if not force and last_sent == period_end:
            return {
                "kind": "weekly",
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "attempted": 0,
                "delivered": 0,
                "skipped": True,
            }
        attempted, delivered = await _send_report_email(
            session,
            kind="weekly",
            period_start=period_start,
            period_end=period_end,
            recipients=recipients,
            top_products_limit=settings_obj.top_products_limit,
            low_stock_limit=settings_obj.low_stock_limit,
        )
        if delivered > 0:
            await _update_block_meta(session, block, {"reports_weekly_last_sent_period_end": period_end.isoformat()})
        return {
            "kind": "weekly",
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "attempted": attempted,
            "delivered": delivered,
            "skipped": False,
        }

    period_end = _monthly_period_end(now, day=settings_obj.monthly_day, hour_utc=settings_obj.monthly_hour_utc)
    period_start = _subtract_one_month(period_end)
    last_sent = state_obj.monthly_last_sent_period_end
    if not force and last_sent == period_end:
        return {
            "kind": "monthly",
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "attempted": 0,
            "delivered": 0,
            "skipped": True,
        }
    attempted, delivered = await _send_report_email(
        session,
        kind="monthly",
        period_start=period_start,
        period_end=period_end,
        recipients=recipients,
        top_products_limit=settings_obj.top_products_limit,
        low_stock_limit=settings_obj.low_stock_limit,
    )
    if delivered > 0:
        await _update_block_meta(session, block, {"reports_monthly_last_sent_period_end": period_end.isoformat()})
    return {
        "kind": "monthly",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "attempted": attempted,
        "delivered": delivered,
        "skipped": False,
    }

