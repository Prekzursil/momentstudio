from __future__ import annotations

from urllib.parse import quote_plus

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.order import Order, OrderEvent, OrderItem, OrderStatus
from app.services import auth as auth_service
from app.services import checkout_settings as checkout_settings_service
from app.services import coupons as coupons_service
from app.services import email as email_service
from app.services import notifications as notification_service
from app.services import paypal as paypal_service
from app.services import promo_usage


CAPTURABLE_ORDER_STATUSES = {
    OrderStatus.pending_payment,
    OrderStatus.pending_acceptance,
    OrderStatus.paid,
}


def _account_orders_url(order: Order) -> str:
    token = str(order.reference_code or order.id)
    return f"/account/orders?q={quote_plus(token)}"


def _stripe_event_object(event: dict) -> object | None:
    data = event.get("data")
    if not isinstance(data, dict):
        return None
    return data.get("object")


def _object_get(source: object | None, key: str) -> object | None:
    getter = getattr(source, "get", None)
    if callable(getter):
        return getter(key)
    return None


def _stripe_event_value(event: dict, key: str) -> object | None:
    return _object_get(_stripe_event_object(event), key)


def _to_optional_str(value: object | None) -> str | None:
    return str(value) if value else None


def _to_optional_int(value: object | None) -> int | None:
    return int(value) if isinstance(value, (int, float)) else None


def _customer_email(order: Order) -> str | None:
    return (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)


def _customer_language(order: Order) -> str | None:
    return order.user.preferred_language if order.user else None


def _is_capturable_status(order: Order) -> bool:
    return order.status in CAPTURABLE_ORDER_STATUSES


def _has_payment_captured_event(order: Order) -> bool:
    return any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))


def _has_paypal_capture(order: Order) -> bool:
    return bool((order.paypal_capture_id or "").strip()) or _has_payment_captured_event(order)


def _order_query_with_relations():
    return select(Order).options(
        selectinload(Order.user),
        selectinload(Order.items).selectinload(OrderItem.product),
        selectinload(Order.events),
        selectinload(Order.shipping_address),
        selectinload(Order.billing_address),
    )


async def _load_order_by_stripe_checkout_session(session: AsyncSession, session_id: str) -> Order | None:
    query = _order_query_with_relations().where(Order.stripe_checkout_session_id == session_id)
    return (await session.execute(query)).scalars().first()


async def _load_order_by_stripe_payment_intent(session: AsyncSession, intent_id: str) -> Order | None:
    query = _order_query_with_relations().where(Order.stripe_payment_intent_id == intent_id)
    return (await session.execute(query)).scalars().first()


async def _load_order_by_paypal_order_id(session: AsyncSession, paypal_order_id: str) -> Order | None:
    query = _order_query_with_relations().where(Order.paypal_order_id == paypal_order_id)
    return (await session.execute(query)).scalars().first()


def _transition_pending_payment_to_acceptance(session: AsyncSession, order: Order) -> bool:
    if order.status != OrderStatus.pending_payment:
        return False
    order.status = OrderStatus.pending_acceptance
    session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
    return True


async def _commit_order(session: AsyncSession, order: Order) -> None:
    session.add(order)
    await session.commit()
    await session.refresh(order)


async def _commit_order_if_changed(session: AsyncSession, order: Order, changed: bool) -> None:
    if not changed:
        return
    await _commit_order(session, order)


async def _send_payment_received_notification(session: AsyncSession, order: Order) -> None:
    if not order.user or not order.user.id:
        return
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


async def _send_order_emails(session: AsyncSession, background_tasks: BackgroundTasks, order: Order) -> None:
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    customer_to = _customer_email(order)
    customer_lang = _customer_language(order)
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


async def _redeem_coupon_and_notify(session: AsyncSession, order: Order, note: str) -> None:
    await coupons_service.redeem_coupon_for_order(session, order=order, note=note)
    await _send_payment_received_notification(session, order)


async def _add_stripe_capture_event(session: AsyncSession, order: Order, note: str) -> bool:
    if _has_payment_captured_event(order):
        return False
    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=note))
    await promo_usage.record_promo_usage(session, order=order, note=note)
    return True


