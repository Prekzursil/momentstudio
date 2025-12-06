from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.cart import Cart, CartItem
from app.models.catalog import Product, ProductVariant
from app.schemas.cart import CartItemCreate, CartItemUpdate, CartRead, CartItemRead, Totals
from app.schemas.promo import PromoCodeRead, PromoCodeCreate
from app.schemas.cart_sync import CartSyncItem
from app.models.promo import PromoCode
from app.models.order import Order
from app.models.user import User
from app.models.order import ShippingMethod
from app.services import email as email_service
from app.core.config import settings


async def _get_or_create_cart(session: AsyncSession, user_id: UUID | None, session_id: str | None) -> Cart:
    if user_id:
        result = await session.execute(
            select(Cart)
            .options(
                selectinload(Cart.items)
                .selectinload(CartItem.product)
                .selectinload(Product.images)
            )
            .where(Cart.user_id == user_id)
        )
        cart = result.scalar_one_or_none()
        if cart:
            return cart
    if session_id:
        result = await session.execute(
            select(Cart)
            .options(
                selectinload(Cart.items)
                .selectinload(CartItem.product)
                .selectinload(Product.images)
            )
            .where(Cart.session_id == session_id)
        )
        cart = result.scalar_one_or_none()
        if cart:
            return cart
    cart = Cart(user_id=user_id, session_id=session_id)
    session.add(cart)
    await session.commit()
    await session.refresh(cart)
    return cart


async def get_cart(session: AsyncSession, user_id: UUID | None, session_id: str | None) -> Cart:
    cart = await _get_or_create_cart(session, user_id, session_id)
    return cart


async def _validate_stock(product: Product, variant: ProductVariant | None, quantity: int) -> None:
    stock = variant.stock_quantity if variant else product.stock_quantity
    if quantity > stock:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient stock")
    max_allowed = variant.stock_quantity if variant else product.stock_quantity
    if max_allowed and quantity > max_allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quantity exceeds allowed maximum")


def _enforce_max_quantity(quantity: int, limit: int | None) -> None:
    if limit and quantity > limit:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quantity exceeds allowed maximum")


def _get_first_image(product: Product | None) -> str | None:
    if not product or not product.images:
        return None
    first = sorted(product.images, key=lambda img: img.sort_order or 0)
    return first[0].url if first else None


def _calculate_shipping_amount(subtotal: Decimal, shipping_method: ShippingMethod | None) -> Decimal:
    if not shipping_method:
        return Decimal("0")
    base = Decimal(shipping_method.rate_flat or 0)
    per = Decimal(shipping_method.rate_per_kg or 0)
    return base + per * subtotal


def _to_decimal(value: float | Decimal | int) -> Decimal:
    if isinstance(value, Decimal):
        dec = value
    else:
        dec = Decimal(str(value)) if settings.enforce_decimal_prices else Decimal(value)
    if settings.enforce_decimal_prices:
        dec = dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return dec


def _compute_discount(subtotal: Decimal, promo: PromoCodeRead | None) -> Decimal:
    if not promo:
        return Decimal("0")
    if promo.amount_off:
        discount_val = Decimal(promo.amount_off)
    elif promo.percentage_off:
        discount_val = subtotal * Decimal(promo.percentage_off) / Decimal(100)
    else:
        discount_val = Decimal("0")
    if discount_val > subtotal:
        discount_val = subtotal
    return discount_val


def _calculate_totals(
    cart: Cart,
    shipping_method: ShippingMethod | None = None,
    promo: PromoCodeRead | None = None,
    currency: str | None = "USD",
) -> Totals:
    subtotal = sum(_to_decimal(item.unit_price_at_add) * item.quantity for item in cart.items)
    subtotal = _to_decimal(subtotal)
    discount_val = _compute_discount(subtotal, promo)
    taxable = subtotal - discount_val
    if taxable < 0:
        taxable = Decimal("0")
    tax = _to_decimal(taxable * Decimal("0.1"))
    shipping = _to_decimal(_calculate_shipping_amount(subtotal, shipping_method))
    total = _to_decimal(taxable + tax + shipping)
    if total < 0:
        total = Decimal("0.00")
    return Totals(subtotal=subtotal, tax=tax, shipping=shipping, total=total, currency=currency)


