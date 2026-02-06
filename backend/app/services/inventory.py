from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
        OrderStatus.paid,
        OrderStatus.shipped,
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


async def list_order_reservations(
    session: AsyncSession,
    *,
    product_id: UUID,
    variant_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    open_statuses = {
        OrderStatus.pending_payment,
        OrderStatus.pending_acceptance,
        OrderStatus.paid,
        OrderStatus.shipped,
    }
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
            OrderItem.variant_id == variant_id
            if variant_id is not None
            else OrderItem.variant_id.is_(None),
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
    items: list[dict] = []
    for order_id, reference_code, status_value, created_at, customer_email, quantity in rows:
        items.append(
            {
                "order_id": order_id,
                "reference_code": reference_code,
                "status": status_value.value,
                "created_at": created_at,
                "customer_email": customer_email,
                "quantity": int(quantity or 0),
            }
        )
    return items


def _note_key(product_id: UUID, variant_id: UUID | None) -> str:
    return (
        f"variant:{variant_id}" if variant_id is not None else f"product:{product_id}"
    )


async def upsert_restock_note(
    session: AsyncSession, *, payload: RestockNoteUpsert, user_id: UUID | None
) -> RestockNoteRead | None:
    product = await session.get(Product, payload.product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Product not found"
        )
    if payload.variant_id is not None:
        variant = await session.get(ProductVariant, payload.variant_id)
        if not variant or variant.product_id != product.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant"
            )

    supplier = (payload.supplier or "").strip() or None
    note = (payload.note or "").strip() or None
    desired_quantity = (
        payload.desired_quantity if payload.desired_quantity is not None else None
    )
    if desired_quantity is not None:
        desired_quantity = int(desired_quantity)
        if desired_quantity < 0:
            desired_quantity = 0

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
        category: Category = product.category
        threshold = int(
            (
                product.low_stock_threshold
                if product.low_stock_threshold is not None
                else category.low_stock_threshold
            )
            or default_threshold
        )
        product_key = _ReservedKey(product_id=product.id, variant_id=None)
        carts_qty = int(reserved_carts.get(product_key, 0))
        orders_qty = int(reserved_orders.get(product_key, 0))
        available = int(product.stock_quantity) - carts_qty - orders_qty

        note_record = notes_by_key.get(_note_key(product.id, None))
        note_present = bool(
            note_record
            and (
                (note_record.note or "").strip()
                or (note_record.supplier or "").strip()
                or (note_record.desired_quantity is not None)
            )
        )
        is_low = available < threshold
        if is_low or note_present:
            is_critical = bool(available <= 0 or available < max(1, threshold // 2))
            rows.append(
                RestockListItem(
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
                    is_critical=is_critical,
                    restock_at=product.restock_at,
                    supplier=getattr(note_record, "supplier", None)
                    if note_record
                    else None,
                    desired_quantity=getattr(note_record, "desired_quantity", None)
                    if note_record
                    else None,
                    note=getattr(note_record, "note", None) if note_record else None,
                    note_updated_at=getattr(note_record, "updated_at", None)
                    if note_record
                    else None,
                )
            )

        if not include_variants:
            continue
        for variant in product.variants:
            variant_key = _ReservedKey(product_id=product.id, variant_id=variant.id)
            carts_qty = int(reserved_carts.get(variant_key, 0))
            orders_qty = int(reserved_orders.get(variant_key, 0))
            available = int(variant.stock_quantity) - carts_qty - orders_qty

            note_record = notes_by_key.get(_note_key(product.id, variant.id))
            note_present = bool(
                note_record
                and (
                    (note_record.note or "").strip()
                    or (note_record.supplier or "").strip()
                    or (note_record.desired_quantity is not None)
                )
            )
            is_low = available < threshold
            if not (is_low or note_present):
                continue
            is_critical = bool(available <= 0 or available < max(1, threshold // 2))
            rows.append(
                RestockListItem(
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
                    is_critical=is_critical,
                    restock_at=product.restock_at,
                    supplier=getattr(note_record, "supplier", None)
                    if note_record
                    else None,
                    desired_quantity=getattr(note_record, "desired_quantity", None)
                    if note_record
                    else None,
                    note=getattr(note_record, "note", None) if note_record else None,
                    note_updated_at=getattr(note_record, "updated_at", None)
                    if note_record
                    else None,
                )
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
