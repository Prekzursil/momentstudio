import csv
import io
import mimetypes
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, UploadFile, File
from fastapi.responses import PlainTextResponse, StreamingResponse, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import require_complete_profile, require_verified_email, require_admin
from app.core.config import settings
from app.db.session import get_session
from app.models.address import Address
from app.models.cart import Cart
from app.models.order import OrderStatus, OrderEvent
from app.schemas.cart import CartRead
from app.schemas.order import OrderRead, OrderCreate, OrderUpdate, ShippingMethodCreate, ShippingMethodRead, OrderEventRead
from app.services import cart as cart_service
from app.services import order as order_service
from app.services import email as email_service
from app.services import auth as auth_service
from app.services import private_storage
from app.schemas.checkout import (
    CheckoutRequest,
    GuestCheckoutRequest,
    GuestCheckoutResponse,
    GuestEmailVerificationConfirmRequest,
    GuestEmailVerificationRequest,
    GuestEmailVerificationStatus,
)
from app.schemas.user import UserCreate
from app.schemas.address import AddressCreate
from app.services import payments
from app.services import address as address_service
from app.api.v1 import cart as cart_api
from app.schemas.order_admin import AdminOrderListItem, AdminOrderListResponse, AdminOrderRead, AdminPaginationMeta
from app.services import notifications as notification_service

router = APIRouter(prefix="/orders", tags=["orders"])


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _generate_guest_email_token() -> str:
    return str(secrets.randbelow(1_000_000)).zfill(6)

GUEST_EMAIL_TOKEN_MAX_ATTEMPTS = 10


def _sanitize_filename(value: str | None) -> str:
    name = Path(value or "").name.strip()
    if not name:
        return "shipping-label"
    return name[:255]


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
        customer_email=current_user.email,
        customer_name=getattr(current_user, "name", None) or current_user.email,
        cart=cart,
        shipping_address_id=payload.shipping_address_id,
        billing_address_id=payload.billing_address_id,
        shipping_method=shipping_method,
    )
    await notification_service.create_notification(
        session,
        user_id=current_user.id,
        type="order",
        title="Order placed" if (current_user.preferred_language or "en") != "ro" else "Comandă plasată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url="/account",
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

    has_billing = bool((payload.billing_line1 or "").strip())
    billing_same_as_shipping = not has_billing

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
            is_default_billing=bool(payload.save_address and billing_same_as_shipping),
        ),
    )

    billing_addr = shipping_addr
    if has_billing:
        if not payload.billing_city or not payload.billing_postal_code or not payload.billing_country:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Billing address is incomplete")
        billing_addr = await address_service.create_address(
            session,
            current_user.id,
            AddressCreate(
                label="Checkout (Billing)",
                line1=payload.billing_line1 or payload.line1,
                line2=payload.billing_line2,
                city=payload.billing_city,
                region=payload.billing_region,
                postal_code=payload.billing_postal_code,
                country=payload.billing_country,
                is_default_shipping=False,
                is_default_billing=payload.save_address,
            ),
        )

    totals, discount_val = cart_service.calculate_totals(user_cart, shipping_method=shipping_method, promo=promo)
    payment_method = payload.payment_method or "stripe"
    intent = None
    client_secret = None
    payment_intent_id = None
    if payment_method == "stripe":
        intent = await payments.create_payment_intent(session, user_cart, amount_cents=int(totals.total * 100))
        client_secret = str(intent.get("client_secret"))
        payment_intent_id = str(intent.get("intent_id"))
    order = await order_service.build_order_from_cart(
        session,
        current_user.id,
        customer_email=current_user.email,
        customer_name=getattr(current_user, "name", None) or current_user.email,
        cart=user_cart,
        shipping_address_id=shipping_addr.id,
        billing_address_id=billing_addr.id,
        shipping_method=shipping_method,
        payment_method=payment_method,
        payment_intent_id=payment_intent_id,
        discount=discount_val,
    )
    await notification_service.create_notification(
        session,
        user_id=current_user.id,
        type="order",
        title="Order placed" if (current_user.preferred_language or "en") != "ro" else "Comandă plasată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url="/account",
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
    return GuestCheckoutResponse(
        order_id=order.id,
        reference_code=order.reference_code,
        client_secret=client_secret,
        payment_method=payment_method,
    )


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
        customer_email=getattr(order, "customer_email", None)
        or (getattr(order.user, "email", None) if getattr(order, "user", None) else None),
        customer_username=getattr(order.user, "username", None) if getattr(order, "user", None) else None,
        shipping_address=order.shipping_address,
        billing_address=order.billing_address,
        tracking_url=getattr(order, "tracking_url", None),
        shipping_label_filename=getattr(order, "shipping_label_filename", None),
        shipping_label_uploaded_at=getattr(order, "shipping_label_uploaded_at", None),
        has_shipping_label=bool(getattr(order, "shipping_label_path", None)),
    )