def calculate_totals(
    cart: Cart, shipping_method: ShippingMethod | None = None, promo: PromoCodeRead | None = None
) -> tuple[Totals, Decimal]:
    subtotal = sum(_to_decimal(item.unit_price_at_add) * item.quantity for item in cart.items)
    discount_val = _compute_discount(_to_decimal(subtotal), promo)
    currency = next(
        (getattr(item.product, "currency", None) for item in cart.items if getattr(item, "product", None)), "USD"
    ) or "USD"
    totals = _calculate_totals(cart, shipping_method=shipping_method, promo=promo, currency=currency)
    return totals, discount_val


async def serialize_cart(
    session: AsyncSession,
    cart: Cart,
    shipping_method: ShippingMethod | None = None,
    promo: PromoCodeRead | None = None,
) -> CartRead:
    result = await session.execute(
        select(Cart)
            .options(
                selectinload(Cart.items)
                .selectinload(CartItem.product)
                .selectinload(Product.images)
            )
            .where(Cart.id == cart.id)
    )
    hydrated = result.scalar_one()
    currency = next(
        (getattr(item.product, "currency", None) for item in hydrated.items if getattr(item, "product", None)), "USD"
    ) or "USD"
    totals = _calculate_totals(hydrated, shipping_method=shipping_method, promo=promo, currency=currency)
    return CartRead(
        id=hydrated.id,
        user_id=hydrated.user_id,
        session_id=hydrated.session_id,
        items=[
            CartItemRead(
                id=item.id,
                product_id=item.product_id,
                variant_id=item.variant_id,
                quantity=item.quantity,
                max_quantity=item.max_quantity or (item.product.stock_quantity if item.product else None),
                note=item.note,
                unit_price_at_add=Decimal(item.unit_price_at_add),
                name=item.product.name if item.product else None,
                slug=item.product.slug if item.product else None,
                image_url=_get_first_image(item.product),
                currency=getattr(item.product, "currency", None) or "USD",
            )
            for item in hydrated.items
        ],
        totals=totals,
    )


