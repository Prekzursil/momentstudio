from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Sequence
from uuid import UUID
import random
import string
import re

from fastapi import HTTPException, status
from sqlalchemy import String, cast, exists, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.models.cart import Cart
from app.models.address import Address
from app.models.catalog import Product, ProductStatus
from app.models.order import (
    Order,
    OrderAdminNote,
    OrderEvent,
    OrderItem,
    OrderRefund,
    OrderStatus,
    OrderTag,
    ShippingMethod,
)
from app.schemas.order import OrderUpdate, ShippingMethodCreate
from app.schemas.order_admin_address import AdminOrderAddressesUpdate
from app.services import address as address_service
from app.services import checkout_settings as checkout_settings_service
from app.services import pricing
from app.services import payments
from app.services import paypal
from app.services import promo_usage


async def build_order_from_cart(
    session: AsyncSession,
    user_id: UUID | None,
    *,
    customer_email: str,
    customer_name: str,
    cart: Cart,
    shipping_address_id: UUID | None,
    billing_address_id: UUID | None,
    shipping_method: ShippingMethod | None = None,
    payment_method: str = "stripe",
    payment_intent_id: str | None = None,
    stripe_checkout_session_id: str | None = None,
    paypal_order_id: str | None = None,
    tax_amount: Decimal | None = None,
    fee_amount: Decimal | None = None,
    shipping_amount: Decimal | None = None,
    total_amount: Decimal | None = None,
    courier: str | None = None,
    delivery_type: str | None = None,
    locker_id: str | None = None,
    locker_name: str | None = None,
    locker_address: str | None = None,
    locker_lat: float | None = None,
    locker_lng: float | None = None,
    discount: Decimal | None = None,
    promo_code: str | None = None,
    invoice_company: str | None = None,
    invoice_vat_id: str | None = None,
) -> Order:
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    product_ids = {item.product_id for item in cart.items if getattr(item, "product_id", None)}
    if product_ids:
        result = await session.execute(
            select(Product.id, Product.status, Product.is_active, Product.is_deleted).where(Product.id.in_(product_ids))
        )
        rows = list(result.all())
        found = {row[0] for row in rows}
        missing = product_ids - found
        unavailable = [
            pid
            for (pid, status_value, is_active, is_deleted) in rows
            if is_deleted or not is_active or ProductStatus(status_value) != ProductStatus.published
        ]
        if missing or unavailable:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more cart items are unavailable")

    subtotal = Decimal("0.00")
    items: list[OrderItem] = []
    for item in cart.items:
        item_subtotal = Decimal(item.unit_price_at_add) * item.quantity
        subtotal += item_subtotal
        items.append(
            OrderItem(
                product_id=item.product_id,
                variant_id=item.variant_id,
                quantity=item.quantity,
                unit_price=item.unit_price_at_add,
                subtotal=item_subtotal,
            )
        )

    ref = await _generate_reference_code(session)
    discount_val = discount or Decimal("0")
    computed_fee = Decimal("0.00")
    computed_tax = Decimal("0.00")
    computed_shipping = Decimal("0.00")
    computed_total = Decimal("0.00")

    if tax_amount is not None and shipping_amount is not None and total_amount is not None:
        computed_fee = Decimal(fee_amount or 0)
        computed_tax = Decimal(tax_amount)
        computed_shipping = Decimal(shipping_amount)
        computed_total = Decimal(total_amount)
    else:
        checkout_settings = await checkout_settings_service.get_checkout_settings(session)
        taxable = subtotal - discount_val
        if taxable < 0:
            taxable = Decimal("0.00")
        computed_shipping = (
            Decimal(checkout_settings.shipping_fee_ron)
            if checkout_settings.shipping_fee_ron is not None
            else _calculate_shipping(subtotal, shipping_method)
        )
        threshold = checkout_settings.free_shipping_threshold_ron
        if threshold is not None and threshold >= 0 and taxable >= threshold:
            computed_shipping = Decimal("0.00")
        breakdown = pricing.compute_totals(
            subtotal=subtotal,
            discount=discount_val,
            shipping=computed_shipping,
            fee_enabled=checkout_settings.fee_enabled,
            fee_type=checkout_settings.fee_type,
            fee_value=checkout_settings.fee_value,
            vat_enabled=checkout_settings.vat_enabled,
            vat_rate_percent=checkout_settings.vat_rate_percent,
            vat_apply_to_shipping=checkout_settings.vat_apply_to_shipping,
            vat_apply_to_fee=checkout_settings.vat_apply_to_fee,
        )
        computed_fee = breakdown.fee
        computed_tax = breakdown.vat
        computed_shipping = breakdown.shipping
        computed_total = breakdown.total

    method = (payment_method or "").strip().lower()
    initial_status = (
        OrderStatus.pending_payment if method in {"stripe", "paypal", "netopia"} else OrderStatus.pending_acceptance
    )
    promo_clean = (promo_code or "").strip().upper() or None
    if promo_clean and len(promo_clean) > 40:
        promo_clean = promo_clean[:40]
    invoice_company_clean = (invoice_company or "").strip() or None
    if invoice_company_clean and len(invoice_company_clean) > 200:
        invoice_company_clean = invoice_company_clean[:200]
    invoice_vat_clean = (invoice_vat_id or "").strip() or None
    if invoice_vat_clean and len(invoice_vat_clean) > 64:
        invoice_vat_clean = invoice_vat_clean[:64]
    order = Order(
        user_id=user_id,
        reference_code=ref,
        customer_email=customer_email,
        customer_name=customer_name,
        status=initial_status,
        invoice_company=invoice_company_clean,
        invoice_vat_id=invoice_vat_clean,
        total_amount=computed_total,
        tax_amount=computed_tax,
        fee_amount=computed_fee,
        shipping_amount=computed_shipping,
        currency="RON",
        payment_method=payment_method,
        promo_code=promo_clean,
        courier=courier,
        delivery_type=delivery_type,
        locker_id=locker_id,
        locker_name=locker_name,
        locker_address=locker_address,
        locker_lat=locker_lat,
        locker_lng=locker_lng,
        shipping_address_id=shipping_address_id,
        billing_address_id=billing_address_id,
        items=items,
        shipping_method_id=shipping_method.id if shipping_method else None,
        stripe_payment_intent_id=payment_intent_id,
        stripe_checkout_session_id=stripe_checkout_session_id,
        paypal_order_id=paypal_order_id,
    )
    session.add(order)
    await session.commit()
    await session.refresh(order)
    await _log_event(session, order.id, "created", f"Reference {order.reference_code}")
    await session.refresh(order)
    await session.refresh(order, attribute_names=["items", "events", "shipping_method"])
    try:
        from app.core import metrics

        metrics.record_order_created()
    except Exception:
        # metrics should never break order creation
        pass
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def get_orders_for_user(session: AsyncSession, user_id: UUID) -> Sequence[Order]:
    result = await session.execute(
        select(Order)
        .where(Order.user_id == user_id)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .order_by(Order.created_at.desc())
    )
    return result.scalars().all()


