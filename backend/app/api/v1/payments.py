import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.dependencies import get_current_user_optional
from app.core.rate_limit import per_identifier_limiter
from app.core.security import decode_token
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
from app.services import coupons as coupons_service
from app.services import promo_usage
from app.api.v1 import cart as cart_api
from app.schemas.payment_capabilities import PaymentsCapabilitiesResponse, PaymentMethodCapability
from app.services.payment_provider import is_mock_payments

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger(__name__)


def _user_or_session_or_ip_identifier(request: Request) -> str:
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1]
        decoded = decode_token(token)
        if decoded and decoded.get("sub"):
            return f"user:{decoded['sub']}"
    session_id = (request.headers.get("X-Session-Id") or "").strip()
    if session_id:
        return f"sid:{session_id}"
    return f"ip:{request.client.host if request.client else 'anon'}"


payment_intent_rate_limit = per_identifier_limiter(
    _user_or_session_or_ip_identifier,
    settings.payments_rate_limit_intent,
    60,
    key="payments:intent",
)


def _account_orders_url(order: Order) -> str:
    token = str(order.reference_code or order.id)
    return f"/account/orders?q={quote_plus(token)}"


def _payment_method_capability(
    *,
    configured: bool,
    enabled: bool,
    reason: str,
) -> PaymentMethodCapability:
    return PaymentMethodCapability(
        supported=True,
        configured=configured,
        enabled=enabled,
        reason_code=None if enabled else "missing_credentials",
        reason=None if enabled else reason,
    )


def _netopia_capability() -> PaymentMethodCapability:
    netopia_configured, config_reason = netopia_service.netopia_configuration_status()
    if not settings.netopia_enabled:
        return PaymentMethodCapability(
            supported=True,
            configured=netopia_configured,
            enabled=False,
            reason_code="disabled_in_env",
            reason="Netopia is disabled",
        )
    if not netopia_configured:
        return PaymentMethodCapability(
            supported=True,
            configured=False,
            enabled=False,
            reason_code="missing_credentials",
            reason=config_reason or "Netopia is not configured",
        )
    return PaymentMethodCapability(
        supported=True,
        configured=True,
        enabled=True,
        reason_code=None,
        reason=None,
    )


@router.get("/capabilities", response_model=PaymentsCapabilitiesResponse)
async def payment_capabilities() -> PaymentsCapabilitiesResponse:
    mock_mode = is_mock_payments()
    stripe_configured = payments.is_stripe_configured()
    paypal_configured = paypal_service.is_paypal_configured()

    return PaymentsCapabilitiesResponse(
        payments_provider=str(getattr(settings, "payments_provider", "") or "real"),
        stripe=_payment_method_capability(
            configured=stripe_configured,
            enabled=bool(mock_mode or stripe_configured),
            reason="Stripe is not configured",
        ),
        paypal=_payment_method_capability(
            configured=paypal_configured,
            enabled=bool(mock_mode or paypal_configured),
            reason="PayPal is not configured",
        ),
        netopia=_netopia_capability(),
        cod=PaymentMethodCapability(supported=True, configured=True, enabled=True, reason=None),
    )


@router.post("/intent", status_code=status.HTTP_200_OK)
async def create_payment_intent(
    _: None = Depends(payment_intent_rate_limit),
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


def _webhook_already_processed(record: object) -> bool:
    return bool(getattr(record, "processed_at", None)) and not (getattr(record, "last_error", None) or "").strip()


async def _set_paypal_webhook_result(
    session: AsyncSession,
    *,
    record_id: Any,
    processed: bool,
    error: str | None = None,
) -> None:
    updated = await session.get(PayPalWebhookEvent, record_id)
    if not updated:
        return
    updated.processed_at = datetime.now(timezone.utc) if processed else None
    updated.last_error = None if processed else error
    session.add(updated)
    await session.commit()


async def _parse_paypal_webhook_event(request: Request) -> dict[str, Any]:
    try:
        event = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload") from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload")
    return event


