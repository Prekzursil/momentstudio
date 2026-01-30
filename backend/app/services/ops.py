from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_event import EmailDeliveryEvent
from app.models.email_failure import EmailDeliveryFailure
from app.models.ops import MaintenanceBanner
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from app.schemas.ops import ShippingSimulationResult, WebhookEventDetail, WebhookEventRead, WebhookStatus
from app.services import checkout_settings as checkout_settings_service
from app.services import order as order_service
from app.services import pricing
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


async def simulate_shipping_rates(
    session: AsyncSession,
    *,
    subtotal_ron: Decimal,
    discount_ron: Decimal,
    shipping_method_id: UUID | None,
    country: str | None = None,
    postal_code: str | None = None,
) -> ShippingSimulationResult:
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    rounding = checkout_settings.money_rounding

    subtotal = pricing.quantize_money(Decimal(subtotal_ron), rounding=rounding)
    discount = pricing.quantize_money(Decimal(discount_ron or 0), rounding=rounding)
    taxable = subtotal - discount
    if taxable < 0:
        taxable = Decimal("0.00")

    method = None
    selected_id: UUID | None = None
    if shipping_method_id:
        method = await order_service.get_shipping_method(session, shipping_method_id)
        if not method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
        selected_id = method.id

    # Current storefront rules: prefer checkout_settings.shipping_fee_ron when set; otherwise compute using shipping method.
    if checkout_settings.shipping_fee_ron is not None:
        base_shipping = pricing.quantize_money(Decimal(checkout_settings.shipping_fee_ron), rounding=rounding)
    else:
        base_shipping = pricing.quantize_money(order_service._calculate_shipping(subtotal, method), rounding=rounding)  # type: ignore[attr-defined]

    threshold = checkout_settings.free_shipping_threshold_ron
    if threshold is not None and threshold >= 0 and taxable >= Decimal(str(threshold)):
        base_shipping = Decimal("0.00")

    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=discount,
        shipping=base_shipping,
        fee_enabled=checkout_settings.fee_enabled,
        fee_type=checkout_settings.fee_type,
        fee_value=checkout_settings.fee_value,
        vat_enabled=checkout_settings.vat_enabled,
        vat_rate_percent=checkout_settings.vat_rate_percent,
        vat_apply_to_shipping=checkout_settings.vat_apply_to_shipping,
        vat_apply_to_fee=checkout_settings.vat_apply_to_fee,
        rounding=rounding,
    )

    methods = await order_service.list_shipping_methods(session)
    method_rows = []
    for m in methods:
        if checkout_settings.shipping_fee_ron is not None:
            shipping_for_method = Decimal(checkout_settings.shipping_fee_ron)
        else:
            shipping_for_method = order_service._calculate_shipping(subtotal, m)  # type: ignore[attr-defined]
        shipping_for_method = pricing.quantize_money(Decimal(shipping_for_method or 0), rounding=rounding)
        if threshold is not None and threshold >= 0 and taxable >= Decimal(str(threshold)):
            shipping_for_method = Decimal("0.00")
        method_rows.append(
            {
                "id": m.id,
                "name": m.name,
                "rate_flat": pricing.quantize_money(Decimal(getattr(m, "rate_flat", 0) or 0), rounding=rounding)
                if getattr(m, "rate_flat", None) is not None
                else None,
                "rate_per_kg": pricing.quantize_money(Decimal(getattr(m, "rate_per_kg", 0) or 0), rounding=rounding)
                if getattr(m, "rate_per_kg", None) is not None
                else None,
                "computed_shipping_ron": shipping_for_method,
            }
        )

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


