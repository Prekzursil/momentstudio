from uuid import UUID
from decimal import Decimal

import uuid
from fastapi import APIRouter, Depends, Header, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user_optional
from app.db.session import get_session
from app.schemas.cart import CartItemCreate, CartItemRead, CartItemUpdate, CartRead
from app.schemas.promo import PromoCodeRead, PromoCodeCreate
from app.services import cart as cart_service
from app.services import checkout_settings as checkout_settings_service
from app.services import order as order_service
from app.schemas.cart_sync import CartSyncRequest

router = APIRouter(prefix="/cart", tags=["cart"])


def session_header(x_session_id: str | None = Header(default=None)) -> str | None:
    return x_session_id


@router.get("", response_model=CartRead)
async def get_cart(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(session_header),
    shipping_method_id: UUID | None = Query(default=None),
    promo_code: str | None = Query(default=None),
):
    if not current_user and not session_id:
        session_id = f"guest-{uuid.uuid4()}"
    cart = await cart_service.get_cart(session, getattr(current_user, "id", None) if current_user else None, session_id)
    await session.refresh(cart)
    if session_id and not cart.session_id:
        cart.session_id = session_id
        session.add(cart)
        await session.commit()
        await session.refresh(cart)
    shipping_method = None
    if shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    promo = None
    if promo_code:
        promo = await cart_service.validate_promo(session, promo_code, currency=None)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    return await cart_service.serialize_cart(
        session,
        cart,
        shipping_method=shipping_method,
        promo=promo,
        checkout_settings=checkout_settings,
    )


@router.post("/items", response_model=CartItemRead, status_code=status.HTTP_201_CREATED)
async def add_item(
    payload: CartItemCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(session_header),
):
    if not current_user and not session_id:
        session_id = f"guest-{uuid.uuid4()}"
    cart = await cart_service.get_cart(session, getattr(current_user, "id", None) if current_user else None, session_id)
    item = await cart_service.add_item(session, cart, payload)
    return CartItemRead(
        id=item.id,
        product_id=item.product_id,
        variant_id=item.variant_id,
        quantity=item.quantity,
        max_quantity=item.max_quantity,
        unit_price_at_add=Decimal(item.unit_price_at_add),
    )


@router.patch("/items/{item_id}", response_model=CartItemRead)
async def update_item(
    item_id: UUID,
    payload: CartItemUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(session_header),
):
    cart = await cart_service.get_cart(session, getattr(current_user, "id", None) if current_user else None, session_id)
    item = await cart_service.update_item(session, cart, item_id, payload)
    return CartItemRead(
        id=item.id,
        product_id=item.product_id,
        variant_id=item.variant_id,
        quantity=item.quantity,
        max_quantity=item.max_quantity,
        unit_price_at_add=Decimal(item.unit_price_at_add),
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(session_header),
):
    cart = await cart_service.get_cart(session, getattr(current_user, "id", None) if current_user else None, session_id)
    await cart_service.delete_item(session, cart, item_id)
    return None


@router.post("/merge", response_model=CartRead)
async def merge_guest_cart(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(session_header),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Auth required to merge guest cart")
    user_cart = await cart_service.get_cart(session, current_user.id, None)
    merged_cart = await cart_service.merge_guest_cart(session, user_cart, session_id)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    return await cart_service.serialize_cart(
        session,
        merged_cart,
        checkout_settings=checkout_settings,
    )


@router.post("/promo/validate", response_model=PromoCodeRead)
async def validate_promo(
    payload: PromoCodeCreate,
    session: AsyncSession = Depends(get_session),
):
    return await cart_service.validate_promo(session, payload.code, payload.currency)


@router.post("/sync", response_model=CartRead)
async def sync_cart(
    payload: CartSyncRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(session_header),
):
    if not current_user and not session_id:
        session_id = f"guest-{uuid.uuid4()}"
    cart = await cart_service.get_cart(session, getattr(current_user, "id", None) if current_user else None, session_id)
    await cart_service.sync_cart(session, cart, payload.items)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    return await cart_service.serialize_cart(
        session,
        cart,
        checkout_settings=checkout_settings,
    )
