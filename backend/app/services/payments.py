from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal, cast
from uuid import uuid4

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
from app.services.payment_provider import is_mock_payments

stripe = cast(Any, stripe)

_STRIPE_PLACEHOLDER_SUFFIX = "_placeholder"


def _stripe_env() -> Literal["sandbox", "live"]:
    raw = (settings.stripe_env or "sandbox").strip().lower()
    if raw in {"live", "production", "prod"}:
        return "live"
    return "sandbox"


def _looks_configured(value: str | None) -> bool:
    cleaned = (value or "").strip()
    if not cleaned:
        return False
    return not cleaned.endswith(_STRIPE_PLACEHOLDER_SUFFIX)


def stripe_secret_key() -> str:
    if _stripe_env() == "live":
        return (settings.stripe_secret_key_live or settings.stripe_secret_key or "").strip()
    return (
        settings.stripe_secret_key_sandbox
        or settings.stripe_secret_key_test
        or settings.stripe_secret_key
        or ""
    ).strip()


def stripe_webhook_secret() -> str:
    if _stripe_env() == "live":
        return (settings.stripe_webhook_secret_live or settings.stripe_webhook_secret or "").strip()
    return (
        settings.stripe_webhook_secret_sandbox
        or settings.stripe_webhook_secret_test
        or settings.stripe_webhook_secret
        or ""
    ).strip()


def is_stripe_configured() -> bool:
    return _looks_configured(stripe_secret_key())


def is_stripe_webhook_configured() -> bool:
    return _looks_configured(stripe_webhook_secret())


def init_stripe() -> None:
    stripe.api_key = stripe_secret_key()


async def _load_promo(session: AsyncSession, *, code: str) -> PromoCode | None:
    promo_res = await session.execute(select(PromoCode).where(PromoCode.code == code))
    return promo_res.scalar_one_or_none()


async def _load_existing_coupon_mapping(
    session: AsyncSession,
    *,
    promo_id: Any,
    discount_cents: int,
    currency: str,
) -> StripeCouponMapping | None:
    map_res = await session.execute(
        select(StripeCouponMapping).where(
            StripeCouponMapping.promo_code_id == promo_id,
            StripeCouponMapping.discount_cents == int(discount_cents),
            StripeCouponMapping.currency == currency,
        )
    )
    return map_res.scalar_one_or_none()


async def _persist_coupon_mapping(
    session: AsyncSession,
    *,
    promo_id: Any,
    discount_cents: int,
    currency: str,
    coupon_id: str,
) -> str:
    record = StripeCouponMapping(
        promo_code_id=promo_id,
        discount_cents=int(discount_cents),
        currency=currency,
        stripe_coupon_id=str(coupon_id),
    )
    session.add(record)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        recovered = await _load_existing_coupon_mapping(
            session,
            promo_id=promo_id,
            discount_cents=discount_cents,
            currency=currency,
        )
        if recovered:
            return recovered.stripe_coupon_id
    return str(coupon_id)


def _coupon_id_from_object(coupon_obj: Any) -> str | None:
    coupon_id = getattr(coupon_obj, "id", None)
    if coupon_id:
        return str(coupon_id)
    if hasattr(coupon_obj, "get"):
        raw = coupon_obj.get("id")
        if raw:
            return str(raw)
    return None


async def _get_or_create_cached_amount_off_coupon(
    session: AsyncSession,
    *,
    promo_code: str,
    discount_cents: int,
    currency: str = "RON",
) -> str | None:
    cleaned_code = (promo_code or "").strip().upper()
    if not cleaned_code or discount_cents <= 0:
        return None
    promo_and_currency = await _promo_and_currency(
        session,
        promo_code=cleaned_code,
        currency=currency,
    )
    if promo_and_currency is None:
        return None
    promo, currency_clean = promo_and_currency
    existing = await _load_existing_coupon_mapping(
        session,
        promo_id=promo.id,
        discount_cents=discount_cents,
        currency=currency_clean,
    )
    if existing:
        return existing.stripe_coupon_id

    coupon_id = _create_stripe_discount_coupon_id(
        promo_code=cleaned_code,
        discount_cents=discount_cents,
        currency=currency_clean,
    )
    if not coupon_id:
        return None
    return await _persist_coupon_mapping(
        session,
        promo_id=promo.id,
        discount_cents=discount_cents,
        currency=currency_clean,
        coupon_id=coupon_id,
    )


