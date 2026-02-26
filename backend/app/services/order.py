from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
import logging
from typing import Any, NamedTuple, Sequence, cast as typing_cast
from uuid import UUID
import secrets
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
from app.services.pricing import MoneyRounding
from app.services import taxes as taxes_service
from app.services.taxes import TaxableProductLine
from app.services import payments
from app.services import paypal
from app.services import promo_usage

logger = logging.getLogger(__name__)

_ORDER_STOCK_COMMIT_EVENT = "stock_committed"
_ORDER_STOCK_RESTORE_EVENT = "stock_restored"


async def _lock_order_stock_row(session: AsyncSession, order_id: UUID) -> None:
    await session.execute(select(Order.id).where(Order.id == order_id).with_for_update())


async def _order_has_event(session: AsyncSession, *, order_id: UUID, event: str) -> bool:
    event_id = (
        (
            await session.execute(
                select(OrderEvent.id).where(
                    OrderEvent.order_id == order_id,
                    OrderEvent.event == event,
                )
            )
        )
        .scalars()
        .first()
    )
    return bool(event_id)


async def _load_order_items_for_stock(session: AsyncSession, order: Order) -> list[OrderItem]:
    items = list(getattr(order, "items", []) or [])
    if items:
        return items
    await session.refresh(order, attribute_names=["items"])
    return list(getattr(order, "items", []) or [])


def _stock_qty_by_key(items: Sequence[OrderItem]) -> dict[tuple[UUID, UUID | None], int]:
    qty_by_key: dict[tuple[UUID, UUID | None], int] = defaultdict(int)
    for item in items:
        product_id = getattr(item, "product_id", None)
        if not product_id:
            continue
        qty = int(getattr(item, "quantity", 0) or 0)
        if qty <= 0:
            continue
        qty_by_key[(product_id, getattr(item, "variant_id", None))] += qty
    return qty_by_key


def _stock_target_ids(qty_by_key: dict[tuple[UUID, UUID | None], int]) -> tuple[set[UUID], set[UUID]]:
    product_ids = {product_id for product_id, variant_id in qty_by_key.keys() if variant_id is None}
    variant_ids = {variant_id for _, variant_id in qty_by_key.keys() if variant_id is not None}
    return product_ids, variant_ids


async def _load_locked_products(session: AsyncSession, product_ids: set[UUID]) -> dict[UUID, Product]:
    if not product_ids:
        return {}
    products = (
        (
            await session.execute(
                select(Product).where(Product.id.in_(product_ids)).with_for_update(of=Product)
            )
        )
        .scalars()
        .all()
    )
    return {product.id: product for product in products}


async def _load_locked_variants(session: AsyncSession, variant_ids: set[UUID]) -> dict[UUID, ProductVariant]:
    if not variant_ids:
        return {}
    variants = (
        (
            await session.execute(
                select(ProductVariant).where(ProductVariant.id.in_(variant_ids)).with_for_update(of=ProductVariant)
            )
        )
        .scalars()
        .all()
    )
    return {variant.id: variant for variant in variants}


def _apply_stock_deduction(
    *,
    session: AsyncSession,
    qty_by_key: dict[tuple[UUID, UUID | None], int],
    products: dict[UUID, Product],
    variants: dict[UUID, ProductVariant],
) -> list[dict[str, object]]:
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
    return lines


async def _commit_stock_for_order(session: AsyncSession, order: Order) -> None:
    await _lock_order_stock_row(session, order.id)
    if await _order_has_event(session, order_id=order.id, event=_ORDER_STOCK_COMMIT_EVENT):
        return
    items = await _load_order_items_for_stock(session, order)
    if not items:
        return
    qty_by_key = _stock_qty_by_key(items)
    if not qty_by_key:
        return
    product_ids, variant_ids = _stock_target_ids(qty_by_key)
    products = await _load_locked_products(session, product_ids)
    variants = await _load_locked_variants(session, variant_ids)
    lines = _apply_stock_deduction(
        session=session,
        qty_by_key=qty_by_key,
        products=products,
        variants=variants,
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


async def _get_committed_stock_event(session: AsyncSession, order_id: UUID) -> OrderEvent | None:
    return (
        (
            await session.execute(
                select(OrderEvent).where(
                    OrderEvent.order_id == order_id,
                    OrderEvent.event == _ORDER_STOCK_COMMIT_EVENT,
                )
            )
        )
        .scalars()
        .first()
    )


def _restore_delta_from_row(raw: object) -> tuple[UUID, UUID | None, int] | None:
    if not isinstance(raw, dict):
        return None
    product_id = _try_uuid(raw.get("product_id"))
    if not product_id:
        return None
    variant_ref = raw.get("variant_id")
    variant_id = _try_uuid(variant_ref) if variant_ref else None
    try:
        deducted_qty = int(raw.get("deducted_qty") or 0)
    except Exception:
        return None
    if deducted_qty <= 0:
        return None
    return product_id, variant_id, deducted_qty


def _restore_qty_by_key(committed: OrderEvent | None) -> dict[tuple[UUID, UUID | None], int]:
    if not committed:
        return {}
    data = getattr(committed, "data", None) or {}
    raw_lines = data.get("lines") if isinstance(data, dict) else None
    if not isinstance(raw_lines, list):
        return {}
    restore_by_key: dict[tuple[UUID, UUID | None], int] = defaultdict(int)
    for raw in raw_lines:
        parsed = _restore_delta_from_row(raw)
        if not parsed:
            continue
        product_id, variant_id, deducted_qty = parsed
        restore_by_key[(product_id, variant_id)] += deducted_qty
    return restore_by_key


def _apply_stock_restore(
    *,
    session: AsyncSession,
    restore_by_key: dict[tuple[UUID, UUID | None], int],
    products: dict[UUID, Product],
    variants: dict[UUID, ProductVariant],
) -> list[dict[str, object]]:
    lines: list[dict[str, object]] = []
    for (product_id, variant_id), qty in restore_by_key.items():
        if variant_id:
            variant = variants.get(variant_id)
            if not variant:
                continue
            before = int(getattr(variant, "stock_quantity", 0) or 0)
            after = before + int(qty)
            variant.stock_quantity = after
            session.add(variant)
            lines.append(
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
        lines.append(
            {
                "product_id": str(product_id),
                "variant_id": None,
                "restored_qty": int(qty),
                "before": int(before),
                "after": int(after),
            }
        )
    return lines


async def _restore_stock_for_order(session: AsyncSession, order: Order) -> None:
    await _lock_order_stock_row(session, order.id)
    if await _order_has_event(session, order_id=order.id, event=_ORDER_STOCK_RESTORE_EVENT):
        return
    committed = await _get_committed_stock_event(session, order.id)
    if not committed:
        return
    restore_by_key = _restore_qty_by_key(committed)
    if not restore_by_key:
        return
    product_ids, variant_ids = _stock_target_ids(restore_by_key)
    products = await _load_locked_products(session, product_ids)
    variants = await _load_locked_variants(session, variant_ids)
    restored_lines = _apply_stock_restore(
        session=session,
        restore_by_key=restore_by_key,
        products=products,
        variants=variants,
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


def _collect_cart_order_targets(
    cart: Cart,
) -> tuple[dict[tuple[UUID, UUID | None], int], set[UUID], set[UUID]]:
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
    return qty_by_key, product_ids, variant_ids


def _product_is_orderable(product: Product) -> bool:
    return (
        not bool(getattr(product, "is_deleted", False))
        and bool(getattr(product, "is_active", True))
        and getattr(product, "status", None) == ProductStatus.published
    )


async def _load_orderable_products(
    session: AsyncSession,
    product_ids: set[UUID],
) -> dict[UUID, Product]:
    if not product_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(Product)
                .where(Product.id.in_(product_ids))
                .order_by(Product.id)
                .with_for_update(of=Product)
            )
        )
        .scalars()
        .all()
    )
    products_by_id = {product.id: product for product in rows}
    missing = product_ids - set(products_by_id.keys())
    unavailable = [product_id for product_id, product in products_by_id.items() if not _product_is_orderable(product)]
    if missing or unavailable:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more cart items are unavailable")
    return products_by_id