async def search_orders_for_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    q: str | None = None,
    status: OrderStatus | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Order], int, int]:
    cleaned_q = (q or "").strip()
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 20)))
    offset = (page - 1) * limit

    filters: list[ColumnElement[bool]] = [Order.user_id == user_id]
    if status:
        filters.append(Order.status == status)
    if cleaned_q:
        pattern = f"%{cleaned_q}%"
        filters.append(or_(Order.reference_code.ilike(pattern), cast(Order.id, String).ilike(pattern)))
    if from_dt:
        filters.append(Order.created_at >= from_dt)
    if to_dt:
        filters.append(Order.created_at <= to_dt)

    total_items = (
        await session.execute(
            select(func.count()).select_from(Order).where(*filters),
        )
    ).scalar_one()

    pending_count = (
        await session.execute(
            select(func.count())
            .select_from(Order)
            .where(
                Order.user_id == user_id,
                Order.status.in_([OrderStatus.pending_payment, OrderStatus.pending_acceptance]),
            ),
        )
    ).scalar_one()

    result = await session.execute(
        select(Order)
        .where(*filters)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    orders = result.scalars().unique().all()
    return list(orders), int(total_items), int(pending_count)


async def get_order(session: AsyncSession, user_id: UUID, order_id: UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .where(Order.user_id == user_id, Order.id == order_id)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
    )
    return result.scalar_one_or_none()


async def list_orders(session: AsyncSession, status: OrderStatus | None = None, user_id: UUID | None = None) -> list[Order]:
    query = (
        select(Order)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .order_by(Order.created_at.desc())
    )
    if status:
        query = query.where(Order.status == status)
    if user_id:
        query = query.where(Order.user_id == user_id)
    result = await session.execute(query)
    return list(result.scalars().unique())


async def admin_search_orders(
    session: AsyncSession,
    *,
    q: str | None = None,
    status: OrderStatus | None = None,
    pending_any: bool = False,
    tag: str | None = None,
    from_dt=None,
    to_dt=None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[tuple[Order, str | None, str | None]], int]:
    """Paginated order search for the admin UI.

    Returns rows of (Order, customer_email, customer_username) plus total_items.
    """
    from app.models.user import User

    cleaned_q = (q or "").strip()
    tag_clean = _normalize_order_tag(tag) if tag is not None else None
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 20)))
    offset = (page - 1) * limit

    filters: list[ColumnElement[bool]] = []
    if tag_clean:
        filters.append(
            exists(select(OrderTag.id).where(OrderTag.order_id == Order.id, OrderTag.tag == tag_clean))
        )
    if pending_any:
        filters.append(Order.status.in_([OrderStatus.pending_payment, OrderStatus.pending_acceptance]))
    elif status:
        filters.append(Order.status == status)
    if from_dt:
        filters.append(Order.created_at >= from_dt)
    if to_dt:
        filters.append(Order.created_at <= to_dt)
    if cleaned_q:
        filters.append(
            or_(
                cast(Order.id, String).ilike(f"%{cleaned_q}%"),
                Order.reference_code.ilike(f"%{cleaned_q}%"),
                func.lower(Order.customer_email).ilike(f"%{cleaned_q.lower()}%"),
                func.lower(Order.customer_name).ilike(f"%{cleaned_q.lower()}%"),
                User.username.ilike(f"%{cleaned_q}%"),
            )
        )

    count_stmt = select(func.count()).select_from(Order).join(User, Order.user_id == User.id, isouter=True)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total_items = int((await session.execute(count_stmt)).scalar_one() or 0)

    stmt = (
        select(Order, Order.customer_email, User.username)
        .join(User, Order.user_id == User.id, isouter=True)
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if filters:
        stmt = stmt.where(*filters)

    result = await session.execute(stmt)
    raw_rows = result.all()
    rows: list[tuple[Order, str | None, str | None]] = [
        (order, email, username) for (order, email, username) in raw_rows
    ]
    return rows, total_items


async def get_order_by_id_admin(session: AsyncSession, order_id: UUID) -> Order | None:
    """Admin read: includes addresses plus items/events/user."""
    result = await session.execute(
        select(Order)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.refunds),
            selectinload(Order.admin_notes),
            selectinload(Order.tags),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .where(Order.id == order_id)
    )
    return result.scalar_one_or_none()


