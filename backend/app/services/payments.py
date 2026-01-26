from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal, cast

import stripe
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.cart import Cart
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.webhook import StripeWebhookEvent
from app.core import metrics

stripe = cast(Any, stripe)

_STRIPE_PLACEHOLDER_SUFFIX = "_placeholder"


def _stripe_env() -> Literal["test", "live"]:
    raw = (settings.stripe_env or "test").strip().lower()
    if raw in {"live", "production", "prod"}:
        return "live"
    return "test"


def _looks_configured(value: str | None) -> bool:
    cleaned = (value or "").strip()
    if not cleaned:
        return False
    return not cleaned.endswith(_STRIPE_PLACEHOLDER_SUFFIX)


def stripe_secret_key() -> str:
    if _stripe_env() == "live":
        return (settings.stripe_secret_key_live or settings.stripe_secret_key or "").strip()
    return (settings.stripe_secret_key_test or settings.stripe_secret_key or "").strip()


def stripe_webhook_secret() -> str:
    if _stripe_env() == "live":
        return (settings.stripe_webhook_secret_live or settings.stripe_webhook_secret or "").strip()
    return (settings.stripe_webhook_secret_test or settings.stripe_webhook_secret or "").strip()


def is_stripe_configured() -> bool:
    return _looks_configured(stripe_secret_key())


def is_stripe_webhook_configured() -> bool:
    return _looks_configured(stripe_webhook_secret())


def init_stripe() -> None:
    stripe.api_key = stripe_secret_key()


async def _get_or_create_cached_amount_off_coupon(
    session: AsyncSession,
    *,
    promo_code: str,
    discount_cents: int,
    currency: str = "RON",
) -> str | None:
    cleaned_code = (promo_code or "").strip().upper()
    if not cleaned_code:
        return None
    if discount_cents <= 0:
        return None

    promo_res = await session.execute(select(PromoCode).where(PromoCode.code == cleaned_code))
    promo = promo_res.scalar_one_or_none()
    if not promo:
        return None

    currency_clean = (getattr(promo, "currency", None) or currency or "RON").strip().upper() or "RON"
    map_res = await session.execute(
        select(StripeCouponMapping).where(
            StripeCouponMapping.promo_code_id == promo.id,
            StripeCouponMapping.discount_cents == int(discount_cents),
            StripeCouponMapping.currency == currency_clean,
        )
    )
    existing = map_res.scalar_one_or_none()
    if existing:
        return existing.stripe_coupon_id

    try:
        coupon_obj = stripe.Coupon.create(
            duration="once",
            amount_off=int(discount_cents),
            currency=currency_clean.lower(),
            metadata={"promo_code": cleaned_code, "discount_cents": str(int(discount_cents))},
        )
    except Exception:
        return None

    coupon_id = getattr(coupon_obj, "id", None) or (coupon_obj.get("id") if hasattr(coupon_obj, "get") else None)
    if not coupon_id:
        return None

    record = StripeCouponMapping(
        promo_code_id=promo.id,
        discount_cents=int(discount_cents),
        currency=currency_clean,
        stripe_coupon_id=str(coupon_id),
    )
    session.add(record)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        map_res = await session.execute(
            select(StripeCouponMapping).where(
                StripeCouponMapping.promo_code_id == promo.id,
                StripeCouponMapping.discount_cents == int(discount_cents),
                StripeCouponMapping.currency == currency_clean,
            )
        )
        recovered = map_res.scalar_one_or_none()
        if recovered:
            return recovered.stripe_coupon_id
    return str(coupon_id)


async def create_payment_intent(session: AsyncSession, cart: Cart, amount_cents: int | None = None) -> dict:
    if not is_stripe_configured():
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    init_stripe()
    subtotal = sum(
        (Decimal(str(item.unit_price_at_add)) * int(item.quantity or 0) for item in cart.items),
        start=Decimal("0.00"),
    )
    subtotal = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    computed_amount = int((subtotal * 100).to_integral_value(rounding=ROUND_HALF_UP))
    if amount_cents is None:
        amount_cents = computed_amount
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency="ron",
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


