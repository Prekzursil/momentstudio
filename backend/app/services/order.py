from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from typing import Sequence
from uuid import UUID
import random
import string
import re

from fastapi import HTTPException, status
from sqlalchemy import String, and_, case, cast, exists, func, literal, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.models.cart import Cart
from app.models.address import Address
from app.models.catalog import Product, ProductStatus, ProductVariant
from app.models.order import (
    Order,
    OrderAdminNote,
    OrderEvent,
    OrderItem,
    OrderRefund,
    OrderShipment,
    OrderStatus,
    OrderTag,
    ShippingMethod,
)
from app.schemas.order import OrderUpdate, ShippingMethodCreate
from app.schemas.order_admin_address import AdminOrderAddressesUpdate
from app.schemas.order_shipment import OrderShipmentCreate, OrderShipmentUpdate
from app.services import address as address_service
from app.services import checkout_settings as checkout_settings_service
from app.services import tracking as tracking_service
from app.services import pricing
from app.services import taxes as taxes_service
from app.services.taxes import TaxableProductLine
from app.services import payments
from app.services import paypal
from app.services import promo_usage


_ORDER_STOCK_COMMIT_EVENT = "stock_committed"
_ORDER_STOCK_RESTORE_EVENT = "stock_restored"


async def _commit_stock_for_order(session: AsyncSession, order: Order) -> None:
    # Serialize stock adjustments per-order so concurrent status updates can't double-deduct inventory.
    await session.execute(select(Order.id).where(Order.id == order.id).with_for_update())

    existing = (
        (
            await session.execute(
                select(OrderEvent.id).where(
                    OrderEvent.order_id == order.id,
                    OrderEvent.event == _ORDER_STOCK_COMMIT_EVENT,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing:
        return

    items: list[OrderItem] = list(getattr(order, "items", []) or [])
    if not items:
        await session.refresh(order, attribute_names=["items"])
        items = list(getattr(order, "items", []) or [])
    if not items:
        return

    qty_by_key: dict[tuple[UUID, UUID | None], int] = defaultdict(int)
    for item in items:
        product_id = getattr(item, "product_id", None)
        if not product_id:
            continue
        qty = int(getattr(item, "quantity", 0) or 0)
        if qty <= 0:
            continue
        qty_by_key[(product_id, getattr(item, "variant_id", None))] += qty

    if not qty_by_key:
        return

    product_ids = {pid for pid, vid in qty_by_key.keys() if vid is None}
    variant_ids = {vid for _, vid in qty_by_key.keys() if vid is not None}

    products: dict[UUID, Product] = {}
    if product_ids:
        products = {
            p.id: p
            for p in (
                (
                    await session.execute(
                        select(Product).where(Product.id.in_(product_ids)).with_for_update()
                    )
                )
                .scalars()
                .all()
            )
        }

    variants: dict[UUID, ProductVariant] = {}
    if variant_ids:
        variants = {
            v.id: v
            for v in (
                (
                    await session.execute(
                        select(ProductVariant).where(ProductVariant.id.in_(variant_ids)).with_for_update()
                    )
                )
                .scalars()
                .all()
            )
        }

    lines: list[dict[str, object]] = []
    for (product_id, variant_id), qty in qty_by_key.items():
        if variant_id:
            variant = variants.get(variant_id)
            if not variant:
                continue
            before = int(getattr(variant, "stock_quantity", 0) or 0)
            after = max(0, before - qty)
            variant.stock_quantity = after
            session.add(variant)
            deducted = before - after
            lines.append(
                {
                    "product_id": str(product_id),
                    "variant_id": str(variant_id),
                    "requested_qty": int(qty),
                    "deducted_qty": int(deducted),
                    "shortage_qty": int(max(0, qty - deducted)),
                    "before": int(before),
                    "after": int(after),
                }
            )
            continue

        product = products.get(product_id)
        if not product:
            continue
        before = int(getattr(product, "stock_quantity", 0) or 0)
        after = max(0, before - qty)
        product.stock_quantity = after
        session.add(product)
        deducted = before - after
        lines.append(
            {
                "product_id": str(product_id),
                "variant_id": None,
                "requested_qty": int(qty),
                "deducted_qty": int(deducted),
                "shortage_qty": int(max(0, qty - deducted)),
                "before": int(before),
                "after": int(after),
            }
        )

    if not lines:
        return

    session.add(
        OrderEvent(
            order_id=order.id,
            event=_ORDER_STOCK_COMMIT_EVENT,
            note=None,
            data={"lines": lines},
        )
    )


def _try_uuid(value: object) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except Exception:
        return None


async def _restore_stock_for_order(session: AsyncSession, order: Order) -> None:
    # Serialize stock adjustments per-order so concurrent cancellations can't double-restock inventory.
    await session.execute(select(Order.id).where(Order.id == order.id).with_for_update())

    already_restored = (
        (
            await session.execute(
                select(OrderEvent.id).where(
                    OrderEvent.order_id == order.id,
                    OrderEvent.event == _ORDER_STOCK_RESTORE_EVENT,
                )
            )
        )
        .scalars()
        .first()
    )
    if already_restored:
        return

    committed = (
        (
            await session.execute(
                select(OrderEvent).where(
                    OrderEvent.order_id == order.id,
                    OrderEvent.event == _ORDER_STOCK_COMMIT_EVENT,
                )
            )
        )
        .scalars()
        .first()
    )
    if not committed:
        return

    data = getattr(committed, "data", None) or {}
    raw_lines = data.get("lines") if isinstance(data, dict) else None
    if not isinstance(raw_lines, list):
        return

    restore_by_key: dict[tuple[UUID, UUID | None], int] = defaultdict(int)
    for raw in raw_lines:
        if not isinstance(raw, dict):
            continue
        product_id = _try_uuid(raw.get("product_id"))
        if not product_id:
            continue
        variant_id = _try_uuid(raw.get("variant_id")) if raw.get("variant_id") else None
        try:
            deducted_qty = int(raw.get("deducted_qty") or 0)
        except Exception:
            deducted_qty = 0
        if deducted_qty <= 0:
            continue
        restore_by_key[(product_id, variant_id)] += deducted_qty

    if not restore_by_key:
        return

    product_ids = {pid for pid, vid in restore_by_key.keys() if vid is None}
    variant_ids = {vid for _, vid in restore_by_key.keys() if vid is not None}

    products: dict[UUID, Product] = {}
    if product_ids:
        products = {
            p.id: p
            for p in (
                (
                    await session.execute(
                        select(Product).where(Product.id.in_(product_ids)).with_for_update()
                    )
                )
                .scalars()
                .all()
            )
        }

    variants: dict[UUID, ProductVariant] = {}
    if variant_ids:
        variants = {
            v.id: v
            for v in (
                (
                    await session.execute(
                        select(ProductVariant).where(ProductVariant.id.in_(variant_ids)).with_for_update()
                    )
                )
                .scalars()
                .all()
            )
        }

    restored_lines: list[dict[str, object]] = []
    for (product_id, variant_id), qty in restore_by_key.items():
        if variant_id:
            variant = variants.get(variant_id)
            if not variant:
                continue
            before = int(getattr(variant, "stock_quantity", 0) or 0)
            after = before + int(qty)
            variant.stock_quantity = after
            session.add(variant)
            restored_lines.append(
                {
                    "product_id": str(product_id),
                    "variant_id": str(variant_id),
                    "restored_qty": int(qty),
                    "before": int(before),
                    "after": int(after),
                }
            )
            continue

        product = products.get(product_id)
        if not product:
            continue
        before = int(getattr(product, "stock_quantity", 0) or 0)
        after = before + int(qty)
        product.stock_quantity = after
        session.add(product)
        restored_lines.append(
            {
                "product_id": str(product_id),
                "variant_id": None,
                "restored_qty": int(qty),
                "before": int(before),
                "after": int(after),
            }
        )

    if not restored_lines:
        return

    session.add(
        OrderEvent(
            order_id=order.id,
            event=_ORDER_STOCK_RESTORE_EVENT,
            note=None,
            data={"lines": restored_lines, "committed_event_id": str(getattr(committed, "id", "") or "") or None},
        )
    )


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
    stripe_checkout_url: str | None = None,
    paypal_order_id: str | None = None,
    paypal_approval_url: str | None = None,
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

    qty_by_key: dict[tuple[UUID, UUID | None], int] = defaultdict(int)
    product_ids: set[UUID] = set()
    variant_ids: set[UUID] = set()
    for item in cart.items:
        product_id = getattr(item, "product_id", None)
        if not product_id:
            continue
        quantity = int(getattr(item, "quantity", 0) or 0)
        if quantity <= 0:
            continue
        product_ids.add(product_id)
        variant_id = getattr(item, "variant_id", None)
        if variant_id:
            variant_ids.add(variant_id)
        qty_by_key[(product_id, variant_id)] += quantity

    products_by_id: dict[UUID, Product] = {}
    if product_ids:
        rows = (
            (
                await session.execute(
                    select(Product)
                    .where(Product.id.in_(product_ids))
                    .order_by(Product.id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        products_by_id = {p.id: p for p in rows}
        missing = product_ids - set(products_by_id.keys())
        unavailable = [
            pid
            for pid, prod in products_by_id.items()
            if getattr(prod, "is_deleted", False)
            or not bool(getattr(prod, "is_active", True))
            or getattr(prod, "status", None) != ProductStatus.published
        ]
        if missing or unavailable:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more cart items are unavailable")

    variants_by_id: dict[UUID, ProductVariant] = {}
    if variant_ids:
        variant_rows = (
            (
                await session.execute(
                    select(ProductVariant)
                    .where(ProductVariant.id.in_(variant_ids))
                    .order_by(ProductVariant.id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        variants_by_id = {v.id: v for v in variant_rows}
        missing_variants = variant_ids - set(variants_by_id.keys())
        if missing_variants:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")

    if qty_by_key:
        open_statuses = {OrderStatus.pending_payment, OrderStatus.pending_acceptance}
        reserved_expr = case(
            (
                OrderItem.quantity > OrderItem.shipped_quantity,
                OrderItem.quantity - OrderItem.shipped_quantity,
            ),
            else_=0,
        )
        reserved_stmt = (
            select(
                OrderItem.product_id,
                OrderItem.variant_id,
                func.coalesce(func.sum(reserved_expr), 0).label("qty"),
            )
            .select_from(OrderItem)
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.status.in_(open_statuses), OrderItem.product_id.in_(product_ids))
            .group_by(OrderItem.product_id, OrderItem.variant_id)
        )
        reserved_rows = (await session.execute(reserved_stmt)).all()
        reserved_by_key: dict[tuple[UUID, UUID | None], int] = {
            (row[0], row[1]): int(row[2] or 0) for row in reserved_rows
        }

        for (product_id, variant_id), quantity in qty_by_key.items():
            product = products_by_id.get(product_id)
            if not product:
                continue
            if bool(getattr(product, "allow_backorder", False)):
                continue

            reserved_qty = int(reserved_by_key.get((product_id, variant_id), 0) or 0)
            if variant_id:
                variant = variants_by_id.get(variant_id)
                if not variant or getattr(variant, "product_id", None) != product_id:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")
                stock_qty = int(getattr(variant, "stock_quantity", 0) or 0)
            else:
                stock_qty = int(getattr(product, "stock_quantity", 0) or 0)
            available_qty = stock_qty - reserved_qty
            if quantity > available_qty:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient stock")

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
            rounding=checkout_settings.money_rounding,
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
        stripe_checkout_url=(stripe_checkout_url or "").strip() or None,
        paypal_order_id=paypal_order_id,
        paypal_approval_url=(paypal_approval_url or "").strip() or None,
    )
    session.add(order)
    await session.flush()
    cart.last_order_id = order.id
    session.add(cart)
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
    user_id: UUID | None = None,
    status: OrderStatus | None = None,
    statuses: list[OrderStatus] | None = None,
    pending_any: bool = False,
    tag: str | None = None,
    sla: str | None = None,
    fraud: str | None = None,
    include_test: bool = True,
    from_dt=None,
    to_dt=None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[tuple[Order, str | None, str | None, str | None, datetime | None, bool, str | None]], int]:
    """Paginated order search for the admin UI.

    Returns rows of (Order, customer_email, customer_username, sla_kind, sla_started_at, fraud_flagged, fraud_severity) plus total_items.
    """
    from app.models.user import User
    from app.core.config import settings

    cleaned_q = (q or "").strip()
    tag_clean = _normalize_order_tag(tag) if tag is not None else None
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 20)))
    offset = (page - 1) * limit

    sla_clean = (sla or "").strip().lower() or None
    fraud_clean = (fraud or "").strip().lower() or None
    now = datetime.now(timezone.utc)
    accept_hours = max(1, int(getattr(settings, "order_sla_accept_hours", 24) or 24))
    ship_hours = max(1, int(getattr(settings, "order_sla_ship_hours", 48) or 48))
    accept_cutoff = now - timedelta(hours=accept_hours)
    ship_cutoff = now - timedelta(hours=ship_hours)

    window_minutes = max(1, int(getattr(settings, "fraud_velocity_window_minutes", 60 * 24) or 60 * 24))
    threshold = max(2, int(getattr(settings, "fraud_velocity_threshold", 3) or 3))
    retry_threshold = max(1, int(getattr(settings, "fraud_payment_retry_threshold", 2) or 2))
    fraud_since = now - timedelta(minutes=window_minutes)

    entered_pending_acceptance_at = (
        select(func.max(OrderEvent.created_at))
        .where(
            OrderEvent.order_id == Order.id,
            OrderEvent.event == "status_change",
            OrderEvent.note.is_not(None),
            OrderEvent.note.like("% -> pending_acceptance"),
        )
        .correlate(Order)
        .scalar_subquery()
    )
    entered_paid_at = (
        select(func.max(OrderEvent.created_at))
        .where(
            OrderEvent.order_id == Order.id,
            OrderEvent.event == "status_change",
            OrderEvent.note.is_not(None),
            OrderEvent.note.like("% -> paid"),
        )
        .correlate(Order)
        .scalar_subquery()
    )
    accept_started_at = func.coalesce(entered_pending_acceptance_at, Order.created_at)
    ship_started_at = func.coalesce(entered_paid_at, Order.created_at)

    sla_kind_col = case(
        (Order.status == OrderStatus.pending_acceptance, literal("accept")),
        (Order.status == OrderStatus.paid, literal("ship")),
        else_=literal(None),
    ).label("sla_kind")
    sla_started_at_col = case(
        (Order.status == OrderStatus.pending_acceptance, accept_started_at),
        (Order.status == OrderStatus.paid, ship_started_at),
        else_=literal(None),
    ).label("sla_started_at")

    email_velocity_subq = (
        select(
            func.lower(Order.customer_email).label("email"),
            func.count(Order.id).label("email_count"),
        )
        .where(Order.created_at >= fraud_since)
        .group_by(func.lower(Order.customer_email))
        .having(func.count(Order.id) > 1)
        .subquery()
    )
    user_velocity_subq = (
        select(
            Order.user_id.label("user_id"),
            func.count(Order.id).label("user_count"),
        )
        .where(Order.user_id.is_not(None), Order.created_at >= fraud_since)
        .group_by(Order.user_id)
        .having(func.count(Order.id) > 1)
        .subquery()
    )
    email_count = func.coalesce(email_velocity_subq.c.email_count, 0)
    user_count = func.coalesce(user_velocity_subq.c.user_count, 0)
    fraud_flagged_expr = or_(email_count > 1, user_count > 1, Order.payment_retry_count >= retry_threshold)
    fraud_flagged_col = fraud_flagged_expr.label("fraud_flagged")
    fraud_severity_col = case(
        (or_(email_count >= threshold, user_count >= threshold), literal("high")),
        (
            or_(email_count > 1, user_count > 1, Order.payment_retry_count >= retry_threshold),
            literal("medium"),
        ),
        (Order.payment_retry_count > 0, literal("low")),
        else_=literal(None),
    ).label("fraud_severity")

    filters: list[ColumnElement[bool]] = []
    if user_id:
        filters.append(Order.user_id == user_id)
    if tag_clean:
        filters.append(
            exists(select(OrderTag.id).where(OrderTag.order_id == Order.id, OrderTag.tag == tag_clean))
        )
    if not include_test and tag_clean != "test":
        filters.append(
            ~exists(select(OrderTag.id).where(OrderTag.order_id == Order.id, OrderTag.tag == "test"))
        )
    if pending_any:
        filters.append(Order.status.in_([OrderStatus.pending_payment, OrderStatus.pending_acceptance]))
    elif statuses:
        filters.append(Order.status.in_(statuses))
    elif status:
        filters.append(Order.status == status)
    if sla_clean:
        if sla_clean == "accept_overdue":
            filters.append(Order.status == OrderStatus.pending_acceptance)
            filters.append(accept_started_at <= accept_cutoff)
        elif sla_clean == "ship_overdue":
            filters.append(Order.status == OrderStatus.paid)
            filters.append(ship_started_at <= ship_cutoff)
        elif sla_clean == "any_overdue":
            filters.append(
                or_(
                    and_(Order.status == OrderStatus.pending_acceptance, accept_started_at <= accept_cutoff),
                    and_(Order.status == OrderStatus.paid, ship_started_at <= ship_cutoff),
                )
            )
    if fraud_clean:
        fraud_approved = exists(
            select(OrderTag.id).where(OrderTag.order_id == Order.id, OrderTag.tag == "fraud_approved")
        )
        fraud_denied = exists(
            select(OrderTag.id).where(OrderTag.order_id == Order.id, OrderTag.tag == "fraud_denied")
        )
        if fraud_clean == "queue":
            filters.append(fraud_flagged_expr)
            filters.append(~fraud_approved)
            filters.append(~fraud_denied)
        elif fraud_clean == "flagged":
            filters.append(fraud_flagged_expr)
        elif fraud_clean == "approved":
            filters.append(fraud_approved)
        elif fraud_clean == "denied":
            filters.append(fraud_denied)
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

    count_stmt = (
        select(func.count())
        .select_from(Order)
        .join(User, Order.user_id == User.id, isouter=True)
        .join(email_velocity_subq, email_velocity_subq.c.email == func.lower(Order.customer_email), isouter=True)
        .join(user_velocity_subq, user_velocity_subq.c.user_id == Order.user_id, isouter=True)
    )
    if filters:
        count_stmt = count_stmt.where(*filters)
    total_items = int((await session.execute(count_stmt)).scalar_one() or 0)

    stmt = (
        select(
            Order,
            Order.customer_email,
            User.username,
            sla_kind_col,
            sla_started_at_col,
            fraud_flagged_col,
            fraud_severity_col,
        )
        .join(User, Order.user_id == User.id, isouter=True)
        .join(email_velocity_subq, email_velocity_subq.c.email == func.lower(Order.customer_email), isouter=True)
        .join(user_velocity_subq, user_velocity_subq.c.user_id == Order.user_id, isouter=True)
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if filters:
        stmt = stmt.where(*filters)

    result = await session.execute(stmt)
    raw_rows = result.all()
    rows: list[tuple[Order, str | None, str | None, str | None, datetime | None, bool, str | None]] = [
        (order, email, username, sla_kind, sla_started_at, bool(fraud_flagged), fraud_severity)
        for (order, email, username, sla_kind, sla_started_at, fraud_flagged, fraud_severity) in raw_rows
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
            selectinload(Order.shipments),
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
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    taxable_subtotal = pricing.quantize_money(taxable_subtotal, rounding=checkout_settings.money_rounding)
    shipping_amount = Decimal(checkout_settings.shipping_fee_ron)
    threshold = checkout_settings.free_shipping_threshold_ron
    if threshold is not None and threshold >= 0 and taxable_subtotal >= threshold:
        shipping_amount = Decimal("0.00")
    shipping_amount = pricing.quantize_money(shipping_amount, rounding=checkout_settings.money_rounding)

    fee_amount = pricing.quantize_money(Decimal(getattr(order, "fee_amount", 0) or 0), rounding=checkout_settings.money_rounding)
    subtotal_items = sum((Decimal(getattr(item, "subtotal", 0) or 0) for item in getattr(order, "items", []) or []), start=Decimal("0.00"))
    subtotal_items = pricing.quantize_money(subtotal_items, rounding=checkout_settings.money_rounding)
    discount_val = subtotal_items - taxable_subtotal
    if discount_val < 0:
        discount_val = Decimal("0.00")
    discount_val = pricing.quantize_money(discount_val, rounding=checkout_settings.money_rounding)
    country_code = getattr(getattr(order, "shipping_address", None), "country", None)
    lines: list[TaxableProductLine] = [
        TaxableProductLine(product_id=item.product_id, subtotal=pricing.quantize_money(Decimal(item.subtotal), rounding=checkout_settings.money_rounding))
        for item in getattr(order, "items", []) or []
        if getattr(item, "product_id", None)
    ]
    vat_amount = await taxes_service.compute_cart_vat_amount(
        session,
        country_code=country_code,
        lines=lines,
        discount=discount_val,
        shipping=shipping_amount,
        fee=fee_amount,
        checkout=checkout_settings,
    )

    order.shipping_amount = shipping_amount
    order.tax_amount = vat_amount
    order.total_amount = pricing.quantize_money(
        taxable_subtotal + fee_amount + shipping_amount + vat_amount, rounding=checkout_settings.money_rounding
    )

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
        allowed = set(ALLOWED_TRANSITIONS.get(current_status, set()))
        # COD orders start in "pending_acceptance" and should be shippable without a payment capture step.
        if payment_method == "cod" and current_status == OrderStatus.pending_acceptance:
            allowed.update({OrderStatus.shipped, OrderStatus.delivered})
        if next_status not in allowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")
        order.status = next_status
        data.pop("status")
        if next_status in {OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered}:
            await _commit_stock_for_order(session, order)
        elif next_status == OrderStatus.cancelled:
            await _restore_stock_for_order(session, order)
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

    if any(field in data for field in ("tracking_number", "tracking_url", "courier")):
        target_courier = data.get("courier") if "courier" in data else getattr(order, "courier", None)
        if "tracking_number" in data:
            data["tracking_number"] = tracking_service.validate_tracking_number(
                courier=target_courier, tracking_number=data.get("tracking_number")
            )
        elif "courier" in data:
            existing_tracking = getattr(order, "tracking_number", None)
            if (existing_tracking or "").strip():
                tracking_service.validate_tracking_number(courier=target_courier, tracking_number=existing_tracking)
        if "tracking_url" in data:
            data["tracking_url"] = tracking_service.validate_tracking_url(tracking_url=data.get("tracking_url"))

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
        await session.refresh(order, attribute_names=["items", "shipping_address"])
        checkout_settings = await checkout_settings_service.get_checkout_settings(session)
        taxable_subtotal = (
            Decimal(order.total_amount)
            - Decimal(order.shipping_amount)
            - Decimal(order.tax_amount)
            - Decimal(getattr(order, "fee_amount", 0) or 0)
        )
        if taxable_subtotal < 0:
            taxable_subtotal = Decimal("0.00")
        taxable_subtotal = pricing.quantize_money(taxable_subtotal, rounding=checkout_settings.money_rounding)
        shipping_amount = Decimal(checkout_settings.shipping_fee_ron)
        threshold = checkout_settings.free_shipping_threshold_ron
        if threshold is not None and threshold >= 0 and taxable_subtotal >= threshold:
            shipping_amount = Decimal("0.00")
        shipping_amount = pricing.quantize_money(shipping_amount, rounding=checkout_settings.money_rounding)

        fee_amount = pricing.quantize_money(Decimal(getattr(order, "fee_amount", 0) or 0), rounding=checkout_settings.money_rounding)
        subtotal_items = sum((Decimal(getattr(item, "subtotal", 0) or 0) for item in getattr(order, "items", []) or []), start=Decimal("0.00"))
        subtotal_items = pricing.quantize_money(subtotal_items, rounding=checkout_settings.money_rounding)
        discount_val = subtotal_items - taxable_subtotal
        if discount_val < 0:
            discount_val = Decimal("0.00")
        discount_val = pricing.quantize_money(discount_val, rounding=checkout_settings.money_rounding)
        country_code = getattr(getattr(order, "shipping_address", None), "country", None)
        lines: list[TaxableProductLine] = [
            TaxableProductLine(product_id=item.product_id, subtotal=pricing.quantize_money(Decimal(item.subtotal), rounding=checkout_settings.money_rounding))
            for item in getattr(order, "items", []) or []
            if getattr(item, "product_id", None)
        ]
        vat_amount = await taxes_service.compute_cart_vat_amount(
            session,
            country_code=country_code,
            lines=lines,
            discount=discount_val,
            shipping=shipping_amount,
            fee=fee_amount,
            checkout=checkout_settings,
        )

        order.shipping_amount = shipping_amount
        order.tax_amount = vat_amount
        order.total_amount = pricing.quantize_money(
            taxable_subtotal + fee_amount + shipping_amount + vat_amount, rounding=checkout_settings.money_rounding
        )

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
        await _commit_stock_for_order(session, order)
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


async def list_order_tag_stats(session: AsyncSession) -> list[tuple[str, int]]:
    result = await session.execute(
        select(OrderTag.tag, func.count(OrderTag.id))
        .group_by(OrderTag.tag)
        .order_by(func.count(OrderTag.id).desc(), OrderTag.tag.asc())
    )
    rows = []
    for row in result.all():
        if not row or not row[0]:
            continue
        rows.append((str(row[0]), int(row[1] or 0)))
    return rows


async def rename_order_tag(
    session: AsyncSession,
    *,
    from_tag: str,
    to_tag: str,
    actor_user_id: UUID | None = None,
    max_affected_orders: int = 5000,
) -> dict[str, object]:
    from_clean = _normalize_order_tag(from_tag)
    to_clean = _normalize_order_tag(to_tag)
    if not from_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from_tag is required")
    if not to_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="to_tag is required")
    if from_clean == to_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tags must be different")

    rows = (await session.execute(select(OrderTag).where(OrderTag.tag == from_clean))).scalars().all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    affected_order_ids = {row.order_id for row in rows if getattr(row, "order_id", None)}
    if len(affected_order_ids) > max_affected_orders:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many affected orders ({len(affected_order_ids)}); narrow the scope first.",
        )

    existing_targets = (
        await session.execute(
            select(OrderTag.order_id).where(OrderTag.order_id.in_(affected_order_ids), OrderTag.tag == to_clean)
        )
    ).all()
    orders_with_target = {row[0] for row in existing_targets if row and row[0]}

    updated = 0
    merged = 0
    note = f"{from_clean} -> {to_clean}"
    actor_value = str(actor_user_id) if actor_user_id else None

    for tag_row in rows:
        order_id = getattr(tag_row, "order_id", None)
        if not order_id:
            continue
        if order_id in orders_with_target:
            await session.delete(tag_row)
            merged += 1
        else:
            tag_row.tag = to_clean
            session.add(tag_row)
            updated += 1
        session.add(
            OrderEvent(
                order_id=order_id,
                event="tag_renamed",
                note=note,
                data={"from": from_clean, "to": to_clean, "actor_user_id": actor_value},
            )
        )

    await session.commit()
    total = updated + merged
    return {"from_tag": from_clean, "to_tag": to_clean, "updated": updated, "merged": merged, "total": total}


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


async def review_order_fraud(
    session: AsyncSession,
    order: Order,
    *,
    decision: str,
    note: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    decision_clean = (decision or "").strip().lower()
    if decision_clean not in {"approve", "deny"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid fraud review decision")

    target_tag = "fraud_approved" if decision_clean == "approve" else "fraud_denied"
    remove_tag = "fraud_denied" if decision_clean == "approve" else "fraud_approved"

    note_clean = (note or "").strip() or None
    if note_clean:
        note_clean = note_clean[:500]

    tags = (
        await session.execute(
            select(OrderTag).where(OrderTag.order_id == order.id, OrderTag.tag.in_([target_tag, remove_tag]))
        )
    ).scalars().all()
    by_tag = {row.tag: row for row in tags if row and row.tag}

    removed = by_tag.get(remove_tag)
    if removed is not None:
        await session.delete(removed)

    if target_tag not in by_tag:
        session.add(OrderTag(order_id=order.id, actor_user_id=actor_user_id, tag=target_tag))

    audit_note = f"{decision_clean}: {note_clean}" if note_clean else decision_clean
    session.add(
        OrderEvent(
            order_id=order.id,
            event="fraud_review",
            note=audit_note[:2000] if audit_note else None,
            data={
                "decision": decision_clean,
                "note": note_clean,
                "actor_user_id": str(actor_user_id) if actor_user_id else None,
            },
        )
    )
    admin_note = f"Fraud review: {decision_clean}" + (f" - {note_clean}" if note_clean else "")
    session.add(OrderAdminNote(order_id=order.id, actor_user_id=actor_user_id, note=admin_note[:5000]))

    await session.commit()
    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def create_order_shipment(
    session: AsyncSession,
    order: Order,
    payload: OrderShipmentCreate,
    *,
    actor: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    tracking_number = (payload.tracking_number or "").strip()
    if not tracking_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is required")

    courier = (payload.courier or "").strip() or None
    tracking_url = (payload.tracking_url or "").strip() or None
    tracking_number_validated = tracking_service.validate_tracking_number(courier=courier, tracking_number=tracking_number)
    if not tracking_number_validated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is required")
    tracking_number = tracking_number_validated
    tracking_url = tracking_service.validate_tracking_url(tracking_url=tracking_url)

    existing = (
        (
            await session.execute(
                select(OrderShipment.id).where(
                    OrderShipment.order_id == order.id, OrderShipment.tracking_number == tracking_number
                )
            )
        )
        .scalars()
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment already exists")

    shipment = OrderShipment(
        order_id=order.id,
        courier=courier,
        tracking_number=tracking_number,
        tracking_url=tracking_url,
    )
    session.add(shipment)

    if not (getattr(order, "tracking_number", None) or "").strip():
        order.tracking_number = tracking_number
    if tracking_url and not (getattr(order, "tracking_url", None) or "").strip():
        order.tracking_url = tracking_url
    if courier and not (getattr(order, "courier", None) or "").strip():
        order.courier = courier

    session.add(order)

    actor_clean = (actor or "").strip() or None
    note = f"{actor_clean}: {tracking_number}" if actor_clean else tracking_number
    session.add(
        OrderEvent(
            order_id=order.id,
            event="shipment_added",
            note=note,
            data={"shipment": {"tracking_number": tracking_number, "tracking_url": tracking_url, "courier": courier}},
        )
    )

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment already exists") from exc

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def update_order_shipment(
    session: AsyncSession,
    order: Order,
    shipment_id: UUID,
    payload: OrderShipmentUpdate,
    *,
    actor: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    shipment = await session.get(OrderShipment, shipment_id)
    if not shipment or shipment.order_id != order.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")

    data = payload.model_dump(exclude_unset=True)
    previous_tracking_number = getattr(shipment, "tracking_number", None)
    previous_tracking_url = getattr(shipment, "tracking_url", None)
    previous_courier = getattr(shipment, "courier", None)

    if "tracking_number" in data:
        tracking_number = (str(data.get("tracking_number") or "")).strip()
        if not tracking_number:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is required")
        existing = (
            (
                await session.execute(
                    select(OrderShipment.id).where(
                        OrderShipment.order_id == order.id,
                        OrderShipment.tracking_number == tracking_number,
                        OrderShipment.id != shipment_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment already exists")
        shipment.tracking_number = tracking_number

    if "tracking_url" in data:
        shipment.tracking_url = (str(data.get("tracking_url") or "")).strip() or None

    if "courier" in data:
        shipment.courier = (str(data.get("courier") or "")).strip() or None

    shipment.tracking_number = tracking_service.validate_tracking_number(
        courier=getattr(shipment, "courier", None),
        tracking_number=getattr(shipment, "tracking_number", None),
    ) or shipment.tracking_number
    shipment.tracking_url = tracking_service.validate_tracking_url(tracking_url=getattr(shipment, "tracking_url", None))

    session.add(shipment)

    changes: dict[str, dict[str, object]] = {}
    if getattr(shipment, "tracking_number", None) != previous_tracking_number:
        changes["tracking_number"] = {"from": previous_tracking_number, "to": getattr(shipment, "tracking_number", None)}
    if getattr(shipment, "tracking_url", None) != previous_tracking_url:
        changes["tracking_url"] = {"from": previous_tracking_url, "to": getattr(shipment, "tracking_url", None)}
    if getattr(shipment, "courier", None) != previous_courier:
        changes["courier"] = {"from": previous_courier, "to": getattr(shipment, "courier", None)}

    if changes:
        actor_clean = (actor or "").strip() or None
        note = actor_clean or None
        session.add(
            OrderEvent(
                order_id=order.id,
                event="shipment_updated",
                note=note,
                data={"shipment_id": str(shipment_id), "changes": changes},
            )
        )

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment already exists") from exc

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def delete_order_shipment(
    session: AsyncSession,
    order: Order,
    shipment_id: UUID,
    *,
    actor: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    shipment = await session.get(OrderShipment, shipment_id)
    if not shipment or shipment.order_id != order.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")

    tracking_number = getattr(shipment, "tracking_number", None)
    await session.delete(shipment)

    actor_clean = (actor or "").strip() or None
    note = f"{actor_clean}: {tracking_number}" if actor_clean and tracking_number else (actor_clean or tracking_number)
    session.add(OrderEvent(order_id=order.id, event="shipment_deleted", note=note, data={"shipment_id": str(shipment_id)}))

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Could not delete shipment") from exc

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
            selectinload(Order.refunds),
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
        refunded_qty: dict[UUID, int] = {}
        for existing_refund in order.refunds or []:
            payload = existing_refund.data if isinstance(existing_refund.data, dict) else {}
            rows = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_item_id = row.get("order_item_id")
                raw_qty = row.get("quantity")
                try:
                    parsed_item_id = UUID(str(raw_item_id))
                except Exception:
                    continue
                try:
                    parsed_qty = int(raw_qty or 0)
                except Exception:
                    continue
                if parsed_qty <= 0:
                    continue
                refunded_qty[parsed_item_id] = refunded_qty.get(parsed_item_id, 0) + parsed_qty

        requested_qty: dict[UUID, int] = {}
        for item_id, qty in items:
            q = int(qty or 0)
            if q <= 0:
                continue
            requested_qty[item_id] = requested_qty.get(item_id, 0) + q

        items_total = Decimal("0.00")
        for item_id, q in requested_qty.items():
            order_item = items_by_id.get(item_id)
            if not order_item:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order item")
            ordered_qty = int(order_item.quantity or 0)
            already_qty = int(refunded_qty.get(item_id, 0))
            remaining_qty = ordered_qty - already_qty
            if remaining_qty <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order item already fully refunded")
            if q > remaining_qty:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund quantity exceeds remaining refundable quantity")
            selected_items.append({"order_item_id": str(order_item.id), "quantity": q})

            unit_price = Decimal(str(getattr(order_item, "unit_price", "0") or "0"))
            items_total += pricing.quantize_money(unit_price * Decimal(q))

        if selected_items and amount_q > pricing.quantize_money(items_total):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund amount exceeds selected items total")

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
    await _restore_stock_for_order(session, order)
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