@router.post("/guest-checkout/email/request", status_code=status.HTTP_204_NO_CONTENT)
async def request_guest_email_verification(
    payload: GuestEmailVerificationRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> None:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")

    email = _normalize_email(str(payload.email))
    existing = await auth_service.get_user_by_email(session, email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered; please sign in to checkout.",
        )

    cart = await cart_service.get_cart(session, None, session_id)
    token = _generate_guest_email_token()
    now = datetime.now(timezone.utc)

    cart.guest_email = email
    cart.guest_email_verification_token = token
    cart.guest_email_verification_expires_at = now + timedelta(minutes=30)
    cart.guest_email_verified_at = None
    cart.guest_email_verification_attempts = 0
    cart.guest_email_verification_last_attempt_at = None
    session.add(cart)
    await session.commit()

    background_tasks.add_task(email_service.send_verification_email, email, token, lang)


@router.post("/guest-checkout/email/confirm", response_model=GuestEmailVerificationStatus)
async def confirm_guest_email_verification(
    payload: GuestEmailVerificationConfirmRequest,
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
) -> GuestEmailVerificationStatus:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")

    cart = await cart_service.get_cart(session, None, session_id)
    email = _normalize_email(str(payload.email))
    token = (payload.token or "").strip()
    now = datetime.now(timezone.utc)

    if not cart.guest_email or _normalize_email(cart.guest_email) != email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email mismatch")

    expires = cart.guest_email_verification_expires_at
    if expires and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not cart.guest_email_verification_token or not expires or expires < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    attempts = int(getattr(cart, "guest_email_verification_attempts", 0) or 0)
    if attempts >= GUEST_EMAIL_TOKEN_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts; request a new code.")

    if cart.guest_email_verification_token != token:
        cart.guest_email_verification_attempts = attempts + 1
        cart.guest_email_verification_last_attempt_at = now
        session.add(cart)
        await session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    cart.guest_email_verified_at = now
    cart.guest_email_verification_token = None
    cart.guest_email_verification_expires_at = None
    cart.guest_email_verification_attempts = 0
    cart.guest_email_verification_last_attempt_at = None
    session.add(cart)
    await session.commit()
    await session.refresh(cart)
    return GuestEmailVerificationStatus(email=cart.guest_email, verified=True)


@router.get("/guest-checkout/email/status", response_model=GuestEmailVerificationStatus)
async def guest_email_verification_status(
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
) -> GuestEmailVerificationStatus:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")
    cart = await cart_service.get_cart(session, None, session_id)
    return GuestEmailVerificationStatus(email=cart.guest_email, verified=cart.guest_email_verified_at is not None)


@router.post("/guest-checkout", response_model=GuestCheckoutResponse, status_code=status.HTTP_201_CREATED)
async def guest_checkout(
    payload: GuestCheckoutRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
):
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")

    email = _normalize_email(str(payload.email))
    existing = await auth_service.get_user_by_email(session, email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered; please sign in to checkout.",
        )

    cart = await cart_service.get_cart(session, None, session_id)
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")
    if not cart.guest_email_verified_at or _normalize_email(cart.guest_email or "") != email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email verification required")

    user_id = None
    customer_name = (payload.name or "").strip()
    if not customer_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")

    if payload.create_account:
        if not payload.password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required")
        if not payload.username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username is required")
        if not payload.first_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="First name is required")
        if not payload.last_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Last name is required")
        if not payload.date_of_birth:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date of birth is required")
        if not payload.phone:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone is required")

        user = await auth_service.create_user(
            session,
            UserCreate(
                email=email,
                username=payload.username,
                password=payload.password,
                name=customer_name,
                first_name=payload.first_name,
                middle_name=payload.middle_name,
                last_name=payload.last_name,
                date_of_birth=payload.date_of_birth,
                phone=payload.phone,
                preferred_language=payload.preferred_language or "en",
            ),
        )
        user.email_verified = True
        session.add(user)
        await session.commit()
        await session.refresh(user)
        user_id = user.id

    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")

    promo = None
    if payload.promo_code:
        promo = await cart_service.validate_promo(session, payload.promo_code, currency=None)

    has_billing = bool((payload.billing_line1 or "").strip())
    billing_same_as_shipping = not has_billing

    shipping_addr = await address_service.create_address(
        session,
        user_id,
        AddressCreate(
            label="Guest Checkout" if not payload.create_account else "Checkout",
            line1=payload.line1,
            line2=payload.line2,
            city=payload.city,
            region=payload.region,
            postal_code=payload.postal_code,
            country=payload.country,
            is_default_shipping=bool(payload.save_address and payload.create_account),
            is_default_billing=bool(payload.save_address and payload.create_account and billing_same_as_shipping),
        ),
    )

    billing_addr = shipping_addr
    if has_billing:
        if not payload.billing_city or not payload.billing_postal_code or not payload.billing_country:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Billing address is incomplete")
        billing_addr = await address_service.create_address(
            session,
            user_id,
            AddressCreate(
                label="Guest Checkout (Billing)" if not payload.create_account else "Checkout (Billing)",
                line1=payload.billing_line1 or payload.line1,
                line2=payload.billing_line2,
                city=payload.billing_city,
                region=payload.billing_region,
                postal_code=payload.billing_postal_code,
                country=payload.billing_country,
                is_default_shipping=False,
                is_default_billing=bool(payload.save_address and payload.create_account),
            ),
        )

    totals, discount_val = cart_service.calculate_totals(cart, shipping_method=shipping_method, promo=promo)
    payment_method = payload.payment_method or "stripe"
    intent = None
    client_secret = None
    payment_intent_id = None
    if payment_method == "stripe":
        intent = await payments.create_payment_intent(session, cart, amount_cents=int(totals.total * 100))
        client_secret = str(intent.get("client_secret"))
        payment_intent_id = str(intent.get("intent_id"))
    order = await order_service.build_order_from_cart(
        session,
        user_id,
        customer_email=email,
        customer_name=customer_name,
        cart=cart,
        shipping_address_id=shipping_addr.id,
        billing_address_id=billing_addr.id,
        shipping_method=shipping_method,
        payment_method=payment_method,
        payment_intent_id=payment_intent_id,
        discount=discount_val,
    )

    background_tasks.add_task(email_service.send_order_confirmation, email, order, order.items)
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_new_order_notification,
            admin_to,
            order,
            email,
            owner.preferred_language if owner else None,
        )

    return GuestCheckoutResponse(
        order_id=order.id,
        reference_code=order.reference_code,
        client_secret=client_secret,
        payment_method=payment_method,
    )


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
    if previous_status != updated.status and updated.status == OrderStatus.shipped:
        shipping_to = (
            updated.user.email
            if updated.user and updated.user.email
            else getattr(updated, "customer_email", None)
        )
        if shipping_to:
            background_tasks.add_task(email_service.send_shipping_update, shipping_to, updated, updated.tracking_number)
        if updated.user and updated.user.id:
            await notification_service.create_notification(
                session,
                user_id=updated.user.id,
                type="order",
                title="Order shipped" if (updated.user.preferred_language or "en") != "ro" else "Comandă expediată",
                body=f"Reference {updated.reference_code}" if updated.reference_code else None,
                url="/account",
            )
    full = await order_service.get_order_by_id_admin(session, order_id)
    if not full:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    base = OrderRead.model_validate(full).model_dump()
    return AdminOrderRead(
        **base,
        customer_email=getattr(full, "customer_email", None) or (getattr(full.user, "email", None) if getattr(full, "user", None) else None),
        customer_username=getattr(full.user, "username", None) if getattr(full, "user", None) else None,
        shipping_address=full.shipping_address,
        billing_address=full.billing_address,
        tracking_url=getattr(full, "tracking_url", None),
        shipping_label_filename=getattr(full, "shipping_label_filename", None),
        shipping_label_uploaded_at=getattr(full, "shipping_label_uploaded_at", None),
        has_shipping_label=bool(getattr(full, "shipping_label_path", None)),
    )