async def _handle_stripe_dispute_event(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    event_type: str,
    event: dict,
) -> None:
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if not admin_to:
        return
    background_tasks.add_task(
        email_service.send_stripe_dispute_notification,
        admin_to,
        event_type=event_type,
        dispute_id=_to_optional_str(_stripe_event_value(event, "id")),
        charge_id=_to_optional_str(_stripe_event_value(event, "charge")),
        amount=_to_optional_int(_stripe_event_value(event, "amount")),
        currency=_to_optional_str(_stripe_event_value(event, "currency")),
        reason=_to_optional_str(_stripe_event_value(event, "reason")),
        dispute_status=_to_optional_str(_stripe_event_value(event, "status")),
        lang=owner.preferred_language if owner else None,
    )


async def _process_stripe_paid_order(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    note: str,
    payment_intent_id: str | None = None,
) -> None:
    changed = False
    if payment_intent_id and not order.stripe_payment_intent_id:
        order.stripe_payment_intent_id = payment_intent_id
        changed = True

    if _transition_pending_payment_to_acceptance(session, order):
        changed = True

    captured_added = await _add_stripe_capture_event(session, order, note)
    if captured_added:
        changed = True

    await _commit_order_if_changed(session, order, changed)
    await _redeem_coupon_and_notify(session, order, note)
    if captured_added:
        await _send_order_emails(session, background_tasks, order)


async def _handle_stripe_checkout_completed(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    event: dict,
) -> None:
    session_id = _to_optional_str(_stripe_event_value(event, "id"))
    payment_status = _to_optional_str(_stripe_event_value(event, "payment_status"))
    if not session_id or str(payment_status or "").lower() != "paid":
        return

    order = await _load_order_by_stripe_checkout_session(session, session_id)
    if not order or not _is_capturable_status(order):
        return

    payment_intent_id = _to_optional_str(_stripe_event_value(event, "payment_intent"))
    await _process_stripe_paid_order(
        session,
        background_tasks,
        order,
        note=f"Stripe checkout {session_id}",
        payment_intent_id=payment_intent_id,
    )


async def _handle_stripe_payment_intent_succeeded(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    event: dict,
) -> None:
    intent_id = _to_optional_str(_stripe_event_value(event, "id"))
    if not intent_id:
        return

    order = await _load_order_by_stripe_payment_intent(session, intent_id)
    if not order or not _is_capturable_status(order):
        return

    await _process_stripe_paid_order(
        session,
        background_tasks,
        order,
        note=f"Stripe {intent_id}".strip(),
    )


async def process_stripe_event(session: AsyncSession, background_tasks: BackgroundTasks, event: dict) -> None:
    event_type = str(event.get("type") or "")
    if event_type.startswith("charge.dispute."):
        await _handle_stripe_dispute_event(session, background_tasks, event_type, event)
        return
    if event_type == "checkout.session.completed":
        await _handle_stripe_checkout_completed(session, background_tasks, event)
        return
    if event_type == "payment_intent.succeeded":
        await _handle_stripe_payment_intent_succeeded(session, background_tasks, event)


def _paypal_order_id(event: dict) -> str | None:
    resource = event.get("resource")
    if not isinstance(resource, dict):
        return None
    order_id = resource.get("id")
    return str(order_id) if order_id else None


def _is_paypal_order_ready(order: Order | None) -> bool:
    if not order:
        return False
    if (order.payment_method or "").strip().lower() != "paypal":
        return False
    if not _is_capturable_status(order):
        return False
    return not _has_paypal_capture(order)


async def _capture_paypal_order(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    paypal_order_id: str,
) -> None:
    capture_id = await paypal_service.capture_order(paypal_order_id=paypal_order_id)
    _transition_pending_payment_to_acceptance(session, order)
    if capture_id and not (order.paypal_capture_id or "").strip():
        order.paypal_capture_id = capture_id

    note = f"PayPal {capture_id}".strip()
    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=note))
    await promo_usage.record_promo_usage(session, order=order, note=note)
    await _commit_order(session, order)

    await _redeem_coupon_and_notify(session, order, note)
    await _send_order_emails(session, background_tasks, order)


async def process_paypal_event(session: AsyncSession, background_tasks: BackgroundTasks, event: dict) -> None:
    if str(event.get("event_type") or "") != "CHECKOUT.ORDER.APPROVED":
        return

    paypal_order_id = _paypal_order_id(event)
    if not paypal_order_id:
        return

    order = await _load_order_by_paypal_order_id(session, paypal_order_id)
    if not order or not _is_paypal_order_ready(order):
        return

    await _capture_paypal_order(session, background_tasks, order, paypal_order_id)
