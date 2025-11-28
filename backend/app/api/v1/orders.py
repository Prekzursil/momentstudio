from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, require_admin
from app.db.session import get_session
from app.models.address import Address
from app.models.cart import Cart
from app.models.order import OrderStatus
from app.schemas.order import OrderRead, OrderCreate, OrderUpdate, ShippingMethodCreate, ShippingMethodRead, OrderEventRead
from app.services import order as order_service

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: OrderCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    cart_result = await session.execute(
        select(Cart).options(selectinload(Cart.items)).where(Cart.user_id == current_user.id)
    )
    cart = cart_result.scalar_one_or_none()
    if not cart or not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    for address_id in [payload.shipping_address_id, payload.billing_address_id]:
        if address_id:
            addr = await session.get(Address, address_id)
            if not addr or addr.user_id != current_user.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid address")

    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")

    order = await order_service.build_order_from_cart(
        session,
        current_user.id,
        cart,
        payload.shipping_address_id,
        payload.billing_address_id,
        shipping_method,
    )
    return order


@router.get("", response_model=list[OrderRead])
async def list_orders(current_user=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    orders = await order_service.get_orders_for_user(session, current_user.id)
    return list(orders)


@router.get("/admin", response_model=list[OrderRead])
async def admin_list_orders(
    status: OrderStatus | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    return await order_service.list_orders(session, status=status, user_id=user_id)


@router.patch("/admin/{order_id}", response_model=OrderRead)
async def admin_update_order(
    order_id: UUID,
    payload: OrderUpdate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    return await order_service.update_order(session, order, payload, shipping_method=shipping_method)


@router.post("/admin/{order_id}/retry-payment", response_model=OrderRead)
async def admin_retry_payment(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await order_service.retry_payment(session, order)


@router.post("/admin/{order_id}/refund", response_model=OrderRead)
async def admin_refund_order(
    order_id: UUID,
    note: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await order_service.refund_order(session, order, note=note)


@router.post("/admin/{order_id}/items/{item_id}/fulfill", response_model=OrderRead)
async def admin_fulfill_item(
    order_id: UUID,
    item_id: UUID,
    shipped_quantity: int = 0,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await order_service.update_fulfillment(session, order, item_id, shipped_quantity)


@router.get("/admin/{order_id}/events", response_model=list[OrderEventRead])
async def admin_order_events(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order.events


@router.get("/admin/{order_id}/packing-slip")
async def admin_packing_slip(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    content = f"Packing slip for order {order.reference_code or order.id}\nItems: {len(order.items)}"
    return PlainTextResponse(content, media_type="application/pdf")


@router.post("/shipping-methods", response_model=ShippingMethodRead, status_code=status.HTTP_201_CREATED)
async def create_shipping_method(
    payload: ShippingMethodCreate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    return await order_service.create_shipping_method(session, payload)


@router.get("/shipping-methods", response_model=list[ShippingMethodRead])
async def list_shipping_methods(session: AsyncSession = Depends(get_session)) -> list[ShippingMethodRead]:
    return await order_service.list_shipping_methods(session)


@router.get("/{order_id}", response_model=OrderRead)
async def get_order(order_id: UUID, current_user=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    order = await order_service.get_order(session, current_user.id, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order