async def _load_orderable_variants(
    session: AsyncSession,
    variant_ids: set[UUID],
) -> dict[UUID, ProductVariant]:
    if not variant_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(ProductVariant)
                .where(ProductVariant.id.in_(variant_ids))
                .order_by(ProductVariant.id)
                .with_for_update(of=ProductVariant)
            )
        )
        .scalars()
        .all()
    )
    variants_by_id = {variant.id: variant for variant in rows}
    if variant_ids - set(variants_by_id.keys()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")
    return variants_by_id


async def _reserved_order_qty_by_key(
    session: AsyncSession,
    product_ids: set[UUID],
) -> dict[tuple[UUID, UUID | None], int]:
    if not product_ids:
        return {}
    open_statuses = {OrderStatus.pending_payment, OrderStatus.pending_acceptance}
    reserved_expr = case(
        (
            OrderItem.quantity > OrderItem.shipped_quantity,
            OrderItem.quantity - OrderItem.shipped_quantity,
        ),
        else_=0,
    )
    stmt = (
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
    rows = (await session.execute(stmt)).all()
    return {(row[0], row[1]): int(row[2] or 0) for row in rows}


def _stock_qty_for_order_key(
    *,
    product_id: UUID,
    variant_id: UUID | None,
    products_by_id: dict[UUID, Product],
    variants_by_id: dict[UUID, ProductVariant],
) -> int:
    if variant_id:
        variant = variants_by_id.get(variant_id)
        if not variant or getattr(variant, "product_id", None) != product_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")
        return int(getattr(variant, "stock_quantity", 0) or 0)
    product = products_by_id.get(product_id)
    return int(getattr(product, "stock_quantity", 0) or 0) if product else 0


def _validate_stock_for_cart_targets(
    *,
    qty_by_key: dict[tuple[UUID, UUID | None], int],
    products_by_id: dict[UUID, Product],
    variants_by_id: dict[UUID, ProductVariant],
    reserved_by_key: dict[tuple[UUID, UUID | None], int],
) -> None:
    for (product_id, variant_id), quantity in qty_by_key.items():
        product = products_by_id.get(product_id)
        if not product or bool(getattr(product, "allow_backorder", False)):
            continue
        reserved_qty = int(reserved_by_key.get((product_id, variant_id), 0) or 0)
        stock_qty = _stock_qty_for_order_key(
            product_id=product_id,
            variant_id=variant_id,
            products_by_id=products_by_id,
            variants_by_id=variants_by_id,
        )
        if quantity > stock_qty - reserved_qty:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient stock")


def _build_order_items(cart: Cart) -> tuple[Decimal, list[OrderItem]]:
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
    return subtotal, items


def _provided_order_totals(
    *,
    fee_amount: Decimal | None,
    tax_amount: Decimal | None,
    shipping_amount: Decimal | None,
    total_amount: Decimal | None,
) -> tuple[Decimal, Decimal, Decimal, Decimal] | None:
    if tax_amount is not None and shipping_amount is not None and total_amount is not None:
        return (
            Decimal(fee_amount or 0),
            Decimal(tax_amount),
            Decimal(shipping_amount),
            Decimal(total_amount),
        )
    return None


def _checkout_shipping_amount(
    *,
    subtotal: Decimal,
    discount: Decimal,
    shipping_method: ShippingMethod | None,
    checkout_settings: Any,
) -> Decimal:
    taxable = subtotal - discount
    if taxable < 0:
        taxable = Decimal("0.00")
    shipping = (
        Decimal(checkout_settings.shipping_fee_ron)
        if checkout_settings.shipping_fee_ron is not None
        else _calculate_shipping(subtotal, shipping_method)
    )
    threshold = checkout_settings.free_shipping_threshold_ron
    if threshold is not None and threshold >= 0 and taxable >= threshold:
        shipping = Decimal("0.00")
    return shipping


async def _computed_order_totals(
    session: AsyncSession,
    *,
    subtotal: Decimal,
    discount: Decimal,
    shipping_method: ShippingMethod | None,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    shipping = _checkout_shipping_amount(
        subtotal=subtotal,
        discount=discount,
        shipping_method=shipping_method,
        checkout_settings=checkout_settings,
    )
    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=discount,
        shipping=shipping,
        fee_enabled=checkout_settings.fee_enabled,
        fee_type=checkout_settings.fee_type,
        fee_value=checkout_settings.fee_value,
        vat_enabled=checkout_settings.vat_enabled,
        vat_rate_percent=checkout_settings.vat_rate_percent,
        vat_apply_to_shipping=checkout_settings.vat_apply_to_shipping,
        vat_apply_to_fee=checkout_settings.vat_apply_to_fee,
        rounding=checkout_settings.money_rounding,
    )
    return breakdown.fee, breakdown.vat, breakdown.shipping, breakdown.total


async def _resolve_order_totals(
    session: AsyncSession,
    *,
    subtotal: Decimal,
    discount: Decimal,
    shipping_method: ShippingMethod | None,
    fee_amount: Decimal | None,
    tax_amount: Decimal | None,
    shipping_amount: Decimal | None,
    total_amount: Decimal | None,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    provided = _provided_order_totals(
        fee_amount=fee_amount,
        tax_amount=tax_amount,
        shipping_amount=shipping_amount,
        total_amount=total_amount,
    )
    if provided is not None:
        return provided
    return await _computed_order_totals(
        session,
        subtotal=subtotal,
        discount=discount,
        shipping_method=shipping_method,
    )


def _clean_optional_order_text(value: str | None, *, max_length: int, upper: bool = False) -> str | None:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    normalized = cleaned.upper() if upper else cleaned
    return normalized[:max_length]


def _initial_order_status(payment_method: str) -> OrderStatus:
    method = (payment_method or "").strip().lower()
    return OrderStatus.pending_payment if method in {"stripe", "paypal", "netopia"} else OrderStatus.pending_acceptance


class _BuildOrderFromCartArgs(NamedTuple):
    user_id: UUID | None
    customer_email: str
    customer_name: str
    cart: Cart
    shipping_address_id: UUID | None
    billing_address_id: UUID | None
    shipping_method: ShippingMethod | None
    payment_method: str
    payment_intent_id: str | None
    stripe_checkout_session_id: str | None
    stripe_checkout_url: str | None
    paypal_order_id: str | None
    paypal_approval_url: str | None
    tax_amount: Decimal | None
    fee_amount: Decimal | None
    shipping_amount: Decimal | None
    total_amount: Decimal | None
    courier: str | None
    delivery_type: str | None
    locker_id: str | None
    locker_name: str | None
    locker_address: str | None
    locker_lat: float | None
    locker_lng: float | None
    discount: Decimal | None
    promo_code: str | None
    invoice_company: str | None
    invoice_vat_id: str | None


def _new_cart_order_from_args(
    *,
    args: _BuildOrderFromCartArgs,
    reference_code: str,
    items: list[OrderItem],
    fee_amount: Decimal,
    tax_amount: Decimal,
    shipping_amount: Decimal,
    total_amount: Decimal,
) -> Order:
    return Order(
        user_id=args.user_id,
        reference_code=reference_code,
        customer_email=args.customer_email,
        customer_name=args.customer_name,
        status=_initial_order_status(args.payment_method),
        invoice_company=_clean_optional_order_text(args.invoice_company, max_length=200),
        invoice_vat_id=_clean_optional_order_text(args.invoice_vat_id, max_length=64),
        total_amount=total_amount,
        tax_amount=tax_amount,
        fee_amount=fee_amount,
        shipping_amount=shipping_amount,
        currency="RON",
        payment_method=args.payment_method,
        promo_code=_clean_optional_order_text(args.promo_code, max_length=40, upper=True),
        courier=args.courier,
        delivery_type=args.delivery_type,
        locker_id=args.locker_id,
        locker_name=args.locker_name,
        locker_address=args.locker_address,
        locker_lat=args.locker_lat,
        locker_lng=args.locker_lng,
        shipping_address_id=args.shipping_address_id,
        billing_address_id=args.billing_address_id,
        items=items,
        shipping_method_id=args.shipping_method.id if args.shipping_method else None,
        stripe_payment_intent_id=args.payment_intent_id,
        stripe_checkout_session_id=args.stripe_checkout_session_id,
        stripe_checkout_url=(args.stripe_checkout_url or "").strip() or None,
        paypal_order_id=args.paypal_order_id,
        paypal_approval_url=(args.paypal_approval_url or "").strip() or None,
    )


async def _persist_order_with_cart(session: AsyncSession, *, order: Order, cart: Cart) -> None:
    session.add(order)
    await session.flush()
    cart.last_order_id = order.id
    session.add(cart)
    await session.commit()


async def _post_create_order_hooks(session: AsyncSession, order: Order) -> None:
    await session.refresh(order)
    await _log_event(session, order.id, "created", f"Reference {order.reference_code}")
    await session.refresh(order)
    await session.refresh(order, attribute_names=["items", "events", "shipping_method"])
    try:
        from app.core import metrics

        metrics.record_order_created()
    except Exception as exc:
        # metrics should never break order creation
        logger.debug("order_created_metric_emit_failed", extra={"order_id": str(order.id)}, exc_info=exc)


async def _build_order_from_cart_impl(session: AsyncSession, args: _BuildOrderFromCartArgs) -> Order:
    if not args.cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")
    qty_by_key, product_ids, variant_ids = _collect_cart_order_targets(args.cart)
    products_by_id = await _load_orderable_products(session, product_ids)
    variants_by_id = await _load_orderable_variants(session, variant_ids)
    if qty_by_key:
        _validate_stock_for_cart_targets(
            qty_by_key=qty_by_key,
            products_by_id=products_by_id,
            variants_by_id=variants_by_id,
            reserved_by_key=await _reserved_order_qty_by_key(session, product_ids),
        )
    subtotal, items = _build_order_items(args.cart)
    computed_fee, computed_tax, computed_shipping, computed_total = await _resolve_order_totals(
        session,
        subtotal=subtotal,
        discount=args.discount or Decimal("0"),
        shipping_method=args.shipping_method,
        fee_amount=args.fee_amount,
        tax_amount=args.tax_amount,
        shipping_amount=args.shipping_amount,
        total_amount=args.total_amount,
    )
    order = _new_cart_order_from_args(
        args=args,
        reference_code=await _generate_reference_code(session),
        items=items,
        fee_amount=computed_fee,
        tax_amount=computed_tax,
        shipping_amount=computed_shipping,
        total_amount=computed_total,
    )
    await _persist_order_with_cart(session, order=order, cart=args.cart)
    await _post_create_order_hooks(session, order)
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


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
    args = _BuildOrderFromCartArgs(**{key: value for key, value in locals().items() if key != "session"})
    return await _build_order_from_cart_impl(session, args)


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


def _normalize_order_search_inputs(
    *,
    q: str | None,
    page: int,
    limit: int,
) -> tuple[str, int, int, int]:
    cleaned_q = (q or "").strip()
    normalized_page = max(1, int(page or 1))
    normalized_limit = max(1, min(100, int(limit or 20)))
    offset = (normalized_page - 1) * normalized_limit
    return cleaned_q, normalized_page, normalized_limit, offset


def _build_user_order_search_filters(
    *,
    user_id: UUID,
    cleaned_q: str,
    status: OrderStatus | None,
    from_dt: datetime | None,
    to_dt: datetime | None,
) -> list[ColumnElement[bool]]:
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
    return filters


async def _count_orders_with_filters(
    session: AsyncSession,
    filters: Sequence[ColumnElement[bool]],
) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(Order).where(*filters),
            )
        ).scalar_one()
        or 0
    )


async def _count_pending_orders_for_user(session: AsyncSession, user_id: UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(Order)
                .where(
                    Order.user_id == user_id,
                    Order.status.in_([OrderStatus.pending_payment, OrderStatus.pending_acceptance]),
                ),
            )
        ).scalar_one()
        or 0
    )


