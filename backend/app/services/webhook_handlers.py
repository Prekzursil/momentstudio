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


def _account_orders_url(order: Order) -> str:
    token = str(order.reference_code or order.id)
    return f"/account/orders?q={quote_plus(token)}"


async def process_stripe_event(session: AsyncSession, background_tasks: BackgroundTasks, event: dict) -> None:
    event_type = str(event.get("type") or "")

    if event_type.startswith("charge.dispute."):
        data = event.get("data")
        obj = data.get("object") if isinstance(data, dict) else None
        get = getattr(obj, "get", None)
        dispute_id = get("id") if callable(get) else None
        charge_id = get("charge") if callable(get) else None
        amount = get("amount") if callable(get) else None
        currency = get("currency") if callable(get) else None
        reason = get("reason") if callable(get) else None
        dispute_status = get("status") if callable(get) else None

        owner = await auth_service.get_owner_user(session)
        admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
        if admin_to:
            background_tasks.add_task(
                email_service.send_stripe_dispute_notification,
                admin_to,
                event_type=event_type,
                dispute_id=str(dispute_id) if dispute_id else None,
                charge_id=str(charge_id) if charge_id else None,
                amount=int(amount) if isinstance(amount, (int, float)) else None,
                currency=str(currency) if currency else None,
                reason=str(reason) if reason else None,
                dispute_status=str(dispute_status) if dispute_status else None,
                lang=owner.preferred_language if owner else None,
            )

    if event_type == "checkout.session.completed":
        data = event.get("data")
        obj = data.get("object") if isinstance(data, dict) else None
        get = getattr(obj, "get", None)
        session_id = get("id") if callable(get) else None
        payment_intent_id = get("payment_intent") if callable(get) else None
        payment_status = get("payment_status") if callable(get) else None
        if session_id and str(payment_status or "").lower() == "paid":
            order = (
                (
                    await session.execute(
                        select(Order)
                        .options(
                            selectinload(Order.user),
                            selectinload(Order.items).selectinload(OrderItem.product),
                            selectinload(Order.events),
                            selectinload(Order.shipping_address),
                            selectinload(Order.billing_address),
                        )
                        .where(Order.stripe_checkout_session_id == str(session_id))
                    )
                )
                .scalars()
                .first()
            )
            if order and order.status in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
                captured_added = False
                changed = False
                if payment_intent_id and not order.stripe_payment_intent_id:
                    order.stripe_payment_intent_id = str(payment_intent_id)
                    changed = True

                if order.status == OrderStatus.pending_payment:
                    order.status = OrderStatus.pending_acceptance
                    session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
                    changed = True

                already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
                if not already_captured:
                    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=f"Stripe checkout {session_id}"))
                    captured_added = True
                    changed = True
                    await promo_usage.record_promo_usage(session, order=order, note=f"Stripe checkout {session_id}")

                if changed:
                    session.add(order)
                    await session.commit()
                    await session.refresh(order)
                await coupons_service.redeem_coupon_for_order(session, order=order, note=f"Stripe checkout {session_id}")

                if order.user and order.user.id:
                    await notification_service.create_notification(
                        session,
                        user_id=order.user.id,
                        type="order",
                        title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
                        body=f"Reference {order.reference_code}" if order.reference_code else None,
                        url=_account_orders_url(order),
                    )

                if captured_added:
                    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
                    customer_to = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
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

    if event_type == "payment_intent.succeeded":
        data = event.get("data")
        obj = data.get("object") if isinstance(data, dict) else None
        get = getattr(obj, "get", None)
        intent_id = get("id") if callable(get) else None
        if intent_id:
            order = (
                (
                    await session.execute(
                        select(Order)
                        .options(
                            selectinload(Order.user),
                            selectinload(Order.items).selectinload(OrderItem.product),
                            selectinload(Order.events),
                            selectinload(Order.shipping_address),
                            selectinload(Order.billing_address),
                        )
                        .where(Order.stripe_payment_intent_id == str(intent_id))
                    )
                )
                .scalars()
                .first()
            )
            if order and order.status in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
                captured_added = False
                changed = False
                already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
                if not already_captured:
                    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=f"Stripe {intent_id}"))
                    captured_added = True
                    changed = True
                    await promo_usage.record_promo_usage(session, order=order, note=f"Stripe {intent_id}".strip())

                if order.status == OrderStatus.pending_payment:
                    order.status = OrderStatus.pending_acceptance
                    session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
                    changed = True

                if changed:
                    session.add(order)
                    await session.commit()
                    await session.refresh(order)
                await coupons_service.redeem_coupon_for_order(session, order=order, note=f"Stripe {intent_id}".strip())

                if order.user and order.user.id:
                    await notification_service.create_notification(
                        session,
                        user_id=order.user.id,
                        type="order",
                        title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
                        body=f"Reference {order.reference_code}" if order.reference_code else None,
                        url=_account_orders_url(order),
                    )

                if captured_added:
                    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
                    customer_to = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
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


async def process_paypal_event(session: AsyncSession, background_tasks: BackgroundTasks, event: dict) -> None:
    event_type = str(event.get("event_type") or "")
    if event_type != "CHECKOUT.ORDER.APPROVED":
        return

    resource = event.get("resource")
    paypal_order_id = resource.get("id") if isinstance(resource, dict) else None
    if not paypal_order_id:
        return

    order = (
        (
            await session.execute(
                select(Order)
                .options(
                    selectinload(Order.user),
                    selectinload(Order.items).selectinload(OrderItem.product),
                    selectinload(Order.events),
                    selectinload(Order.shipping_address),
                    selectinload(Order.billing_address),
                )
                .where(Order.paypal_order_id == str(paypal_order_id))
            )
        )
        .scalars()
        .first()
    )
    if not order or (order.payment_method or "").strip().lower() != "paypal":
        return

    already_captured = bool((order.paypal_capture_id or "").strip()) or any(
        getattr(evt, "event", None) == "payment_captured" for evt in (order.events or [])
    )
    if already_captured or order.status not in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
        return

    capture_id = await paypal_service.capture_order(paypal_order_id=str(paypal_order_id))

    if order.status == OrderStatus.pending_payment:
        order.status = OrderStatus.pending_acceptance
        session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
    if capture_id and not (order.paypal_capture_id or "").strip():
        order.paypal_capture_id = capture_id

    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=f"PayPal {capture_id}".strip()))
    await promo_usage.record_promo_usage(session, order=order, note=f"PayPal {capture_id}".strip())
    session.add(order)
    await session.commit()
    await session.refresh(order)

    await coupons_service.redeem_coupon_for_order(session, order=order, note=f"PayPal {capture_id}".strip())

    if order.user and order.user.id:
        await notification_service.create_notification(
            session,
            user_id=order.user.id,
            type="order",
            title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
            body=f"Reference {order.reference_code}" if order.reference_code else None,
            url=_account_orders_url(order),
        )

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    customer_to = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
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
