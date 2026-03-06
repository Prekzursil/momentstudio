from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product, ProductVariant, RestockNote
from app.models.order import Order, OrderItem, OrderStatus
from app.models.user import User
from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.inventory import (
    RestockListItem,
    RestockListResponse,
    RestockNoteRead,
    RestockNoteUpsert,
)


DEFAULT_CART_RESERVATION_WINDOW_MINUTES = 120


@dataclass(frozen=True)
class _ReservedKey:
    product_id: UUID
    variant_id: UUID | None


def _cart_reservation_cutoff(now: datetime) -> datetime:
    minutes = (
        getattr(
            settings,
            "cart_reservation_window_minutes",
            DEFAULT_CART_RESERVATION_WINDOW_MINUTES,
        )
        or DEFAULT_CART_RESERVATION_WINDOW_MINUTES
    )
    minutes_int = int(minutes)
    if minutes_int <= 0:
        minutes_int = DEFAULT_CART_RESERVATION_WINDOW_MINUTES
    return now - timedelta(minutes=minutes_int)


async def _reserved_in_active_carts(
    session: AsyncSession, cutoff: datetime
) -> dict[_ReservedKey, int]:
    stmt = (
        select(
            CartItem.product_id,
            CartItem.variant_id,
            func.coalesce(func.sum(CartItem.quantity), 0).label("qty"),
        )
        .select_from(CartItem)
        .join(Cart, Cart.id == CartItem.cart_id)
        .where(Cart.updated_at >= cutoff)
        .group_by(CartItem.product_id, CartItem.variant_id)
    )
    rows = (await session.execute(stmt)).all()
    return {
        _ReservedKey(product_id=row[0], variant_id=row[1]): int(row[2] or 0)
        for row in rows
    }


async def _reserved_in_open_orders(session: AsyncSession) -> dict[_ReservedKey, int]:
    open_statuses = {
        OrderStatus.pending_payment,
        OrderStatus.pending_acceptance,
    }
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
        .where(Order.status.in_(open_statuses))
        .group_by(OrderItem.product_id, OrderItem.variant_id)
    )
    rows = (await session.execute(stmt)).all()
    return {
        _ReservedKey(product_id=row[0], variant_id=row[1]): int(row[2] or 0)
        for row in rows
    }


