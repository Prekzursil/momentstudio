from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timedelta, timezone
from uuid import UUID
import logging

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.models.cart import Cart, CartItem
from app.models.catalog import Product, ProductImage, ProductVariant, ProductStatus
from app.schemas.cart import CartItemCreate, CartItemUpdate, CartRead, CartItemRead, Totals
from app.schemas.promo import PromoCodeRead, PromoCodeCreate
from app.schemas.cart_sync import CartSyncItem
from app.models.promo import PromoCode
from app.models.order import Order
from app.models.user import User
from app.models.order import ShippingMethod
from app.services import email as email_service
from app.services.checkout_settings import CheckoutSettings
from app.services.catalog import is_sale_active
from app.services import pricing
from app.services import taxes as taxes_service
from app.services.taxes import TaxableProductLine
from app.core.config import settings
from app.core.logging_config import request_id_ctx_var


cart_logger = logging.getLogger("app.cart")


def _log_cart(event: str, cart: Cart, user_id: UUID | None = None) -> None:
    cart_id = getattr(cart, "id", None)
    cart_logger.info(
        event,
        extra={
            "request_id": request_id_ctx_var.get(),
            "cart_id": str(cart_id) if cart_id else None,
            "user_id": str(user_id) if user_id else None,
        },
    )


async def _get_or_create_cart(session: AsyncSession, user_id: UUID | None, session_id: str | None) -> Cart:
    async def _load_by_session_id(sid: str) -> Cart | None:
        result = await session.execute(
            select(Cart)
            .options(
                selectinload(Cart.items)
                .selectinload(CartItem.product)
                .selectinload(Product.images),
                with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True),
            )
            .where(Cart.session_id == sid)
        )
        return result.scalar_one_or_none()

    if user_id:
        result = await session.execute(
            select(Cart)
            .options(
                selectinload(Cart.items)
                .selectinload(CartItem.product)
                .selectinload(Product.images),
                with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True),
            )
            .where(Cart.user_id == user_id)
        )
        cart = result.scalar_one_or_none()
        if cart:
            return cart
    if session_id:
        cart = await _load_by_session_id(session_id)
        if cart:
            return cart
    cart = Cart(user_id=user_id, session_id=session_id)
    session.add(cart)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        # Under concurrent requests, two carts may race on the same `session_id`.
        # Recover by loading the existing cart instead of surfacing a 500.
        if session_id:
            cart = await _load_by_session_id(session_id)
            if cart:
                _log_cart("cart_race_recovered", cart, user_id=user_id)
                return cart
        raise
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


SUPPORTED_COURIERS: set[str] = {"sameday", "fan_courier"}


def delivery_constraints(cart: Cart) -> tuple[bool, list[str]]:
    """Compute delivery constraints implied by products in the cart.

    - Locker delivery is allowed only if all products allow it.
    - Allowed couriers are the intersection of all product courier allowlists,
      modeled as "disallowed couriers" per product.
    """

    locker_allowed = True
    allowed_couriers = set(SUPPORTED_COURIERS)

    for item in getattr(cart, "items", []) or []:
        product = getattr(item, "product", None)
        if not product:
            continue
        if getattr(product, "shipping_allow_locker", True) is False:
            locker_allowed = False

        disallowed = getattr(product, "shipping_disallowed_couriers", None) or []
        if isinstance(disallowed, str):
            disallowed = [disallowed]
        for raw in disallowed:
            code = str(raw or "").strip().lower()
            if code in allowed_couriers:
                allowed_couriers.remove(code)

    return locker_allowed, sorted(allowed_couriers)