async def _verify_paypal_webhook_signature(request: Request, event: dict[str, Any]) -> None:
    verified = await paypal_service.verify_webhook_signature(headers=dict(request.headers), event=event)
    if not verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")


def _paypal_event_identity(event: dict[str, Any]) -> tuple[str, str | None]:
    event_id = str(event.get("id") or "").strip()
    if not event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing PayPal event id")
    event_type = str(event.get("event_type") or "").strip() or None
    return event_id, event_type


def _paypal_payload_summary(event: dict[str, Any], event_id: str, event_type: str | None) -> dict[str, Any]:
    resource_raw = event.get("resource")
    resource = resource_raw if isinstance(resource_raw, dict) else {}
    resource_id = resource.get("id")
    return {
        "id": event_id,
        "event_type": event_type,
        "create_time": event.get("create_time"),
        "resource": {"id": resource_id} if resource_id else None,
    }


async def _upsert_paypal_webhook_event(
    session: AsyncSession,
    *,
    event_id: str,
    event_type: str | None,
    payload_summary: dict[str, Any],
    now: datetime,
) -> PayPalWebhookEvent:
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
        return record
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
        return existing


@router.post("/paypal/webhook", status_code=status.HTTP_200_OK)
async def paypal_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> dict:
    event = await _parse_paypal_webhook_event(request)
    await _verify_paypal_webhook_signature(request, event)
    event_id, event_type = _paypal_event_identity(event)
    payload_summary = _paypal_payload_summary(event, event_id, event_type)
    record = await _upsert_paypal_webhook_event(
        session,
        event_id=event_id,
        event_type=event_type,
        payload_summary=payload_summary,
        now=datetime.now(timezone.utc),
    )

    if _webhook_already_processed(record):
        return {"received": True, "type": event.get("event_type")}

    try:
        await webhook_handlers.process_paypal_event(session, background_tasks, event)
    except Exception as exc:
        await session.rollback()
        error = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        await _set_paypal_webhook_result(session, record_id=record.id, processed=False, error=error)
        raise
    await _set_paypal_webhook_result(session, record_id=record.id, processed=True)
    return {"received": True, "type": event.get("event_type")}


def _netopia_ack(error_type: int, error_code: str | int | None, message: str) -> dict[str, int | str]:
    return {
        "errorType": int(error_type),
        "errorCode": "" if error_code is None else str(error_code),
        "errorMessage": message,
    }


def _netopia_log_context(request: Request, payload: bytes) -> dict[str, Any]:
    return {
        "provider": "netopia",
        "path": request.url.path,
        "client_ip": request.client.host if request.client else None,
        "payload_bytes": len(payload),
    }


def _netopia_warn_and_ack(
    log_context: dict[str, Any],
    *,
    error_type: int,
    error_code: str,
    message: str,
    reason: str,
    exc_info: bool = False,
) -> dict[str, int | str]:
    logger.warning(
        "Netopia webhook acknowledged with error: %s (%s)",
        reason,
        message,
        extra={
            **log_context,
            "error_type": int(error_type),
            "error_code": error_code,
        },
        exc_info=exc_info,
    )
    return _netopia_ack(error_type, error_code, message)


def _verify_netopia_signature(
    *,
    verification_token: str,
    payload: bytes,
    log_context: dict[str, Any],
) -> dict[str, int | str] | None:
    try:
        netopia_service.verify_ipn(verification_token=verification_token, payload=payload)
    except HTTPException as exc:
        detail = str(exc.detail) if getattr(exc, "detail", None) else "Invalid Netopia signature"
        return _netopia_warn_and_ack(
            log_context,
            error_type=2,
            error_code="INVALID_IPN",
            message=detail,
            reason="IPN verification failed",
        )
    except Exception:
        return _netopia_warn_and_ack(
            log_context,
            error_type=2,
            error_code="INVALID_IPN",
            message="Invalid Netopia signature",
            reason="IPN verification crashed",
            exc_info=True,
        )
    return None