def _normalize_order_tag(tag: str | None) -> str | None:
    if tag is None:
        return None
    cleaned = re.sub(r"\s+", "_", str(tag).strip().lower())
    cleaned = re.sub(r"[^a-z0-9_-]", "", cleaned)
    cleaned = cleaned.strip("_-")
    return cleaned[:50] if cleaned else None


async def compute_fraud_signals(session: AsyncSession, order: Order) -> list[dict]:
    from app.core.config import settings

    signals: list[dict] = []

    now = datetime.now(timezone.utc)
    window_minutes = max(1, int(getattr(settings, "fraud_velocity_window_minutes", 60 * 24) or 60 * 24))
    threshold = max(2, int(getattr(settings, "fraud_velocity_threshold", 3) or 3))
    since = now - timedelta(minutes=window_minutes)

    email = (getattr(order, "customer_email", None) or "").strip().lower()
    if email:
        email_count = int(
            (
                await session.execute(
                    select(func.count())
                    .select_from(Order)
                    .where(func.lower(Order.customer_email) == email, Order.created_at >= since)
                )
            ).scalar_one()
            or 0
        )
        if email_count > 1:
            signals.append(
                {
                    "code": "velocity_email",
                    "severity": "high" if email_count >= threshold else "medium",
                    "data": {"count": email_count, "window_minutes": window_minutes},
                }
            )

    user_id = getattr(order, "user_id", None)
    if user_id:
        user_count = int(
            (
                await session.execute(
                    select(func.count()).select_from(Order).where(Order.user_id == user_id, Order.created_at >= since)
                )
            ).scalar_one()
            or 0
        )
        if user_count > 1:
            signals.append(
                {
                    "code": "velocity_user",
                    "severity": "high" if user_count >= threshold else "medium",
                    "data": {"count": user_count, "window_minutes": window_minutes},
                }
            )

    shipping_country = (getattr(getattr(order, "shipping_address", None), "country", None) or "").strip().upper()
    billing_country = (getattr(getattr(order, "billing_address", None), "country", None) or "").strip().upper()
    if shipping_country and billing_country and shipping_country != billing_country:
        signals.append(
            {
                "code": "country_mismatch",
                "severity": "low",
                "data": {"shipping_country": shipping_country, "billing_country": billing_country},
            }
        )

    retry_threshold = max(1, int(getattr(settings, "fraud_payment_retry_threshold", 2) or 2))
    retries = int(getattr(order, "payment_retry_count", 0) or 0)
    if retries > 0:
        signals.append(
            {
                "code": "payment_retries",
                "severity": "medium" if retries >= retry_threshold else "low",
                "data": {"count": retries},
            }
        )

    return signals


ALLOWED_TRANSITIONS = {
    OrderStatus.pending_payment: {OrderStatus.pending_acceptance, OrderStatus.cancelled},
    OrderStatus.pending_acceptance: {OrderStatus.paid, OrderStatus.cancelled},
    OrderStatus.paid: {OrderStatus.shipped, OrderStatus.refunded, OrderStatus.cancelled},
    OrderStatus.shipped: {OrderStatus.delivered, OrderStatus.refunded},
    OrderStatus.delivered: {OrderStatus.refunded},
    OrderStatus.cancelled: set(),
    OrderStatus.refunded: set(),
}