def _calculate_shipping_amount(
    subtotal: Decimal,
    shipping_method: ShippingMethod | None,
    *,
    shipping_fee_ron: Decimal | None = None,
) -> Decimal:
    if shipping_fee_ron is not None:
        return shipping_fee_ron
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
    *,
    checkout_settings: CheckoutSettings | None = None,
    shipping_fee_ron: Decimal | None = None,
    free_shipping_threshold_ron: Decimal | None = None,
    currency: str | None = "RON",
) -> Totals:
    checkout = checkout_settings or CheckoutSettings()
    subtotal = sum(_to_decimal(item.unit_price_at_add) * item.quantity for item in cart.items)
    subtotal = _to_decimal(subtotal)
    discount_val = _compute_discount(subtotal, promo)

    shipping_fee = shipping_fee_ron if shipping_fee_ron is not None else checkout.shipping_fee_ron
    threshold = (
        free_shipping_threshold_ron if free_shipping_threshold_ron is not None else checkout.free_shipping_threshold_ron
    )
    shipping_amount = _calculate_shipping_amount(subtotal, shipping_method, shipping_fee_ron=shipping_fee)
    shipping = _to_decimal(shipping_amount)
    if threshold is not None and threshold >= 0 and (subtotal - discount_val) >= threshold:
        shipping = Decimal("0.00")

    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=discount_val,
        shipping=shipping,
        fee_enabled=checkout.fee_enabled,
        fee_type=checkout.fee_type,
        fee_value=checkout.fee_value,
        vat_enabled=checkout.vat_enabled,
        vat_rate_percent=checkout.vat_rate_percent,
        vat_apply_to_shipping=checkout.vat_apply_to_shipping,
        vat_apply_to_fee=checkout.vat_apply_to_fee,
        rounding=checkout.money_rounding,
    )

    return Totals(
        subtotal=breakdown.subtotal,
        fee=breakdown.fee,
        tax=breakdown.vat,
        shipping=breakdown.shipping,
        total=breakdown.total,
        currency=currency,
        free_shipping_threshold_ron=threshold,
    )


def calculate_totals(
    cart: Cart,
    shipping_method: ShippingMethod | None = None,
    promo: PromoCodeRead | None = None,
    *,
    checkout_settings: CheckoutSettings | None = None,
    shipping_fee_ron: Decimal | None = None,
    free_shipping_threshold_ron: Decimal | None = None,
) -> tuple[Totals, Decimal]:
    subtotal = sum(_to_decimal(item.unit_price_at_add) * item.quantity for item in cart.items)
    discount_val = _compute_discount(_to_decimal(subtotal), promo)
    # The app enforces a single-currency policy (RON). Avoid accessing lazy-loaded
    # product relationships here, since this function is used in sync contexts.
    currency = "RON"
    totals = _calculate_totals(
        cart,
        shipping_method=shipping_method,
        promo=promo,
        checkout_settings=checkout_settings,
        shipping_fee_ron=shipping_fee_ron,
        free_shipping_threshold_ron=free_shipping_threshold_ron,
        currency=currency,
    )
    return totals, discount_val


async def calculate_totals_async(
    session: AsyncSession,
    cart: Cart,
    shipping_method: ShippingMethod | None = None,
    promo: PromoCodeRead | None = None,
    *,
    checkout_settings: CheckoutSettings | None = None,
    shipping_fee_ron: Decimal | None = None,
    free_shipping_threshold_ron: Decimal | None = None,
    country_code: str | None = None,
) -> tuple[Totals, Decimal]:
    checkout = checkout_settings or CheckoutSettings()
    rounding = checkout.money_rounding

    subtotal_raw = sum(_to_decimal(item.unit_price_at_add) * item.quantity for item in cart.items)
    subtotal = _to_decimal(subtotal_raw)
    discount_val = _compute_discount(subtotal, promo)

    shipping_fee = shipping_fee_ron if shipping_fee_ron is not None else checkout.shipping_fee_ron
    threshold = (
        free_shipping_threshold_ron if free_shipping_threshold_ron is not None else checkout.free_shipping_threshold_ron
    )
    shipping_amount = _calculate_shipping_amount(subtotal, shipping_method, shipping_fee_ron=shipping_fee)
    shipping = _to_decimal(shipping_amount)
    if threshold is not None and threshold >= 0 and (subtotal - discount_val) >= threshold:
        shipping = Decimal("0.00")

    base_breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=discount_val,
        shipping=shipping,
        fee_enabled=checkout.fee_enabled,
        fee_type=checkout.fee_type,
        fee_value=checkout.fee_value,
        vat_enabled=False,
        vat_rate_percent=checkout.vat_rate_percent,
        vat_apply_to_shipping=checkout.vat_apply_to_shipping,
        vat_apply_to_fee=checkout.vat_apply_to_fee,
        rounding=rounding,
    )

    lines: list[TaxableProductLine] = []
    for item in cart.items:
        product_id = getattr(item, "product_id", None)
        if not product_id:
            continue
        line_subtotal = pricing.quantize_money(_to_decimal(item.unit_price_at_add) * item.quantity, rounding=rounding)
        lines.append(TaxableProductLine(product_id=product_id, subtotal=line_subtotal))

    if lines:
        line_sum = sum((line.subtotal for line in lines), start=Decimal("0.00"))
        diff = pricing.quantize_money(base_breakdown.subtotal - line_sum, rounding=rounding)
        if diff != 0:
            idx = max(range(len(lines)), key=lambda i: lines[i].subtotal)
            adjusted = lines[idx].subtotal + diff
            if adjusted < 0:
                adjusted = Decimal("0.00")
            lines[idx] = TaxableProductLine(product_id=lines[idx].product_id, subtotal=adjusted)

    vat_override = await taxes_service.compute_cart_vat_amount(
        session,
        country_code=country_code,
        lines=lines,
        discount=base_breakdown.discount,
        shipping=base_breakdown.shipping,
        fee=base_breakdown.fee,
        checkout=checkout,
    )

    breakdown = pricing.compute_totals(
        subtotal=subtotal,
        discount=discount_val,
        shipping=shipping,
        fee_enabled=checkout.fee_enabled,
        fee_type=checkout.fee_type,
        fee_value=checkout.fee_value,
        vat_enabled=checkout.vat_enabled,
        vat_rate_percent=checkout.vat_rate_percent,
        vat_apply_to_shipping=checkout.vat_apply_to_shipping,
        vat_apply_to_fee=checkout.vat_apply_to_fee,
        rounding=rounding,
        vat_override=vat_override,
    )

    return (
        Totals(
            subtotal=breakdown.subtotal,
            fee=breakdown.fee,
            tax=breakdown.vat,
            shipping=breakdown.shipping,
            total=breakdown.total,
            currency="RON",
            free_shipping_threshold_ron=threshold,
        ),
        discount_val,
    )