async def _promo_and_currency(
    session: AsyncSession,
    *,
    promo_code: str,
    currency: str,
) -> tuple[PromoCode, str] | None:
    promo = await _load_promo(session, code=promo_code)
    if not promo:
        return None
    currency_clean = (getattr(promo, "currency", None) or currency or "RON").strip().upper() or "RON"
    return promo, currency_clean


def _create_stripe_discount_coupon_id(*, promo_code: str, discount_cents: int, currency: str) -> str | None:
    try:
        coupon_obj = stripe.Coupon.create(
            duration="once",
            amount_off=int(discount_cents),
            currency=currency.lower(),
            metadata={"promo_code": promo_code, "discount_cents": str(int(discount_cents))},
        )
    except Exception:
        return None
    return _coupon_id_from_object(coupon_obj)


def _cart_subtotal_cents(cart: Cart) -> int:
    subtotal = sum(
        (Decimal(str(item.unit_price_at_add)) * int(item.quantity or 0) for item in cart.items),
        start=Decimal("0.00"),
    )
    normalized = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((normalized * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _intent_response(intent: Any) -> dict[str, str]:
    client_secret = getattr(intent, "client_secret", None)
    intent_id = getattr(intent, "id", None)
    if not client_secret or not intent_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe client secret missing")
    return {"client_secret": str(client_secret), "intent_id": str(intent_id)}


async def create_payment_intent(session: AsyncSession, cart: Cart, amount_cents: int | None = None) -> dict:
    if not is_stripe_configured():
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    init_stripe()
    computed_amount = _cart_subtotal_cents(cart)
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

    return _intent_response(intent)


def _mock_checkout_session() -> dict[str, str]:
    session_id = f"cs_mock_{uuid4().hex}"
    base = settings.frontend_origin.rstrip("/")
    checkout_url = f"{base}/checkout/mock/stripe?session_id={session_id}"
    return {"session_id": session_id, "checkout_url": checkout_url}


def _normalized_checkout_line_items(amount_cents: int, line_items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if line_items is not None:
        return line_items
    return [
        {
            "price_data": {
                "currency": "ron",
                "unit_amount": int(amount_cents),
                "product_data": {"name": "momentstudio"},
            },
            "quantity": 1,
        }
    ]


def _line_item_total(line_items: list[dict[str, Any]]) -> int:
    computed_total = 0
    for item in line_items:
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
    return computed_total


def _resolve_discount_value(discount_cents: int | None) -> int:
    discount_value = int(discount_cents or 0)
    if discount_value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid discount")
    return discount_value


def _checkout_locale(lang: str | None) -> Literal["en", "ro"]:
    return "ro" if (lang or "").strip().lower() == "ro" else "en"


def _safe_checkout_metadata(metadata: dict[str, str] | None) -> dict[str, str]:
    return {str(k): str(v) for (k, v) in (metadata or {}).items() if k and v is not None}


def _assert_checkout_enabled(amount_cents: int) -> None:
    if not is_stripe_configured():
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid amount")


def _checkout_session_kwargs(
    *,
    customer_email: str,
    line_items: list[dict[str, Any]],
    success_url: str,
    cancel_url: str,
    locale: Literal["en", "ro"],
    metadata: dict[str, str],
    discounts: list[dict[str, str]] | None,
) -> dict[str, Any]:
    session_kwargs: dict[str, Any] = {
        "mode": "payment",
        "customer_email": customer_email,
        "line_items": line_items,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "locale": locale,
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata},
    }
    if discounts:
        session_kwargs["discounts"] = discounts
    return session_kwargs


def _assert_line_items_total(
    *,
    normalized_items: list[dict[str, Any]],
    discount_value: int,
    expected_amount_cents: int,
) -> None:
    computed_total = _line_item_total(normalized_items) - discount_value
    if computed_total != expected_amount_cents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Line items total mismatch")


def _create_checkout_session_object(session_kwargs: dict[str, Any]) -> Any:
    try:
        return stripe.checkout.Session.create(**session_kwargs)
    except Exception as exc:
        metrics.record_payment_failure()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe checkout session creation failed") from exc


def _session_result(session_obj: Any) -> dict[str, str]:
    session_id_raw = getattr(session_obj, "id", None) or (session_obj.get("id") if hasattr(session_obj, "get") else None)
    checkout_url_raw = getattr(session_obj, "url", None) or (
        session_obj.get("url") if hasattr(session_obj, "get") else None
    )
    if not session_id_raw or not checkout_url_raw:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe checkout session missing url")
    return {"session_id": str(session_id_raw), "checkout_url": str(checkout_url_raw)}


async def _discounts_param(
    *,
    session: AsyncSession,
    discount_value: int,
    promo_code: str | None,
) -> list[dict[str, str]] | None:
    if not discount_value:
        return None
    coupon_id = await _get_or_create_cached_amount_off_coupon(
        session,
        promo_code=str(promo_code or ""),
        discount_cents=discount_value,
        currency="RON",
    )
    if not coupon_id:
        coupon_obj = stripe.Coupon.create(duration="once", amount_off=discount_value, currency="ron")
        coupon_id = _coupon_id_from_object(coupon_obj)
    if not coupon_id:
        return None
    return [{"coupon": str(coupon_id)}]


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
    """Create Stripe-hosted checkout and return {session_id, checkout_url}."""
    if is_mock_payments():
        return _mock_checkout_session()

    _assert_checkout_enabled(amount_cents)

    init_stripe()
    locale = _checkout_locale(lang)
    safe_metadata = _safe_checkout_metadata(metadata)
    normalized_items = _normalized_checkout_line_items(amount_cents, line_items)
    discount_value = _resolve_discount_value(discount_cents)
    if line_items is not None:
        _assert_line_items_total(
            normalized_items=normalized_items,
            discount_value=discount_value,
            expected_amount_cents=amount_cents,
        )

    discounts_param = await _discounts_param(
        session=session,
        discount_value=discount_value,
        promo_code=promo_code,
    )
    session_kwargs = _checkout_session_kwargs(
        customer_email=customer_email,
        line_items=normalized_items,
        success_url=success_url,
        cancel_url=cancel_url,
        locale=locale,
        metadata=safe_metadata,
        discounts=discounts_param,
    )
    session_obj = _create_checkout_session_object(session_kwargs)

    return _session_result(session_obj)


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


def _webhook_event_id(event: Any) -> str:
    event_id = str(event.get("id") or "").strip()
    if not event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing event id")
    return event_id


def _webhook_event_type(event: Any) -> str | None:
    return str(event.get("type") or "").strip() or None


def _new_webhook_record(
    *,
    event_id: str,
    event_type: str | None,
    now: datetime,
    payload_summary: dict[str, Any],
) -> StripeWebhookEvent:
    return StripeWebhookEvent(
        stripe_event_id=event_id,
        event_type=event_type,
        attempts=1,
        last_attempt_at=now,
        payload=payload_summary,
    )


async def _existing_webhook_record(session: AsyncSession, *, event_id: str) -> StripeWebhookEvent:
    result = await session.execute(
        select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id)
    )
    return result.scalar_one()


async def _persist_new_webhook_record(session: AsyncSession, record: StripeWebhookEvent) -> StripeWebhookEvent:
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def _update_existing_webhook_record(
    session: AsyncSession,
    *,
    event_id: str,
    event_type: str | None,
    payload_summary: dict[str, Any],
    now: datetime,
) -> StripeWebhookEvent:
    existing = await _existing_webhook_record(session, event_id=event_id)
    existing.attempts = int(getattr(existing, "attempts", 0) or 0) + 1
    existing.last_attempt_at = now
    existing.event_type = event_type or existing.event_type
    existing.payload = payload_summary or existing.payload
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    return existing


async def handle_webhook_event(session: AsyncSession, payload: bytes, sig_header: str | None) -> tuple[dict, StripeWebhookEvent]:
    secret = stripe_webhook_secret()
    if not _looks_configured(secret):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Webhook secret not set")
    init_stripe()
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, secret)
    except Exception as exc:  # broad for Stripe signature errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload") from exc

    event_id = _webhook_event_id(event)
    now = datetime.now(timezone.utc)
    event_type = _webhook_event_type(event)
    payload_summary = _stripe_event_payload_summary(event)

    record = _new_webhook_record(
        event_id=event_id,
        event_type=event_type,
        now=now,
        payload_summary=payload_summary,
    )
    try:
        return event, await _persist_new_webhook_record(session, record)
    except IntegrityError:
        await session.rollback()

    existing = await _update_existing_webhook_record(
        session,
        event_id=event_id,
        event_type=event_type,
        payload_summary=payload_summary,
        now=now,
    )
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