def _webhook_status(*, processed_at: datetime | None, last_error: str | None) -> WebhookStatus:
    if last_error and last_error.strip():
        return "failed"
    if processed_at is not None:
        return "processed"
    return "received"


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
        items.append(
            WebhookEventRead(
                provider="stripe",
                event_id=stripe_row.stripe_event_id,
                event_type=stripe_row.event_type,
                created_at=stripe_row.created_at,
                attempts=int(getattr(stripe_row, "attempts", 0) or 0),
                last_attempt_at=stripe_row.last_attempt_at,
                processed_at=getattr(stripe_row, "processed_at", None),
                last_error=getattr(stripe_row, "last_error", None),
                status=_webhook_status(
                    processed_at=getattr(stripe_row, "processed_at", None), last_error=getattr(stripe_row, "last_error", None)
                ),
            )
        )
    for paypal_row in paypal_rows:
        items.append(
            WebhookEventRead(
                provider="paypal",
                event_id=paypal_row.paypal_event_id,
                event_type=paypal_row.event_type,
                created_at=paypal_row.created_at,
                attempts=int(getattr(paypal_row, "attempts", 0) or 0),
                last_attempt_at=paypal_row.last_attempt_at,
                processed_at=getattr(paypal_row, "processed_at", None),
                last_error=getattr(paypal_row, "last_error", None),
                status=_webhook_status(
                    processed_at=getattr(paypal_row, "processed_at", None), last_error=getattr(paypal_row, "last_error", None)
                ),
            )
        )

    items.sort(key=lambda item: item.last_attempt_at, reverse=True)
    return items[:limit_clean]