async def _fetch_orders_for_user_search(
    session: AsyncSession,
    *,
    filters: Sequence[ColumnElement[bool]],
    offset: int,
    limit: int,
) -> list[Order]:
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
    return list(result.scalars().unique().all())


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
    cleaned_q, _, normalized_limit, offset = _normalize_order_search_inputs(
        q=q,
        page=page,
        limit=limit,
    )
    filters = _build_user_order_search_filters(
        user_id=user_id,
        cleaned_q=cleaned_q,
        status=status,
        from_dt=from_dt,
        to_dt=to_dt,
    )
    total_items = await _count_orders_with_filters(session, filters)
    pending_count = await _count_pending_orders_for_user(session, user_id)
    orders = await _fetch_orders_for_user_search(
        session,
        filters=filters,
        offset=offset,
        limit=normalized_limit,
    )
    return orders, total_items, pending_count


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


class _AdminOrderSearchOptions(NamedTuple):
    q: str | None
    user_id: UUID | None
    status: OrderStatus | None
    statuses: list[OrderStatus] | None
    pending_any: bool
    tag: str | None
    sla: str | None
    fraud: str | None
    include_test: bool
    from_dt: datetime | None
    to_dt: datetime | None
    page: int
    limit: int


def _normalize_admin_order_search_inputs(
    *,
    q: str | None,
    page: int,
    limit: int,
    tag: str | None,
    sla: str | None,
    fraud: str | None,
) -> tuple[str, int, int, str | None, str | None, str | None]:
    cleaned_q, _, normalized_limit, offset = _normalize_order_search_inputs(q=q, page=page, limit=limit)
    tag_clean = _normalize_order_tag(tag) if tag is not None else None
    sla_clean = (sla or "").strip().lower() or None
    fraud_clean = (fraud or "").strip().lower() or None
    return cleaned_q, normalized_limit, offset, tag_clean, sla_clean, fraud_clean


def _admin_sla_cutoffs(settings: object, now: datetime) -> tuple[datetime, datetime]:
    accept_hours = max(1, int(getattr(settings, "order_sla_accept_hours", 24) or 24))
    ship_hours = max(1, int(getattr(settings, "order_sla_ship_hours", 48) or 48))
    return now - timedelta(hours=accept_hours), now - timedelta(hours=ship_hours)


def _admin_fraud_context(settings: object, now: datetime) -> tuple[int, int, datetime]:
    window_minutes = max(1, int(getattr(settings, "fraud_velocity_window_minutes", 60 * 24) or 60 * 24))
    threshold = max(2, int(getattr(settings, "fraud_velocity_threshold", 3) or 3))
    retry_threshold = max(1, int(getattr(settings, "fraud_payment_retry_threshold", 2) or 2))
    return threshold, retry_threshold, now - timedelta(minutes=window_minutes)


def _admin_sla_columns() -> tuple[object, object, object, object]:
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
    return accept_started_at, ship_started_at, sla_kind_col, sla_started_at_col


def _admin_velocity_subqueries(fraud_since: datetime):
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
    return email_velocity_subq, user_velocity_subq


def _admin_fraud_columns(
    *,
    email_velocity_subq,
    user_velocity_subq,
    threshold: int,
    retry_threshold: int,
):
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
    return fraud_flagged_expr, fraud_flagged_col, fraud_severity_col


def _order_tag_exists(tag: str) -> ColumnElement[bool]:
    return exists(select(OrderTag.id).where(OrderTag.order_id == Order.id, OrderTag.tag == tag))


def _apply_admin_user_and_tag_filters(
    filters: list[ColumnElement[bool]],
    *,
    user_id: UUID | None,
    tag_clean: str | None,
    include_test: bool,
) -> None:
    if user_id:
        filters.append(Order.user_id == user_id)
    if tag_clean:
        filters.append(_order_tag_exists(tag_clean))
    if not include_test and tag_clean != "test":
        filters.append(~_order_tag_exists("test"))


def _apply_admin_status_filter(
    filters: list[ColumnElement[bool]],
    *,
    pending_any: bool,
    statuses: list[OrderStatus] | None,
    status: OrderStatus | None,
) -> None:
    if pending_any:
        filters.append(Order.status.in_([OrderStatus.pending_payment, OrderStatus.pending_acceptance]))
    elif statuses:
        filters.append(Order.status.in_(statuses))
    elif status:
        filters.append(Order.status == status)


def _apply_admin_sla_filter(
    filters: list[ColumnElement[bool]],
    *,
    sla_clean: str | None,
    accept_started_at: Any,
    ship_started_at: Any,
    accept_cutoff: datetime,
    ship_cutoff: datetime,
) -> None:
    if not sla_clean:
        return
    if sla_clean == "accept_overdue":
        filters.extend([Order.status == OrderStatus.pending_acceptance, accept_started_at <= accept_cutoff])
        return
    if sla_clean == "ship_overdue":
        filters.extend([Order.status == OrderStatus.paid, ship_started_at <= ship_cutoff])
        return
    if sla_clean == "any_overdue":
        filters.append(
            or_(
                and_(Order.status == OrderStatus.pending_acceptance, accept_started_at <= accept_cutoff),
                and_(Order.status == OrderStatus.paid, ship_started_at <= ship_cutoff),
            )
        )


def _apply_admin_fraud_filter(
    filters: list[ColumnElement[bool]],
    *,
    fraud_clean: str | None,
    fraud_flagged_expr: ColumnElement[bool],
) -> None:
    if not fraud_clean:
        return
    fraud_approved = _order_tag_exists("fraud_approved")
    fraud_denied = _order_tag_exists("fraud_denied")
    if fraud_clean == "queue":
        filters.extend([fraud_flagged_expr, ~fraud_approved, ~fraud_denied])
        return
    if fraud_clean == "flagged":
        filters.append(fraud_flagged_expr)
        return
    if fraud_clean == "approved":
        filters.append(fraud_approved)
        return
    if fraud_clean == "denied":
        filters.append(fraud_denied)


def _apply_admin_date_and_query_filters(
    filters: list[ColumnElement[bool]],
    *,
    from_dt,
    to_dt,
    cleaned_q: str,
    user_model,
) -> None:
    if from_dt:
        filters.append(Order.created_at >= from_dt)
    if to_dt:
        filters.append(Order.created_at <= to_dt)
    if not cleaned_q:
        return
    query_lower = cleaned_q.lower()
    filters.append(
        or_(
            cast(Order.id, String).ilike(f"%{cleaned_q}%"),
            Order.reference_code.ilike(f"%{cleaned_q}%"),
            func.lower(Order.customer_email).ilike(f"%{query_lower}%"),
            func.lower(Order.customer_name).ilike(f"%{query_lower}%"),
            user_model.username.ilike(f"%{cleaned_q}%"),
        )
    )


def _build_admin_search_filters(
    *,
    options: _AdminOrderSearchOptions,
    user_model,
    cleaned_q: str,
    tag_clean: str | None,
    sla_clean: str | None,
    fraud_clean: str | None,
    fraud_flagged_expr: ColumnElement[bool],
    accept_started_at: Any,
    ship_started_at: Any,
    accept_cutoff: datetime,
    ship_cutoff: datetime,
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    _apply_admin_user_and_tag_filters(
        filters,
        user_id=options.user_id,
        tag_clean=tag_clean,
        include_test=options.include_test,
    )
    _apply_admin_status_filter(
        filters,
        pending_any=options.pending_any,
        statuses=options.statuses,
        status=options.status,
    )
    _apply_admin_sla_filter(
        filters,
        sla_clean=sla_clean,
        accept_started_at=accept_started_at,
        ship_started_at=ship_started_at,
        accept_cutoff=accept_cutoff,
        ship_cutoff=ship_cutoff,
    )
    _apply_admin_fraud_filter(filters, fraud_clean=fraud_clean, fraud_flagged_expr=fraud_flagged_expr)
    _apply_admin_date_and_query_filters(
        filters,
        from_dt=options.from_dt,
        to_dt=options.to_dt,
        cleaned_q=cleaned_q,
        user_model=user_model,
    )
    return filters


def _admin_order_count_stmt(*, user_model, email_velocity_subq, user_velocity_subq):
    return (
        select(func.count())
        .select_from(Order)
        .join(user_model, Order.user_id == user_model.id, isouter=True)
        .join(email_velocity_subq, email_velocity_subq.c.email == func.lower(Order.customer_email), isouter=True)
        .join(user_velocity_subq, user_velocity_subq.c.user_id == Order.user_id, isouter=True)
    )


def _admin_order_search_stmt(
    *,
    user_model,
    email_velocity_subq,
    user_velocity_subq,
    sla_kind_col: Any,
    sla_started_at_col: Any,
    fraud_flagged_col: Any,
    fraud_severity_col: Any,
    offset: int,
    limit: int,
):
    return (
        select(
            Order,
            Order.customer_email,
            user_model.username,
            sla_kind_col,
            sla_started_at_col,
            fraud_flagged_col,
            fraud_severity_col,
        )
        .join(user_model, Order.user_id == user_model.id, isouter=True)
        .join(email_velocity_subq, email_velocity_subq.c.email == func.lower(Order.customer_email), isouter=True)
        .join(user_velocity_subq, user_velocity_subq.c.user_id == Order.user_id, isouter=True)
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(limit)
    )


def _coerce_admin_order_rows(raw_rows) -> list[tuple[Order, str | None, str | None, str | None, datetime | None, bool, str | None]]:
    return [
        (order, email, username, sla_kind, sla_started_at, bool(fraud_flagged), fraud_severity)
        for (order, email, username, sla_kind, sla_started_at, fraud_flagged, fraud_severity) in raw_rows
    ]


async def _execute_admin_search_queries(
    session: AsyncSession,
    *,
    user_model,
    filters: list[ColumnElement[bool]],
    email_velocity_subq,
    user_velocity_subq,
    sla_kind_col: Any,
    sla_started_at_col: Any,
    fraud_flagged_col: Any,
    fraud_severity_col: Any,
    offset: int,
    limit: int,
) -> tuple[list[tuple[Order, str | None, str | None, str | None, datetime | None, bool, str | None]], int]:
    count_stmt = _admin_order_count_stmt(
        user_model=user_model,
        email_velocity_subq=email_velocity_subq,
        user_velocity_subq=user_velocity_subq,
    )
    if filters:
        count_stmt = count_stmt.where(*filters)
    total_items = int((await session.execute(count_stmt)).scalar_one() or 0)
    stmt = _admin_order_search_stmt(
        user_model=user_model,
        email_velocity_subq=email_velocity_subq,
        user_velocity_subq=user_velocity_subq,
        sla_kind_col=sla_kind_col,
        sla_started_at_col=sla_started_at_col,
        fraud_flagged_col=fraud_flagged_col,
        fraud_severity_col=fraud_severity_col,
        offset=offset,
        limit=limit,
    )
    if filters:
        stmt = stmt.where(*filters)
    return _coerce_admin_order_rows((await session.execute(stmt)).all()), total_items


async def _run_admin_search_orders(
    session: AsyncSession,
    options: _AdminOrderSearchOptions,
) -> tuple[list[tuple[Order, str | None, str | None, str | None, datetime | None, bool, str | None]], int]:
    from app.core.config import settings
    from app.models.user import User
    cleaned_q, limit, offset, tag_clean, sla_clean, fraud_clean = _normalize_admin_order_search_inputs(q=options.q, page=options.page, limit=options.limit, tag=options.tag, sla=options.sla, fraud=options.fraud)
    now = datetime.now(timezone.utc)
    accept_cutoff, ship_cutoff = _admin_sla_cutoffs(settings, now)
    threshold, retry_threshold, fraud_since = _admin_fraud_context(settings, now)
    accept_started_at, ship_started_at, sla_kind_col, sla_started_at_col = _admin_sla_columns()
    email_velocity_subq, user_velocity_subq = _admin_velocity_subqueries(fraud_since)
    fraud_flagged_expr, fraud_flagged_col, fraud_severity_col = _admin_fraud_columns(
        email_velocity_subq=email_velocity_subq,
        user_velocity_subq=user_velocity_subq,
        threshold=threshold,
        retry_threshold=retry_threshold,
    )
    filters = _build_admin_search_filters(
        options=options,
        user_model=User,
        cleaned_q=cleaned_q,
        tag_clean=tag_clean,
        sla_clean=sla_clean,
        fraud_clean=fraud_clean,
        fraud_flagged_expr=fraud_flagged_expr,
        accept_started_at=accept_started_at,
        ship_started_at=ship_started_at,
        accept_cutoff=accept_cutoff,
        ship_cutoff=ship_cutoff,
    )
    return await _execute_admin_search_queries(
        session,
        user_model=User,
        filters=filters,
        email_velocity_subq=email_velocity_subq,
        user_velocity_subq=user_velocity_subq,
        sla_kind_col=sla_kind_col,
        sla_started_at_col=sla_started_at_col,
        fraud_flagged_col=fraud_flagged_col,
        fraud_severity_col=fraud_severity_col,
        offset=offset,
        limit=limit,
    )


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
    options = _AdminOrderSearchOptions(
        q=q,
        user_id=user_id,
        status=status,
        statuses=statuses,
        pending_any=pending_any,
        tag=tag,
        sla=sla,
        fraud=fraud,
        include_test=include_test,
        from_dt=from_dt,
        to_dt=to_dt,
        page=page,
        limit=limit,
    )
    return await _run_admin_search_orders(session, options)


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


def _fraud_window_config(settings: object) -> tuple[int, int, datetime]:
    window_minutes = max(1, int(getattr(settings, "fraud_velocity_window_minutes", 60 * 24) or 60 * 24))
    threshold = max(2, int(getattr(settings, "fraud_velocity_threshold", 3) or 3))
    since = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    return window_minutes, threshold, since


async def _count_recent_orders_for_email(session: AsyncSession, email: str, since: datetime) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(Order).where(func.lower(Order.customer_email) == email, Order.created_at >= since)
            )
        ).scalar_one()
        or 0
    )


