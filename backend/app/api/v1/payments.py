import json
from datetime import datetime, timezone
from urllib.parse import quote_plus
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.dependencies import get_current_user_optional
from app.db.session import get_session
from app.models.cart import Cart
from app.models.order import Order, OrderItem, OrderStatus, OrderEvent
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from app.services import payments
from app.services import webhook_handlers
from app.services import netopia as netopia_service
from app.services import paypal as paypal_service
from app.services import auth as auth_service
from app.services import email as email_service
from app.services import checkout_settings as checkout_settings_service
from app.services import notifications as notification_service
from app.services import coupons_v2 as coupons_service
from app.services import promo_usage
from app.api.v1 import cart as cart_api
from app.schemas.payment_capabilities import PaymentsCapabilitiesResponse, PaymentMethodCapability
from app.services.payment_provider import is_mock_payments

router = APIRouter(prefix="/payments", tags=["payments"])


def _account_orders_url(order: Order) -> str:
    token = str(order.reference_code or order.id)
    return f"/account/orders?q={quote_plus(token)}"


@router.get("/capabilities", response_model=PaymentsCapabilitiesResponse)
async def payment_capabilities() -> PaymentsCapabilitiesResponse:
    mock_mode = is_mock_payments()

    stripe_configured = payments.is_stripe_configured()
    stripe_enabled = bool(mock_mode or stripe_configured)
    stripe_reason = None if stripe_enabled else "Stripe is not configured"

    paypal_configured = paypal_service.is_paypal_configured()
    paypal_enabled = bool(mock_mode or paypal_configured)
    paypal_reason = None if paypal_enabled else "PayPal is not configured"

    netopia_configured, netopia_config_reason = netopia_service.netopia_configuration_status()
    netopia_supported = True
    netopia_enabled = False
    if not settings.netopia_enabled:
        netopia_reason = "Netopia is disabled"
    elif not netopia_configured:
        netopia_reason = netopia_config_reason or "Netopia is not configured"
    else:
        netopia_enabled = True
        netopia_reason = None

    return PaymentsCapabilitiesResponse(
        payments_provider=str(getattr(settings, "payments_provider", "") or "real"),
        stripe=PaymentMethodCapability(
            supported=True,
            configured=stripe_configured,
            enabled=stripe_enabled,
            reason=stripe_reason,
        ),
        paypal=PaymentMethodCapability(
            supported=True,
            configured=paypal_configured,
            enabled=paypal_enabled,
            reason=paypal_reason,
        ),
        netopia=PaymentMethodCapability(
            supported=netopia_supported,
            configured=netopia_configured,
            enabled=netopia_enabled,
            reason=netopia_reason,
        ),
        cod=PaymentMethodCapability(supported=True, configured=True, enabled=True, reason=None),
    )


@router.post("/intent", status_code=status.HTTP_200_OK)
async def create_payment_intent(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(cart_api.session_header),
):
    user_id = getattr(current_user, "id", None) if current_user else None
    query = select(Cart).options(selectinload(Cart.items))
    if user_id:
        query = query.where(Cart.user_id == user_id)
    elif session_id:
        query = query.where(Cart.session_id == session_id)
    cart = (await session.execute(query)).scalar_one_or_none()
    if not cart:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart not found")
    data = await payments.create_payment_intent(session, cart)
    return data


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    stripe_signature: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = await request.body()
    event, record = await payments.handle_webhook_event(session, payload, stripe_signature)

    already_processed = bool(getattr(record, "processed_at", None)) and not (getattr(record, "last_error", None) or "").strip()
    if already_processed:
        return {"received": True, "type": event.get("type")}

    try:
        await webhook_handlers.process_stripe_event(session, background_tasks, event)

        updated = await session.get(StripeWebhookEvent, record.id)
        if updated:
            updated.processed_at = datetime.now(timezone.utc)
            updated.last_error = None
            session.add(updated)
            await session.commit()
        return {"received": True, "type": event.get("type")}
    except Exception as exc:
        await session.rollback()
        updated = await session.get(StripeWebhookEvent, record.id)
        if updated:
            updated.processed_at = None
            if isinstance(exc, HTTPException):
                updated.last_error = str(exc.detail)
            else:
                updated.last_error = str(exc)
            session.add(updated)
            await session.commit()
        raise


