from decimal import Decimal
from typing import Sequence
from uuid import UUID
import random
import string

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.cart import Cart
from app.models.order import Order, OrderItem, OrderStatus, ShippingMethod, OrderEvent
from app.schemas.order import OrderUpdate, ShippingMethodCreate
from app.services import payments


async def build_order_from_cart(
    session: AsyncSession,
    user_id: UUID,
    cart: Cart,
    shipping_address_id: UUID | None,
    billing_address_id: UUID | None,
    shipping_method: ShippingMethod | None = None,
    payment_intent_id: str | None = None,
    discount: Decimal | None = None,
) -> Order:
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

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
    taxable = subtotal - discount_val
    if taxable < 0:
        taxable = Decimal("0")
    tax = _calculate_tax(taxable)
    shipping_amount = _calculate_shipping(subtotal, shipping_method)
    total = taxable + tax + shipping_amount

    order = Order(
        user_id=user_id,
        reference_code=ref,
        total_amount=total,
        tax_amount=tax,
        shipping_amount=shipping_amount,
        currency="RON",
        shipping_address_id=shipping_address_id,
        billing_address_id=billing_address_id,
        items=items,
        shipping_method_id=shipping_method.id if shipping_method else None,
        stripe_payment_intent_id=payment_intent_id,
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
        )
        .order_by(Order.created_at.desc())
    )
    return result.scalars().all()


async def get_order(session: AsyncSession, user_id: UUID, order_id: UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .where(Order.user_id == user_id, Order.id == order_id)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.shipping_method),
            selectinload(Order.events),
            selectinload(Order.user),
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
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 20)))
    offset = (page - 1) * limit

    filters = []
    if status:
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
                func.lower(User.email).ilike(f"%{cleaned_q.lower()}%"),
                User.username.ilike(f"%{cleaned_q}%"),
            )
        )

    count_stmt = select(func.count()).select_from(Order).join(User, Order.user_id == User.id, isouter=True)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total_items = int((await session.execute(count_stmt)).scalar_one() or 0)

    stmt = (
        select(Order, User.email, User.username)
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
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .where(Order.id == order_id)
    )
    return result.scalar_one_or_none()


ALLOWED_TRANSITIONS = {
    OrderStatus.pending: {OrderStatus.paid, OrderStatus.cancelled},
    OrderStatus.paid: {OrderStatus.shipped, OrderStatus.refunded},
    OrderStatus.shipped: {OrderStatus.refunded},
    OrderStatus.cancelled: set(),
    OrderStatus.refunded: set(),
}


async def update_order(
    session: AsyncSession, order: Order, payload: OrderUpdate, shipping_method: ShippingMethod | None = None
) -> Order:
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"]:
        current_status = OrderStatus(order.status)
        next_status = OrderStatus(data["status"])
        if next_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")
        order.status = next_status
        data.pop("status")
        await _log_event(session, order.id, "status_change", f"{current_status.value} -> {next_status.value}")

    if shipping_method:
        order.shipping_method_id = shipping_method.id
        subtotal: Decimal = sum((Decimal(item.subtotal) for item in order.items), start=Decimal("0"))
        shipping_amount_dec = _calculate_shipping(subtotal, shipping_method)
        tax_amount_dec = _calculate_tax(subtotal)
        order.shipping_amount = float(shipping_amount_dec)
        order.tax_amount = float(tax_amount_dec)
        order.total_amount = float(subtotal + tax_amount_dec + shipping_amount_dec)

    for field, value in data.items():
        setattr(order, field, value)
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def _generate_reference_code(session: AsyncSession, length: int = 10) -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        candidate = "".join(random.choices(chars, k=length))
        result = await session.execute(select(Order).where(Order.reference_code == candidate))
        if not result.scalar_one_or_none():
            return candidate


def _calculate_tax(total: Decimal) -> Decimal:
    return total * Decimal("0.1")


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
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Retry only allowed for pending orders")
    order.payment_retry_count += 1
    await _log_event(session, order.id, "payment_retry", f"Attempt {order.payment_retry_count}")
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def refund_order(session: AsyncSession, order: Order, note: str | None = None) -> Order:
    if order.status not in {OrderStatus.paid, OrderStatus.shipped}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund allowed only for paid or shipped orders")
    previous = order.status
    order.status = OrderStatus.refunded
    await _log_event(session, order.id, "refund_requested", note or f"Manual refund requested from {previous.value}")
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def capture_payment(session: AsyncSession, order: Order, intent_id: str | None = None) -> Order:
    payment_intent_id = intent_id or order.stripe_payment_intent_id
    if not payment_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent id required")
    if order.status not in {OrderStatus.pending, OrderStatus.paid}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Capture only allowed for pending/paid orders")
    await payments.capture_payment_intent(payment_intent_id)
    order.stripe_payment_intent_id = payment_intent_id
    order.status = OrderStatus.paid
    await _log_event(session, order.id, "payment_captured", f"Intent {payment_intent_id}")
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def void_payment(session: AsyncSession, order: Order, intent_id: str | None = None) -> Order:
    payment_intent_id = intent_id or order.stripe_payment_intent_id
    if not payment_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent id required")
    if order.status not in {OrderStatus.pending, OrderStatus.paid}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Void only allowed for pending/paid orders")
    await payments.void_payment_intent(payment_intent_id)
    order.stripe_payment_intent_id = payment_intent_id
    order.status = OrderStatus.cancelled
    await _log_event(session, order.id, "payment_voided", f"Intent {payment_intent_id}")
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def _log_event(session: AsyncSession, order_id: UUID, event: str, note: str | None = None) -> None:
    evt = OrderEvent(order_id=order_id, event=event, note=note)
    session.add(evt)
    await session.commit()
