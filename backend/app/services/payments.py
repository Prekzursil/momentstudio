from typing import Any, cast

import stripe
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.config import settings
from app.models.cart import Cart
from app.models.webhook import StripeWebhookEvent
from app.models.user import PaymentMethod, User
from app.core import metrics

stripe = cast(Any, stripe)


def init_stripe() -> None:
    stripe.api_key = settings.stripe_secret_key


async def create_payment_intent(session: AsyncSession, cart: Cart, amount_cents: int | None = None) -> dict:
    if not settings.stripe_secret_key:
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    init_stripe()
    computed_amount = int(sum(float(item.unit_price_at_add) * item.quantity for item in cart.items) * 100)
    if amount_cents is None:
        amount_cents = computed_amount
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency="ron",
            capture_method="manual",
            metadata={"cart_id": str(cart.id), "user_id": str(cart.user_id) if cart.user_id else ""},
        )
    except Exception as exc:
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    client_secret = getattr(intent, "client_secret", None)
    intent_id = getattr(intent, "id", None)
    if not client_secret or not intent_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe client secret missing")
    return {"client_secret": str(client_secret), "intent_id": str(intent_id)}


async def handle_webhook_event(session: AsyncSession, payload: bytes, sig_header: str | None) -> tuple[dict, bool]:
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Webhook secret not set")
    init_stripe()
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except Exception as exc:  # broad for Stripe signature errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload") from exc

    event_id = event.get("id")
    inserted = False
    if event_id:
        record = StripeWebhookEvent(
            stripe_event_id=str(event_id),
            event_type=str(event.get("type")) if event.get("type") else None,
        )
        session.add(record)
        try:
            await session.commit()
            inserted = True
        except IntegrityError:
            await session.rollback()
    return event, inserted


async def capture_payment_intent(intent_id: str) -> dict:
    """Capture an authorized PaymentIntent."""
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    try:
        return stripe.PaymentIntent.capture(intent_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


async def void_payment_intent(intent_id: str) -> dict:
    """Cancel/void a PaymentIntent that has not been captured."""
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    try:
        return stripe.PaymentIntent.cancel(intent_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


async def refund_payment_intent(intent_id: str) -> dict:
    """Refund a captured PaymentIntent."""
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    try:
        return stripe.Refund.create(payment_intent=intent_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


async def ensure_customer(session: AsyncSession, user: User) -> str:
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    if user.stripe_customer_id:
        return user.stripe_customer_id
    # Stripe expects a string; fallback to empty when name is None
    customer = stripe.Customer.create(email=user.email, name=user.name or "")
    user.stripe_customer_id = customer["id"]
    session.add(user)
    await session.flush()
    return user.stripe_customer_id


async def create_setup_intent(session: AsyncSession, user: User) -> dict:
    customer_id = await ensure_customer(session, user)
    intent = stripe.SetupIntent.create(customer=customer_id, usage="off_session")
    return {"client_secret": intent["client_secret"], "customer_id": customer_id}


async def attach_payment_method(session: AsyncSession, user: User, payment_method_id: str) -> PaymentMethod:
    customer_id = await ensure_customer(session, user)
    init_stripe()
    pm = stripe.PaymentMethod.attach(payment_method_id, customer=customer_id)
    brand = pm.get("card", {}).get("brand") if pm.get("card") else None
    last4 = pm.get("card", {}).get("last4") if pm.get("card") else None
    exp_month = pm.get("card", {}).get("exp_month") if pm.get("card") else None
    exp_year = pm.get("card", {}).get("exp_year") if pm.get("card") else None
    record = PaymentMethod(
        user_id=user.id,
        stripe_payment_method_id=payment_method_id,
        brand=brand,
        last4=last4,
        exp_month=exp_month,
        exp_year=exp_year,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def list_payment_methods(session: AsyncSession, user: User) -> list[PaymentMethod]:
    result = await session.execute(select(PaymentMethod).where(PaymentMethod.user_id == user.id))
    return list(result.scalars().all())


async def remove_payment_method(session: AsyncSession, user: User, payment_method_id: str) -> None:
    try:
        pm_uuid = uuid.UUID(payment_method_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payment method id")
    result = await session.execute(
        select(PaymentMethod).where(PaymentMethod.user_id == user.id, PaymentMethod.id == pm_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment method not found")
    init_stripe()
    try:
        stripe.PaymentMethod.detach(record.stripe_payment_method_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    await session.delete(record)
    await session.commit()