async def get_webhook_detail(session: AsyncSession, *, provider: str, event_id: str) -> WebhookEventDetail:
    provider_key = (provider or "").strip().lower()
    event_key = (event_id or "").strip()
    if provider_key not in {"stripe", "paypal"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported provider")
    if not event_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing event id")

    if provider_key == "stripe":
        stripe_row = (
            (await session.execute(select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_key)))
            .scalars()
            .first()
        )
        if not stripe_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
        return WebhookEventDetail(
            provider="stripe",
            event_id=stripe_row.stripe_event_id,
            event_type=stripe_row.event_type,
            created_at=stripe_row.created_at,
            attempts=int(getattr(stripe_row, "attempts", 0) or 0),
            last_attempt_at=stripe_row.last_attempt_at,
            processed_at=getattr(stripe_row, "processed_at", None),
            last_error=getattr(stripe_row, "last_error", None),
            status=_webhook_status(
                processed_at=getattr(stripe_row, "processed_at", None), last_error=getattr(stripe_row, "last_error", None)
            ),
            payload=getattr(stripe_row, "payload", None),
        )

    paypal_row = (
        (await session.execute(select(PayPalWebhookEvent).where(PayPalWebhookEvent.paypal_event_id == event_key)))
        .scalars()
        .first()
    )
    if not paypal_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    return WebhookEventDetail(
        provider="paypal",
        event_id=paypal_row.paypal_event_id,
        event_type=paypal_row.event_type,
        created_at=paypal_row.created_at,
        attempts=int(getattr(paypal_row, "attempts", 0) or 0),
        last_attempt_at=paypal_row.last_attempt_at,
        processed_at=getattr(paypal_row, "processed_at", None),
        last_error=getattr(paypal_row, "last_error", None),
        status=_webhook_status(
            processed_at=getattr(paypal_row, "processed_at", None), last_error=getattr(paypal_row, "last_error", None)
        ),
        payload=getattr(paypal_row, "payload", None),
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
    now = datetime.now(timezone.utc)
    hours = max(1, int(since_hours or 0))
    since = now - timedelta(hours=hours)

    stripe_pending = await session.scalar(
        select(func.count())
        .select_from(StripeWebhookEvent)
        .where(
            StripeWebhookEvent.processed_at.is_(None),
            or_(StripeWebhookEvent.last_error.is_(None), StripeWebhookEvent.last_error == ""),
            StripeWebhookEvent.last_attempt_at >= since,
        )
    )
    paypal_pending = await session.scalar(
        select(func.count())
        .select_from(PayPalWebhookEvent)
        .where(
            PayPalWebhookEvent.processed_at.is_(None),
            or_(PayPalWebhookEvent.last_error.is_(None), PayPalWebhookEvent.last_error == ""),
            PayPalWebhookEvent.last_attempt_at >= since,
        )
    )
    return int(stripe_pending or 0) + int(paypal_pending or 0)


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


async def retry_webhook(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    provider: str,
    event_id: str,
) -> WebhookEventRead:
    provider_key = (provider or "").strip().lower()
    event_key = (event_id or "").strip()
    if provider_key not in {"stripe", "paypal"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported provider")
    if not event_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing event id")

    now = datetime.now(timezone.utc)

    if provider_key == "stripe":
        stripe_row = (
            (await session.execute(select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_key)))
            .scalars()
            .first()
        )
        if not stripe_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
        if bool(getattr(stripe_row, "processed_at", None)) and not (getattr(stripe_row, "last_error", None) or "").strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook already processed")
        payload = getattr(stripe_row, "payload", None)
        if not payload:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook payload not stored")

        stripe_row.attempts = int(getattr(stripe_row, "attempts", 0) or 0) + 1
        stripe_row.last_attempt_at = now
        session.add(stripe_row)
        await session.commit()

        try:
            await webhook_handlers.process_stripe_event(session, background_tasks, payload)
            updated = await session.get(StripeWebhookEvent, stripe_row.id)
            if updated:
                updated.processed_at = datetime.now(timezone.utc)
                updated.last_error = None
                session.add(updated)
                await session.commit()
                return WebhookEventRead(
                    provider="stripe",
                    event_id=updated.stripe_event_id,
                    event_type=updated.event_type,
                    created_at=updated.created_at,
                    attempts=int(getattr(updated, "attempts", 0) or 0),
                    last_attempt_at=updated.last_attempt_at,
                    processed_at=getattr(updated, "processed_at", None),
                    last_error=getattr(updated, "last_error", None),
                    status=_webhook_status(
                        processed_at=getattr(updated, "processed_at", None), last_error=getattr(updated, "last_error", None)
                    ),
                )
        except HTTPException as exc:
            await session.rollback()
            updated = await session.get(StripeWebhookEvent, stripe_row.id)
            if updated:
                updated.processed_at = None
                updated.last_error = str(exc.detail)
                session.add(updated)
                await session.commit()
            raise
        except Exception as exc:
            await session.rollback()
            updated = await session.get(StripeWebhookEvent, stripe_row.id)
            if updated:
                updated.processed_at = None
                updated.last_error = str(exc)
                session.add(updated)
                await session.commit()
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Retry failed") from exc

        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Retry failed")

    paypal_row = (
        (await session.execute(select(PayPalWebhookEvent).where(PayPalWebhookEvent.paypal_event_id == event_key)))
        .scalars()
        .first()
    )
    if not paypal_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")
    if bool(getattr(paypal_row, "processed_at", None)) and not (getattr(paypal_row, "last_error", None) or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook already processed")
    payload = getattr(paypal_row, "payload", None)
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook payload not stored")

    paypal_row.attempts = int(getattr(paypal_row, "attempts", 0) or 0) + 1
    paypal_row.last_attempt_at = now
    session.add(paypal_row)
    await session.commit()

    try:
        await webhook_handlers.process_paypal_event(session, background_tasks, payload)
        paypal_updated = await session.get(PayPalWebhookEvent, paypal_row.id)
        if paypal_updated:
            paypal_updated.processed_at = datetime.now(timezone.utc)
            paypal_updated.last_error = None
            session.add(paypal_updated)
            await session.commit()
            return WebhookEventRead(
                provider="paypal",
                event_id=paypal_updated.paypal_event_id,
                event_type=paypal_updated.event_type,
                created_at=paypal_updated.created_at,
                attempts=int(getattr(paypal_updated, "attempts", 0) or 0),
                last_attempt_at=paypal_updated.last_attempt_at,
                processed_at=getattr(paypal_updated, "processed_at", None),
                last_error=getattr(paypal_updated, "last_error", None),
                status=_webhook_status(
                    processed_at=getattr(paypal_updated, "processed_at", None),
                    last_error=getattr(paypal_updated, "last_error", None),
                ),
            )
    except HTTPException as exc:
        await session.rollback()
        paypal_updated = await session.get(PayPalWebhookEvent, paypal_row.id)
        if paypal_updated:
            paypal_updated.processed_at = None
            paypal_updated.last_error = str(exc.detail)
            session.add(paypal_updated)
            await session.commit()
        raise
    except Exception as exc:
        await session.rollback()
        paypal_updated = await session.get(PayPalWebhookEvent, paypal_row.id)
        if paypal_updated:
            paypal_updated.processed_at = None
            paypal_updated.last_error = str(exc)
            session.add(paypal_updated)
            await session.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Retry failed") from exc

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Retry failed")