async def serialize_cart(
    session: AsyncSession,
    cart: Cart,
    shipping_method: ShippingMethod | None = None,
    promo: PromoCodeRead | None = None,
    *,
    checkout_settings: CheckoutSettings | None = None,
    shipping_fee_ron: Decimal | None = None,
    free_shipping_threshold_ron: Decimal | None = None,
    totals_override: Totals | None = None,
    country_code: str | None = None,
) -> CartRead:
    result = await session.execute(
        select(Cart)
            .options(
                selectinload(Cart.items)
                .selectinload(CartItem.product)
                .selectinload(Product.images),
                with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True),
            )
            .where(Cart.id == cart.id)
    )
    hydrated = result.scalar_one()
    currency = next(
        (getattr(item.product, "currency", None) for item in hydrated.items if getattr(item, "product", None)), "RON"
    ) or "RON"
    checkout = checkout_settings or CheckoutSettings()
    threshold = (
        free_shipping_threshold_ron if free_shipping_threshold_ron is not None else checkout.free_shipping_threshold_ron
    )
    totals = totals_override
    if not totals:
        totals, _ = await calculate_totals_async(
            session,
            hydrated,
            shipping_method=shipping_method,
            promo=promo,
            checkout_settings=checkout,
            shipping_fee_ron=shipping_fee_ron,
            free_shipping_threshold_ron=free_shipping_threshold_ron,
            country_code=country_code,
        )
    if totals_override and getattr(totals_override, "currency", None) is None:
        totals = Totals(**totals_override.model_dump(), currency=currency)
    if totals is not None:
        totals.free_shipping_threshold_ron = threshold
        totals.phone_required_home = bool(getattr(checkout, "phone_required_home", False))
        totals.phone_required_locker = bool(getattr(checkout, "phone_required_locker", False))
        locker_allowed, allowed_couriers = delivery_constraints(hydrated)
        totals.delivery_locker_allowed = locker_allowed
        totals.delivery_allowed_couriers = allowed_couriers
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
                currency=getattr(item.product, "currency", None) or "RON",
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
    if (
        not product
        or product.is_deleted
        or not product.is_active
        or getattr(product, "status", None) != ProductStatus.published
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    variant = None
    if payload.variant_id:
        variant = await session.get(ProductVariant, payload.variant_id)
        if not variant or variant.product_id != product.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")

    await _validate_stock(product, variant, payload.quantity)
    limit = payload.max_quantity or (variant.stock_quantity if variant else product.stock_quantity)
    _enforce_max_quantity(payload.quantity, limit)

    sale_price = product.sale_price if is_sale_active(product) else None
    base_price = sale_price if sale_price is not None else product.base_price
    unit_price = _to_decimal(base_price)
    if variant:
        unit_price += _to_decimal(variant.additional_price_delta)

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
    record_cart_event(
        "add_item", {"cart_id": str(cart.id), "product_id": str(product.id), "quantity": payload.quantity}
    )
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
    record_cart_event(
        "update_item", {"cart_id": str(cart.id), "item_id": str(item.id), "quantity": payload.quantity}
    )
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
    extra = payload.copy() if payload else {}
    extra["request_id"] = request_id_ctx_var.get()
    cart_logger.info(event, extra=extra)


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
