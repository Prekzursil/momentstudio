from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from contextlib import suppress
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal, cast
from uuid import UUID

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis_client import get_redis
from app.models.email_event import EmailDeliveryEvent
from app.models.email_failure import EmailDeliveryFailure
from app.models.ops import MaintenanceBanner
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from app.schemas.ops import (
    OpsDiagnosticsCheck,
    OpsDiagnosticsRead,
    ShippingSimulationResult,
    WebhookEventDetail,
    WebhookEventRead,
    WebhookStatus,
)
from app.services import checkout_settings as checkout_settings_service
from app.services import netopia as netopia_service
from app.services import order as order_service
from app.services import payments as stripe_payments
from app.services import paypal as paypal_service
from app.services import pricing
from app.services.payment_provider import payments_provider
from app.services import webhook_handlers


async def list_maintenance_banners(session: AsyncSession) -> list[MaintenanceBanner]:
    result = await session.execute(select(MaintenanceBanner).order_by(MaintenanceBanner.starts_at.desc()))
    return list(result.scalars().unique())


async def get_active_maintenance_banner(session: AsyncSession) -> MaintenanceBanner | None:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(MaintenanceBanner)
        .where(
            MaintenanceBanner.is_active.is_(True),
            MaintenanceBanner.starts_at <= now,
            or_(MaintenanceBanner.ends_at.is_(None), MaintenanceBanner.ends_at > now),
        )
        .order_by(MaintenanceBanner.starts_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_maintenance_banner(session: AsyncSession, banner: MaintenanceBanner) -> MaintenanceBanner:
    session.add(banner)
    await session.commit()
    await session.refresh(banner)
    return banner


async def update_maintenance_banner(session: AsyncSession, banner: MaintenanceBanner) -> MaintenanceBanner:
    session.add(banner)
    await session.commit()
    await session.refresh(banner)
    return banner


async def delete_maintenance_banner(session: AsyncSession, banner: MaintenanceBanner) -> None:
    await session.delete(banner)
    await session.commit()


def _is_free_shipping_threshold_met(*, threshold: Decimal | float | int | None, taxable: Decimal) -> bool:
    if threshold is None or threshold < 0:
        return False
    return taxable >= Decimal(str(threshold))


async def _resolve_selected_shipping_method(
    session: AsyncSession, shipping_method_id: UUID | None
) -> tuple[Any | None, UUID | None]:
    if not shipping_method_id:
        return None, None
    method = await order_service.get_shipping_method(session, shipping_method_id)
    if not method:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    return method, method.id


def _compute_shipping_amount(
    *,
    checkout_settings: Any,
    subtotal: Decimal,
    method: Any | None,
    rounding: pricing.MoneyRounding,
) -> Decimal:
    configured_fee = getattr(checkout_settings, "shipping_fee_ron", None)
    if configured_fee is not None:
        raw_shipping = Decimal(configured_fee)
    else:
        raw_shipping = order_service._calculate_shipping(subtotal, method)  # type: ignore[attr-defined]
    return pricing.quantize_money(Decimal(raw_shipping or 0), rounding=rounding)


def _quantize_optional_rate(*, value: Any, rounding: pricing.MoneyRounding) -> Decimal | None:
    if value is None:
        return None
    return pricing.quantize_money(Decimal(value or 0), rounding=rounding)


def _shipping_method_row(*, method: Any, shipping_ron: Decimal, rounding: pricing.MoneyRounding) -> dict[str, Any]:
    return {
        "id": method.id,
        "name": method.name,
        "rate_flat": _quantize_optional_rate(value=getattr(method, "rate_flat", None), rounding=rounding),
        "rate_per_kg": _quantize_optional_rate(value=getattr(method, "rate_per_kg", None), rounding=rounding),
        "computed_shipping_ron": shipping_ron,
    }


def _build_shipping_method_rows(
    *,
    methods: list[Any],
    checkout_settings: Any,
    subtotal: Decimal,
    taxable: Decimal,
    threshold: Decimal | float | int | None,
    rounding: pricing.MoneyRounding,
) -> list[dict[str, Any]]:
    free_shipping = _is_free_shipping_threshold_met(threshold=threshold, taxable=taxable)
    rows: list[dict[str, Any]] = []
    for method in methods:
        shipping_for_method = _compute_shipping_amount(
            checkout_settings=checkout_settings,
            subtotal=subtotal,
            method=method,
            rounding=rounding,
        )
        if free_shipping:
            shipping_for_method = Decimal("0.00")
        rows.append(_shipping_method_row(method=method, shipping_ron=shipping_for_method, rounding=rounding))
    return rows


def _compute_totals_breakdown(
    *,
    checkout_settings: Any,
    subtotal: Decimal,
    discount: Decimal,
    shipping: Decimal,
    rounding: pricing.MoneyRounding,
) -> Any:
    return pricing.compute_totals(
        subtotal=subtotal,
        discount=discount,
        shipping=shipping,
        fee_enabled=checkout_settings.fee_enabled,
        fee_type=checkout_settings.fee_type,
        fee_value=checkout_settings.fee_value,
        vat_enabled=checkout_settings.vat_enabled,
        vat_rate_percent=checkout_settings.vat_rate_percent,
        vat_apply_to_shipping=checkout_settings.vat_apply_to_shipping,
        vat_apply_to_fee=checkout_settings.vat_apply_to_fee,
        rounding=rounding,
    )


def _build_shipping_simulation_result(
    *,
    checkout_settings: Any,
    subtotal: Decimal,
    discount: Decimal,
    taxable: Decimal,
    selected_id: UUID | None,
    method_rows: list[dict[str, Any]],
    breakdown: Any,
    rounding: pricing.MoneyRounding,
) -> ShippingSimulationResult:
    return ShippingSimulationResult(
        subtotal_ron=subtotal,
        discount_ron=discount,
        taxable_subtotal_ron=pricing.quantize_money(taxable, rounding=rounding),
        shipping_ron=breakdown.shipping,
        fee_ron=breakdown.fee,
        vat_ron=breakdown.vat,
        total_ron=breakdown.total,
        shipping_fee_ron=Decimal(checkout_settings.shipping_fee_ron) if checkout_settings.shipping_fee_ron is not None else None,
        free_shipping_threshold_ron=Decimal(checkout_settings.free_shipping_threshold_ron)
        if checkout_settings.free_shipping_threshold_ron is not None
        else None,
        selected_shipping_method_id=selected_id,
        methods=method_rows,  # type: ignore[arg-type]
    )


def _shipping_simulation_amounts(
    *, subtotal_ron: Decimal, discount_ron: Decimal, rounding: pricing.MoneyRounding
) -> tuple[Decimal, Decimal, Decimal]:
    subtotal = pricing.quantize_money(Decimal(subtotal_ron), rounding=rounding)
    discount = pricing.quantize_money(Decimal(discount_ron or 0), rounding=rounding)
    taxable = subtotal - discount
    if taxable < 0:
        taxable = Decimal("0.00")
    return subtotal, discount, taxable


async def _shipping_selection_context(
    session: AsyncSession,
    *,
    checkout_settings: Any,
    shipping_method_id: UUID | None,
    subtotal: Decimal,
    taxable: Decimal,
    rounding: pricing.MoneyRounding,
) -> tuple[UUID | None, Decimal | float | int | None, Decimal]:
    method, selected_id = await _resolve_selected_shipping_method(session, shipping_method_id)
    threshold = checkout_settings.free_shipping_threshold_ron
    base_shipping = _compute_shipping_amount(
        checkout_settings=checkout_settings,
        subtotal=subtotal,
        method=method,
        rounding=rounding,
    )
    if _is_free_shipping_threshold_met(threshold=threshold, taxable=taxable):
        base_shipping = Decimal("0.00")
    return selected_id, threshold, base_shipping


async def _prepare_shipping_simulation(
    session: AsyncSession,
    *,
    checkout_settings: Any,
    shipping_method_id: UUID | None,
    subtotal_ron: Decimal,
    discount_ron: Decimal,
    rounding: pricing.MoneyRounding,
) -> tuple[Decimal, Decimal, Decimal, UUID | None, Any, list[dict[str, Any]]]:
    subtotal, discount, taxable = _shipping_simulation_amounts(
        subtotal_ron=subtotal_ron,
        discount_ron=discount_ron,
        rounding=rounding,
    )
    selected_id, threshold, base_shipping = await _shipping_selection_context(
        session,
        checkout_settings=checkout_settings,
        shipping_method_id=shipping_method_id,
        subtotal=subtotal,
        taxable=taxable,
        rounding=rounding,
    )
    breakdown = _compute_totals_breakdown(
        checkout_settings=checkout_settings,
        subtotal=subtotal,
        discount=discount,
        shipping=base_shipping,
        rounding=rounding,
    )
    methods = await order_service.list_shipping_methods(session)
    method_rows = _build_shipping_method_rows(
        methods=methods,
        checkout_settings=checkout_settings,
        subtotal=subtotal,
        taxable=taxable,
        threshold=threshold,
        rounding=rounding,
    )
    return subtotal, discount, taxable, selected_id, breakdown, method_rows


async def simulate_shipping_rates(
    session: AsyncSession,
    *,
    subtotal_ron: Decimal,
    discount_ron: Decimal,
    shipping_method_id: UUID | None,
    country: str | None = None,
    postal_code: str | None = None,
) -> ShippingSimulationResult:
    _ = country, postal_code
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    rounding = checkout_settings.money_rounding
    subtotal, discount, taxable, selected_id, breakdown, method_rows = await _prepare_shipping_simulation(
        session,
        checkout_settings=checkout_settings,
        shipping_method_id=shipping_method_id,
        subtotal_ron=subtotal_ron,
        discount_ron=discount_ron,
        rounding=rounding,
    )
    return _build_shipping_simulation_result(
        checkout_settings=checkout_settings,
        subtotal=subtotal,
        discount=discount,
        taxable=taxable,
        selected_id=selected_id,
        method_rows=method_rows,
        breakdown=breakdown,
        rounding=rounding,
    )


def _webhook_status(*, processed_at: datetime | None, last_error: str | None) -> WebhookStatus:
    if last_error and last_error.strip():
        return "failed"
    if processed_at is not None:
        return "processed"
    return "received"


def _normalize_webhook_lookup(*, provider: str, event_id: str) -> tuple[str, str]:
    provider_key = (provider or "").strip().lower()
    event_key = (event_id or "").strip()
    if provider_key not in {"stripe", "paypal"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported provider")
    if not event_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing event id")
    return provider_key, event_key


async def _find_stripe_webhook(session: AsyncSession, event_key: str) -> StripeWebhookEvent | None:
    row = (
        (await session.execute(select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_key)))
        .scalars()
        .first()
    )
    return cast(StripeWebhookEvent | None, row)


async def _find_paypal_webhook(session: AsyncSession, event_key: str) -> PayPalWebhookEvent | None:
    row = (
        (await session.execute(select(PayPalWebhookEvent).where(PayPalWebhookEvent.paypal_event_id == event_key)))
        .scalars()
        .first()
    )
    return cast(PayPalWebhookEvent | None, row)


def _build_webhook_event_read(*, provider: Literal["stripe", "paypal"], event_id: str, row: Any) -> WebhookEventRead:
    processed_at = getattr(row, "processed_at", None)
    last_error = getattr(row, "last_error", None)
    return WebhookEventRead(
        provider=provider,
        event_id=event_id,
        event_type=row.event_type,
        created_at=row.created_at,
        attempts=int(getattr(row, "attempts", 0) or 0),
        last_attempt_at=row.last_attempt_at,
        processed_at=processed_at,
        last_error=last_error,
        status=_webhook_status(processed_at=processed_at, last_error=last_error),
    )


def _build_webhook_event_detail(*, provider: Literal["stripe", "paypal"], event_id: str, row: Any) -> WebhookEventDetail:
    processed_at = getattr(row, "processed_at", None)
    last_error = getattr(row, "last_error", None)
    return WebhookEventDetail(
        provider=provider,
        event_id=event_id,
        event_type=row.event_type,
        created_at=row.created_at,
        attempts=int(getattr(row, "attempts", 0) or 0),
        last_attempt_at=row.last_attempt_at,
        processed_at=processed_at,
        last_error=last_error,
        status=_webhook_status(processed_at=processed_at, last_error=last_error),
        payload=getattr(row, "payload", None),
    )


def _require_webhook_row(row: Any) -> Any:
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    return row


async def list_recent_webhooks(session: AsyncSession, *, limit: int = 50) -> list[WebhookEventRead]:
    limit_clean = max(1, min(int(limit or 0), 200))
    stripe_rows = (
        (await session.execute(select(StripeWebhookEvent).order_by(StripeWebhookEvent.last_attempt_at.desc()).limit(limit_clean)))
        .scalars()
        .all()
    )
    paypal_rows = (
        (await session.execute(select(PayPalWebhookEvent).order_by(PayPalWebhookEvent.last_attempt_at.desc()).limit(limit_clean)))
        .scalars()
        .all()
    )

    items: list[WebhookEventRead] = []
    for stripe_row in stripe_rows:
        items.append(_build_webhook_event_read(provider="stripe", event_id=stripe_row.stripe_event_id, row=stripe_row))
    for paypal_row in paypal_rows:
        items.append(_build_webhook_event_read(provider="paypal", event_id=paypal_row.paypal_event_id, row=paypal_row))

    items.sort(key=lambda item: item.last_attempt_at, reverse=True)
    return items[:limit_clean]


async def get_webhook_detail(session: AsyncSession, *, provider: str, event_id: str) -> WebhookEventDetail:
    provider_key, event_key = _normalize_webhook_lookup(provider=provider, event_id=event_id)
    if provider_key == "stripe":
        stripe_row = _require_webhook_row(await _find_stripe_webhook(session, event_key))
        return _build_webhook_event_detail(
            provider="stripe",
            event_id=stripe_row.stripe_event_id,
            row=stripe_row,
        )
    paypal_row = _require_webhook_row(await _find_paypal_webhook(session, event_key))
    return _build_webhook_event_detail(
        provider="paypal",
        event_id=paypal_row.paypal_event_id,
        row=paypal_row,
    )


async def count_failed_webhooks(session: AsyncSession, *, since_hours: int = 24) -> int:
    now = datetime.now(timezone.utc)
    hours = max(1, int(since_hours or 0))
    since = now - timedelta(hours=hours)

    stripe_failed = await session.scalar(
        select(func.count())
        .select_from(StripeWebhookEvent)
        .where(
            StripeWebhookEvent.last_error.is_not(None),
            StripeWebhookEvent.last_attempt_at >= since,
        )
    )
    paypal_failed = await session.scalar(
        select(func.count())
        .select_from(PayPalWebhookEvent)
        .where(
            PayPalWebhookEvent.last_error.is_not(None),
            PayPalWebhookEvent.last_attempt_at >= since,
        )
    )
    return int(stripe_failed or 0) + int(paypal_failed or 0)


async def count_webhook_backlog(session: AsyncSession, *, since_hours: int = 24) -> int:
    _ = since_hours

    stripe_pending_total = await session.scalar(
        select(func.count())
        .select_from(StripeWebhookEvent)
        .where(
            StripeWebhookEvent.processed_at.is_(None),
            or_(StripeWebhookEvent.last_error.is_(None), StripeWebhookEvent.last_error == ""),
        )
    )
    paypal_pending_total = await session.scalar(
        select(func.count())
        .select_from(PayPalWebhookEvent)
        .where(
            PayPalWebhookEvent.processed_at.is_(None),
            or_(PayPalWebhookEvent.last_error.is_(None), PayPalWebhookEvent.last_error == ""),
        )
    )
    return int(stripe_pending_total or 0) + int(paypal_pending_total or 0)


async def count_recent_webhook_backlog(session: AsyncSession, *, since_hours: int = 24) -> int:
    now = datetime.now(timezone.utc)
    hours = max(1, int(since_hours or 0))
    since = now - timedelta(hours=hours)

    stripe_pending_recent = await session.scalar(
        select(func.count())
        .select_from(StripeWebhookEvent)
        .where(
            StripeWebhookEvent.processed_at.is_(None),
            or_(StripeWebhookEvent.last_error.is_(None), StripeWebhookEvent.last_error == ""),
            StripeWebhookEvent.last_attempt_at >= since,
        )
    )
    paypal_pending_recent = await session.scalar(
        select(func.count())
        .select_from(PayPalWebhookEvent)
        .where(
            PayPalWebhookEvent.processed_at.is_(None),
            or_(PayPalWebhookEvent.last_error.is_(None), PayPalWebhookEvent.last_error == ""),
            PayPalWebhookEvent.last_attempt_at >= since,
        )
    )
    return int(stripe_pending_recent or 0) + int(paypal_pending_recent or 0)


async def list_email_failures(
    session: AsyncSession,
    *,
    limit: int = 50,
    since_hours: int = 24,
    to_email: str | None = None,
) -> list[EmailDeliveryFailure]:
    now = datetime.now(timezone.utc)
    hours = max(1, int(since_hours or 0))
    since = now - timedelta(hours=hours)

    limit_clean = max(1, min(int(limit or 0), 200))
    cleaned_email = (to_email or "").strip().lower()
    stmt = (
        select(EmailDeliveryFailure)
        .where(EmailDeliveryFailure.created_at >= since)
        .order_by(EmailDeliveryFailure.created_at.desc())
        .limit(limit_clean)
    )
    if cleaned_email:
        stmt = stmt.where(func.lower(EmailDeliveryFailure.to_email) == cleaned_email)
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


async def list_email_events(
    session: AsyncSession,
    *,
    limit: int = 50,
    since_hours: int = 24,
    to_email: str | None = None,
    status: str | None = None,
) -> list[EmailDeliveryEvent]:
    now = datetime.now(timezone.utc)
    hours = max(1, int(since_hours or 0))
    since = now - timedelta(hours=hours)

    limit_clean = max(1, min(int(limit or 0), 200))
    cleaned_email = (to_email or "").strip().lower()
    cleaned_status = (status or "").strip().lower()

    stmt = (
        select(EmailDeliveryEvent)
        .where(EmailDeliveryEvent.created_at >= since)
        .order_by(EmailDeliveryEvent.created_at.desc())
        .limit(limit_clean)
    )
    if cleaned_email:
        stmt = stmt.where(func.lower(EmailDeliveryEvent.to_email) == cleaned_email)
    if cleaned_status in {"sent", "failed"}:
        stmt = stmt.where(EmailDeliveryEvent.status == cleaned_status)

    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


async def count_email_failures(session: AsyncSession, *, since_hours: int = 24) -> int:
    now = datetime.now(timezone.utc)
    hours = max(1, int(since_hours or 0))
    since = now - timedelta(hours=hours)
    total = await session.scalar(
        select(func.count())
        .select_from(EmailDeliveryFailure)
        .where(EmailDeliveryFailure.created_at >= since)
    )
    return int(total or 0)


def _ensure_retryable_webhook[TWebhook: StripeWebhookEvent | PayPalWebhookEvent](
    row: TWebhook | None,
) -> tuple[TWebhook, Any]:
    webhook_row = _require_webhook_row(row)
    if bool(getattr(webhook_row, "processed_at", None)) and not (getattr(webhook_row, "last_error", None) or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook already processed")
    payload = getattr(webhook_row, "payload", None)
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook payload not stored")
    return webhook_row, payload


async def _save_retry_attempt[TWebhook: StripeWebhookEvent | PayPalWebhookEvent](
    session: AsyncSession,
    *,
    row: TWebhook,
    attempted_at: datetime,
) -> None:
    row.attempts = int(getattr(row, "attempts", 0) or 0) + 1
    row.last_attempt_at = attempted_at
    session.add(row)
    await session.commit()


async def _mark_retry_success[TWebhook: StripeWebhookEvent | PayPalWebhookEvent](
    session: AsyncSession,
    *,
    model: type[TWebhook],
    row_id: UUID,
    provider: Literal["stripe", "paypal"],
    event_id_attr: str,
) -> WebhookEventRead:
    updated = await session.get(model, row_id)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Retry failed")
    updated.processed_at = datetime.now(timezone.utc)
    updated.last_error = None
    session.add(updated)
    await session.commit()
    return _build_webhook_event_read(provider=provider, event_id=str(getattr(updated, event_id_attr)), row=updated)


async def _mark_retry_failure[TWebhook: StripeWebhookEvent | PayPalWebhookEvent](
    session: AsyncSession,
    *,
    model: type[TWebhook],
    row_id: UUID,
    error_message: str,
) -> None:
    await session.rollback()
    updated = await session.get(model, row_id)
    if updated is None:
        return
    updated.processed_at = None
    updated.last_error = error_message
    session.add(updated)
    await session.commit()


async def _run_webhook_retry[TWebhook: StripeWebhookEvent | PayPalWebhookEvent](
    session: AsyncSession,
    *,
    model: type[TWebhook],
    row_id: UUID,
    provider: Literal["stripe", "paypal"],
    event_id_attr: str,
    processor: Callable[[], Awaitable[None]],
) -> WebhookEventRead:
    try:
        await processor()
        return await _mark_retry_success(
            session,
            model=model,
            row_id=row_id,
            provider=provider,
            event_id_attr=event_id_attr,
        )
    except HTTPException as exc:
        await _mark_retry_failure(session, model=model, row_id=row_id, error_message=str(exc.detail))
        raise
    except Exception as exc:
        await _mark_retry_failure(session, model=model, row_id=row_id, error_message=str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Retry failed") from exc


async def _retry_stripe_webhook(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    event_key: str,
    attempted_at: datetime,
) -> WebhookEventRead:
    stripe_row, payload = _ensure_retryable_webhook(await _find_stripe_webhook(session, event_key))
    await _save_retry_attempt(session, row=stripe_row, attempted_at=attempted_at)
    return await _run_webhook_retry(
        session,
        model=StripeWebhookEvent,
        row_id=stripe_row.id,
        provider="stripe",
        event_id_attr="stripe_event_id",
        processor=lambda: webhook_handlers.process_stripe_event(session, background_tasks, payload),
    )


async def _retry_paypal_webhook(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    event_key: str,
    attempted_at: datetime,
) -> WebhookEventRead:
    paypal_row, payload = _ensure_retryable_webhook(await _find_paypal_webhook(session, event_key))
    await _save_retry_attempt(session, row=paypal_row, attempted_at=attempted_at)
    return await _run_webhook_retry(
        session,
        model=PayPalWebhookEvent,
        row_id=paypal_row.id,
        provider="paypal",
        event_id_attr="paypal_event_id",
        processor=lambda: webhook_handlers.process_paypal_event(session, background_tasks, payload),
    )


async def retry_webhook(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    provider: str,
    event_id: str,
) -> WebhookEventRead:
    provider_key, event_key = _normalize_webhook_lookup(provider=provider, event_id=event_id)
    attempted_at = datetime.now(timezone.utc)
    if provider_key == "stripe":
        return await _retry_stripe_webhook(
            session,
            background_tasks,
            event_key=event_key,
            attempted_at=attempted_at,
        )
    return await _retry_paypal_webhook(
        session,
        background_tasks,
        event_key=event_key,
        attempted_at=attempted_at,
    )


def _is_production_env() -> bool:
    env = (settings.environment or "").strip().lower()
    return env in {"prod", "production", "live"}


async def _tcp_connect_check(host: str, port: int, *, timeout_seconds: float) -> tuple[bool, str | None]:
    cleaned_host = (host or "").strip()
    if not cleaned_host:
        return False, "Missing host"
    try:
        cleaned_port = int(port)
    except Exception:
        return False, "Invalid port"

    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(cleaned_host, cleaned_port),
            timeout=timeout_seconds,
        )
        writer.close()
        with suppress(Exception):
            await writer.wait_closed()
        return True, None
    except Exception as exc:
        return False, str(exc)


def _off_diagnostics_check() -> OpsDiagnosticsCheck:
    return OpsDiagnosticsCheck(status="off", configured=False, healthy=False, message=None)


async def _smtp_diagnostics_check() -> OpsDiagnosticsCheck:
    if not bool(getattr(settings, "smtp_enabled", False)):
        return _off_diagnostics_check()
    smtp_from = (getattr(settings, "smtp_from_email", None) or "").strip()
    if not smtp_from:
        return OpsDiagnosticsCheck(
            status="error",
            configured=True,
            healthy=False,
            message="SMTP enabled but SMTP_FROM_EMAIL is missing.",
        )
    ok, err = await _tcp_connect_check(
        getattr(settings, "smtp_host", "localhost"),
        int(getattr(settings, "smtp_port", 0) or 0),
        timeout_seconds=1.0,
    )
    return OpsDiagnosticsCheck(
        status="ok" if ok else "error",
        configured=True,
        healthy=ok,
        message=None if ok else (err or "SMTP connection check failed."),
    )


async def _redis_diagnostics_check() -> OpsDiagnosticsCheck:
    redis_url = (getattr(settings, "redis_url", None) or "").strip()
    if not redis_url:
        return _off_diagnostics_check()
    client = get_redis()
    if client is None:
        return OpsDiagnosticsCheck(
            status="error",
            configured=True,
            healthy=False,
            message="REDIS_URL is set but Redis client is unavailable.",
        )
    try:
        pong = await asyncio.wait_for(cast(Awaitable[bool], client.ping()), timeout=0.5)
    except Exception as exc:
        return OpsDiagnosticsCheck(status="error", configured=True, healthy=False, message=str(exc))
    ok = bool(pong)
    return OpsDiagnosticsCheck(status="ok", configured=True, healthy=ok, message=None if ok else "Redis PING failed.")


def _collect_storage_issues(*, media_root: str, private_root: str) -> list[str]:
    issues: list[str] = []
    for raw_path, label in ((media_root, "media_root"), (private_root, "private_media_root")):
        path = Path(raw_path)
        if not path.exists():
            issues.append(f"{label} missing")
            continue
        if not path.is_dir():
            issues.append(f"{label} not a directory")
            continue
        if not os.access(path, os.W_OK):
            issues.append(f"{label} not writable")
    return issues


def _storage_diagnostics_check() -> OpsDiagnosticsCheck:
    media_root = (getattr(settings, "media_root", None) or "").strip()
    private_root = (getattr(settings, "private_media_root", None) or "").strip()
    if not media_root or not private_root:
        return OpsDiagnosticsCheck(status="error", configured=False, healthy=False, message=None)
    issues = _collect_storage_issues(media_root=media_root, private_root=private_root)
    if issues:
        return OpsDiagnosticsCheck(
            status="warning",
            configured=True,
            healthy=False,
            message=", ".join(issues),
        )
    return OpsDiagnosticsCheck(status="ok", configured=True, healthy=True, message=None)


def _payment_provider_diagnostics_check(
    *,
    provider: str,
    prod: bool,
    configured: bool,
    message: str,
) -> OpsDiagnosticsCheck:
    if provider != "real":
        return _off_diagnostics_check()
    if configured:
        return OpsDiagnosticsCheck(status="ok", configured=True, healthy=True, message=None)
    return OpsDiagnosticsCheck(
        status="error" if prod else "warning",
        configured=False,
        healthy=False,
        message=message,
    )


def _stripe_diagnostics_check(*, provider: str, prod: bool) -> OpsDiagnosticsCheck:
    configured = stripe_payments.is_stripe_configured() and stripe_payments.is_stripe_webhook_configured()
    return _payment_provider_diagnostics_check(
        provider=provider,
        prod=prod,
        configured=configured,
        message="Stripe keys/webhook secret not configured.",
    )


def _paypal_diagnostics_check(*, provider: str, prod: bool) -> OpsDiagnosticsCheck:
    configured = paypal_service.is_paypal_configured() and paypal_service.is_paypal_webhook_configured()
    return _payment_provider_diagnostics_check(
        provider=provider,
        prod=prod,
        configured=configured,
        message="PayPal client/webhook not configured.",
    )


def _netopia_diagnostics_check(*, prod: bool) -> OpsDiagnosticsCheck:
    if not bool(getattr(settings, "netopia_enabled", False)):
        return _off_diagnostics_check()
    configured, reason = netopia_service.netopia_configuration_status()
    return OpsDiagnosticsCheck(
        status="ok" if configured else ("error" if prod else "warning"),
        configured=configured,
        healthy=configured,
        message=None if configured else (reason or "Netopia is enabled but credentials/keys are missing."),
    )


async def get_diagnostics() -> OpsDiagnosticsRead:
    now = datetime.now(timezone.utc)
    env = (settings.environment or "").strip() or "local"
    provider = payments_provider()
    prod = _is_production_env()
    smtp_check = await _smtp_diagnostics_check()
    redis_check = await _redis_diagnostics_check()
    storage_check = _storage_diagnostics_check()
    stripe_check = _stripe_diagnostics_check(provider=provider, prod=prod)
    paypal_check = _paypal_diagnostics_check(provider=provider, prod=prod)
    netopia_check = _netopia_diagnostics_check(prod=prod)

    return OpsDiagnosticsRead(
        checked_at=now,
        environment=env,
        app_version=str(getattr(settings, "app_version", "") or "").strip(),
        payments_provider=provider,
        smtp=smtp_check,
        redis=redis_check,
        storage=storage_check,
        stripe=stripe_check,
        paypal=paypal_check,
        netopia=netopia_check,
    )