def _parse_netopia_payload(
    payload: bytes,
    log_context: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, int | str] | None]:
    try:
        event = json.loads(payload)
    except Exception:
        return None, _netopia_warn_and_ack(
            log_context,
            error_type=2,
            error_code="INVALID_PAYLOAD",
            message="Invalid payload",
            reason="payload is not valid JSON",
        )
    if not isinstance(event, dict):
        return None, _netopia_warn_and_ack(
            log_context,
            error_type=2,
            error_code="INVALID_PAYLOAD",
            message="Invalid payload",
            reason="payload root is not an object",
        )
    return event, None


def _try_uuid(value: str) -> UUID | None:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    try:
        return UUID(cleaned)
    except Exception:
        return None


def _parse_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


def _event_dict(event: dict[str, Any], key: str) -> dict[str, Any]:
    value = event.get(key)
    if isinstance(value, dict):
        return value
    return {}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _clean_optional_text(value: Any) -> str | None:
    cleaned = _clean_text(value)
    return cleaned or None


def _order_candidate(value: str) -> str:
    return value.split("_", 1)[0].strip()


def _extract_netopia_fields(event: dict[str, Any]) -> tuple[str, str, UUID | None, str | None, str | None, int | None]:
    order_info = _event_dict(event, "order")
    payment_info = _event_dict(event, "payment")

    order_id_raw = _clean_text(order_info.get("orderID"))
    candidate = _order_candidate(order_id_raw) if order_id_raw else ""
    order_uuid = _try_uuid(order_id_raw) or _try_uuid(candidate)
    ntp_id = _clean_optional_text(payment_info.get("ntpID"))
    payment_message = _clean_optional_text(payment_info.get("message"))
    payment_status = _parse_optional_int(payment_info.get("status"))
    return order_id_raw, candidate, order_uuid, ntp_id, payment_message, payment_status


async def _load_netopia_order(session: AsyncSession, *, order_uuid: UUID | None, candidate: str) -> Order | None:
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
    return (await session.execute(query)).scalars().first()


def _netopia_order_error(order: Order | None) -> dict[str, int | str] | None:
    if not order:
        return _netopia_ack(2, "ORDER_NOT_FOUND", "Order not found")
    if (order.payment_method or "").strip().lower() != "netopia":
        return _netopia_ack(2, "ORDER_NOT_NETOPIA", "Order is not a Netopia order")
    return None


def _append_payment_message(base_message: str, payment_message: str | None) -> str:
    if not payment_message:
        return base_message
    return f"{base_message}. {payment_message}"


def _netopia_payment_note(ntp_id: str | None, payment_message: str | None) -> str:
    note = f"Netopia {ntp_id}".strip() if ntp_id else "Netopia"
    if payment_message:
        note = f"{note} — {payment_message}"
    return note


async def _notify_netopia_payment_received(session: AsyncSession, order: Order) -> None:
    if not (order.user and order.user.id):
        return
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


def _netopia_customer_to(order: Order) -> str | None:
    if order.user and order.user.email:
        return order.user.email
    return getattr(order, "customer_email", None)


def _netopia_customer_language(order: Order) -> str | None:
    if order.user:
        return order.user.preferred_language
    return None


def _netopia_admin_to(owner: Any) -> str | None:
    if owner and owner.email:
        return owner.email
    return settings.admin_alert_email


async def _queue_netopia_order_emails(session: AsyncSession, background_tasks: BackgroundTasks, order: Order) -> None:
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    customer_to = _netopia_customer_to(order)
    customer_lang = _netopia_customer_language(order)
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
    admin_to = _netopia_admin_to(owner)
    if admin_to:
        background_tasks.add_task(
            email_service.send_new_order_notification,
            admin_to,
            order,
            customer_to,
            owner.preferred_language if owner else None,
        )


