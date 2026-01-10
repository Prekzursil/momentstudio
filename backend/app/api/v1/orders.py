import csv
import io
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import require_complete_profile, require_verified_email, require_admin
from app.core.config import settings
from app.db.session import get_session
from app.models.address import Address
from app.models.cart import Cart
from app.models.order import OrderStatus
from app.schemas.cart import CartRead
from app.schemas.order import OrderRead, OrderCreate, OrderUpdate, ShippingMethodCreate, ShippingMethodRead, OrderEventRead
from app.services import cart as cart_service
from app.services import order as order_service
from app.services import email as email_service
from app.services import auth as auth_service
from app.schemas.checkout import GuestCheckoutRequest, GuestCheckoutResponse, CheckoutRequest
from app.schemas.address import AddressCreate
from app.services import payments
from app.services import address as address_service
from app.api.v1 import cart as cart_api
from app.schemas.order_admin import AdminOrderListItem, AdminOrderListResponse, AdminOrderRead, AdminPaginationMeta

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    background_tasks: BackgroundTasks,
    payload: OrderCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_verified_email),
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
    background_tasks.add_task(email_service.send_order_confirmation, current_user.email, order, order.items)
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_new_order_notification,
            admin_to,
            order,
            current_user.email,
            owner.preferred_language if owner else None,
        )
    return order


@router.post("/checkout", response_model=GuestCheckoutResponse, status_code=status.HTTP_201_CREATED)
async def checkout(
    payload: CheckoutRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_verified_email),
) -> GuestCheckoutResponse:
    user_cart = await cart_service.get_cart(session, current_user.id, None)
    if not user_cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")

    promo = None
    if payload.promo_code:
        promo = await cart_service.validate_promo(session, payload.promo_code, currency=None)

    shipping_addr = await address_service.create_address(
        session,
        current_user.id,
        AddressCreate(
            label="Checkout",
            line1=payload.line1,
            line2=payload.line2,
            city=payload.city,
            region=payload.region,
            postal_code=payload.postal_code,
            country=payload.country,
            is_default_shipping=payload.save_address,
            is_default_billing=payload.save_address,
        ),
    )

    totals, discount_val = cart_service.calculate_totals(user_cart, shipping_method=shipping_method, promo=promo)
    intent = await payments.create_payment_intent(session, user_cart, amount_cents=int(totals.total * 100))
    order = await order_service.build_order_from_cart(
        session,
        current_user.id,
        user_cart,
        shipping_addr.id,
        shipping_addr.id,
        shipping_method=shipping_method,
        payment_intent_id=intent["intent_id"],
        discount=discount_val,
    )
    background_tasks.add_task(email_service.send_order_confirmation, current_user.email, order, order.items)
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_new_order_notification,
            admin_to,
            order,
            current_user.email,
            owner.preferred_language if owner else None,
        )
    return GuestCheckoutResponse(order_id=order.id, reference_code=order.reference_code, client_secret=intent["client_secret"])


@router.get("", response_model=list[OrderRead])
async def list_orders(current_user=Depends(require_complete_profile), session: AsyncSession = Depends(get_session)):
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


@router.get("/admin/search", response_model=AdminOrderListResponse)
async def admin_search_orders(
    q: str | None = Query(default=None, max_length=200),
    status: OrderStatus | None = Query(default=None),
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> AdminOrderListResponse:
    rows, total_items = await order_service.admin_search_orders(
        session, q=q, status=status, from_dt=from_dt, to_dt=to_dt, page=page, limit=limit
    )
    items = [
        AdminOrderListItem(
            id=order.id,
            reference_code=order.reference_code,
            status=order.status,
            total_amount=float(order.total_amount),
            currency=order.currency,
            created_at=order.created_at,
            customer_email=email,
            customer_username=username,
        )
        for (order, email, username) in rows
    ]
    total_pages = max(1, (int(total_items) + limit - 1) // limit)
    meta = AdminPaginationMeta(total_items=int(total_items), total_pages=total_pages, page=page, limit=limit)
    return AdminOrderListResponse(items=items, meta=meta)


@router.get("/admin/export")
async def admin_export_orders(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    orders = await order_service.list_orders(session)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "reference_code", "status", "total_amount", "currency", "user_id", "created_at"])
    for order in orders:
        writer.writerow(
            [
                order.id,
                order.reference_code,
                order.status.value,
                order.total_amount,
                order.currency,
                order.user_id,
                order.created_at,
            ]
        )
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=orders.csv"}
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers=headers)


