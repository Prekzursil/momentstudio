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
from app.models.webhook import PayPalWebhookEvent
from app.services import payments
from app.services import paypal as paypal_service
from app.services import auth as auth_service
from app.services import email as email_service
from app.services import checkout_settings as checkout_settings_service
from app.services import notifications as notification_service
from app.services import promo_usage
from app.api.v1 import cart as cart_api

router = APIRouter(prefix="/payments", tags=["payments"])


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
    event, inserted = await payments.handle_webhook_event(session, payload, stripe_signature)

    event_type = str(event.get("type") or "")
    if inserted and event_type.startswith("charge.dispute."):
        data = event.get("data")
        obj = data.get("object") if isinstance(data, dict) else None
        get = obj.get if hasattr(obj, "get") else None  # type: ignore[assignment]
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

    if inserted and event_type == "checkout.session.completed":
        data = event.get("data")
        obj = data.get("object") if isinstance(data, dict) else None
        get = obj.get if hasattr(obj, "get") else None  # type: ignore[assignment]
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
                    session.add(
                        OrderEvent(
                            order_id=order.id,
                            event="status_change",
                            note="pending_payment -> pending_acceptance",
                        )
                    )
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

                if order.user and order.user.id:
                    await notification_service.create_notification(
                        session,
                        user_id=order.user.id,
                        type="order",
                        title="Payment received"
                        if (order.user.preferred_language or "en") != "ro"
                        else "Plată confirmată",
                        body=f"Reference {order.reference_code}" if order.reference_code else None,
                        url="/account",
                    )

                if captured_added:
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

    if inserted and event_type == "payment_intent.succeeded":
        data = event.get("data")
        obj = data.get("object") if isinstance(data, dict) else None
        get = obj.get if hasattr(obj, "get") else None  # type: ignore[assignment]
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
                    session.add(
                        OrderEvent(
                            order_id=order.id,
                            event="status_change",
                            note="pending_payment -> pending_acceptance",
                        )
                    )
                    changed = True

                if changed:
                    session.add(order)
                    await session.commit()
                    await session.refresh(order)

                # Keep orders pending_acceptance until an admin accepts them; still notify the customer of payment receipt.
                if order.user and order.user.id:
                    await notification_service.create_notification(
                        session,
                        user_id=order.user.id,
                        type="order",
                        title="Payment received"
                        if (order.user.preferred_language or "en") != "ro"
                        else "Plată confirmată",
                        body=f"Reference {order.reference_code}" if order.reference_code else None,
                        url="/account",
                    )

                if captured_added:
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

    return {"received": True, "type": event.get("type")}


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

    record = PayPalWebhookEvent(
        paypal_event_id=event_id,
        event_type=str(event.get("event_type")) if event.get("event_type") else None,
    )
    session.add(record)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return {"received": True, "type": event.get("event_type")}

    event_type = str(event.get("event_type") or "")
    if event_type == "CHECKOUT.ORDER.APPROVED":
        resource = event.get("resource")
        paypal_order_id = resource.get("id") if isinstance(resource, dict) else None
        if paypal_order_id:
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
            if order and (order.payment_method or "").strip().lower() == "paypal":
                already_captured = bool((order.paypal_capture_id or "").strip()) or any(
                    getattr(evt, "event", None) == "payment_captured" for evt in (order.events or [])
                )
                if not already_captured and order.status in {
                    OrderStatus.pending_payment,
                    OrderStatus.pending_acceptance,
                    OrderStatus.paid,
                }:
                    try:
                        capture_id = await paypal_service.capture_order(paypal_order_id=str(paypal_order_id))
                    except HTTPException:
                        await session.rollback()
                        raise

                    if order.status == OrderStatus.pending_payment:
                        order.status = OrderStatus.pending_acceptance
                        session.add(
                            OrderEvent(
                                order_id=order.id,
                                event="status_change",
                                note="pending_payment -> pending_acceptance",
                            )
                        )
                    if capture_id and not (order.paypal_capture_id or "").strip():
                        order.paypal_capture_id = capture_id

                    session.add(
                        OrderEvent(order_id=order.id, event="payment_captured", note=f"PayPal {capture_id}".strip())
                    )
                    await promo_usage.record_promo_usage(session, order=order, note=f"PayPal {capture_id}".strip())
                    session.add(order)
                    await session.commit()
                    await session.refresh(order)

                    if order.user and order.user.id:
                        await notification_service.create_notification(
                            session,
                            user_id=order.user.id,
                            type="order",
                            title="Payment received"
                            if (order.user.preferred_language or "en") != "ro"
                            else "Plată confirmată",
                            body=f"Reference {order.reference_code}" if order.reference_code else None,
                            url="/account",
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

                    return {"received": True, "type": event.get("event_type")}

    await session.commit()
    return {"received": True, "type": event.get("event_type")}