@router.post("/paypal/webhook", status_code=status.HTTP_200_OK)
async def paypal_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        event = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload") from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload")

    verified = await paypal_service.verify_webhook_signature(headers=dict(request.headers), event=event)
    if not verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")

    event_id = str(event.get("id") or "").strip()
    if not event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing PayPal event id")

    now = datetime.now(timezone.utc)
    event_type = str(event.get("event_type") or "").strip() or None
    resource = event.get("resource") if isinstance(event.get("resource"), dict) else {}
    payload_summary = {
        "id": event_id,
        "event_type": event_type,
        "create_time": event.get("create_time"),
        "resource": {"id": resource.get("id")} if isinstance(resource, dict) and resource.get("id") else None,
    }

    record = PayPalWebhookEvent(
        paypal_event_id=event_id,
        event_type=event_type,
        attempts=1,
        last_attempt_at=now,
        payload=payload_summary,
    )
    session.add(record)
    try:
        await session.commit()
        await session.refresh(record)
    except IntegrityError:
        await session.rollback()
        existing = (
            (await session.execute(select(PayPalWebhookEvent).where(PayPalWebhookEvent.paypal_event_id == event_id)))
            .scalars()
            .first()
        )
        if not existing:
            raise
        existing.attempts = int(getattr(existing, "attempts", 0) or 0) + 1
        existing.last_attempt_at = now
        existing.event_type = event_type or existing.event_type
        existing.payload = payload_summary or existing.payload
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        record = existing

    already_processed = bool(getattr(record, "processed_at", None)) and not (getattr(record, "last_error", None) or "").strip()
    if already_processed:
        return {"received": True, "type": event.get("event_type")}

    try:
        await webhook_handlers.process_paypal_event(session, background_tasks, event)

        updated = await session.get(PayPalWebhookEvent, record.id)
        if updated:
            updated.processed_at = datetime.now(timezone.utc)
            updated.last_error = None
            session.add(updated)
            await session.commit()
        return {"received": True, "type": event.get("event_type")}
    except Exception as exc:
        await session.rollback()
        updated = await session.get(PayPalWebhookEvent, record.id)
        if updated:
            updated.processed_at = None
            if isinstance(exc, HTTPException):
                updated.last_error = str(exc.detail)
            else:
                updated.last_error = str(exc)
            session.add(updated)
            await session.commit()
        raise