def _has_payment_captured(order: Order) -> bool:
    method = (getattr(order, "payment_method", None) or "").strip().lower()
    if method == "cod":
        return False
    if method == "paypal":
        return bool((getattr(order, "paypal_capture_id", None) or "").strip())
    if method == "stripe":
        return any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
    return False


def _address_snapshot(addr: Address | None) -> dict[str, object] | None:
    if not addr:
        return None
    return {
        "label": getattr(addr, "label", None),
        "phone": getattr(addr, "phone", None),
        "line1": getattr(addr, "line1", None),
        "line2": getattr(addr, "line2", None),
        "city": getattr(addr, "city", None),
        "region": getattr(addr, "region", None),
        "postal_code": getattr(addr, "postal_code", None),
        "country": getattr(addr, "country", None),
    }


async def _ensure_order_address_snapshot(session: AsyncSession, order: Order, kind: str) -> Address:
    if kind not in {"shipping", "billing"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid address kind")
    attr_name = f"{kind}_address"
    id_attr = f"{kind}_address_id"
    existing = getattr(order, attr_name, None)
    if not existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Order has no {kind} address")
    if getattr(existing, "user_id", None) is None:
        return existing

    snapshot = Address(
        user_id=None,
        label=getattr(existing, "label", None),
        phone=getattr(existing, "phone", None),
        line1=getattr(existing, "line1", None),
        line2=getattr(existing, "line2", None),
        city=getattr(existing, "city", None),
        region=getattr(existing, "region", None),
        postal_code=getattr(existing, "postal_code", None),
        country=getattr(existing, "country", None),
        is_default_shipping=False,
        is_default_billing=False,
    )
    session.add(snapshot)
    await session.flush()
    setattr(order, id_attr, snapshot.id)
    setattr(order, attr_name, snapshot)
    session.add(order)
    await session.flush()
    return snapshot


def _apply_address_update(addr: Address, updates: dict) -> None:
    forbidden = {"is_default_shipping", "is_default_billing", "user_id", "id", "created_at", "updated_at"}
    cleaned = {k: v for k, v in (updates or {}).items() if k not in forbidden}

    for field in ("line1", "city", "postal_code", "country"):
        if field in cleaned and (cleaned[field] is None or not str(cleaned[field]).strip()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} is required")

    target_country = str(cleaned.get("country", getattr(addr, "country", "")) or "").strip()
    target_postal = str(cleaned.get("postal_code", getattr(addr, "postal_code", "")) or "").strip()
    country, postal_code = address_service._validate_address_fields(target_country, target_postal)
    cleaned["country"] = country
    cleaned["postal_code"] = postal_code

    for field, value in cleaned.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(addr, field, value)
    addr.is_default_shipping = False
    addr.is_default_billing = False


async def _rerate_order_shipping(session: AsyncSession, order: Order) -> dict[str, dict[str, str]]:
    previous_shipping = pricing.quantize_money(Decimal(getattr(order, "shipping_amount", 0) or 0))
    previous_tax = pricing.quantize_money(Decimal(getattr(order, "tax_amount", 0) or 0))
    previous_total = pricing.quantize_money(Decimal(getattr(order, "total_amount", 0) or 0))

    taxable_subtotal = (
        Decimal(order.total_amount)
        - Decimal(order.shipping_amount)
        - Decimal(order.tax_amount)
        - Decimal(getattr(order, "fee_amount", 0) or 0)
    )
    if taxable_subtotal < 0:
        taxable_subtotal = Decimal("0.00")
    taxable_subtotal = pricing.quantize_money(taxable_subtotal)

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    shipping_amount = Decimal(checkout_settings.shipping_fee_ron)
    threshold = checkout_settings.free_shipping_threshold_ron
    if threshold is not None and threshold >= 0 and taxable_subtotal >= threshold:
        shipping_amount = Decimal("0.00")
    shipping_amount = pricing.quantize_money(shipping_amount)

    fee_amount = pricing.quantize_money(Decimal(getattr(order, "fee_amount", 0) or 0))
    vat_amount = pricing.compute_vat(
        taxable_subtotal=taxable_subtotal,
        shipping=shipping_amount,
        fee=fee_amount,
        enabled=checkout_settings.vat_enabled,
        vat_rate_percent=checkout_settings.vat_rate_percent,
        apply_to_shipping=checkout_settings.vat_apply_to_shipping,
        apply_to_fee=checkout_settings.vat_apply_to_fee,
    )

    order.shipping_amount = shipping_amount
    order.tax_amount = vat_amount
    order.total_amount = pricing.quantize_money(taxable_subtotal + fee_amount + shipping_amount + vat_amount)

    return {
        "shipping_amount": {"from": str(previous_shipping), "to": str(order.shipping_amount)},
        "tax_amount": {"from": str(previous_tax), "to": str(order.tax_amount)},
        "total_amount": {"from": str(previous_total), "to": str(order.total_amount)},
    }


async def update_order(
    session: AsyncSession, order: Order, payload: OrderUpdate, shipping_method: ShippingMethod | None = None
) -> Order:
    data = payload.model_dump(exclude_unset=True)
    explicit_status = bool(data.get("status"))
    previous_tracking_number = getattr(order, "tracking_number", None)
    previous_tracking_url = getattr(order, "tracking_url", None)
    previous_courier = getattr(order, "courier", None)
    previous_shipping_method_name = getattr(getattr(order, "shipping_method", None), "name", None)
    cancel_reason = data.pop("cancel_reason", None)
    cancel_reason_clean: str | None
    if cancel_reason is None:
        cancel_reason_clean = None
    else:
        cancel_reason_clean = (str(cancel_reason) if cancel_reason is not None else "").strip()
        if cancel_reason_clean:
            cancel_reason_clean = cancel_reason_clean[:2000]
    if "status" in data and data["status"]:
        current_status = OrderStatus(order.status)
        next_status = OrderStatus(data["status"])
        payment_method = (getattr(order, "payment_method", None) or "").strip().lower()
        if (
            current_status == OrderStatus.pending_acceptance
            and next_status == OrderStatus.paid
            and payment_method in {"stripe", "paypal"}
        ):
            if not _has_payment_captured(order):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payment is not captured yet. Wait for payment confirmation before accepting the order.",
                )
        if next_status == OrderStatus.cancelled and current_status in {
            OrderStatus.pending_payment,
            OrderStatus.pending_acceptance,
            OrderStatus.paid,
        }:
            if cancel_reason_clean is None or not cancel_reason_clean:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason is required")
        allowed = ALLOWED_TRANSITIONS.get(current_status, set())
        if next_status not in allowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")
        order.status = next_status
        data.pop("status")
        await _log_event(
            session,
            order.id,
            "status_change",
            f"{current_status.value} -> {next_status.value}",
            data={"changes": {"status": {"from": current_status.value, "to": next_status.value}}},
        )

    if cancel_reason_clean is not None:
        if not cancel_reason_clean:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason is required")
        if order.status != OrderStatus.cancelled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason can only be set for cancelled orders")
        previous_reason = (getattr(order, "cancel_reason", None) or "").strip()
        if previous_reason != cancel_reason_clean:
            order.cancel_reason = cancel_reason_clean
            session.add(order)
            session.add(
                OrderEvent(
                    order_id=order.id,
                    event="cancel_reason_updated",
                    note="Updated",
                    data={
                        "changes": {
                            "cancel_reason": {
                                "from": previous_reason or None,
                                "to": cancel_reason_clean,
                            }
                        }
                    },
                )
            )

    if shipping_method:
        order.shipping_method_id = shipping_method.id
        if previous_shipping_method_name != shipping_method.name:
            session.add(
                OrderEvent(
                    order_id=order.id,
                    event="shipping_method_updated",
                    note=f"{previous_shipping_method_name or '—'} -> {shipping_method.name}",
                    data={
                        "changes": {
                            "shipping_method": {
                                "from": previous_shipping_method_name,
                                "to": shipping_method.name,
                            }
                        }
                    },
                )
            )
        taxable_subtotal = (
            Decimal(order.total_amount)
            - Decimal(order.shipping_amount)
            - Decimal(order.tax_amount)
            - Decimal(getattr(order, "fee_amount", 0) or 0)
        )
        if taxable_subtotal < 0:
            taxable_subtotal = Decimal("0.00")
        taxable_subtotal = pricing.quantize_money(taxable_subtotal)

        checkout_settings = await checkout_settings_service.get_checkout_settings(session)
        shipping_amount = Decimal(checkout_settings.shipping_fee_ron)
        threshold = checkout_settings.free_shipping_threshold_ron
        if threshold is not None and threshold >= 0 and taxable_subtotal >= threshold:
            shipping_amount = Decimal("0.00")
        shipping_amount = pricing.quantize_money(shipping_amount)

        fee_amount = pricing.quantize_money(Decimal(getattr(order, "fee_amount", 0) or 0))
        vat_amount = pricing.compute_vat(
            taxable_subtotal=taxable_subtotal,
            shipping=shipping_amount,
            fee=fee_amount,
            enabled=checkout_settings.vat_enabled,
            vat_rate_percent=checkout_settings.vat_rate_percent,
            apply_to_shipping=checkout_settings.vat_apply_to_shipping,
            apply_to_fee=checkout_settings.vat_apply_to_fee,
        )

        order.shipping_amount = shipping_amount
        order.tax_amount = vat_amount
        order.total_amount = pricing.quantize_money(taxable_subtotal + fee_amount + shipping_amount + vat_amount)

    for field, value in data.items():
        setattr(order, field, value)

    tracking_changes: dict[str, dict[str, object]] = {}
    if "tracking_number" in data and getattr(order, "tracking_number", None) != previous_tracking_number:
        tracking_changes["tracking_number"] = {"from": previous_tracking_number, "to": getattr(order, "tracking_number", None)}
    if "tracking_url" in data and getattr(order, "tracking_url", None) != previous_tracking_url:
        tracking_changes["tracking_url"] = {"from": previous_tracking_url, "to": getattr(order, "tracking_url", None)}
    if tracking_changes:
        session.add(
            OrderEvent(
                order_id=order.id,
                event="tracking_updated",
                note=None,
                data={"changes": tracking_changes},
            )
        )

    if "courier" in data and getattr(order, "courier", None) != previous_courier:
        session.add(
            OrderEvent(
                order_id=order.id,
                event="courier_updated",
                note=None,
                data={
                    "changes": {
                        "courier": {
                            "from": previous_courier,
                            "to": getattr(order, "courier", None),
                        }
                    }
                },
            )
        )

    tracking_in_payload = any(
        (str(data.get(key) or "").strip() for key in ("tracking_number", "tracking_url"))
    )
    if (
        not explicit_status
        and tracking_in_payload
        and order.status == OrderStatus.paid
    ):
        previous = OrderStatus(order.status)
        order.status = OrderStatus.shipped
        await _log_event(
            session,
            order.id,
            "status_auto_ship",
            f"{previous.value} -> {OrderStatus.shipped.value}",
            data={"changes": {"status": {"from": previous.value, "to": OrderStatus.shipped.value}}},
        )
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def update_order_addresses(
    session: AsyncSession,
    order: Order,
    payload: AdminOrderAddressesUpdate,
    *,
    actor: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    if order.status in {OrderStatus.shipped, OrderStatus.delivered, OrderStatus.cancelled, OrderStatus.refunded}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order addresses cannot be edited in this status")

    await session.refresh(order, attribute_names=["shipping_address", "billing_address", "items"])

    changes: dict[str, object] = {}
    shipping_updates = payload.shipping_address.model_dump(exclude_unset=True) if payload.shipping_address else {}
    billing_updates = payload.billing_address.model_dump(exclude_unset=True) if payload.billing_address else {}

    if not shipping_updates and not billing_updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No address updates provided")

    if shipping_updates:
        previous = _address_snapshot(getattr(order, "shipping_address", None))
        addr = await _ensure_order_address_snapshot(session, order, "shipping")
        _apply_address_update(addr, shipping_updates)
        changes["shipping_address"] = {"from": previous, "to": _address_snapshot(addr)}
        session.add(addr)

    if billing_updates:
        previous = _address_snapshot(getattr(order, "billing_address", None))
        addr = await _ensure_order_address_snapshot(session, order, "billing")
        _apply_address_update(addr, billing_updates)
        changes["billing_address"] = {"from": previous, "to": _address_snapshot(addr)}
        session.add(addr)

    if payload.rerate_shipping and shipping_updates:
        if _has_payment_captured(order):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot re-rate shipping after payment capture")
        amount_changes = await _rerate_order_shipping(session, order)
        changes.update(amount_changes)

    note_clean = (payload.note or "").strip() or None
    actor_clean = (actor or "").strip() or None
    note = f"{actor_clean}: {note_clean}" if actor_clean and note_clean else (actor_clean or note_clean)
    session.add(OrderEvent(order_id=order.id, event="addresses_updated", note=note, data={"changes": changes, "actor_user_id": str(actor_user_id) if actor_user_id else None}))

    session.add(order)
    await session.commit()

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def add_admin_note(session: AsyncSession, order: Order, *, note: str, actor_user_id: UUID | None = None) -> Order:
    note_clean = (note or "").strip()
    if not note_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Note is required")
    note_clean = note_clean[:5000]

    session.add(OrderAdminNote(order_id=order.id, actor_user_id=actor_user_id, note=note_clean))
    await session.commit()

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def list_order_tags(session: AsyncSession) -> list[str]:
    result = await session.execute(select(OrderTag.tag).distinct().order_by(OrderTag.tag))
    return [row[0] for row in result.all() if row and row[0]]


async def add_order_tag(session: AsyncSession, order: Order, *, tag: str, actor_user_id: UUID | None = None) -> Order:
    tag_clean = _normalize_order_tag(tag)
    if not tag_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag is required")

    existing = (
        await session.execute(select(OrderTag).where(OrderTag.order_id == order.id, OrderTag.tag == tag_clean))
    ).scalar_one_or_none()
    if existing:
        hydrated = await get_order_by_id_admin(session, order.id)
        return hydrated or order

    session.add(OrderTag(order_id=order.id, actor_user_id=actor_user_id, tag=tag_clean))
    session.add(OrderEvent(order_id=order.id, event="tag_added", note=tag_clean, data={"tag": tag_clean}))
    await session.commit()

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def remove_order_tag(session: AsyncSession, order: Order, *, tag: str, actor_user_id: UUID | None = None) -> Order:
    tag_clean = _normalize_order_tag(tag)
    if not tag_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag is required")

    existing = (
        await session.execute(select(OrderTag).where(OrderTag.order_id == order.id, OrderTag.tag == tag_clean))
    ).scalar_one_or_none()
    if not existing:
        hydrated = await get_order_by_id_admin(session, order.id)
        return hydrated or order

    await session.delete(existing)
    session.add(OrderEvent(order_id=order.id, event="tag_removed", note=tag_clean, data={"tag": tag_clean}))
    await session.commit()

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def _generate_reference_code(session: AsyncSession, length: int = 10) -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        candidate = "".join(random.choices(chars, k=length))
        result = await session.execute(select(Order).where(Order.reference_code == candidate))
        if not result.scalar_one_or_none():
            return candidate


def _calculate_shipping(subtotal: Decimal, method: ShippingMethod | None) -> Decimal:
    if not method:
        return Decimal("0")
    base = Decimal(method.rate_flat or 0)
    # simplistic: rate_per_kg applied on subtotal as proxy
    return base + Decimal(method.rate_per_kg or 0) * subtotal


async def create_shipping_method(session: AsyncSession, payload: ShippingMethodCreate) -> ShippingMethod:
    method = ShippingMethod(**payload.model_dump())
    session.add(method)
    await session.commit()
    await session.refresh(method)
    return method


async def get_shipping_method(session: AsyncSession, method_id: UUID) -> ShippingMethod | None:
    return await session.get(ShippingMethod, method_id)


async def list_shipping_methods(session: AsyncSession) -> list[ShippingMethod]:
    result = await session.execute(select(ShippingMethod).order_by(ShippingMethod.created_at.desc()))
    return list(result.scalars().unique())


async def get_order_by_id(session: AsyncSession, order_id: UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .where(Order.id == order_id)
    )
    return result.scalar_one_or_none()


async def update_fulfillment(session: AsyncSession, order: Order, item_id: UUID, shipped_quantity: int) -> Order:
    item = next((i for i in order.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order item not found")
    if shipped_quantity > item.quantity:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shipped quantity exceeds ordered")
    item.shipped_quantity = shipped_quantity
    session.add(item)
    await session.commit()
    await session.refresh(order, attribute_names=["items"])
    await _log_event(session, order.id, "fulfillment_update", f"Item {item_id} shipped {shipped_quantity}")
    await session.refresh(order)
    await session.refresh(order, attribute_names=["events"])
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def retry_payment(session: AsyncSession, order: Order) -> Order:
    if order.status != OrderStatus.pending_payment:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Retry only allowed for pending_payment orders")
    order.payment_retry_count += 1
    await _log_event(session, order.id, "payment_retry", f"Attempt {order.payment_retry_count}")
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def refund_order(session: AsyncSession, order: Order, note: str | None = None) -> Order:
    if order.status not in {OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund allowed only for paid/shipped/delivered orders")
    previous = order.status
    order.status = OrderStatus.refunded
    await _log_event(session, order.id, "refund_requested", note or f"Manual refund requested from {previous.value}")
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def create_order_refund(
    session: AsyncSession,
    order: Order,
    *,
    amount: Decimal,
    note: str,
    items: list[tuple[UUID, int]] | None = None,
    process_payment: bool = False,
    actor: str | None = None,
) -> Order:
    if order.status not in {OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund allowed only for paid/shipped/delivered orders")

    await session.refresh(order, attribute_names=["refunds", "items"])
    already_refunded = sum((Decimal(r.amount) for r in (order.refunds or [])), Decimal("0.00"))
    total_amount = pricing.quantize_money(Decimal(order.total_amount))
    remaining = pricing.quantize_money(total_amount - already_refunded)
    if remaining <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order already fully refunded")

    amount_q = pricing.quantize_money(Decimal(amount))
    if amount_q <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid refund amount")
    if amount_q > remaining:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund amount exceeds remaining refundable")

    note_clean = (note or "").strip()
    if not note_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund note is required")
    note_clean = note_clean[:2000]

    selected_items: list[dict] = []
    if items:
        items_by_id = {it.id: it for it in (order.items or [])}
        for item_id, qty in items:
            q = int(qty or 0)
            if q <= 0:
                continue
            order_item = items_by_id.get(item_id)
            if not order_item:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order item")
            if q > int(order_item.quantity):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid refund quantity")
            selected_items.append({"order_item_id": str(order_item.id), "quantity": q})

    provider = "manual"
    provider_refund_id: str | None = None

    if process_payment:
        method = (getattr(order, "payment_method", None) or "").strip().lower()
        if method == "stripe":
            payment_intent_id = (getattr(order, "stripe_payment_intent_id", None) or "").strip()
            if not payment_intent_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stripe payment intent id required")
            cents = int((amount_q * 100).to_integral_value(rounding=ROUND_HALF_UP))
            refund = await payments.refund_payment_intent(payment_intent_id, amount_cents=cents)
            provider = "stripe"
            provider_refund_id = refund.get("id") if isinstance(refund, dict) else None
        elif method == "paypal":
            capture_id = (getattr(order, "paypal_capture_id", None) or "").strip()
            if not capture_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PayPal capture id required")
            provider = "paypal"
            provider_refund_id = (await paypal.refund_capture(paypal_capture_id=capture_id, amount_ron=amount_q)) or None
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Automatic refunds not supported for this payment method")

    record = OrderRefund(
        order_id=order.id,
        amount=amount_q,
        currency=order.currency,
        provider=provider,
        provider_refund_id=provider_refund_id,
        note=note_clean,
        data={
            "items": selected_items,
            "actor": actor,
            "process_payment": bool(process_payment),
        }
        if (selected_items or actor or process_payment)
        else None,
    )
    session.add(record)

    prefix = (actor or "").strip()
    event_note = f"{amount_q} {order.currency} ({provider}{' ' + provider_refund_id if provider_refund_id else ''})"
    if prefix:
        event_note = f"{prefix}: {event_note}"
    if note_clean:
        event_note = f"{event_note} - {note_clean}"
    session.add(OrderEvent(order_id=order.id, event="refund_partial", note=event_note[:2000]))

    remaining_after = pricing.quantize_money(total_amount - (already_refunded + amount_q))
    if remaining_after <= 0 and order.status != OrderStatus.refunded:
        previous = OrderStatus(order.status)
        order.status = OrderStatus.refunded
        session.add(OrderEvent(order_id=order.id, event="status_change", note=f"{previous.value} -> refunded"))
        session.add(OrderEvent(order_id=order.id, event="refund_completed", note="Order fully refunded via partial refunds"))
        session.add(order)

    await session.commit()
    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def capture_payment(session: AsyncSession, order: Order, intent_id: str | None = None) -> Order:
    payment_intent_id = intent_id or order.stripe_payment_intent_id
    if not payment_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent id required")
    if (
        intent_id
        and (getattr(order, "stripe_payment_intent_id", None) or "").strip()
        and intent_id != (getattr(order, "stripe_payment_intent_id", None) or "").strip()
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent mismatch")
    if order.status not in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Capture only allowed for pending_payment, pending_acceptance, or paid orders",
        )
    order.stripe_payment_intent_id = payment_intent_id
    await session.refresh(order, attribute_names=["events"])
    already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
    if not already_captured:
        await payments.capture_payment_intent(payment_intent_id)
        session.add(OrderEvent(order_id=order.id, event="payment_captured", note=f"Intent {payment_intent_id}"))
        await promo_usage.record_promo_usage(session, order=order, note=f"Stripe {payment_intent_id}".strip())
    if order.status == OrderStatus.pending_payment:
        order.status = OrderStatus.pending_acceptance
        session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def void_payment(session: AsyncSession, order: Order, intent_id: str | None = None) -> Order:
    payment_intent_id = intent_id or order.stripe_payment_intent_id
    if not payment_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent id required")
    if (
        intent_id
        and (getattr(order, "stripe_payment_intent_id", None) or "").strip()
        and intent_id != (getattr(order, "stripe_payment_intent_id", None) or "").strip()
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent mismatch")
    if order.status not in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Void only allowed for pending_payment, pending_acceptance, or paid orders",
        )
    event = "payment_voided"
    note = f"Intent {payment_intent_id}"
    try:
        await payments.void_payment_intent(payment_intent_id)
    except HTTPException:
        # If the intent is already captured, cancel will fail. Fall back to a best-effort refund.
        refund = await payments.refund_payment_intent(payment_intent_id)
        refund_id = refund.get("id") if isinstance(refund, dict) else None
        event = "payment_refunded"
        note = f"Stripe refund {refund_id}".strip() if refund_id else "Stripe refund"
    order.stripe_payment_intent_id = payment_intent_id
    order.status = OrderStatus.cancelled
    if not (getattr(order, "cancel_reason", None) or "").strip():
        order.cancel_reason = "Cancelled via payment void/refund."
    await _log_event(session, order.id, event, note)
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def _log_event(
    session: AsyncSession, order_id: UUID, event: str, note: str | None = None, data: dict | None = None
) -> None:
    evt = OrderEvent(order_id=order_id, event=event, note=note, data=data)
    session.add(evt)
    await session.commit()