async def create_checkout_session(
    *,
    session: AsyncSession,
    amount_cents: int,
    customer_email: str,
    success_url: str,
    cancel_url: str,
    lang: str | None = None,
    metadata: dict[str, str] | None = None,
    line_items: list[dict[str, Any]] | None = None,
    discount_cents: int | None = None,
    promo_code: str | None = None,
) -> dict:
    """Create a Stripe Checkout Session and return {session_id, checkout_url}.

    This uses Stripe-hosted checkout (redirect flow). The associated PaymentIntent
    metadata includes our provided metadata so webhooks/confirm endpoints can map
    back to internal entities.
    """
    if not is_stripe_configured():
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid amount")

    init_stripe()
    locale: Literal["en", "ro"] = "ro" if (lang or "").strip().lower() == "ro" else "en"
    safe_metadata = {str(k): str(v) for (k, v) in (metadata or {}).items() if k and v is not None}
    normalized_items = line_items or [
        {
            "price_data": {
                "currency": "ron",
                "unit_amount": int(amount_cents),
                "product_data": {"name": "momentstudio"},
            },
            "quantity": 1,
        }
    ]
    discount_value = int(discount_cents or 0)
    if discount_value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid discount")
    if line_items is not None:
        computed_total = 0
        for item in normalized_items:
            qty = item.get("quantity", 1)
            if not isinstance(qty, int):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid line item quantity")
            price_data = item.get("price_data")
            if not isinstance(price_data, dict):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid line item price")
            unit_amount = price_data.get("unit_amount")
            if not isinstance(unit_amount, int):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid line item amount")
            computed_total += unit_amount * qty
        computed_total -= discount_value
        if computed_total != amount_cents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Line items total mismatch")

    try:
        discounts_param = None
        if discount_value:
            coupon_id = await _get_or_create_cached_amount_off_coupon(
                session,
                promo_code=str(promo_code or ""),
                discount_cents=discount_value,
                currency="RON",
            )
            if not coupon_id:
                coupon_obj = stripe.Coupon.create(duration="once", amount_off=discount_value, currency="ron")
                coupon_id = getattr(coupon_obj, "id", None) or (
                    coupon_obj.get("id") if hasattr(coupon_obj, "get") else None
                )
            if coupon_id:
                discounts_param = [{"coupon": str(coupon_id)}]

        session_kwargs: dict[str, Any] = {
            "mode": "payment",
            "customer_email": customer_email,
            "line_items": normalized_items,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "locale": locale,
            "metadata": safe_metadata,
            "payment_intent_data": {"metadata": safe_metadata},
        }
        if discounts_param:
            session_kwargs["discounts"] = discounts_param
        session_obj = stripe.checkout.Session.create(
            **session_kwargs
        )
    except Exception as exc:
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe checkout session creation failed") from exc

    session_id = getattr(session_obj, "id", None) or (session_obj.get("id") if hasattr(session_obj, "get") else None)
    checkout_url = getattr(session_obj, "url", None) or (session_obj.get("url") if hasattr(session_obj, "get") else None)
    if not session_id or not checkout_url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe checkout session missing url")
    return {"session_id": str(session_id), "checkout_url": str(checkout_url)}


def _stripe_event_payload_summary(event: Any) -> dict[str, Any]:
    event_type = str(event.get("type") or "")
    summary: dict[str, Any] = {
        "id": str(event.get("id") or ""),
        "type": event_type,
        "created": event.get("created"),
    }
    data = event.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    get = getattr(obj, "get", None)
    if callable(get):
        obj_summary: dict[str, Any] = {}
        for key in ("id", "payment_intent", "payment_status", "charge", "amount", "currency", "reason", "status"):
            value = get(key)
            if value is not None:
                obj_summary[key] = value
        if obj_summary:
            summary["data"] = {"object": obj_summary}
    return summary


async def handle_webhook_event(session: AsyncSession, payload: bytes, sig_header: str | None) -> tuple[dict, StripeWebhookEvent]:
    secret = stripe_webhook_secret()
    if not _looks_configured(secret):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Webhook secret not set")
    init_stripe()
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, secret)
    except Exception as exc:  # broad for Stripe signature errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload") from exc

    event_id = str(event.get("id") or "").strip()
    if not event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing event id")

    now = datetime.now(timezone.utc)
    event_type = str(event.get("type") or "").strip() or None
    payload_summary = _stripe_event_payload_summary(event)

    record = StripeWebhookEvent(
        stripe_event_id=event_id,
        event_type=event_type,
        attempts=1,
        last_attempt_at=now,
        payload=payload_summary,
    )
    session.add(record)
    try:
        await session.commit()
        await session.refresh(record)
        return event, record
    except IntegrityError:
        await session.rollback()

    existing = (await session.execute(select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id))).scalar_one()
    existing.attempts = int(getattr(existing, "attempts", 0) or 0) + 1
    existing.last_attempt_at = now
    existing.event_type = event_type or existing.event_type
    existing.payload = payload_summary or existing.payload
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    return event, existing


async def capture_payment_intent(intent_id: str) -> dict:
    """Capture an authorized PaymentIntent."""
    if not is_stripe_configured():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    try:
        return stripe.PaymentIntent.capture(intent_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


async def void_payment_intent(intent_id: str) -> dict:
    """Cancel/void a PaymentIntent that has not been captured."""
    if not is_stripe_configured():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    try:
        return stripe.PaymentIntent.cancel(intent_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


async def refund_payment_intent(intent_id: str, *, amount_cents: int | None = None) -> dict:
    """Refund a captured PaymentIntent (supports partial refunds via `amount_cents`)."""
    if not is_stripe_configured():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    init_stripe()
    try:
        payload: dict = {"payment_intent": intent_id}
        if amount_cents is not None:
            payload["amount"] = int(amount_cents)
        return stripe.Refund.create(**payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