@router.post("/admin/{order_id}/shipping-label", response_model=AdminOrderRead)
async def admin_upload_shipping_label(
    order_id: UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    old_path = getattr(order, "shipping_label_path", None)
    rel_path, original_name = private_storage.save_private_upload(
        file,
        subdir=f"shipping-labels/{order_id}",
        allowed_content_types=("application/pdf", "image/png", "image/jpeg", "image/webp"),
        max_bytes=10 * 1024 * 1024,
    )
    now = datetime.now(timezone.utc)
    order.shipping_label_path = rel_path
    order.shipping_label_filename = _sanitize_filename(original_name)
    order.shipping_label_uploaded_at = now
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="shipping_label_uploaded", note=order.shipping_label_filename))
    await session.commit()

    if old_path and old_path != rel_path:
        private_storage.delete_private_file(old_path)

    full = await order_service.get_order_by_id_admin(session, order_id)
    if not full:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    base = OrderRead.model_validate(full).model_dump()
    return AdminOrderRead(
        **base,
        customer_email=getattr(full, "customer_email", None) or (getattr(full.user, "email", None) if getattr(full, "user", None) else None),
        customer_username=getattr(full.user, "username", None) if getattr(full, "user", None) else None,
        shipping_address=full.shipping_address,
        billing_address=full.billing_address,
        tracking_url=getattr(full, "tracking_url", None),
        shipping_label_filename=getattr(full, "shipping_label_filename", None),
        shipping_label_uploaded_at=getattr(full, "shipping_label_uploaded_at", None),
        has_shipping_label=bool(getattr(full, "shipping_label_path", None)),
    )


@router.get("/admin/{order_id}/shipping-label")
async def admin_download_shipping_label(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> FileResponse:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    rel = getattr(order, "shipping_label_path", None)
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping label not found")
    path = private_storage.resolve_private_path(rel)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping label not found")

    filename = _sanitize_filename(getattr(order, "shipping_label_filename", None) or path.name)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    headers = {"Cache-Control": "no-store"}
    return FileResponse(path, media_type=media_type, filename=filename, headers=headers)


@router.delete("/admin/{order_id}/shipping-label", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_shipping_label(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> None:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    rel = getattr(order, "shipping_label_path", None)
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping label not found")

    filename = getattr(order, "shipping_label_filename", None)
    order.shipping_label_path = None
    order.shipping_label_filename = None
    order.shipping_label_uploaded_at = None
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="shipping_label_deleted", note=_sanitize_filename(filename)))
    await session.commit()
    private_storage.delete_private_file(rel)


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
            customer_email=getattr(updated, "customer_email", None) or (updated.user.email if updated.user and updated.user.email else None),
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
    to_email = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
    if not to_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order customer email missing")
    await email_service.send_delivery_confirmation(to_email, order, getattr(order.user, "preferred_language", None) if order.user else None)
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