async def _count_recent_orders_for_user(session: AsyncSession, user_id: UUID, since: datetime) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(Order).where(Order.user_id == user_id, Order.created_at >= since)
            )
        ).scalar_one()
        or 0
    )


def _velocity_signal(code: str, count: int, *, threshold: int, window_minutes: int) -> dict:
    return {
        "code": code,
        "severity": "high" if count >= threshold else "medium",
        "data": {"count": count, "window_minutes": window_minutes},
    }


def _country_mismatch_signal(shipping_country: str, billing_country: str) -> dict:
    return {
        "code": "country_mismatch",
        "severity": "low",
        "data": {"shipping_country": shipping_country, "billing_country": billing_country},
    }


def _payment_retry_signal(retries: int, retry_threshold: int) -> dict:
    return {
        "code": "payment_retries",
        "severity": "medium" if retries >= retry_threshold else "low",
        "data": {"count": retries},
    }


async def _email_velocity_signal(
    session: AsyncSession,
    *,
    order: Order,
    threshold: int,
    window_minutes: int,
    since: datetime,
) -> dict | None:
    email = (getattr(order, "customer_email", None) or "").strip().lower()
    if not email:
        return None
    email_count = await _count_recent_orders_for_email(session, email, since)
    if email_count <= 1:
        return None
    return _velocity_signal("velocity_email", email_count, threshold=threshold, window_minutes=window_minutes)


async def _user_velocity_signal(
    session: AsyncSession,
    *,
    order: Order,
    threshold: int,
    window_minutes: int,
    since: datetime,
) -> dict | None:
    user_id = getattr(order, "user_id", None)
    if not user_id:
        return None
    user_count = await _count_recent_orders_for_user(session, user_id, since)
    if user_count <= 1:
        return None
    return _velocity_signal("velocity_user", user_count, threshold=threshold, window_minutes=window_minutes)


def _country_mismatch_signal_for_order(order: Order) -> dict | None:
    shipping_country = (getattr(getattr(order, "shipping_address", None), "country", None) or "").strip().upper()
    billing_country = (getattr(getattr(order, "billing_address", None), "country", None) or "").strip().upper()
    if not shipping_country or not billing_country or shipping_country == billing_country:
        return None
    return _country_mismatch_signal(shipping_country, billing_country)


def _payment_retry_signal_for_order(order: Order, retry_threshold: int) -> dict | None:
    retries = int(getattr(order, "payment_retry_count", 0) or 0)
    if retries <= 0:
        return None
    return _payment_retry_signal(retries, retry_threshold)


async def compute_fraud_signals(session: AsyncSession, order: Order) -> list[dict]:
    from app.core.config import settings

    window_minutes, threshold, since = _fraud_window_config(settings)
    retry_threshold = max(1, int(getattr(settings, "fraud_payment_retry_threshold", 2) or 2))
    candidates = [
        await _email_velocity_signal(
            session,
            order=order,
            threshold=threshold,
            window_minutes=window_minutes,
            since=since,
        ),
        await _user_velocity_signal(
            session,
            order=order,
            threshold=threshold,
            window_minutes=window_minutes,
            since=since,
        ),
        _country_mismatch_signal_for_order(order),
        _payment_retry_signal_for_order(order, retry_threshold),
    ]
    return [candidate for candidate in candidates if candidate is not None]


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


_ADDRESS_UPDATE_FORBIDDEN_FIELDS = {
    "is_default_shipping",
    "is_default_billing",
    "user_id",
    "id",
    "created_at",
    "updated_at",
}
_ADDRESS_UPDATE_REQUIRED_FIELDS = ("line1", "city", "postal_code", "country")


def _clean_address_update_payload(updates: dict | None) -> dict:
    return {k: v for k, v in (updates or {}).items() if k not in _ADDRESS_UPDATE_FORBIDDEN_FIELDS}


def _validate_required_address_fields(cleaned: dict) -> None:
    for field in _ADDRESS_UPDATE_REQUIRED_FIELDS:
        if field not in cleaned:
            continue
        if cleaned[field] is not None and str(cleaned[field]).strip():
            continue
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} is required")


def _resolve_validated_country_postal(addr: Address, cleaned: dict) -> tuple[str, str]:
    target_country = str(cleaned.get("country", getattr(addr, "country", "")) or "").strip()
    target_postal = str(cleaned.get("postal_code", getattr(addr, "postal_code", "")) or "").strip()
    return address_service._validate_address_fields(target_country, target_postal)


def _assign_address_fields(addr: Address, cleaned: dict) -> None:
    for field, value in cleaned.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(addr, field, value)


def _apply_address_update(addr: Address, updates: dict) -> None:
    cleaned = _clean_address_update_payload(updates)
    _validate_required_address_fields(cleaned)

    country, postal_code = _resolve_validated_country_postal(addr, cleaned)
    cleaned["country"] = country
    cleaned["postal_code"] = postal_code
    _assign_address_fields(addr, cleaned)
    addr.is_default_shipping = False
    addr.is_default_billing = False


def _previous_order_amounts(order: Order) -> tuple[Decimal, Decimal, Decimal]:
    return (
        pricing.quantize_money(Decimal(getattr(order, "shipping_amount", 0) or 0)),
        pricing.quantize_money(Decimal(getattr(order, "tax_amount", 0) or 0)),
        pricing.quantize_money(Decimal(getattr(order, "total_amount", 0) or 0)),
    )


def _order_fee_amount(order: Order, rounding: MoneyRounding) -> Decimal:
    return pricing.quantize_money(Decimal(getattr(order, "fee_amount", 0) or 0), rounding=rounding)


def _taxable_subtotal_for_order(order: Order, fee_amount: Decimal, rounding: MoneyRounding) -> Decimal:
    taxable_subtotal = Decimal(order.total_amount) - Decimal(order.shipping_amount) - Decimal(order.tax_amount) - fee_amount
    if taxable_subtotal < 0:
        taxable_subtotal = Decimal("0.00")
    return pricing.quantize_money(taxable_subtotal, rounding=rounding)


def _shipping_amount_for_subtotal(
    *,
    taxable_subtotal: Decimal,
    shipping_fee: Decimal,
    free_shipping_threshold: Decimal | None,
    rounding: MoneyRounding,
) -> Decimal:
    shipping_amount = Decimal(shipping_fee)
    if free_shipping_threshold is not None and free_shipping_threshold >= 0 and taxable_subtotal >= free_shipping_threshold:
        shipping_amount = Decimal("0.00")
    return pricing.quantize_money(shipping_amount, rounding=rounding)


def _subtotal_items(order: Order, rounding: MoneyRounding) -> Decimal:
    subtotal = sum(
        (Decimal(getattr(item, "subtotal", 0) or 0) for item in getattr(order, "items", []) or []),
        start=Decimal("0.00"),
    )
    return pricing.quantize_money(subtotal, rounding=rounding)