@router.post("/netopia/webhook", status_code=status.HTTP_200_OK)
async def netopia_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    verification_token: str | None = Header(default=None, alias="Verification-token"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = await request.body()
    if not verification_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Netopia verification token")

    netopia_service.verify_ipn(verification_token=verification_token, payload=payload)

    try:
        event = json.loads(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload") from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload")

    order_info = event.get("order") if isinstance(event.get("order"), dict) else {}
    payment_info = event.get("payment") if isinstance(event.get("payment"), dict) else {}
    order_id_raw = str(order_info.get("orderID") or "").strip()
    ntp_id = str(payment_info.get("ntpID") or "").strip() or None
    payment_message = str(payment_info.get("message") or "").strip() or None
    payment_status_raw = payment_info.get("status")
    try:
        payment_status = int(payment_status_raw) if payment_status_raw is not None else None
    except Exception:
        payment_status = None

    def _ack(error_type: int, error_code: str | int | None, message: str) -> dict:
        return {
            "errorType": int(error_type),
            "errorCode": "" if error_code is None else str(error_code),
            "errorMessage": message,
        }

    if not order_id_raw:
        return _ack(2, "MISSING_ORDER_ID", "Missing order id")

    def _try_uuid(value: str) -> UUID | None:
        cleaned = (value or "").strip()
        if not cleaned:
            return None
        try:
            return UUID(cleaned)
        except Exception:
            return None

    candidate = order_id_raw.split("_", 1)[0].strip() if order_id_raw else ""
    order_uuid = _try_uuid(order_id_raw) or _try_uuid(candidate)

    query = (
        select(Order)
        .options(
            selectinload(Order.user),
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.events),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
    )
    if order_uuid:
        query = query.where(Order.id == order_uuid)
    else:
        query = query.where(Order.reference_code == candidate)

    order = (await session.execute(query)).scalars().first()
    if not order:
        return _ack(2, "ORDER_NOT_FOUND", "Order not found")

    if (order.payment_method or "").strip().lower() != "netopia":
        return _ack(2, "ORDER_NOT_NETOPIA", "Order is not a Netopia order")

    # Status codes based on Netopia IPN docs / official examples.
    paid_statuses = {3, 5}  # STATUS_PAID / STATUS_CONFIRMED
    if payment_status in paid_statuses:
        already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
        if not already_captured and order.status in {
            OrderStatus.pending_payment,
            OrderStatus.pending_acceptance,
            OrderStatus.paid,
        }:
            note = f"Netopia {ntp_id}".strip() if ntp_id else "Netopia"
            if payment_message:
                note = f"{note} — {payment_message}"

            if order.status == OrderStatus.pending_payment:
                order.status = OrderStatus.pending_acceptance
                session.add(
                    OrderEvent(
                        order_id=order.id,
                        event="status_change",
                        note="pending_payment -> pending_acceptance",
                    )
                )
            session.add(OrderEvent(order_id=order.id, event="payment_captured", note=note))
            await promo_usage.record_promo_usage(session, order=order, note=note)
            session.add(order)
            await session.commit()
            await session.refresh(order)
            await coupons_service.redeem_coupon_for_order(session, order=order, note=note)

            if order.user and order.user.id:
                await notification_service.create_notification(
                    session,
                    user_id=order.user.id,
                    type="order",
                    title="Payment received"
                    if (order.user.preferred_language or "en") != "ro"
                    else "Plată confirmată",
                    body=f"Reference {order.reference_code}" if order.reference_code else None,
                    url=_account_orders_url(order),
                )

            checkout_settings = await checkout_settings_service.get_checkout_settings(session)
            customer_to = (order.user.email if order.user and order.user.email else None) or getattr(
                order, "customer_email", None
            )
            customer_lang = order.user.preferred_language if order.user else None
            if customer_to:
                background_tasks.add_task(
                    email_service.send_order_confirmation,
                    customer_to,
                    order,
                    order.items,
                    customer_lang,
                    receipt_share_days=checkout_settings.receipt_share_days,
                )
            owner = await auth_service.get_owner_user(session)
            admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
            if admin_to:
                background_tasks.add_task(
                    email_service.send_new_order_notification,
                    admin_to,
                    order,
                    customer_to,
                    owner.preferred_language if owner else None,
                )

        msg = "payment was paid; deliver goods"
        if payment_message:
            msg = f"{msg}. {payment_message}"
        return _ack(0, None, msg)

    if payment_status is None:
        return _ack(1, "UNKNOWN", "Unknown payment status")

    if payment_status == 4:
        msg = "payment was cancelled; do not deliver goods"
        if payment_message:
            msg = f"{msg}. {payment_message}"
        return _ack(1, payment_status, msg)
    if payment_status == 12:
        msg = "Payment is DECLINED"
        if payment_message:
            msg = f"{msg}. {payment_message}"
        return _ack(1, payment_status, msg)
    if payment_status == 13:
        msg = "Payment in reviewing"
        if payment_message:
            msg = f"{msg}. {payment_message}"
        return _ack(1, payment_status, msg)
    if payment_status == 15:
        msg = "3D AUTH required"
        if payment_message:
            msg = f"{msg}. {payment_message}"
        return _ack(1, payment_status, msg)

    msg = "Unknown"
    if payment_message:
        msg = f"{msg}. {payment_message}"
    return _ack(1, payment_status, msg)