async def list_cart_reservations(
    session: AsyncSession,
    *,
    product_id: UUID,
    variant_id: UUID | None = None,
    now: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[datetime, list[dict]]:
    now_value = now or datetime.now(timezone.utc)
    cutoff = _cart_reservation_cutoff(now_value)

    email_expr = func.coalesce(User.email, Cart.guest_email).label("customer_email")
    qty_expr = func.coalesce(func.sum(CartItem.quantity), 0).label("quantity")

    stmt = (
        select(Cart.id, Cart.updated_at, email_expr, qty_expr)
        .select_from(CartItem)
        .join(Cart, Cart.id == CartItem.cart_id)
        .outerjoin(User, User.id == Cart.user_id)
        .where(
            Cart.updated_at >= cutoff,
            CartItem.product_id == product_id,
            CartItem.variant_id == variant_id
            if variant_id is not None
            else CartItem.variant_id.is_(None),
        )
        .group_by(Cart.id, Cart.updated_at, User.email, Cart.guest_email)
        .order_by(Cart.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    items: list[dict] = []
    for cart_id, updated_at, customer_email, quantity in rows:
        items.append(
            {
                "cart_id": cart_id,
                "updated_at": updated_at,
                "customer_email": customer_email,
                "quantity": int(quantity or 0),
            }
        )
    return cutoff, items


def _reservation_variant_filter(variant_id: UUID | None) -> Any:
    if variant_id is not None:
        return OrderItem.variant_id == variant_id
    return OrderItem.variant_id.is_(None)


def _open_order_statuses() -> set[OrderStatus]:
    return {OrderStatus.pending_payment, OrderStatus.pending_acceptance}


def _order_reservation_row(row: Any) -> dict:
    order_id, reference_code, status_value, created_at, customer_email, quantity = row
    return {
        "order_id": order_id,
        "reference_code": reference_code,
        "status": status_value.value,
        "created_at": created_at,
        "customer_email": customer_email,
        "quantity": int(quantity or 0),
    }


async def list_order_reservations(
    session: AsyncSession,
    *,
    product_id: UUID,
    variant_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    open_statuses = _open_order_statuses()
    reserved_expr = case(
        (
            OrderItem.quantity > OrderItem.shipped_quantity,
            OrderItem.quantity - OrderItem.shipped_quantity,
        ),
        else_=0,
    )
    qty_expr = func.coalesce(func.sum(reserved_expr), 0).label("quantity")

    stmt = (
        select(
            Order.id,
            Order.reference_code,
            Order.status,
            Order.created_at,
            Order.customer_email,
            qty_expr,
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.status.in_(open_statuses),
            OrderItem.product_id == product_id,
            _reservation_variant_filter(variant_id),
        )
        .group_by(
            Order.id,
            Order.reference_code,
            Order.status,
            Order.created_at,
            Order.customer_email,
        )
        .having(qty_expr > 0)
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    return [_order_reservation_row(row) for row in rows]


def _note_key(product_id: UUID, variant_id: UUID | None) -> str:
    return (
        f"variant:{variant_id}" if variant_id is not None else f"product:{product_id}"
    )


async def upsert_restock_note(
    session: AsyncSession, *, payload: RestockNoteUpsert, user_id: UUID | None
) -> RestockNoteRead | None:
    await _assert_restock_target_exists(
        session,
        product_id=payload.product_id,
        variant_id=payload.variant_id,
    )
    supplier, note, desired_quantity = _normalized_restock_note_payload(payload)
    should_delete = supplier is None and note is None and desired_quantity is None

    key = _note_key(payload.product_id, payload.variant_id)
    existing = await session.scalar(
        select(RestockNote).where(RestockNote.target_key == key)
    )

    if should_delete:
        if existing is not None:
            await session.delete(existing)
            await session.commit()
        return None

    if existing is None:
        existing = RestockNote(
            target_key=key,
            product_id=payload.product_id,
            variant_id=payload.variant_id,
            actor_user_id=user_id,
            supplier=supplier,
            desired_quantity=desired_quantity,
            note=note,
        )
        session.add(existing)
    else:
        existing.supplier = supplier
        existing.desired_quantity = desired_quantity
        existing.note = note
        existing.actor_user_id = user_id
        session.add(existing)

    await session.commit()
    await session.refresh(existing)
    return RestockNoteRead.model_validate(existing)


async def _assert_restock_target_exists(
    session: AsyncSession,
    *,
    product_id: UUID,
    variant_id: UUID | None,
) -> None:
    product = await session.get(Product, product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Product not found"
        )
    if variant_id is None:
        return
    variant = await session.get(ProductVariant, variant_id)
    if not variant or variant.product_id != product.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant"
        )


def _normalized_restock_note_payload(
    payload: RestockNoteUpsert,
) -> tuple[str | None, str | None, int | None]:
    supplier = (payload.supplier or "").strip() or None
    note = (payload.note or "").strip() or None
    desired_quantity = payload.desired_quantity if payload.desired_quantity is not None else None
    if desired_quantity is not None:
        desired_quantity = max(0, int(desired_quantity))
    return supplier, note, desired_quantity


def _restock_threshold(
    product: Product,
    *,
    default_threshold: int,
) -> int:
    category: Category = product.category
    raw_threshold = product.low_stock_threshold if product.low_stock_threshold is not None else category.low_stock_threshold
    return int(raw_threshold or default_threshold)


def _restock_note_present(note_record: RestockNote | None) -> bool:
    if note_record is None:
        return False
    return bool(
        (note_record.note or "").strip()
        or (note_record.supplier or "").strip()
        or (note_record.desired_quantity is not None)
    )


def _restock_item_kwargs(note_record: RestockNote | None) -> dict[str, Any]:
    if note_record is None:
        return {
            "supplier": None,
            "desired_quantity": None,
            "note": None,
            "note_updated_at": None,
        }
    return {
        "supplier": note_record.supplier,
        "desired_quantity": note_record.desired_quantity,
        "note": note_record.note,
        "note_updated_at": note_record.updated_at,
    }


def _is_critical_stock(available: int, threshold: int) -> bool:
    return bool(available <= 0 or available < max(1, threshold // 2))


def _available_quantity(
    *,
    stock_quantity: int,
    reserved_carts: int,
    reserved_orders: int,
) -> int:
    return int(stock_quantity) - reserved_carts - reserved_orders


def _build_product_restock_item(
    *,
    product: Product,
    threshold: int,
    carts_qty: int,
    orders_qty: int,
    available: int,
    note_record: RestockNote | None,
) -> RestockListItem:
    return RestockListItem(
        kind="product",
        product_id=product.id,
        variant_id=None,
        sku=product.sku,
        product_slug=product.slug,
        product_name=product.name,
        variant_name=None,
        stock_quantity=int(product.stock_quantity),
        reserved_in_carts=carts_qty,
        reserved_in_orders=orders_qty,
        available_quantity=available,
        threshold=threshold,
        is_critical=_is_critical_stock(available, threshold),
        restock_at=product.restock_at,
        **_restock_item_kwargs(note_record),
    )


def _build_variant_restock_item(
    *,
    product: Product,
    variant: ProductVariant,
    threshold: int,
    carts_qty: int,
    orders_qty: int,
    available: int,
    note_record: RestockNote | None,
) -> RestockListItem:
    return RestockListItem(
        kind="variant",
        product_id=product.id,
        variant_id=variant.id,
        sku=product.sku,
        product_slug=product.slug,
        product_name=product.name,
        variant_name=variant.name,
        stock_quantity=int(variant.stock_quantity),
        reserved_in_carts=carts_qty,
        reserved_in_orders=orders_qty,
        available_quantity=available,
        threshold=threshold,
        is_critical=_is_critical_stock(available, threshold),
        restock_at=product.restock_at,
        **_restock_item_kwargs(note_record),
    )


def _extend_restock_rows_for_product(
    *,
    rows: list[RestockListItem],
    product: Product,
    include_variants: bool,
    default_threshold: int,
    reserved_carts: dict[_ReservedKey, int],
    reserved_orders: dict[_ReservedKey, int],
    notes_by_key: dict[str, RestockNote],
) -> None:
    threshold = _restock_threshold(product, default_threshold=default_threshold)
    product_key = _ReservedKey(product_id=product.id, variant_id=None)
    carts_qty = int(reserved_carts.get(product_key, 0))
    orders_qty = int(reserved_orders.get(product_key, 0))
    available = _available_quantity(
        stock_quantity=int(product.stock_quantity),
        reserved_carts=carts_qty,
        reserved_orders=orders_qty,
    )
    note_record = notes_by_key.get(_note_key(product.id, None))
    if available < threshold or _restock_note_present(note_record):
        rows.append(
            _build_product_restock_item(
                product=product,
                threshold=threshold,
                carts_qty=carts_qty,
                orders_qty=orders_qty,
                available=available,
                note_record=note_record,
            )
        )
    if not include_variants:
        return
    _extend_variant_restock_rows(
        rows=rows,
        product=product,
        threshold=threshold,
        reserved_carts=reserved_carts,
        reserved_orders=reserved_orders,
        notes_by_key=notes_by_key,
    )


def _extend_variant_restock_rows(
    *,
    rows: list[RestockListItem],
    product: Product,
    threshold: int,
    reserved_carts: dict[_ReservedKey, int],
    reserved_orders: dict[_ReservedKey, int],
    notes_by_key: dict[str, RestockNote],
) -> None:
    for variant in product.variants:
        variant_key = _ReservedKey(product_id=product.id, variant_id=variant.id)
        carts_qty = int(reserved_carts.get(variant_key, 0))
        orders_qty = int(reserved_orders.get(variant_key, 0))
        available = _available_quantity(
            stock_quantity=int(variant.stock_quantity),
            reserved_carts=carts_qty,
            reserved_orders=orders_qty,
        )
        note_record = notes_by_key.get(_note_key(product.id, variant.id))
        if not (available < threshold or _restock_note_present(note_record)):
            continue
        rows.append(
            _build_variant_restock_item(
                product=product,
                variant=variant,
                threshold=threshold,
                carts_qty=carts_qty,
                orders_qty=orders_qty,
                available=available,
                note_record=note_record,
            )
        )


async def list_restock_list(
    session: AsyncSession,
    *,
    include_variants: bool = True,
    default_threshold: int = 5,
) -> list[RestockListItem]:
    now = datetime.now(timezone.utc)
    cutoff = _cart_reservation_cutoff(now)

    reserved_carts = await _reserved_in_active_carts(session, cutoff)
    reserved_orders = await _reserved_in_open_orders(session)

    notes = (await session.execute(select(RestockNote))).scalars().all()
    notes_by_key = {n.target_key: n for n in notes}

    products = (
        (
            await session.execute(
                select(Product)
                .options(selectinload(Product.variants), selectinload(Product.category))
                .where(Product.is_deleted.is_(False), Product.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )

    rows: list[RestockListItem] = []
    for product in products:
        _extend_restock_rows_for_product(
            rows=rows,
            product=product,
            include_variants=include_variants,
            default_threshold=default_threshold,
            reserved_carts=reserved_carts,
            reserved_orders=reserved_orders,
            notes_by_key=notes_by_key,
        )

    rows.sort(
        key=lambda r: (
            0 if r.is_critical else 1,
            r.available_quantity,
            r.product_name.casefold(),
            (r.variant_name or "").casefold(),
        )
    )
    return rows


async def paginate_restock_list(
    session: AsyncSession,
    *,
    page: int = 1,
    limit: int = 50,
    include_variants: bool = True,
    default_threshold: int = 5,
) -> RestockListResponse:
    rows = await list_restock_list(
        session,
        include_variants=include_variants,
        default_threshold=default_threshold,
    )
    total_items = len(rows)
    limit = max(1, min(int(limit), 200))
    page = max(1, int(page))
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    if page > total_pages:
        page = total_pages

    start = (page - 1) * limit
    end = start + limit
    paged = rows[start:end]

    meta = AdminPaginationMeta(
        page=page, limit=limit, total_items=total_items, total_pages=total_pages
    )
    return RestockListResponse(items=paged, meta=meta)