def _taxable_lines(order: Order, rounding: MoneyRounding) -> list[TaxableProductLine]:
    return [
        TaxableProductLine(
            product_id=item.product_id,
            subtotal=pricing.quantize_money(Decimal(item.subtotal), rounding=rounding),
        )
        for item in getattr(order, "items", []) or []
        if getattr(item, "product_id", None)
    ]


def _discount_for_totals(*, subtotal_items: Decimal, taxable_subtotal: Decimal, rounding: MoneyRounding) -> Decimal:
    discount_val = subtotal_items - taxable_subtotal
    if discount_val < 0:
        discount_val = Decimal("0.00")
    return pricing.quantize_money(discount_val, rounding=rounding)


def _apply_rerated_totals(
    *,
    order: Order,
    taxable_subtotal: Decimal,
    fee_amount: Decimal,
    shipping_amount: Decimal,
    vat_amount: Decimal,
    rounding: MoneyRounding,
) -> None:
    order.shipping_amount = shipping_amount
    order.tax_amount = vat_amount
    order.total_amount = pricing.quantize_money(
        taxable_subtotal + fee_amount + shipping_amount + vat_amount,
        rounding=rounding,
    )


def _rerate_change_payload(
    *,
    previous_shipping: Decimal,
    previous_tax: Decimal,
    previous_total: Decimal,
    order: Order,
) -> dict[str, dict[str, str]]:
    return {
        "shipping_amount": {"from": str(previous_shipping), "to": str(order.shipping_amount)},
        "tax_amount": {"from": str(previous_tax), "to": str(order.tax_amount)},
        "total_amount": {"from": str(previous_total), "to": str(order.total_amount)},
    }


async def _apply_order_address_kind_update(
    session: AsyncSession,
    *,
    order: Order,
    kind: str,
    updates: dict,
) -> dict[str, object] | None:
    if not updates:
        return None
    attr_name = f"{kind}_address"
    previous = _address_snapshot(getattr(order, attr_name, None))
    address = await _ensure_order_address_snapshot(session, order, kind)
    _apply_address_update(address, updates)
    session.add(address)
    return {"from": previous, "to": _address_snapshot(address)}


async def _maybe_rerate_for_address_update(
    session: AsyncSession,
    *,
    order: Order,
    should_rerate: bool,
) -> dict[str, dict[str, str]] | None:
    if not should_rerate:
        return None
    if _has_payment_captured(order):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot re-rate shipping after payment capture")
    return await _rerate_order_shipping(session, order)


def _address_updates_from_payload(payload: AdminOrderAddressesUpdate) -> tuple[dict, dict]:
    shipping_updates = payload.shipping_address.model_dump(exclude_unset=True) if payload.shipping_address else {}
    billing_updates = payload.billing_address.model_dump(exclude_unset=True) if payload.billing_address else {}
    if shipping_updates or billing_updates:
        return shipping_updates, billing_updates
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No address updates provided")


def _compose_address_update_note(*, actor: str | None, note: str | None) -> str | None:
    note_clean = (note or "").strip() or None
    actor_clean = (actor or "").strip() or None
    return f"{actor_clean}: {note_clean}" if actor_clean and note_clean else (actor_clean or note_clean)


def _ensure_order_addresses_are_editable(order: Order) -> None:
    if order.status in {OrderStatus.shipped, OrderStatus.delivered, OrderStatus.cancelled, OrderStatus.refunded}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order addresses cannot be edited in this status")


async def _rerate_order_shipping(session: AsyncSession, order: Order) -> dict[str, dict[str, str]]:
    previous_shipping, previous_tax, previous_total = _previous_order_amounts(order)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    rounding = checkout_settings.money_rounding
    fee_amount = _order_fee_amount(order, rounding)
    taxable_subtotal = _taxable_subtotal_for_order(order, fee_amount, rounding)
    shipping_amount = _shipping_amount_for_subtotal(
        taxable_subtotal=taxable_subtotal,
        shipping_fee=checkout_settings.shipping_fee_ron,
        free_shipping_threshold=checkout_settings.free_shipping_threshold_ron,
        rounding=rounding,
    )
    subtotal_items = _subtotal_items(order, rounding)
    discount_val = _discount_for_totals(
        subtotal_items=subtotal_items,
        taxable_subtotal=taxable_subtotal,
        rounding=rounding,
    )
    country_code = getattr(getattr(order, "shipping_address", None), "country", None)
    lines = _taxable_lines(order, rounding)
    vat_amount = await taxes_service.compute_cart_vat_amount(
        session,
        country_code=country_code,
        lines=lines,
        discount=discount_val,
        shipping=shipping_amount,
        fee=fee_amount,
        checkout=checkout_settings,
    )
    _apply_rerated_totals(
        order=order,
        taxable_subtotal=taxable_subtotal,
        fee_amount=fee_amount,
        shipping_amount=shipping_amount,
        vat_amount=vat_amount,
        rounding=rounding,
    )
    return _rerate_change_payload(
        previous_shipping=previous_shipping,
        previous_tax=previous_tax,
        previous_total=previous_total,
        order=order,
    )


def _clean_cancel_reason(cancel_reason: object | None) -> str | None:
    if cancel_reason is None:
        return None
    cleaned = str(cancel_reason).strip()
    return cleaned[:2000] if cleaned else ""


def _allowed_next_order_statuses(*, current_status: OrderStatus, payment_method: str) -> set[OrderStatus]:
    allowed = set(ALLOWED_TRANSITIONS.get(current_status, set()))
    if payment_method == "cod" and current_status == OrderStatus.pending_acceptance:
        # COD orders can ship directly from pending_acceptance.
        allowed.update({OrderStatus.shipped, OrderStatus.delivered})
    return allowed


def _status_requires_captured_payment(
    *,
    current_status: OrderStatus,
    next_status: OrderStatus,
    payment_method: str,
) -> bool:
    return (
        current_status == OrderStatus.pending_acceptance
        and next_status == OrderStatus.paid
        and payment_method in {"stripe", "paypal"}
    )


def _status_requires_cancel_reason(*, current_status: OrderStatus, next_status: OrderStatus) -> bool:
    return (
        next_status == OrderStatus.cancelled
        and current_status in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}
    )


def _normalized_order_payment_method(order: Order) -> str:
    return (getattr(order, "payment_method", None) or "").strip().lower()


async def _apply_status_change_side_effects(session: AsyncSession, *, order: Order, next_status: OrderStatus) -> None:
    if next_status in {OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered}:
        await _commit_stock_for_order(session, order)
        return
    if next_status == OrderStatus.cancelled:
        await _restore_stock_for_order(session, order)


async def _apply_status_change_update(
    session: AsyncSession,
    *,
    order: Order,
    data: dict[str, object],
    cancel_reason_clean: str | None,
) -> None:
    if "status" not in data:
        return
    status_value = data["status"]
    if not status_value:
        return
    current_status = OrderStatus(order.status)
    next_status = OrderStatus(status_value)
    payment_method = _normalized_order_payment_method(order)
    requires_capture = _status_requires_captured_payment(
        current_status=current_status,
        next_status=next_status,
        payment_method=payment_method,
    )
    if requires_capture:
        if not _has_payment_captured(order):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment is not captured yet. Wait for payment confirmation before accepting the order.")
    requires_reason = _status_requires_cancel_reason(current_status=current_status, next_status=next_status)
    if requires_reason and not cancel_reason_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason is required")
    if next_status not in _allowed_next_order_statuses(current_status=current_status, payment_method=payment_method):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")
    order.status = next_status
    data.pop("status")
    await _apply_status_change_side_effects(session, order=order, next_status=next_status)
    await _log_event(
        session,
        order.id,
        "status_change",
        f"{current_status.value} -> {next_status.value}",
        data={"changes": {"status": {"from": current_status.value, "to": next_status.value}}},
    )


def _apply_cancel_reason_update(
    session: AsyncSession,
    *,
    order: Order,
    cancel_reason_clean: str | None,
) -> None:
    if cancel_reason_clean is None:
        return
    if not cancel_reason_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason is required")
    if order.status != OrderStatus.cancelled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason can only be set for cancelled orders")
    previous_reason = (getattr(order, "cancel_reason", None) or "").strip()
    if previous_reason == cancel_reason_clean:
        return
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


def _has_tracking_payload_fields(data: dict[str, object]) -> bool:
    return any(field in data for field in ("tracking_number", "tracking_url", "courier"))


def _tracking_target_courier(order: Order, data: dict[str, object]) -> str | None:
    if "courier" in data:
        return typing_cast(str | None, data.get("courier"))
    return typing_cast(str | None, getattr(order, "courier", None))


def _validate_existing_tracking_for_courier(order: Order, *, target_courier: str | None) -> None:
    existing_tracking = typing_cast(str | None, getattr(order, "tracking_number", None))
    if not (existing_tracking or "").strip():
        return
    tracking_service.validate_tracking_number(courier=target_courier, tracking_number=existing_tracking)


def _validate_tracking_number_payload(
    order: Order,
    data: dict[str, object],
    *,
    target_courier: str | None,
) -> None:
    if "tracking_number" in data:
        data["tracking_number"] = tracking_service.validate_tracking_number(
            courier=target_courier,
            tracking_number=typing_cast(str | None, data.get("tracking_number")),
        )
        return
    if "courier" in data:
        _validate_existing_tracking_for_courier(order, target_courier=target_courier)


def _validate_tracking_update_payload(order: Order, data: dict[str, object]) -> None:
    if not _has_tracking_payload_fields(data):
        return
    target_courier = _tracking_target_courier(order, data)
    _validate_tracking_number_payload(order, data, target_courier=target_courier)
    if "tracking_url" in data:
        data["tracking_url"] = tracking_service.validate_tracking_url(tracking_url=typing_cast(str | None, data.get("tracking_url")))


async def _apply_shipping_method_update(
    session: AsyncSession,
    *,
    order: Order,
    shipping_method: ShippingMethod | None,
    previous_shipping_method_name: str | None,
) -> None:
    if not shipping_method:
        return
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
    await _rerate_order_shipping(session, order)