@router.get("/admin/{order_id}", response_model=AdminOrderRead)
async def admin_get_order(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    base = OrderRead.model_validate(order).model_dump()
    return AdminOrderRead(
        **base,
        customer_email=getattr(order.user, "email", None) if getattr(order, "user", None) else None,
        customer_username=getattr(order.user, "username", None) if getattr(order, "user", None) else None,
        shipping_address=order.shipping_address,
        billing_address=order.billing_address,
    )


@router.post("/guest-checkout", response_model=GuestCheckoutResponse, status_code=status.HTTP_201_CREATED)
async def guest_checkout(
    _payload: GuestCheckoutRequest,
    _background_tasks: BackgroundTasks,
    _session: AsyncSession = Depends(get_session),
    _session_id: str | None = Depends(cart_api.session_header),
):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Guest checkout disabled; please sign in")


@router.patch("/admin/{order_id}", response_model=AdminOrderRead)
async def admin_update_order(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    payload: OrderUpdate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    previous_status = order.status
    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    updated = await order_service.update_order(session, order, payload, shipping_method=shipping_method)
    if previous_status != updated.status and updated.status == OrderStatus.shipped and updated.user and updated.user.email:
        background_tasks.add_task(
            email_service.send_shipping_update, updated.user.email, updated, updated.tracking_number
        )
    full = await order_service.get_order_by_id_admin(session, order_id)
    if not full:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    base = OrderRead.model_validate(full).model_dump()
    return AdminOrderRead(
        **base,
        customer_email=getattr(full.user, "email", None) if getattr(full, "user", None) else None,
        customer_username=getattr(full.user, "username", None) if getattr(full, "user", None) else None,
        shipping_address=full.shipping_address,
        billing_address=full.billing_address,
    )


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
    background_tasks: BackgroundTasks,
    order_id: UUID,
    note: str | None = None,
    session: AsyncSession = Depends(get_session),
    admin_user=Depends(require_admin),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    updated = await order_service.refund_order(session, order, note=note)
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_refund_requested_notification,
            admin_to,
            updated,
            customer_email=(updated.user.email if updated.user and updated.user.email else None),
            requested_by_email=getattr(admin_user, "email", None),
            note=note,
            lang=owner.preferred_language if owner else None,
        )
    return updated


@router.post("/admin/{order_id}/delivery-email", response_model=OrderRead)
async def admin_send_delivery_email(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if not order.user or not order.user.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order user email missing")
    await email_service.send_delivery_confirmation(order.user.email, order)
    return order


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


@router.post("/admin/{order_id}/capture-payment", response_model=OrderRead)
async def admin_capture_payment(
    order_id: UUID,
    intent_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await order_service.capture_payment(session, order, intent_id=intent_id)


@router.post("/admin/{order_id}/void-payment", response_model=OrderRead)
async def admin_void_payment(
    order_id: UUID,
    intent_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await order_service.void_payment(session, order, intent_id=intent_id)


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
async def get_order(
    order_id: UUID, current_user=Depends(require_complete_profile), session: AsyncSession = Depends(get_session)
):
    order = await order_service.get_order(session, current_user.id, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


@router.get("/{order_id}/receipt")
async def download_receipt(
    order_id: UUID,
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
):
    order = await order_service.get_order(session, current_user.id, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    ref = order.reference_code or str(order.id)
    filename = f"receipt-{ref}.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    content = (
        f"Receipt for order {ref}\n"
        f"Status: {order.status}\n"
        f"Total: {order.total_amount} {order.currency}\n"
        f"Items: {len(order.items)}\n"
    )
    return PlainTextResponse(content, media_type="application/pdf", headers=headers)


@router.post("/{order_id}/reorder", response_model=CartRead)
async def reorder_order(
    order_id: UUID,
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> CartRead:
    cart = await cart_service.reorder_from_order(session, current_user.id, order_id)
    return await cart_service.serialize_cart(session, cart)