async def add_item(
    session: AsyncSession,
    cart: Cart,
    payload: CartItemCreate,
) -> CartItem:
    product = await session.get(Product, payload.product_id)
    if not product or product.is_deleted or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    variant = None
    if payload.variant_id:
        variant = await session.get(ProductVariant, payload.variant_id)
        if not variant or variant.product_id != product.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")

    await _validate_stock(product, variant, payload.quantity)
    limit = payload.max_quantity or (variant.stock_quantity if variant else product.stock_quantity)
    _enforce_max_quantity(payload.quantity, limit)

    unit_price = Decimal(product.base_price)
    if variant:
        unit_price += Decimal(variant.additional_price_delta)

    item = CartItem(
        cart=cart,
        product_id=product.id,
        variant_id=variant.id if variant else None,
        quantity=payload.quantity,
        note=payload.note,
        unit_price_at_add=unit_price,
        max_quantity=payload.max_quantity,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    record_cart_event("add_item", {"cart_id": str(cart.id), "product_id": str(product.id), "quantity": payload.quantity})
    return item


async def update_item(session: AsyncSession, cart: Cart, item_id: UUID, payload: CartItemUpdate) -> CartItem:
    result = await session.execute(select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == cart.id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart item not found")

    product = await session.get(Product, item.product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    variant = await session.get(ProductVariant, item.variant_id) if item.variant_id else None
    await _validate_stock(product, variant, payload.quantity)
    _enforce_max_quantity(payload.quantity, item.max_quantity)

    item.quantity = payload.quantity
    item.note = payload.note
    session.add(item)
    await session.commit()
    await session.refresh(item)
    record_cart_event("update_item", {"cart_id": str(cart.id), "item_id": str(item.id), "quantity": payload.quantity})
    return item


async def delete_item(session: AsyncSession, cart: Cart, item_id: UUID) -> None:
    result = await session.execute(select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == cart.id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart item not found")
    await session.delete(item)
    await session.commit()
    record_cart_event("delete_item", {"cart_id": str(cart.id), "item_id": str(item_id)})


async def sync_cart(session: AsyncSession, cart: Cart, items: list[CartSyncItem]) -> None:
    # clear existing items
    for existing in list(cart.items):
        await session.delete(existing)
    await session.flush()
    for item in items:
        await add_item(
            session,
            cart,
            CartItemCreate(
                product_id=item.product_id,
                variant_id=item.variant_id,
                quantity=item.quantity,
                note=item.note,
                max_quantity=item.max_quantity,
            ),
        )
    await session.refresh(cart)


async def merge_guest_cart(session: AsyncSession, user_cart: Cart, guest_session_id: str | None) -> Cart:
    if not guest_session_id:
        return user_cart

    guest = await _get_or_create_cart(session, None, guest_session_id)
    if guest.id == user_cart.id:
        return user_cart

    for guest_item in guest.items:
        # try to find matching item
        match = next(
            (i for i in user_cart.items if i.product_id == guest_item.product_id and i.variant_id == guest_item.variant_id),
            None,
        )
        product = await session.get(Product, guest_item.product_id)
        if not product:
            continue
        variant = await session.get(ProductVariant, guest_item.variant_id) if guest_item.variant_id else None
        new_qty = guest_item.quantity + (match.quantity if match else 0)
        await _validate_stock(product, variant, new_qty)

        unit_price = guest_item.unit_price_at_add
        if match:
            match.quantity = new_qty
            match.unit_price_at_add = unit_price
            session.add(match)
        else:
            session.add(
                CartItem(
                    cart=user_cart,
                    product_id=guest_item.product_id,
                    variant_id=guest_item.variant_id,
                    quantity=guest_item.quantity,
                    unit_price_at_add=unit_price,
                )
            )
    await session.delete(guest)
    await session.commit()
    await session.refresh(user_cart)
    return user_cart


async def cleanup_stale_guest_carts(session: AsyncSession, max_age_hours: int = 72) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    result = await session.execute(select(Cart).where(Cart.user_id.is_(None), Cart.updated_at < cutoff))
    stale = result.scalars().all()
    deleted = 0
    for cart in stale:
        await session.delete(cart)
        deleted += 1
    if deleted:
        await session.commit()
    return deleted


async def create_promo(session: AsyncSession, payload: PromoCodeCreate) -> PromoCode:
    code = payload.code.strip().upper()
    result = await session.execute(select(PromoCode).where(PromoCode.code == code))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promo code already exists")
    if payload.percentage_off and payload.amount_off:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose percentage_off or amount_off, not both")
    promo = PromoCode(**payload.model_dump())
    promo.code = code
    session.add(promo)
    await session.commit()
    await session.refresh(promo)
    return promo


async def validate_promo(session: AsyncSession, code: str, currency: str | None = None) -> PromoCodeRead:
    cleaned = code.strip().upper()
    result = await session.execute(select(PromoCode).where(PromoCode.code == cleaned, PromoCode.active.is_(True)))
    promo = result.scalar_one_or_none()
    if not promo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promo code not found")
    if promo.expires_at and promo.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promo code expired")
    if promo.max_uses and promo.times_used >= promo.max_uses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promo code usage limit reached")
    if promo.currency and currency and promo.currency.upper() != currency.upper():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Promo code currency mismatch")
    return PromoCodeRead.model_validate(promo)


async def reserve_stock_for_checkout(session: AsyncSession, cart: Cart) -> bool:
    # Placeholder: would mark stock as reserved in inventory system
    return True


async def run_abandoned_cart_job(session: AsyncSession, max_age_hours: int = 24) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    result = await session.execute(
        select(Cart).options(selectinload(Cart.items)).where(Cart.user_id.isnot(None), Cart.updated_at < cutoff)
    )
    carts = result.scalars().all()
    sent = 0
    for cart in carts:
        if cart.items and cart.user_id:
            user_result = await session.execute(select(User).where(User.id == cart.user_id))
            user = user_result.scalar_one_or_none()
            if user and user.email:
                await email_service.send_cart_abandonment(user.email)
                sent += 1
    await cleanup_stale_guest_carts(session, max_age_hours)
    return sent


def record_cart_event(event: str, payload: dict | None = None) -> None:
    # Placeholder for analytics hook; integrate with telemetry pipeline later
    return None


async def reorder_from_order(session: AsyncSession, user_id: UUID, order_id: UUID) -> Cart:
    result = await session.execute(
        select(Order).options(selectinload(Order.items)).where(Order.id == order_id, Order.user_id == user_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    cart = await _get_or_create_cart(session, user_id, None)
    await session.refresh(cart, attribute_names=["items"])
    # Replace current cart items with the order items
    for item in list(cart.items):
        await session.delete(item)
    await session.flush()

    for order_item in order.items:
        payload = CartItemCreate(
            product_id=order_item.product_id,
            variant_id=order_item.variant_id,
            quantity=order_item.quantity,
        )
        await add_item(session, cart, payload)
    await session.refresh(cart)
    return cart