def _tracking_changes_payload(
    *,
    order: Order,
    data: dict[str, object],
    previous_tracking_number: object | None,
    previous_tracking_url: object | None,
) -> dict[str, dict[str, object]]:
    tracking_changes: dict[str, dict[str, object]] = {}
    if "tracking_number" in data and getattr(order, "tracking_number", None) != previous_tracking_number:
        tracking_changes["tracking_number"] = {"from": previous_tracking_number, "to": getattr(order, "tracking_number", None)}
    if "tracking_url" in data and getattr(order, "tracking_url", None) != previous_tracking_url:
        tracking_changes["tracking_url"] = {"from": previous_tracking_url, "to": getattr(order, "tracking_url", None)}
    return tracking_changes


def _append_tracking_and_courier_events(
    session: AsyncSession,
    *,
    order: Order,
    data: dict[str, object],
    previous_tracking_number: object | None,
    previous_tracking_url: object | None,
    previous_courier: object | None,
) -> None:
    tracking_changes = _tracking_changes_payload(
        order=order,
        data=data,
        previous_tracking_number=previous_tracking_number,
        previous_tracking_url=previous_tracking_url,
    )
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


def _tracking_payload_has_value(data: dict[str, object]) -> bool:
    return any(str(data.get(key) or "").strip() for key in ("tracking_number", "tracking_url"))


async def _maybe_auto_ship_on_tracking_update(
    session: AsyncSession,
    *,
    order: Order,
    data: dict[str, object],
    explicit_status: bool,
) -> None:
    if explicit_status or not _tracking_payload_has_value(data) or order.status != OrderStatus.paid:
        return
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


async def update_order(
    session: AsyncSession, order: Order, payload: OrderUpdate, shipping_method: ShippingMethod | None = None
) -> Order:
    data = payload.model_dump(exclude_unset=True)
    explicit_status = bool(data.get("status"))
    previous_tracking_number = getattr(order, "tracking_number", None)
    previous_tracking_url = getattr(order, "tracking_url", None)
    previous_courier = getattr(order, "courier", None)
    previous_shipping_method_name = getattr(getattr(order, "shipping_method", None), "name", None)
    cancel_reason_clean = _clean_cancel_reason(data.pop("cancel_reason", None))

    await _apply_status_change_update(session, order=order, data=data, cancel_reason_clean=cancel_reason_clean)
    _apply_cancel_reason_update(session, order=order, cancel_reason_clean=cancel_reason_clean)
    _validate_tracking_update_payload(order, data)
    await _apply_shipping_method_update(
        session,
        order=order,
        shipping_method=shipping_method,
        previous_shipping_method_name=previous_shipping_method_name,
    )

    for field, value in data.items():
        setattr(order, field, value)

    _append_tracking_and_courier_events(
        session,
        order=order,
        data=data,
        previous_tracking_number=previous_tracking_number,
        previous_tracking_url=previous_tracking_url,
        previous_courier=previous_courier,
    )
    await _maybe_auto_ship_on_tracking_update(session, order=order, data=data, explicit_status=explicit_status)
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
    _ensure_order_addresses_are_editable(order)
    await session.refresh(order, attribute_names=["shipping_address", "billing_address", "items"])
    changes: dict[str, object] = {}
    shipping_updates, billing_updates = _address_updates_from_payload(payload)
    shipping_change = await _apply_order_address_kind_update(
        session,
        order=order,
        kind="shipping",
        updates=shipping_updates,
    )
    if shipping_change is not None:
        changes["shipping_address"] = shipping_change

    billing_change = await _apply_order_address_kind_update(
        session,
        order=order,
        kind="billing",
        updates=billing_updates,
    )
    if billing_change is not None:
        changes["billing_address"] = billing_change

    amount_changes = await _maybe_rerate_for_address_update(
        session,
        order=order,
        should_rerate=bool(payload.rerate_shipping and shipping_updates),
    )
    if amount_changes is not None:
        changes.update(amount_changes)
    note = _compose_address_update_note(actor=actor, note=payload.note)
    session.add(
        OrderEvent(
            order_id=order.id,
            event="addresses_updated",
            note=note,
            data={"changes": changes, "actor_user_id": str(actor_user_id) if actor_user_id else None},
        )
    )
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


def _validate_tag_rename_inputs(from_tag: str, to_tag: str) -> tuple[str, str]:
    from_clean = _normalize_order_tag(from_tag)
    to_clean = _normalize_order_tag(to_tag)
    if not from_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from_tag is required")
    if not to_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="to_tag is required")
    if from_clean == to_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tags must be different")
    return from_clean, to_clean


def _collect_affected_order_ids(tag_rows: Sequence[OrderTag]) -> set[UUID]:
    return {row.order_id for row in tag_rows if getattr(row, "order_id", None)}


def _ensure_affected_order_limit(affected_order_ids: set[UUID], max_affected_orders: int) -> None:
    if len(affected_order_ids) <= max_affected_orders:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Too many affected orders ({len(affected_order_ids)}); narrow the scope first.",
    )


async def _fetch_orders_with_target_tag(
    session: AsyncSession, *, affected_order_ids: set[UUID], to_clean: str
) -> set[UUID]:
    if not affected_order_ids:
        return set()

    existing_targets = (
        await session.execute(
            select(OrderTag.order_id).where(OrderTag.order_id.in_(affected_order_ids), OrderTag.tag == to_clean)
        )
    ).all()
    return {row[0] for row in existing_targets if row and row[0]}


async def _apply_tag_rename_rows(
    session: AsyncSession,
    *,
    tag_rows: Sequence[OrderTag],
    to_clean: str,
    orders_with_target: set[UUID],
    from_clean: str,
    actor_value: str | None,
) -> tuple[int, int]:
    updated = 0
    merged = 0
    note = f"{from_clean} -> {to_clean}"

    for tag_row in tag_rows:
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

    return updated, merged