async def _process_netopia_paid_order(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    *,
    ntp_id: str | None,
    payment_message: str | None,
) -> None:
    already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
    allowed_statuses = {
        OrderStatus.pending_payment,
        OrderStatus.pending_acceptance,
        OrderStatus.paid,
    }
    if already_captured or order.status not in allowed_statuses:
        return

    note = _netopia_payment_note(ntp_id, payment_message)
    if order.status == OrderStatus.pending_payment:
        order.status = OrderStatus.pending_acceptance
        session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))

    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=note))
    await promo_usage.record_promo_usage(session, order=order, note=note)
    session.add(order)
    await session.commit()
    await session.refresh(order)
    await coupons_service.redeem_coupon_for_order(session, order=order, note=note)

    await _notify_netopia_payment_received(session, order)
    await _queue_netopia_order_emails(session, background_tasks, order)


def _netopia_status_ack_fields(payment_status: int | None, payment_message: str | None) -> tuple[int, str | int, str]:
    if payment_status is None:
        return 1, "UNKNOWN", "Unknown payment status"
    status_messages = {
        4: "payment was cancelled; do not deliver goods",
        12: "Payment is DECLINED",
        13: "Payment in reviewing",
        15: "3D AUTH required",
    }
    return 1, payment_status, _append_payment_message(status_messages.get(payment_status, "Unknown"), payment_message)


def _prepare_netopia_event(
    *,
    verification_token: str | None,
    payload: bytes,
    log_context: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, int | str] | None]:
    if not verification_token:
        return None, _netopia_warn_and_ack(
            log_context,
            error_type=2,
            error_code="MISSING_VERIFICATION_TOKEN",
            message="Missing Netopia verification token",
            reason="missing verification header",
        )
    signature_error = _verify_netopia_signature(
        verification_token=verification_token,
        payload=payload,
        log_context=log_context,
    )
    if signature_error:
        return None, signature_error
    return _parse_netopia_payload(payload, log_context)


async def _resolve_netopia_order_context(
    session: AsyncSession,
    event: dict[str, Any],
) -> tuple[Order | None, str | None, str | None, int | None, dict[str, int | str] | None]:
    order_id_raw, candidate, order_uuid, ntp_id, payment_message, payment_status = _extract_netopia_fields(event)
    if not order_id_raw:
        return None, ntp_id, payment_message, payment_status, _netopia_ack(2, "MISSING_ORDER_ID", "Missing order id")
    order = await _load_netopia_order(session, order_uuid=order_uuid, candidate=candidate)
    order_error = _netopia_order_error(order)
    if order_error:
        return None, ntp_id, payment_message, payment_status, order_error
    return order, ntp_id, payment_message, payment_status, None


@router.post("/netopia/webhook", status_code=status.HTTP_200_OK)
async def netopia_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    verification_token: str | None = Header(default=None, alias="Verification-token"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = await request.body()
    log_context = _netopia_log_context(request, payload)

    event, precheck_error = _prepare_netopia_event(
        verification_token=verification_token,
        payload=payload,
        log_context=log_context,
    )
    if precheck_error:
        return precheck_error
    assert event is not None

    order, ntp_id, payment_message, payment_status, order_error = await _resolve_netopia_order_context(session, event)
    if order_error:
        return order_error
    assert order is not None

    try:
        if payment_status in {3, 5}:
            await _process_netopia_paid_order(
                session,
                background_tasks,
                order,
                ntp_id=ntp_id,
                payment_message=payment_message,
            )
            paid_message = _append_payment_message("payment was paid; deliver goods", payment_message)
            return _netopia_ack(0, None, paid_message)

        error_type, error_code, message = _netopia_status_ack_fields(payment_status, payment_message)
        return _netopia_ack(error_type, error_code, message)
    except Exception:
        await session.rollback()
        return _netopia_warn_and_ack(
            log_context,
            error_type=2,
            error_code="INTERNAL_ERROR",
            message="Internal processing error",
            reason="unhandled processing error",
            exc_info=True,
        )