async def rename_order_tag(
    session: AsyncSession,
    *,
    from_tag: str,
    to_tag: str,
    actor_user_id: UUID | None = None,
    max_affected_orders: int = 5000,
) -> dict[str, object]:
    from_clean, to_clean = _validate_tag_rename_inputs(from_tag, to_tag)

    rows = (await session.execute(select(OrderTag).where(OrderTag.tag == from_clean))).scalars().all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    affected_order_ids = _collect_affected_order_ids(rows)
    _ensure_affected_order_limit(affected_order_ids, max_affected_orders)
    orders_with_target = await _fetch_orders_with_target_tag(
        session,
        affected_order_ids=affected_order_ids,
        to_clean=to_clean,
    )
    actor_value = str(actor_user_id) if actor_user_id else None

    updated, merged = await _apply_tag_rename_rows(
        session,
        tag_rows=rows,
        to_clean=to_clean,
        orders_with_target=orders_with_target,
        from_clean=from_clean,
        actor_value=actor_value,
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


def _normalize_fraud_decision(decision: str) -> str:
    decision_clean = (decision or "").strip().lower()
    if decision_clean in {"approve", "deny"}:
        return decision_clean
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid fraud review decision")


def _fraud_tags_for_decision(decision_clean: str) -> tuple[str, str]:
    if decision_clean == "approve":
        return "fraud_approved", "fraud_denied"
    return "fraud_denied", "fraud_approved"


def _normalize_fraud_note(note: str | None) -> str | None:
    note_clean = (note or "").strip() or None
    if not note_clean:
        return None
    return note_clean[:500]


async def _sync_fraud_decision_tags(
    session: AsyncSession,
    *,
    order_id: UUID,
    by_tag: dict[str, OrderTag],
    target_tag: str,
    remove_tag: str,
    actor_user_id: UUID | None,
) -> None:
    removed = by_tag.get(remove_tag)
    if removed is not None:
        await session.delete(removed)

    if target_tag in by_tag:
        return
    session.add(OrderTag(order_id=order_id, actor_user_id=actor_user_id, tag=target_tag))


def _build_fraud_audit_note(decision_clean: str, note_clean: str | None) -> str:
    if not note_clean:
        return decision_clean
    return f"{decision_clean}: {note_clean}"


def _build_fraud_admin_note(decision_clean: str, note_clean: str | None) -> str:
    return f"Fraud review: {decision_clean}" + (f" - {note_clean}" if note_clean else "")


def _clean_optional_text(value: object | None) -> str | None:
    return (str(value or "")).strip() or None


async def _ensure_unique_order_shipment(
    session: AsyncSession,
    *,
    order_id: UUID,
    tracking_number: str,
    exclude_id: UUID | None = None,
) -> None:
    existing = await _shipment_id_by_tracking(
        session,
        order_id=order_id,
        tracking_number=tracking_number,
        exclude_id=exclude_id,
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment already exists")


async def _shipment_id_by_tracking(
    session: AsyncSession,
    *,
    order_id: UUID,
    tracking_number: str,
    exclude_id: UUID | None = None,
) -> UUID | None:
    criteria: list[ColumnElement[bool]] = [
        OrderShipment.order_id == order_id,
        OrderShipment.tracking_number == tracking_number,
    ]
    if exclude_id is not None:
        criteria.append(OrderShipment.id != exclude_id)
    return (
        (
            await session.execute(
                select(OrderShipment.id).where(*criteria),
            )
        )
        .scalars()
        .first()
    )


def _new_order_shipment(
    *,
    order_id: UUID,
    courier: str | None,
    tracking_number: str,
    tracking_url: str | None,
) -> OrderShipment:
    return OrderShipment(
        order_id=order_id,
        courier=courier,
        tracking_number=tracking_number,
        tracking_url=tracking_url,
    )


def _shipment_previous_fields(shipment: OrderShipment) -> tuple[str | None, str | None, str | None]:
    return (
        getattr(shipment, "tracking_number", None),
        getattr(shipment, "tracking_url", None),
        getattr(shipment, "courier", None),
    )


async def _hydrate_admin_order_or_current(session: AsyncSession, order: Order) -> Order:
    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


def _validate_shipment_tracking(
    *,
    courier: str | None,
    tracking_number: str | None,
    tracking_url: str | None,
) -> tuple[str, str | None]:
    tracking_number_validated = tracking_service.validate_tracking_number(
        courier=courier,
        tracking_number=tracking_number,
    )
    if not tracking_number_validated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is required")
    return tracking_number_validated, tracking_service.validate_tracking_url(tracking_url=tracking_url)


def _apply_order_tracking_defaults(
    *,
    order: Order,
    courier: str | None,
    tracking_number: str,
    tracking_url: str | None,
) -> None:
    default_fields = (
        ("tracking_number", tracking_number),
        ("tracking_url", tracking_url),
        ("courier", courier),
    )
    for field, value in default_fields:
        if not value:
            continue
        if (getattr(order, field, None) or "").strip():
            continue
        setattr(order, field, value)


def _shipment_change_set(
    *,
    shipment: OrderShipment,
    previous_tracking_number: str | None,
    previous_tracking_url: str | None,
    previous_courier: str | None,
) -> dict[str, dict[str, object]]:
    changes: dict[str, dict[str, object]] = {}
    if getattr(shipment, "tracking_number", None) != previous_tracking_number:
        changes["tracking_number"] = {"from": previous_tracking_number, "to": getattr(shipment, "tracking_number", None)}
    if getattr(shipment, "tracking_url", None) != previous_tracking_url:
        changes["tracking_url"] = {"from": previous_tracking_url, "to": getattr(shipment, "tracking_url", None)}
    if getattr(shipment, "courier", None) != previous_courier:
        changes["courier"] = {"from": previous_courier, "to": getattr(shipment, "courier", None)}
    return changes


def _apply_shipment_optional_updates(shipment: OrderShipment, data: dict[str, object]) -> None:
    if "tracking_url" in data:
        shipment.tracking_url = _clean_optional_text(data.get("tracking_url"))
    if "courier" in data:
        shipment.courier = _clean_optional_text(data.get("courier"))


async def _apply_shipment_tracking_update(
    session: AsyncSession,
    *,
    order_id: UUID,
    shipment: OrderShipment,
    shipment_id: UUID,
    tracking_number: object | None,
) -> None:
    normalized_tracking_number = (str(tracking_number or "")).strip()
    if not normalized_tracking_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is required")
    await _ensure_unique_order_shipment(
        session,
        order_id=order_id,
        tracking_number=normalized_tracking_number,
        exclude_id=shipment_id,
    )
    shipment.tracking_number = normalized_tracking_number


def _build_shipment_added_event(
    *,
    order_id: UUID,
    actor: str | None,
    tracking_number: str,
    tracking_url: str | None,
    courier: str | None,
) -> OrderEvent:
    actor_clean = (actor or "").strip() or None
    note = f"{actor_clean}: {tracking_number}" if actor_clean else tracking_number
    return OrderEvent(
        order_id=order_id,
        event="shipment_added",
        note=note,
        data={"shipment": {"tracking_number": tracking_number, "tracking_url": tracking_url, "courier": courier}},
    )


def _build_shipment_updated_event(
    *,
    order_id: UUID,
    shipment_id: UUID,
    actor: str | None,
    changes: dict[str, dict[str, object]],
) -> OrderEvent:
    actor_clean = (actor or "").strip() or None
    return OrderEvent(
        order_id=order_id,
        event="shipment_updated",
        note=actor_clean or None,
        data={"shipment_id": str(shipment_id), "changes": changes},
    )


async def _commit_order_shipment(session: AsyncSession, *, conflict_detail: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict_detail) from exc


async def review_order_fraud(
    session: AsyncSession,
    order: Order,
    *,
    decision: str,
    note: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    decision_clean = _normalize_fraud_decision(decision)
    target_tag, remove_tag = _fraud_tags_for_decision(decision_clean)
    note_clean = _normalize_fraud_note(note)

    tags = (
        await session.execute(
            select(OrderTag).where(OrderTag.order_id == order.id, OrderTag.tag.in_([target_tag, remove_tag]))
        )
    ).scalars().all()
    by_tag = {row.tag: row for row in tags if row and row.tag}

    await _sync_fraud_decision_tags(
        session,
        order_id=order.id,
        by_tag=by_tag,
        target_tag=target_tag,
        remove_tag=remove_tag,
        actor_user_id=actor_user_id,
    )

    audit_note = _build_fraud_audit_note(decision_clean, note_clean)
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
    admin_note = _build_fraud_admin_note(decision_clean, note_clean)
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

    courier = _clean_optional_text(payload.courier)
    tracking_url = _clean_optional_text(payload.tracking_url)
    tracking_number, tracking_url = _validate_shipment_tracking(
        courier=courier,
        tracking_number=tracking_number,
        tracking_url=tracking_url,
    )
    await _ensure_unique_order_shipment(
        session,
        order_id=order.id,
        tracking_number=tracking_number,
    )

    shipment = _new_order_shipment(
        order_id=order.id,
        courier=courier,
        tracking_number=tracking_number,
        tracking_url=tracking_url,
    )
    session.add(shipment)
    _apply_order_tracking_defaults(
        order=order,
        courier=courier,
        tracking_number=tracking_number,
        tracking_url=tracking_url,
    )
    session.add(order)
    session.add(
        _build_shipment_added_event(
            order_id=order.id,
            actor=actor,
            tracking_number=tracking_number,
            tracking_url=tracking_url,
            courier=courier,
        )
    )
    await _commit_order_shipment(session, conflict_detail="Shipment already exists")
    return await _hydrate_admin_order_or_current(session, order)


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
    previous_tracking_number, previous_tracking_url, previous_courier = _shipment_previous_fields(shipment)

    if "tracking_number" in data:
        await _apply_shipment_tracking_update(
            session,
            order_id=order.id,
            shipment=shipment,
            shipment_id=shipment_id,
            tracking_number=data.get("tracking_number"),
        )
    _apply_shipment_optional_updates(shipment, data)

    shipment.tracking_number, shipment.tracking_url = _validate_shipment_tracking(
        courier=getattr(shipment, "courier", None),
        tracking_number=getattr(shipment, "tracking_number", None),
        tracking_url=getattr(shipment, "tracking_url", None),
    )

    session.add(shipment)
    changes = _shipment_change_set(
        shipment=shipment,
        previous_tracking_number=previous_tracking_number,
        previous_tracking_url=previous_tracking_url,
        previous_courier=previous_courier,
    )
    if changes:
        session.add(
            _build_shipment_updated_event(
                order_id=order.id,
                shipment_id=shipment_id,
                actor=actor,
                changes=changes,
            )
        )
    await _commit_order_shipment(session, conflict_detail="Shipment already exists")
    return await _hydrate_admin_order_or_current(session, order)


def _require_order_shipment(shipment: OrderShipment | None, order_id: UUID) -> OrderShipment:
    if not shipment or shipment.order_id != order_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipment not found")
    return shipment


def _build_deleted_shipment_note(actor: str | None, tracking_number: object | None) -> object | None:
    actor_clean = (actor or "").strip() or None
    return f"{actor_clean}: {tracking_number}" if actor_clean and tracking_number else (actor_clean or tracking_number)


async def _commit_deleted_shipment(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Could not delete shipment") from exc


async def delete_order_shipment(
    session: AsyncSession,
    order: Order,
    shipment_id: UUID,
    *,
    actor: str | None = None,
    actor_user_id: UUID | None = None,
) -> Order:
    shipment = _require_order_shipment(await session.get(OrderShipment, shipment_id), order.id)

    tracking_number = getattr(shipment, "tracking_number", None)
    await session.delete(shipment)

    note = _build_deleted_shipment_note(actor, tracking_number)
    session.add(OrderEvent(order_id=order.id, event="shipment_deleted", note=note, data={"shipment_id": str(shipment_id)}))

    await _commit_deleted_shipment(session)

    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


async def _generate_reference_code(session: AsyncSession, length: int = 10) -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        candidate = "".join(secrets.choice(chars) for _ in range(length))
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


def _ensure_refund_allowed(order: Order) -> None:
    if order.status in {OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered}:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund allowed only for paid/shipped/delivered orders")


def _compute_refund_balance(order: Order) -> tuple[Decimal, Decimal, Decimal]:
    already_refunded = sum((Decimal(refund.amount) for refund in (order.refunds or [])), Decimal("0.00"))
    total_amount = pricing.quantize_money(Decimal(order.total_amount))
    remaining = pricing.quantize_money(total_amount - already_refunded)
    if remaining <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order already fully refunded")
    return already_refunded, total_amount, remaining


def _normalize_refund_amount(amount: Decimal, remaining: Decimal) -> Decimal:
    amount_q = pricing.quantize_money(Decimal(amount))
    if amount_q <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid refund amount")
    if amount_q > remaining:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund amount exceeds remaining refundable")
    return amount_q


def _normalize_refund_note(note: str) -> str:
    note_clean = (note or "").strip()
    if not note_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund note is required")
    return note_clean[:2000]


def _refund_item_rows(existing_refund: OrderRefund) -> list[object]:
    payload = existing_refund.data if isinstance(existing_refund.data, dict) else {}
    rows = payload.get("items")
    return rows if isinstance(rows, list) else []


def _parse_refunded_qty_row(row: object) -> tuple[UUID, int] | None:
    if not isinstance(row, dict):
        return None
    item_id = _try_uuid(row.get("order_item_id"))
    if not item_id:
        return None
    try:
        quantity = int(row.get("quantity") or 0)
    except Exception:
        return None
    return (item_id, quantity) if quantity > 0 else None


def _refunded_qty_by_item(order: Order) -> dict[UUID, int]:
    refunded_qty: dict[UUID, int] = {}
    for existing_refund in order.refunds or []:
        for row in _refund_item_rows(existing_refund):
            parsed = _parse_refunded_qty_row(row)
            if not parsed:
                continue
            item_id, quantity = parsed
            refunded_qty[item_id] = refunded_qty.get(item_id, 0) + quantity
    return refunded_qty


def _requested_refund_qty(items: list[tuple[UUID, int]]) -> dict[UUID, int]:
    requested_qty: dict[UUID, int] = {}
    for item_id, qty in items:
        quantity = int(qty or 0)
        if quantity <= 0:
            continue
        requested_qty[item_id] = requested_qty.get(item_id, 0) + quantity
    return requested_qty


def _require_refundable_order_item(items_by_id: dict[UUID, OrderItem], item_id: UUID) -> OrderItem:
    order_item = items_by_id.get(item_id)
    if order_item:
        return order_item
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order item")


def _validate_refund_quantity_bounds(
    *,
    order_item: OrderItem,
    requested_qty: int,
    already_refunded_qty: int,
) -> None:
    remaining_qty = int(order_item.quantity or 0) - already_refunded_qty
    if remaining_qty <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order item already fully refunded")
    if requested_qty > remaining_qty:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund quantity exceeds remaining refundable quantity")


def _select_refund_items(
    *,
    order: Order,
    requested_qty: dict[UUID, int],
    refunded_qty: dict[UUID, int],
) -> tuple[list[dict], Decimal]:
    items_by_id = {item.id: item for item in (order.items or [])}
    selected_items: list[dict] = []
    items_total = Decimal("0.00")
    for item_id, quantity in requested_qty.items():
        order_item = _require_refundable_order_item(items_by_id, item_id)
        _validate_refund_quantity_bounds(
            order_item=order_item,
            requested_qty=quantity,
            already_refunded_qty=int(refunded_qty.get(item_id, 0)),
        )
        selected_items.append({"order_item_id": str(order_item.id), "quantity": quantity})
        unit_price = Decimal(str(getattr(order_item, "unit_price", "0") or "0"))
        items_total += pricing.quantize_money(unit_price * Decimal(quantity))
    return selected_items, items_total


def _validate_refund_item_selection(
    *,
    order: Order,
    items: list[tuple[UUID, int]] | None,
    amount_q: Decimal,
) -> list[dict]:
    if not items:
        return []
    refunded_qty = _refunded_qty_by_item(order)
    requested_qty = _requested_refund_qty(items)
    selected_items, items_total = _select_refund_items(
        order=order,
        requested_qty=requested_qty,
        refunded_qty=refunded_qty,
    )
    if selected_items and amount_q > pricing.quantize_money(items_total):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund amount exceeds selected items total")
    return selected_items


async def _resolve_refund_provider(
    *,
    order: Order,
    amount_q: Decimal,
    process_payment: bool,
) -> tuple[str, str | None]:
    if not process_payment:
        return "manual", None
    method = (getattr(order, "payment_method", None) or "").strip().lower()
    if method == "stripe":
        return await _stripe_refund_provider(order, amount_q)
    if method == "paypal":
        return await _paypal_refund_provider(order, amount_q)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Automatic refunds not supported for this payment method")


async def _stripe_refund_provider(order: Order, amount_q: Decimal) -> tuple[str, str | None]:
    payment_intent_id = (getattr(order, "stripe_payment_intent_id", None) or "").strip()
    if not payment_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stripe payment intent id required")
    cents = int((amount_q * 100).to_integral_value(rounding=ROUND_HALF_UP))
    refund = await payments.refund_payment_intent(payment_intent_id, amount_cents=cents)
    return "stripe", (refund.get("id") if isinstance(refund, dict) else None)


async def _paypal_refund_provider(order: Order, amount_q: Decimal) -> tuple[str, str | None]:
    capture_id = (getattr(order, "paypal_capture_id", None) or "").strip()
    if not capture_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PayPal capture id required")
    refund_id = (await paypal.refund_capture(paypal_capture_id=capture_id, amount_ron=amount_q)) or None
    return "paypal", refund_id


def _partial_refund_data(
    *,
    selected_items: list[dict],
    actor: str | None,
    process_payment: bool,
) -> dict[str, object] | None:
    if not (selected_items or actor or process_payment):
        return None
    return {
        "items": selected_items,
        "actor": actor,
        "process_payment": bool(process_payment),
    }


def _add_partial_refund_record_and_events(
    session: AsyncSession,
    *,
    order: Order,
    amount_q: Decimal,
    note_clean: str,
    selected_items: list[dict],
    actor: str | None,
    process_payment: bool,
    provider: str,
    provider_refund_id: str | None,
    total_amount: Decimal,
    already_refunded: Decimal,
) -> None:
    session.add(
        OrderRefund(
            order_id=order.id,
            amount=amount_q,
            currency=order.currency,
            provider=provider,
            provider_refund_id=provider_refund_id,
            note=note_clean,
            data=_partial_refund_data(
                selected_items=selected_items,
                actor=actor,
                process_payment=process_payment,
            ),
        )
    )
    event_note = _build_refund_partial_note(
        actor=actor,
        amount_q=amount_q,
        currency=order.currency,
        provider=provider,
        provider_refund_id=provider_refund_id,
        note_clean=note_clean,
    )
    session.add(OrderEvent(order_id=order.id, event="refund_partial", note=event_note[:2000]))
    _apply_full_refund_status(
        session,
        order=order,
        total_amount=total_amount,
        already_refunded=already_refunded,
        amount_q=amount_q,
    )


def _build_refund_partial_note(
    *,
    actor: str | None,
    amount_q: Decimal,
    currency: str,
    provider: str,
    provider_refund_id: str | None,
    note_clean: str,
) -> str:
    prefix = (actor or "").strip()
    event_note = f"{amount_q} {currency} ({provider}{' ' + provider_refund_id if provider_refund_id else ''})"
    if prefix:
        event_note = f"{prefix}: {event_note}"
    return f"{event_note} - {note_clean}" if note_clean else event_note


def _apply_full_refund_status(
    session: AsyncSession,
    *,
    order: Order,
    total_amount: Decimal,
    already_refunded: Decimal,
    amount_q: Decimal,
) -> None:
    remaining_after = pricing.quantize_money(total_amount - (already_refunded + amount_q))
    if remaining_after > 0 or order.status == OrderStatus.refunded:
        return
    previous = OrderStatus(order.status)
    order.status = OrderStatus.refunded
    session.add(OrderEvent(order_id=order.id, event="status_change", note=f"{previous.value} -> refunded"))
    session.add(OrderEvent(order_id=order.id, event="refund_completed", note="Order fully refunded via partial refunds"))
    session.add(order)


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
    _ensure_refund_allowed(order)
    await session.refresh(order, attribute_names=["refunds", "items"])
    already_refunded, total_amount, remaining = _compute_refund_balance(order)
    amount_q = _normalize_refund_amount(amount, remaining)
    note_clean = _normalize_refund_note(note)
    selected_items = _validate_refund_item_selection(order=order, items=items, amount_q=amount_q)
    provider, provider_refund_id = await _resolve_refund_provider(
        order=order,
        amount_q=amount_q,
        process_payment=process_payment,
    )
    _add_partial_refund_record_and_events(
        session,
        order=order,
        amount_q=amount_q,
        note_clean=note_clean,
        selected_items=selected_items,
        actor=actor,
        process_payment=process_payment,
        provider=provider,
        provider_refund_id=provider_refund_id,
        total_amount=total_amount,
        already_refunded=already_refunded,
    )
    await session.commit()
    hydrated = await get_order_by_id_admin(session, order.id)
    return hydrated or order


_PAYMENT_ACTION_ALLOWED_STATUSES = {
    OrderStatus.pending_payment,
    OrderStatus.pending_acceptance,
    OrderStatus.paid,
}


def _resolve_payment_intent_id(order: Order, intent_id: str | None) -> str:
    payment_intent_id = intent_id or order.stripe_payment_intent_id
    if not payment_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent id required")

    current_intent_id = (getattr(order, "stripe_payment_intent_id", None) or "").strip()
    if intent_id and current_intent_id and intent_id != current_intent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment intent mismatch")

    return payment_intent_id


def _require_payment_action_status(order: Order, *, detail: str) -> None:
    if order.status in _PAYMENT_ACTION_ALLOWED_STATUSES:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def _capture_payment_if_needed(session: AsyncSession, order: Order, payment_intent_id: str) -> None:
    await session.refresh(order, attribute_names=["events"])
    already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
    if already_captured:
        return

    await payments.capture_payment_intent(payment_intent_id)
    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=f"Intent {payment_intent_id}"))
    await promo_usage.record_promo_usage(session, order=order, note=f"Stripe {payment_intent_id}".strip())


def _mark_pending_acceptance_after_capture(session: AsyncSession, order: Order) -> None:
    if order.status != OrderStatus.pending_payment:
        return

    order.status = OrderStatus.pending_acceptance
    session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))


async def _void_or_refund_payment_intent(payment_intent_id: str) -> tuple[str, str]:
    try:
        await payments.void_payment_intent(payment_intent_id)
        return "payment_voided", f"Intent {payment_intent_id}"
    except HTTPException:
        # If the intent is already captured, cancel will fail. Fall back to a best-effort refund.
        refund = await payments.refund_payment_intent(payment_intent_id)
        refund_id = refund.get("id") if isinstance(refund, dict) else None
        note = f"Stripe refund {refund_id}".strip() if refund_id else "Stripe refund"
        return "payment_refunded", note


def _mark_cancelled_for_void(order: Order, payment_intent_id: str) -> None:
    order.stripe_payment_intent_id = payment_intent_id
    order.status = OrderStatus.cancelled
    if (getattr(order, "cancel_reason", None) or "").strip():
        return
    order.cancel_reason = "Cancelled via payment void/refund."


async def capture_payment(session: AsyncSession, order: Order, intent_id: str | None = None) -> Order:
    payment_intent_id = _resolve_payment_intent_id(order, intent_id)
    _require_payment_action_status(
        order,
        detail="Capture only allowed for pending_payment, pending_acceptance, or paid orders",
    )

    order.stripe_payment_intent_id = payment_intent_id
    await _capture_payment_if_needed(session, order, payment_intent_id)
    _mark_pending_acceptance_after_capture(session, order)
    session.add(order)
    await session.commit()
    hydrated = await get_order_by_id(session, order.id)
    return hydrated or order


async def void_payment(session: AsyncSession, order: Order, intent_id: str | None = None) -> Order:
    payment_intent_id = _resolve_payment_intent_id(order, intent_id)
    _require_payment_action_status(
        order,
        detail="Void only allowed for pending_payment, pending_acceptance, or paid orders",
    )

    event, note = await _void_or_refund_payment_intent(payment_intent_id)
    _mark_cancelled_for_void(order, payment_intent_id)
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
