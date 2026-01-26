import csv
import io
import mimetypes
import secrets
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote_plus
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, UploadFile, File, Body, Response
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import (
    get_current_user_optional,
    require_admin,
    require_admin_section,
    require_complete_profile,
    require_verified_email,
)
from app.core.config import settings
from app.core import security
from app.core.security import create_receipt_token, decode_receipt_token
from app.db.session import get_session
from app.models.address import Address
from app.models.cart import Cart
from app.models.order import Order, OrderItem, OrderStatus, OrderEvent
from app.models.user import User
from app.schemas.cart import CartRead
from app.schemas.cart import Totals
from app.schemas.order import (
    OrderCancelRequest,
    OrderCreate,
    OrderEventRead,
    OrderListResponse,
    OrderPaginationMeta,
    OrderRead,
    OrderUpdate,
    ShippingMethodCreate,
    ShippingMethodRead,
)
from app.services import cart as cart_service
from app.services import coupons_v2 as coupons_service
from app.services import order as order_service
from app.services import email as email_service
from app.services import checkout_settings as checkout_settings_service
from app.services import auth as auth_service
from app.services import private_storage
from app.services import receipts as receipt_service
from app.services import packing_slips as packing_slips_service
from app.schemas.checkout import (
    CheckoutRequest,
    GuestCheckoutRequest,
    GuestCheckoutResponse,
    GuestEmailVerificationConfirmRequest,
    GuestEmailVerificationRequest,
    GuestEmailVerificationRequestResponse,
    GuestEmailVerificationStatus,
    PayPalCaptureRequest,
    PayPalCaptureResponse,
    StripeConfirmRequest,
    StripeConfirmResponse,
)
from app.schemas.user import UserCreate
from app.schemas.address import AddressCreate
from app.services import payments
from app.services import paypal as paypal_service
from app.services import address as address_service
from app.api.v1 import cart as cart_api
from app.schemas.order_admin import (
    AdminOrderListItem,
    AdminOrderListResponse,
    AdminOrderRead,
    AdminPaginationMeta,
    AdminOrderEmailResendRequest,
    AdminOrderIdsRequest,
)
from app.schemas.order_admin_note import OrderAdminNoteCreate
from app.schemas.order_admin_address import AdminOrderAddressesUpdate
from app.schemas.order_shipment import OrderShipmentCreate, OrderShipmentUpdate, OrderShipmentRead
from app.schemas.order_tag import OrderTagCreate, OrderTagsResponse
from app.schemas.order_refund import AdminOrderRefundCreate, AdminOrderRefundRequest
from app.schemas.receipt import ReceiptRead, ReceiptShareTokenRead
from app.services import notifications as notification_service
from app.services import promo_usage
from app.services import pricing
from app.services import pii as pii_service

router = APIRouter(prefix="/orders", tags=["orders"])


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _account_orders_url(order: Order) -> str:
    token = str(order.reference_code or order.id)
    return f"/account/orders?q={quote_plus(token)}"


def _generate_guest_email_token() -> str:
    return str(secrets.randbelow(1_000_000)).zfill(6)

GUEST_EMAIL_TOKEN_MAX_ATTEMPTS = 10


def _as_decimal(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _money_to_cents(value: Decimal) -> int:
    quantized = pricing.quantize_money(value)
    return int((quantized * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _charge_label(kind: str, lang: str | None) -> str:
    ro = (lang or "").strip().lower() == "ro"
    if kind == "shipping":
        return "Livrare" if ro else "Shipping"
    if kind == "fee":
        return "Taxă" if ro else "Fee"
    if kind == "vat":
        return "TVA" if ro else "VAT"
    if kind == "discount":
        return "Reducere" if ro else "Discount"
    return kind


def _cart_item_name(item, lang: str | None) -> str:
    product = getattr(item, "product", None)
    variant = getattr(item, "variant", None)
    base = (getattr(product, "name", None) or "").strip() or "Item"
    variant_name = (getattr(variant, "name", None) or "").strip()
    if variant_name:
        return f"{base} ({variant_name})"
    return base


def _build_stripe_line_items(cart: Cart, totals: Totals, *, lang: str | None) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for item in cart.items:
        unit_price = _as_decimal(getattr(item, "unit_price_at_add", 0))
        unit_amount = _money_to_cents(unit_price)
        quantity = int(getattr(item, "quantity", 0) or 0)
        if quantity <= 0:
            continue
        items.append(
            {
                "price_data": {
                    "currency": "ron",
                    "unit_amount": unit_amount,
                    "product_data": {"name": _cart_item_name(item, lang)},
                },
                "quantity": quantity,
            }
        )

    shipping_cents = _money_to_cents(totals.shipping)
    if shipping_cents:
        items.append(
            {
                "price_data": {
                    "currency": "ron",
                    "unit_amount": shipping_cents,
                    "product_data": {"name": _charge_label("shipping", lang)},
                },
                "quantity": 1,
            }
        )

    fee_cents = _money_to_cents(totals.fee)
    if fee_cents:
        items.append(
            {
                "price_data": {
                    "currency": "ron",
                    "unit_amount": fee_cents,
                    "product_data": {"name": _charge_label("fee", lang)},
                },
                "quantity": 1,
            }
        )

    vat_cents = _money_to_cents(totals.tax)
    if vat_cents:
        items.append(
            {
                "price_data": {
                    "currency": "ron",
                    "unit_amount": vat_cents,
                    "product_data": {"name": _charge_label("vat", lang)},
                },
                "quantity": 1,
            }
        )

    return items


def _build_paypal_items(cart: Cart, *, lang: str | None) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for item in cart.items:
        quantity = int(getattr(item, "quantity", 0) or 0)
        if quantity <= 0:
            continue
        product = getattr(item, "product", None)
        sku = (getattr(product, "sku", None) or "").strip() or None
        unit_price = pricing.quantize_money(_as_decimal(getattr(item, "unit_price_at_add", 0)))
        record: dict[str, object] = {
            "name": _cart_item_name(item, lang),
            "quantity": str(quantity),
            "unit_amount": {"currency_code": "RON", "value": str(unit_price)},
            "category": "PHYSICAL_GOODS",
        }
        if sku:
            record["sku"] = sku
        items.append(record)
    return items


def _delivery_from_payload(
    *,
    courier: str,
    delivery_type: str,
    locker_id: str | None,
    locker_name: str | None,
    locker_address: str | None,
    locker_lat: float | None,
    locker_lng: float | None,
) -> tuple[str, str, str | None, str | None, str | None, float | None, float | None]:
    courier_clean = (courier or "sameday").strip()
    delivery_clean = (delivery_type or "home").strip()
    if delivery_clean == "locker":
        if not (locker_id or "").strip() or not (locker_name or "").strip() or locker_lat is None or locker_lng is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Locker selection is required")
        return (
            courier_clean,
            delivery_clean,
            locker_id.strip(),
            locker_name.strip(),
            (locker_address or "").strip() or None,
            float(locker_lat),
            float(locker_lng),
        )
    return courier_clean, delivery_clean, None, None, None, None, None


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

    shipping_country: str | None = None
    for address_id in [payload.shipping_address_id, payload.billing_address_id]:
        if address_id:
            addr = await session.get(Address, address_id)
            if not addr or addr.user_id != current_user.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid address")
            if address_id == payload.shipping_address_id:
                shipping_country = addr.country

    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    totals, _ = await cart_service.calculate_totals_async(
        session,
        cart,
        shipping_method=shipping_method,
        promo=None,
        checkout_settings=checkout_settings,
        country_code=shipping_country,
    )

    order = await order_service.build_order_from_cart(
        session,
        current_user.id,
        customer_email=current_user.email,
        customer_name=getattr(current_user, "name", None) or current_user.email,
        cart=cart,
        shipping_address_id=payload.shipping_address_id,
        billing_address_id=payload.billing_address_id,
        shipping_method=shipping_method,
        payment_method="cod",
        tax_amount=totals.tax,
        fee_amount=totals.fee,
        shipping_amount=totals.shipping,
        total_amount=totals.total,
    )
    await notification_service.create_notification(
        session,
        user_id=current_user.id,
        type="order",
        title="Order placed" if (current_user.preferred_language or "en") != "ro" else "Comandă plasată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )
    background_tasks.add_task(
        email_service.send_order_confirmation,
        current_user.email,
        order,
        order.items,
        current_user.preferred_language,
        receipt_share_days=checkout_settings.receipt_share_days,
    )
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
    session_id: str | None = Depends(cart_api.session_header),
) -> GuestCheckoutResponse:
    user_cart = await cart_service.get_cart(session, current_user.id, session_id)
    if not user_cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)

    courier, delivery_type, locker_id, locker_name, locker_address, locker_lat, locker_lng = _delivery_from_payload(
        courier=payload.courier,
        delivery_type=payload.delivery_type,
        locker_id=payload.locker_id,
        locker_name=payload.locker_name,
        locker_address=payload.locker_address,
        locker_lat=payload.locker_lat,
        locker_lng=payload.locker_lng,
    )
    locker_allowed, allowed_couriers = cart_service.delivery_constraints(user_cart)
    if not allowed_couriers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No couriers available for cart items")
    if courier not in allowed_couriers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected courier is not available for cart items")
    if delivery_type == "locker" and not locker_allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Locker delivery is not available for cart items")
    phone_required = bool(
        checkout_settings.phone_required_locker if delivery_type == "locker" else checkout_settings.phone_required_home
    )
    phone = (payload.phone or "").strip() or None
    if not phone:
        phone = (getattr(current_user, "phone", None) or "").strip() or None
    if phone_required and not phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone is required")

    promo = None
    applied_discount = None
    applied_coupon = None
    coupon_shipping_discount = Decimal("0.00")
    if payload.promo_code:
        rate_flat = Decimal(getattr(shipping_method, "rate_flat", None) or 0) if shipping_method else None
        rate_per = Decimal(getattr(shipping_method, "rate_per_kg", None) or 0) if shipping_method else None
        try:
            applied_discount = await coupons_service.apply_discount_code_to_cart(
                session,
                user=current_user,
                cart=user_cart,
                checkout=checkout_settings,
                shipping_method_rate_flat=rate_flat,
                shipping_method_rate_per_kg=rate_per,
                code=payload.promo_code,
                country_code=payload.country,
            )
            applied_coupon = applied_discount.coupon if applied_discount else None
            coupon_shipping_discount = applied_discount.shipping_discount_ron if applied_discount else Decimal("0.00")
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                promo = await cart_service.validate_promo(session, payload.promo_code, currency=None)
            else:
                raise

    has_billing = bool((payload.billing_line1 or "").strip())
    billing_same_as_shipping = not has_billing

    address_user_id = current_user.id if payload.save_address else None
    default_shipping = bool(
        payload.save_address and (payload.default_shipping if payload.default_shipping is not None else True)
    )
    default_billing = bool(
        payload.save_address and (payload.default_billing if payload.default_billing is not None else True)
    )

    shipping_addr = await address_service.create_address(
        session,
        address_user_id,
        AddressCreate(
            label="Checkout" if payload.save_address else "Checkout (One-time)",
            phone=phone,
            line1=payload.line1,
            line2=payload.line2,
            city=payload.city,
            region=payload.region,
            postal_code=payload.postal_code,
            country=payload.country,
            is_default_shipping=default_shipping,
            is_default_billing=bool(default_billing and billing_same_as_shipping),
        ),
    )

    billing_addr = shipping_addr
    if has_billing:
        if not (
            (payload.billing_line1 or "").strip()
            and (payload.billing_city or "").strip()
            and (payload.billing_postal_code or "").strip()
            and (payload.billing_country or "").strip()
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Billing address is incomplete")
        billing_addr = await address_service.create_address(
            session,
            address_user_id,
            AddressCreate(
                label="Checkout (Billing)" if payload.save_address else "Checkout (Billing · One-time)",
                phone=phone,
                line1=payload.billing_line1 or payload.line1,
                line2=payload.billing_line2,
                city=payload.billing_city,
                region=payload.billing_region,
                postal_code=payload.billing_postal_code,
                country=payload.billing_country,
                is_default_shipping=False,
                is_default_billing=default_billing,
            ),
        )

    if applied_coupon and applied_discount:
        totals, discount_val = applied_discount.totals, applied_discount.discount_ron
    else:
        totals, discount_val = await cart_service.calculate_totals_async(
            session,
            user_cart,
            shipping_method=shipping_method,
            promo=promo,
            checkout_settings=checkout_settings,
            country_code=shipping_addr.country,
        )
    payment_method = payload.payment_method or "stripe"
    stripe_session_id = None
    stripe_checkout_url = None
    payment_intent_id = None
    paypal_order_id = None
    paypal_approval_url = None
    if payment_method == "stripe":
        stripe_line_items = _build_stripe_line_items(user_cart, totals, lang=current_user.preferred_language)
        discount_cents = _money_to_cents(discount_val) if discount_val and discount_val > 0 else None
        stripe_session = await payments.create_checkout_session(
            session=session,
            amount_cents=_money_to_cents(totals.total),
            customer_email=current_user.email,
            success_url=f"{settings.frontend_origin.rstrip('/')}/checkout/stripe/return?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.frontend_origin.rstrip('/')}/checkout/stripe/cancel?session_id={{CHECKOUT_SESSION_ID}}",
            lang=current_user.preferred_language,
            metadata={"cart_id": str(user_cart.id), "user_id": str(current_user.id)},
            line_items=stripe_line_items,
            discount_cents=discount_cents,
            promo_code=payload.promo_code,
        )
        stripe_session_id = str(stripe_session.get("session_id"))
        stripe_checkout_url = str(stripe_session.get("checkout_url"))
    elif payment_method == "paypal":
        paypal_items = _build_paypal_items(user_cart, lang=current_user.preferred_language)
        paypal_order_id, paypal_approval_url = await paypal_service.create_order(
            total_ron=totals.total,
            reference=str(user_cart.id),
            return_url=f"{settings.frontend_origin}/checkout/paypal/return",
            cancel_url=f"{settings.frontend_origin}/checkout/paypal/cancel",
            item_total_ron=totals.subtotal,
            shipping_ron=totals.shipping,
            tax_ron=totals.tax,
            fee_ron=totals.fee,
            discount_ron=discount_val,
            items=paypal_items,
        )
    elif payment_method == "netopia":
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Netopia is not configured yet")
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
        stripe_checkout_session_id=stripe_session_id,
        paypal_order_id=paypal_order_id,
        courier=courier,
        delivery_type=delivery_type,
        locker_id=locker_id,
        locker_name=locker_name,
        locker_address=locker_address,
        locker_lat=locker_lat,
        locker_lng=locker_lng,
        discount=discount_val,
        promo_code=payload.promo_code,
        invoice_company=payload.invoice_company,
        invoice_vat_id=payload.invoice_vat_id,
        tax_amount=totals.tax,
        fee_amount=totals.fee,
        shipping_amount=totals.shipping,
        total_amount=totals.total,
    )
    if applied_coupon:
        await coupons_service.reserve_coupon_for_order(
            session,
            user=current_user,
            order=order,
            coupon=applied_coupon,
            discount_ron=discount_val,
            shipping_discount_ron=coupon_shipping_discount,
        )
        if (payment_method or "").strip().lower() == "cod":
            await coupons_service.redeem_coupon_for_order(session, order=order, note="COD checkout")
    await notification_service.create_notification(
        session,
        user_id=current_user.id,
        type="order",
        title="Order placed" if (current_user.preferred_language or "en") != "ro" else "Comandă plasată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )
    if (payment_method or "").strip().lower() == "cod":
        background_tasks.add_task(
            email_service.send_order_confirmation,
            current_user.email,
            order,
            order.items,
            current_user.preferred_language,
            receipt_share_days=checkout_settings.receipt_share_days,
        )
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
        paypal_order_id=paypal_order_id,
        paypal_approval_url=paypal_approval_url,
        stripe_session_id=stripe_session_id,
        stripe_checkout_url=stripe_checkout_url,
        payment_method=payment_method,
    )


@router.post("/paypal/capture", response_model=PayPalCaptureResponse)
async def capture_paypal_order(
    payload: PayPalCaptureRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> PayPalCaptureResponse:
    paypal_order_id = (payload.paypal_order_id or "").strip()
    if not paypal_order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PayPal order id is required")

    order = (
        (
            await session.execute(
                select(Order)
                .options(
                    selectinload(Order.user),
                    selectinload(Order.items).selectinload(OrderItem.product),
                    selectinload(Order.events),
                    selectinload(Order.shipping_address),
                    selectinload(Order.billing_address),
                )
                .where(Order.paypal_order_id == paypal_order_id)
            )
        )
        .scalars()
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if payload.order_id and order.id != payload.order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order mismatch")
    if (order.payment_method or "").strip().lower() != "paypal":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not a PayPal order")

    # For signed-in checkouts, keep the capture bound to the same user.
    if order.user_id:
        if current_user and order.user_id == current_user.id:
            pass
        elif payload.order_id and order.id == payload.order_id:
            # Allow guest checkout return flows (including "create account" during guest checkout).
            pass
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    if order.paypal_capture_id:
        return PayPalCaptureResponse(
            order_id=order.id,
            reference_code=order.reference_code,
            status=order.status,
            paypal_capture_id=order.paypal_capture_id,
        )

    if order.status not in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order cannot be captured")

    capture_id = await paypal_service.capture_order(paypal_order_id=paypal_order_id)
    if order.status == OrderStatus.pending_payment:
        order.status = OrderStatus.pending_acceptance
        session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
    order.paypal_capture_id = capture_id or order.paypal_capture_id
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="payment_captured", note=f"PayPal {capture_id}".strip()))
    await promo_usage.record_promo_usage(session, order=order, note=f"PayPal {capture_id}".strip())
    await session.commit()
    await session.refresh(order)
    await coupons_service.redeem_coupon_for_order(session, order=order, note=f"PayPal {capture_id}".strip())

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    customer_to = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
    customer_lang = order.user.preferred_language if order.user else None
    if customer_to:
        background_tasks.add_task(
            email_service.send_order_confirmation,
            customer_to,
            order,
            order.items,
            customer_lang,
            receipt_share_days=checkout_settings.receipt_share_days,
        )
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_new_order_notification,
            admin_to,
            order,
            customer_to,
            owner.preferred_language if owner else None,
        )
    if order.user and order.user.id:
        await notification_service.create_notification(
            session,
            user_id=order.user.id,
            type="order",
            title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
            body=f"Reference {order.reference_code}" if order.reference_code else None,
            url=_account_orders_url(order),
        )

    return PayPalCaptureResponse(
        order_id=order.id,
        reference_code=order.reference_code,
        status=order.status,
        paypal_capture_id=order.paypal_capture_id,
    )


@router.post("/stripe/confirm", response_model=StripeConfirmResponse)
async def confirm_stripe_checkout(
    payload: StripeConfirmRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> StripeConfirmResponse:
    session_id = (payload.session_id or "").strip()
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session id is required")

    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")

    payments.init_stripe()
    try:
        checkout_session = payments.stripe.checkout.Session.retrieve(session_id)  # type: ignore[attr-defined]
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe session lookup failed") from exc

    payment_status = (
        getattr(checkout_session, "payment_status", None)
        or (checkout_session.get("payment_status") if hasattr(checkout_session, "get") else None)
    )
    if str(payment_status or "").lower() != "paid":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment not completed")

    order = (
        (
            await session.execute(
                select(Order)
                .options(
                    selectinload(Order.user),
                    selectinload(Order.items).selectinload(OrderItem.product),
                    selectinload(Order.events),
                    selectinload(Order.shipping_address),
                    selectinload(Order.billing_address),
                )
                .where(Order.stripe_checkout_session_id == session_id)
            )
        )
        .scalars()
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if payload.order_id and order.id != payload.order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order mismatch")

    # For signed-in checkouts, keep confirmation bound to the same user.
    if order.user_id:
        if current_user and order.user_id == getattr(current_user, "id", None):
            pass
        elif payload.order_id and order.id == payload.order_id:
            # Allow guest checkout return flows (including "create account" during guest checkout).
            pass
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    payment_intent_id = (
        getattr(checkout_session, "payment_intent", None)
        or (checkout_session.get("payment_intent") if hasattr(checkout_session, "get") else None)
    )
    if payment_intent_id and not order.stripe_payment_intent_id:
        order.stripe_payment_intent_id = str(payment_intent_id)

    already_captured = any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))
    captured_added = False
    if not already_captured:
        session.add(
            OrderEvent(
                order_id=order.id,
                event="payment_captured",
                note=f"Stripe session {session_id}",
            )
        )
        captured_added = True
        await promo_usage.record_promo_usage(session, order=order, note=f"Stripe session {session_id}")
    if order.status == OrderStatus.pending_payment:
        order.status = OrderStatus.pending_acceptance
        session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
    session.add(order)
    await session.commit()
    await session.refresh(order)
    await coupons_service.redeem_coupon_for_order(session, order=order, note=f"Stripe session {session_id}")

    if captured_added:
        customer_to = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
        customer_lang = order.user.preferred_language if order.user else None
        if customer_to:
            background_tasks.add_task(
                email_service.send_order_confirmation,
                customer_to,
                order,
                order.items,
                customer_lang,
            )
        owner = await auth_service.get_owner_user(session)
        admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
        if admin_to:
            background_tasks.add_task(
                email_service.send_new_order_notification,
                admin_to,
                order,
                customer_to,
                owner.preferred_language if owner else None,
            )
        if order.user and order.user.id:
            await notification_service.create_notification(
                session,
                user_id=order.user.id,
                type="order",
                title="Payment received"
                if (order.user.preferred_language or "en") != "ro"
                else "Plată confirmată",
                body=f"Reference {order.reference_code}" if order.reference_code else None,
                url=_account_orders_url(order),
            )

    return StripeConfirmResponse(order_id=order.id, reference_code=order.reference_code, status=order.status)


@router.get("", response_model=list[OrderRead])
async def list_orders(current_user=Depends(require_complete_profile), session: AsyncSession = Depends(get_session)):
    orders = await order_service.get_orders_for_user(session, current_user.id)
    return list(orders)


@router.get("/me", response_model=OrderListResponse)
async def list_my_orders(
    q: str | None = Query(default=None, max_length=200),
    status: OrderStatus | None = Query(default=None),
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> OrderListResponse:
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")
    from_dt = datetime.combine(from_date, time.min, tzinfo=timezone.utc) if from_date else None
    to_dt = datetime.combine(to_date, time.max, tzinfo=timezone.utc) if to_date else None
    rows, total_items, pending_count = await order_service.search_orders_for_user(
        session,
        user_id=current_user.id,
        q=q,
        status=status,
        from_dt=from_dt,
        to_dt=to_dt,
        page=page,
        limit=limit,
    )
    total_pages = max(1, (int(total_items) + limit - 1) // limit)
    meta = OrderPaginationMeta(
        total_items=int(total_items),
        total_pages=total_pages,
        page=page,
        limit=limit,
        pending_count=int(pending_count),
    )
    return OrderListResponse(items=list(rows), meta=meta)


@router.get("/admin", response_model=list[OrderRead])
async def admin_list_orders(
    status: OrderStatus | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
):
    return await order_service.list_orders(session, status=status, user_id=user_id)


@router.get("/admin/search", response_model=AdminOrderListResponse)
async def admin_search_orders(
    q: str | None = Query(default=None, max_length=200),
    user_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=50),
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    include_pii: bool = Query(default=False),
    include_test: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderListResponse:
    if include_pii:
        pii_service.require_pii_reveal(admin)
    status_clean = (status or "").strip().lower() if status else None
    pending_any = False
    parsed_status = None
    parsed_statuses: list[OrderStatus] | None = None
    if status_clean:
        if status_clean == "pending":
            pending_any = True
        elif status_clean == "sales":
            parsed_statuses = [
                OrderStatus.paid,
                OrderStatus.shipped,
                OrderStatus.delivered,
                OrderStatus.refunded,
            ]
        else:
            try:
                parsed_status = OrderStatus(status_clean)
            except ValueError:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order status")
    rows, total_items = await order_service.admin_search_orders(
        session,
        q=q,
        user_id=user_id,
        status=parsed_status,
        statuses=parsed_statuses,
        pending_any=pending_any,
        tag=tag,
        from_dt=from_dt,
        to_dt=to_dt,
        page=page,
        limit=limit,
        include_test=include_test,
    )
    items = [
        AdminOrderListItem(
            id=order.id,
            reference_code=order.reference_code,
            status=order.status,
            total_amount=order.total_amount,
            currency=order.currency,
            created_at=order.created_at,
            customer_email=email if include_pii else pii_service.mask_email(email),
            customer_username=username,
            tags=[t.tag for t in (getattr(order, "tags", None) or [])],
        )
        for (order, email, username) in rows
    ]
    total_pages = max(1, (int(total_items) + limit - 1) // limit)
    meta = AdminPaginationMeta(total_items=int(total_items), total_pages=total_pages, page=page, limit=limit)
    return AdminOrderListResponse(items=items, meta=meta)


@router.get("/admin/tags", response_model=OrderTagsResponse)
async def admin_list_order_tags(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
) -> OrderTagsResponse:
    tags = await order_service.list_order_tags(session)
    return OrderTagsResponse(items=tags)


@router.get("/admin/export")
async def admin_export_orders(
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
    columns: list[str] | None = Query(default=None),
    include_pii: bool = Query(default=False),
):
    if include_pii:
        pii_service.require_pii_reveal(admin)
    orders = await order_service.list_orders(session)
    allowed: dict[str, Callable[[Order], Any]] = {
        "id": lambda o: str(o.id),
        "reference_code": lambda o: o.reference_code or "",
        "status": lambda o: getattr(o.status, "value", str(o.status)),
        "total_amount": lambda o: str(o.total_amount),
        "tax_amount": lambda o: str(o.tax_amount),
        "fee_amount": lambda o: str(getattr(o, "fee_amount", 0) or 0),
        "shipping_amount": lambda o: str(o.shipping_amount),
        "currency": lambda o: o.currency or "",
        "user_id": lambda o: str(o.user_id) if o.user_id else "",
        "customer_email": lambda o: getattr(o, "customer_email", "") or "",
        "customer_name": lambda o: getattr(o, "customer_name", "") or "",
        "payment_method": lambda o: getattr(o, "payment_method", "") or "",
        "promo_code": lambda o: getattr(o, "promo_code", "") or "",
        "courier": lambda o: getattr(o, "courier", "") or "",
        "delivery_type": lambda o: getattr(o, "delivery_type", "") or "",
        "tracking_number": lambda o: getattr(o, "tracking_number", "") or "",
        "tracking_url": lambda o: getattr(o, "tracking_url", "") or "",
        "invoice_company": lambda o: getattr(o, "invoice_company", "") or "",
        "invoice_vat_id": lambda o: getattr(o, "invoice_vat_id", "") or "",
        "shipping_method": lambda o: getattr(getattr(o, "shipping_method", None), "name", "") or "",
        "locker_name": lambda o: getattr(o, "locker_name", "") or "",
        "locker_address": lambda o: getattr(o, "locker_address", "") or "",
        "created_at": lambda o: o.created_at.isoformat() if getattr(o, "created_at", None) else "",
        "updated_at": lambda o: o.updated_at.isoformat() if getattr(o, "updated_at", None) else "",
    }
    if not include_pii:
        allowed["customer_email"] = lambda o: pii_service.mask_email(getattr(o, "customer_email", "") or "") or ""
        allowed["customer_name"] = lambda o: pii_service.mask_text(getattr(o, "customer_name", "") or "", keep=1) or ""
        allowed["invoice_company"] = lambda o: pii_service.mask_text(getattr(o, "invoice_company", "") or "", keep=1) or ""
        allowed["invoice_vat_id"] = lambda o: pii_service.mask_text(getattr(o, "invoice_vat_id", "") or "", keep=2) or ""
        allowed["locker_address"] = lambda o: "***" if (getattr(o, "locker_address", "") or "").strip() else ""
    default_columns = ["id", "reference_code", "status", "total_amount", "currency", "user_id", "created_at"]
    if not columns:
        selected_columns = default_columns
    else:
        requested: list[str] = []
        for raw in columns:
            for part in str(raw).split(","):
                cleaned = part.strip()
                if cleaned:
                    requested.append(cleaned)
        invalid = [c for c in requested if c not in allowed]
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid export columns: {', '.join(sorted(set(invalid)))}. Allowed: {', '.join(sorted(allowed.keys()))}",
            )
        selected_columns = requested

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(selected_columns)
    for order in orders:
        writer.writerow([allowed[col](order) for col in selected_columns])
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=orders.csv"}
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers=headers)


async def _serialize_admin_order(
    session: AsyncSession,
    order: Order,
    *,
    include_pii: bool = False,
    current_user: User | None = None,
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(current_user)
    fraud_signals = await order_service.compute_fraud_signals(session, order)
    base = OrderRead.model_validate(order).model_dump()

    def _masked_address(addr: Address | None) -> dict[str, Any] | None:
        if not addr:
            return None
        return {
            "id": addr.id,
            "user_id": addr.user_id,
            "label": addr.label,
            "phone": None,
            "line1": "***",
            "line2": "***" if (addr.line2 or "").strip() else None,
            "city": "***",
            "region": "***" if (addr.region or "").strip() else None,
            "postal_code": "***",
            "country": addr.country,
            "is_default_shipping": bool(getattr(addr, "is_default_shipping", False)),
            "is_default_billing": bool(getattr(addr, "is_default_billing", False)),
            "created_at": addr.created_at,
            "updated_at": addr.updated_at,
        }

    if not include_pii:
        base["invoice_company"] = pii_service.mask_text(base.get("invoice_company"), keep=1)
        base["invoice_vat_id"] = pii_service.mask_text(base.get("invoice_vat_id"), keep=2)
        base["locker_address"] = "***" if (base.get("locker_address") or "").strip() else base.get("locker_address")

    customer_email = getattr(order, "customer_email", None) or (
        getattr(order.user, "email", None) if getattr(order, "user", None) else None
    )
    if not include_pii:
        customer_email = pii_service.mask_email(customer_email)
    return AdminOrderRead(
        **base,
        customer_email=customer_email,
        customer_username=getattr(order.user, "username", None) if getattr(order, "user", None) else None,
        shipping_address=order.shipping_address if include_pii else _masked_address(getattr(order, "shipping_address", None)),
        billing_address=order.billing_address if include_pii else _masked_address(getattr(order, "billing_address", None)),
        tracking_url=getattr(order, "tracking_url", None),
        shipping_label_filename=getattr(order, "shipping_label_filename", None),
        shipping_label_uploaded_at=getattr(order, "shipping_label_uploaded_at", None),
        has_shipping_label=bool(getattr(order, "shipping_label_path", None)),
        refunds=getattr(order, "refunds", []) or [],
        admin_notes=getattr(order, "admin_notes", []) or [],
        tags=[t.tag for t in (getattr(order, "tags", None) or [])],
        fraud_signals=fraud_signals,
        shipments=getattr(order, "shipments", []) or [],
    )


@router.get("/admin/{order_id}", response_model=AdminOrderRead)
async def admin_get_order(
    order_id: UUID,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    return await _serialize_admin_order(session, order, include_pii=include_pii, current_user=admin)


@router.post("/guest-checkout/email/request", response_model=GuestEmailVerificationRequestResponse)
async def request_guest_email_verification(
    payload: GuestEmailVerificationRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> GuestEmailVerificationRequestResponse:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")

    email = _normalize_email(str(payload.email))
    if await auth_service.is_email_taken(session, email):
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
    return GuestEmailVerificationRequestResponse(sent=True)


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
    if await auth_service.is_email_taken(session, email):
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
        background_tasks.add_task(
            email_service.send_welcome_email,
            user.email,
            first_name=user.first_name,
            lang=user.preferred_language,
        )

    shipping_method = None
    if payload.shipping_method_id:
        shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
        if not shipping_method:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")

    if (payload.promo_code or "").strip():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sign in to use coupons.")
    promo = None

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    courier, delivery_type, locker_id, locker_name, locker_address, locker_lat, locker_lng = _delivery_from_payload(
        courier=payload.courier,
        delivery_type=payload.delivery_type,
        locker_id=payload.locker_id,
        locker_name=payload.locker_name,
        locker_address=payload.locker_address,
        locker_lat=payload.locker_lat,
        locker_lng=payload.locker_lng,
    )
    locker_allowed, allowed_couriers = cart_service.delivery_constraints(cart)
    if not allowed_couriers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No couriers available for cart items")
    if courier not in allowed_couriers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected courier is not available for cart items")
    if delivery_type == "locker" and not locker_allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Locker delivery is not available for cart items")
    phone_required = bool(
        checkout_settings.phone_required_locker if delivery_type == "locker" else checkout_settings.phone_required_home
    )
    phone = (payload.phone or "").strip() or None
    if phone_required and not phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone is required")

    has_billing = bool((payload.billing_line1 or "").strip())
    billing_same_as_shipping = not has_billing

    shipping_addr = await address_service.create_address(
        session,
        user_id,
        AddressCreate(
            label="Guest Checkout" if not payload.create_account else "Checkout",
            phone=phone,
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
        if not (
            (payload.billing_line1 or "").strip()
            and (payload.billing_city or "").strip()
            and (payload.billing_postal_code or "").strip()
            and (payload.billing_country or "").strip()
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Billing address is incomplete")
        billing_addr = await address_service.create_address(
            session,
            user_id,
            AddressCreate(
                label="Guest Checkout (Billing)" if not payload.create_account else "Checkout (Billing)",
                phone=phone,
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

    totals, discount_val = await cart_service.calculate_totals_async(
        session,
        cart,
        shipping_method=shipping_method,
        promo=promo,
        checkout_settings=checkout_settings,
        country_code=shipping_addr.country,
    )
    payment_method = payload.payment_method or "stripe"
    stripe_session_id = None
    stripe_checkout_url = None
    payment_intent_id = None
    paypal_order_id = None
    paypal_approval_url = None
    if payment_method == "stripe":
        stripe_line_items = _build_stripe_line_items(cart, totals, lang=payload.preferred_language)
        discount_cents = _money_to_cents(discount_val) if discount_val and discount_val > 0 else None
        stripe_session = await payments.create_checkout_session(
            session=session,
            amount_cents=_money_to_cents(totals.total),
            customer_email=email,
            success_url=f"{settings.frontend_origin.rstrip('/')}/checkout/stripe/return?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.frontend_origin.rstrip('/')}/checkout/stripe/cancel?session_id={{CHECKOUT_SESSION_ID}}",
            lang=payload.preferred_language,
            metadata={"cart_id": str(cart.id), "user_id": str(user_id) if user_id else ""},
            line_items=stripe_line_items,
            discount_cents=discount_cents,
            promo_code=None,
        )
        stripe_session_id = str(stripe_session.get("session_id"))
        stripe_checkout_url = str(stripe_session.get("checkout_url"))
    elif payment_method == "paypal":
        paypal_items = _build_paypal_items(cart, lang=payload.preferred_language)
        paypal_order_id, paypal_approval_url = await paypal_service.create_order(
            total_ron=totals.total,
            reference=str(cart.id),
            return_url=f"{settings.frontend_origin}/checkout/paypal/return",
            cancel_url=f"{settings.frontend_origin}/checkout/paypal/cancel",
            item_total_ron=totals.subtotal,
            shipping_ron=totals.shipping,
            tax_ron=totals.tax,
            fee_ron=totals.fee,
            discount_ron=discount_val,
            items=paypal_items,
        )
    elif payment_method == "netopia":
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Netopia is not configured yet")
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
        stripe_checkout_session_id=stripe_session_id,
        paypal_order_id=paypal_order_id,
        courier=courier,
        delivery_type=delivery_type,
        locker_id=locker_id,
        locker_name=locker_name,
        locker_address=locker_address,
        locker_lat=locker_lat,
        locker_lng=locker_lng,
        discount=discount_val,
        promo_code=None,
        invoice_company=payload.invoice_company,
        invoice_vat_id=payload.invoice_vat_id,
        tax_amount=totals.tax,
        fee_amount=totals.fee,
        shipping_amount=totals.shipping,
        total_amount=totals.total,
    )

    if (payment_method or "").strip().lower() == "cod":
        background_tasks.add_task(
            email_service.send_order_confirmation,
            email,
            order,
            order.items,
            payload.preferred_language,
            receipt_share_days=checkout_settings.receipt_share_days,
        )
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
        paypal_order_id=paypal_order_id,
        paypal_approval_url=paypal_approval_url,
        stripe_session_id=stripe_session_id,
        stripe_checkout_url=stripe_checkout_url,
        payment_method=payment_method,
    )


@router.patch("/admin/{order_id}", response_model=AdminOrderRead)
async def admin_update_order(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    payload: OrderUpdate,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
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
    if previous_status != updated.status:
        if updated.status == OrderStatus.cancelled:
            await coupons_service.release_coupon_for_order(
                session, order=updated, reason=(payload.cancel_reason or "cancelled")[:255]
            )
        elif updated.status == OrderStatus.refunded:
            await coupons_service.release_coupon_for_order(session, order=updated, reason="refunded")

        if updated.status == OrderStatus.cancelled:
            payment_method = (updated.payment_method or "").strip().lower()
            refund_needed = False
            if payment_method == "paypal" and updated.paypal_capture_id:
                refund_needed = True
            if payment_method == "stripe" and updated.stripe_payment_intent_id:
                refund_needed = any(evt.event == "payment_captured" for evt in updated.events or [])
            if refund_needed:
                owner = await auth_service.get_owner_user(session)
                if owner and owner.id:
                    await notification_service.create_notification(
                        session,
                        user_id=owner.id,
                        type="admin",
                        title="Refund required"
                        if (owner.preferred_language or "en") != "ro"
                        else "Rambursare necesară",
                        body=(
                            f"Order {updated.reference_code or updated.id} was cancelled and needs a manual refund ({payment_method})."
                            if (owner.preferred_language or "en") != "ro"
                            else f"Comanda {updated.reference_code or updated.id} a fost anulată și necesită o rambursare manuală ({payment_method})."
                        ),
                        url=f"/admin/orders/{updated.id}",
                    )
        customer_email = (updated.user.email if updated.user and updated.user.email else None) or getattr(
            updated, "customer_email", None
        )
        customer_lang = updated.user.preferred_language if updated.user else None
        if customer_email:
            if updated.status == OrderStatus.paid:
                background_tasks.add_task(
                    email_service.send_order_processing_update,
                    customer_email,
                    updated,
                    lang=customer_lang,
                )
            elif updated.status == OrderStatus.shipped:
                background_tasks.add_task(
                    email_service.send_shipping_update,
                    customer_email,
                    updated,
                    updated.tracking_number,
                    customer_lang,
                )
            elif updated.status == OrderStatus.delivered:
                background_tasks.add_task(
                    email_service.send_delivery_confirmation,
                    customer_email,
                    updated,
                    customer_lang,
                )
                if updated.user and updated.user.email:
                    coupon = await coupons_service.issue_first_order_reward_if_eligible(
                        session,
                        user=updated.user,
                        order=updated,
                        validity_days=int(getattr(settings, "first_order_reward_coupon_validity_days", 30) or 30),
                    )
                    if coupon:
                        background_tasks.add_task(
                            email_service.send_coupon_assigned,
                            updated.user.email,
                            coupon_code=coupon.code,
                            promotion_name="First order reward",
                            promotion_description="20% off your next order (one-time).",
                            ends_at=getattr(coupon, "ends_at", None),
                            lang=customer_lang,
                        )
            elif updated.status == OrderStatus.cancelled:
                background_tasks.add_task(
                    email_service.send_order_cancelled_update,
                    customer_email,
                    updated,
                    lang=customer_lang,
                )
            elif updated.status == OrderStatus.refunded:
                background_tasks.add_task(
                    email_service.send_order_refunded_update,
                    customer_email,
                    updated,
                    lang=customer_lang,
                )

        if updated.user and updated.user.id:
            if updated.status == OrderStatus.paid:
                title = "Order processing" if (updated.user.preferred_language or "en") != "ro" else "Comandă în procesare"
            elif updated.status == OrderStatus.shipped:
                title = "Order shipped" if (updated.user.preferred_language or "en") != "ro" else "Comandă expediată"
            elif updated.status == OrderStatus.delivered:
                title = "Order complete" if (updated.user.preferred_language or "en") != "ro" else "Comandă finalizată"
            elif updated.status == OrderStatus.cancelled:
                title = "Order cancelled" if (updated.user.preferred_language or "en") != "ro" else "Comandă anulată"
            elif updated.status == OrderStatus.refunded:
                title = "Order refunded" if (updated.user.preferred_language or "en") != "ro" else "Comandă rambursată"
            else:
                title = "Order update" if (updated.user.preferred_language or "en") != "ro" else "Actualizare comandă"
            await notification_service.create_notification(
                session,
                user_id=updated.user.id,
                type="order",
                title=title,
                body=f"Reference {updated.reference_code}" if updated.reference_code else None,
                url=_account_orders_url(updated),
            )
    full = await order_service.get_order_by_id_admin(session, order_id)
    if not full:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await _serialize_admin_order(session, full, include_pii=include_pii, current_user=admin)


@router.patch("/admin/{order_id}/addresses", response_model=AdminOrderRead)
async def admin_update_order_addresses(
    order_id: UUID,
    payload: AdminOrderAddressesUpdate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    updated = await order_service.update_order_addresses(
        session,
        order,
        payload,
        actor=actor,
        actor_user_id=getattr(admin, "id", None),
    )
    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.get("/admin/{order_id}/shipments", response_model=list[OrderShipmentRead])
async def admin_list_order_shipments(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
) -> list[OrderShipmentRead]:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return getattr(order, "shipments", []) or []


@router.post("/admin/{order_id}/shipments", response_model=AdminOrderRead)
async def admin_create_order_shipment(
    order_id: UUID,
    payload: OrderShipmentCreate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    updated = await order_service.create_order_shipment(
        session,
        order,
        payload,
        actor=actor,
        actor_user_id=getattr(admin, "id", None),
    )
    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.patch("/admin/{order_id}/shipments/{shipment_id}", response_model=AdminOrderRead)
async def admin_update_order_shipment(
    order_id: UUID,
    shipment_id: UUID,
    payload: OrderShipmentUpdate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    updated = await order_service.update_order_shipment(
        session,
        order,
        shipment_id,
        payload,
        actor=actor,
        actor_user_id=getattr(admin, "id", None),
    )
    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.delete("/admin/{order_id}/shipments/{shipment_id}", response_model=AdminOrderRead)
async def admin_delete_order_shipment(
    order_id: UUID,
    shipment_id: UUID,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    updated = await order_service.delete_order_shipment(
        session,
        order,
        shipment_id,
        actor=actor,
        actor_user_id=getattr(admin, "id", None),
    )
    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.post("/admin/{order_id}/shipping-label", response_model=AdminOrderRead)
async def admin_upload_shipping_label(
    order_id: UUID,
    file: UploadFile = File(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
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
    return await _serialize_admin_order(session, full, include_pii=include_pii, current_user=admin)


@router.get("/admin/{order_id}/shipping-label")
async def admin_download_shipping_label(
    order_id: UUID,
    action: str | None = Query(default=None, max_length=20),
    session: AsyncSession = Depends(get_session),
    admin=Depends(require_admin_section("orders")),
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
    action_clean = (action or "").strip().lower()
    event = "shipping_label_printed" if action_clean == "print" else "shipping_label_downloaded"
    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    note = f"{actor}: {filename}" if actor else filename
    session.add(OrderEvent(order_id=order.id, event=event, note=note))
    await session.commit()
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    headers = {"Cache-Control": "no-store"}
    return FileResponse(path, media_type=media_type, filename=filename, headers=headers)


@router.delete("/admin/{order_id}/shipping-label", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_shipping_label(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
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
    payload: AdminOrderRefundRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    admin_user=Depends(require_admin),
):
    password = str(payload.password or "")
    if not password or not security.verify_password(password, admin_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

    note = (payload.note or "").strip() or None
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    updated = await order_service.refund_order(session, order, note=note)
    await coupons_service.release_coupon_for_order(session, order=updated, reason="refunded")
    customer_to = (updated.user.email if updated.user and updated.user.email else None) or getattr(updated, "customer_email", None)
    customer_lang = updated.user.preferred_language if updated.user else None
    if customer_to:
        background_tasks.add_task(email_service.send_order_refunded_update, customer_to, updated, lang=customer_lang)
    if updated.user and updated.user.id:
        await notification_service.create_notification(
            session,
            user_id=updated.user.id,
            type="order",
            title="Order refunded" if (updated.user.preferred_language or "en") != "ro" else "Comandă rambursată",
            body=f"Reference {updated.reference_code}" if updated.reference_code else None,
            url=_account_orders_url(updated),
        )
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


@router.post("/admin/{order_id}/refunds", response_model=AdminOrderRead)
async def admin_create_order_refund(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    payload: AdminOrderRefundCreate = Body(...),
    session: AsyncSession = Depends(get_session),
    admin_user=Depends(require_admin),
) -> AdminOrderRead:
    password = str(payload.password or "")
    if not password or not security.verify_password(password, admin_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    items = [(row.order_item_id, int(row.quantity)) for row in (payload.items or [])]
    updated = await order_service.create_order_refund(
        session,
        order,
        amount=payload.amount,
        note=payload.note,
        items=items,
        process_payment=bool(payload.process_payment),
        actor=(getattr(admin_user, "email", None) or getattr(admin_user, "username", None) or "admin").strip(),
    )
    if updated.status == OrderStatus.refunded:
        await coupons_service.release_coupon_for_order(session, order=updated, reason="refunded")

    refund_record = (getattr(updated, "refunds", None) or [])[-1] if (getattr(updated, "refunds", None) or []) else None
    if refund_record:
        customer_to = (updated.user.email if updated.user and updated.user.email else None) or getattr(updated, "customer_email", None)
        customer_lang = updated.user.preferred_language if updated.user else None
        if customer_to:
            background_tasks.add_task(email_service.send_order_partial_refund_update, customer_to, updated, refund_record, lang=customer_lang)
        if updated.user and updated.user.id:
            amount = getattr(refund_record, "amount", None)
            currency = getattr(updated, "currency", None) or "RON"
            body = f"{amount} {currency}" if amount is not None else None
            await notification_service.create_notification(
                session,
                user_id=updated.user.id,
                type="order",
                title=(
                    "Partial refund issued"
                    if (updated.user.preferred_language or "en") != "ro"
                    else "Rambursare parțială"
                ),
                body=body,
                url="/account/orders",
            )

    return await _serialize_admin_order(session, updated)


@router.post("/admin/{order_id}/notes", response_model=AdminOrderRead)
async def admin_add_order_note(
    order_id: UUID,
    payload: OrderAdminNoteCreate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    updated = await order_service.add_admin_note(session, order, note=payload.note, actor_user_id=getattr(admin, "id", None))

    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.post("/admin/{order_id}/tags", response_model=AdminOrderRead)
async def admin_add_order_tag(
    order_id: UUID,
    payload: OrderTagCreate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    updated = await order_service.add_order_tag(
        session, order, tag=payload.tag, actor_user_id=getattr(admin, "id", None)
    )

    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.delete("/admin/{order_id}/tags/{tag}", response_model=AdminOrderRead)
async def admin_remove_order_tag(
    order_id: UUID,
    tag: str,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    updated = await order_service.remove_order_tag(
        session, order, tag=tag, actor_user_id=getattr(admin, "id", None)
    )

    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.post("/admin/{order_id}/delivery-email", response_model=OrderRead)
async def admin_send_delivery_email(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    payload: AdminOrderEmailResendRequest = Body(default=AdminOrderEmailResendRequest()),
    session: AsyncSession = Depends(get_session),
    admin=Depends(require_admin_section("orders")),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    to_email = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
    if not to_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order customer email missing")
    note = (payload.note or "").strip() or None
    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    event_note = f"{actor}: {note}" if note else actor
    session.add(OrderEvent(order_id=order.id, event="email_resend_delivery", note=event_note))
    await session.commit()
    await session.refresh(order, attribute_names=["events"])
    background_tasks.add_task(
        email_service.send_delivery_confirmation,
        to_email,
        order,
        getattr(order.user, "preferred_language", None) if order.user else None,
    )
    return order


@router.post("/admin/{order_id}/confirmation-email", response_model=OrderRead)
async def admin_send_confirmation_email(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    payload: AdminOrderEmailResendRequest = Body(default=AdminOrderEmailResendRequest()),
    session: AsyncSession = Depends(get_session),
    admin=Depends(require_admin_section("orders")),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    to_email = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
    if not to_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order customer email missing")
    note = (payload.note or "").strip() or None
    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    event_note = f"{actor}: {note}" if note else actor
    session.add(OrderEvent(order_id=order.id, event="email_resend_confirmation", note=event_note))
    await session.commit()
    await session.refresh(order, attribute_names=["events"])

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    background_tasks.add_task(
        email_service.send_order_confirmation,
        to_email,
        order,
        order.items,
        getattr(order.user, "preferred_language", None) if order.user else None,
        receipt_share_days=checkout_settings.receipt_share_days,
    )
    return order


@router.post("/admin/{order_id}/items/{item_id}/fulfill", response_model=AdminOrderRead)
async def admin_fulfill_item(
    order_id: UUID,
    item_id: UUID,
    shipped_quantity: int = 0,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    await order_service.update_fulfillment(session, order, item_id, shipped_quantity)
    refreshed = await order_service.get_order_by_id_admin(session, order_id)
    if not refreshed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await _serialize_admin_order(session, refreshed, include_pii=include_pii, current_user=admin)


@router.get("/admin/{order_id}/events", response_model=list[OrderEventRead])
async def admin_order_events(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order.events


@router.get("/admin/{order_id}/packing-slip")
async def admin_packing_slip(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
):
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    pdf = packing_slips_service.render_packing_slip_pdf(order)
    ref = getattr(order, "reference_code", None) or str(order.id)
    headers = {"Content-Disposition": f"attachment; filename=packing-slip-{ref}.pdf"}
    return Response(content=pdf, media_type="application/pdf", headers=headers)


@router.post("/admin/batch/packing-slips")
async def admin_batch_packing_slips(
    payload: AdminOrderIdsRequest,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
):
    ids = list(dict.fromkeys(payload.order_ids))
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No orders selected")
    if len(ids) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many orders selected")

    result = await session.execute(
        select(Order)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        )
        .where(Order.id.in_(ids))
    )
    orders = list(result.scalars().unique())
    found = {o.id for o in orders}
    missing = [str(order_id) for order_id in ids if order_id not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"missing_order_ids": missing})

    order_by_id = {o.id: o for o in orders}
    ordered = [order_by_id[order_id] for order_id in ids if order_id in order_by_id]
    pdf = packing_slips_service.render_batch_packing_slips_pdf(ordered)
    headers = {"Content-Disposition": "attachment; filename=packing-slips.pdf"}
    return Response(content=pdf, media_type="application/pdf", headers=headers)


@router.post("/admin/{order_id}/capture-payment", response_model=OrderRead)
async def admin_capture_payment(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    intent_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    updated = await order_service.capture_payment(session, order, intent_id=intent_id)
    await coupons_service.redeem_coupon_for_order(
        session,
        order=updated,
        note=f"Stripe {intent_id or updated.stripe_payment_intent_id}".strip(),
    )
    customer_to = (updated.user.email if updated.user and updated.user.email else None) or getattr(updated, "customer_email", None)
    customer_lang = updated.user.preferred_language if updated.user else None
    if customer_to:
        background_tasks.add_task(email_service.send_order_processing_update, customer_to, updated, lang=customer_lang)
    if updated.user and updated.user.id:
        await notification_service.create_notification(
            session,
            user_id=updated.user.id,
            type="order",
            title="Order processing" if (updated.user.preferred_language or "en") != "ro" else "Comandă în procesare",
            body=f"Reference {updated.reference_code}" if updated.reference_code else None,
            url=_account_orders_url(updated),
        )
    return updated


@router.post("/admin/{order_id}/void-payment", response_model=OrderRead)
async def admin_void_payment(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    intent_id: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> OrderRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    updated = await order_service.void_payment(session, order, intent_id=intent_id)
    await coupons_service.release_coupon_for_order(session, order=updated, reason="payment_voided")
    customer_to = (updated.user.email if updated.user and updated.user.email else None) or getattr(updated, "customer_email", None)
    customer_lang = updated.user.preferred_language if updated.user else None
    if customer_to:
        background_tasks.add_task(email_service.send_order_cancelled_update, customer_to, updated, lang=customer_lang)
    if updated.user and updated.user.id:
        await notification_service.create_notification(
            session,
            user_id=updated.user.id,
            type="order",
            title="Order cancelled" if (updated.user.preferred_language or "en") != "ro" else "Comandă anulată",
            body=f"Reference {updated.reference_code}" if updated.reference_code else None,
            url=_account_orders_url(updated),
        )
    return updated


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
    pdf = receipt_service.render_order_receipt_pdf(order, order.items)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers=headers)


@router.get("/receipt/{token}", response_model=ReceiptRead)
async def read_receipt_by_token(
    token: str,
    reveal: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> ReceiptRead:
    decoded = decode_receipt_token(token)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")
    order_id, token_version = decoded
    try:
        order_uuid = UUID(order_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")

    order = await order_service.get_order_by_id(session, order_uuid)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    if int(getattr(order, "receipt_token_version", 0) or 0) != int(token_version):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")
    role = getattr(current_user, "role", None) if current_user else None
    role_value = (getattr(role, "value", None) or str(role or "")).strip().lower()
    is_admin = role_value in {"admin", "owner"}
    is_owner = bool(current_user and getattr(order, "user_id", None) and getattr(current_user, "id", None) == order.user_id)
    allow_full = bool(reveal and (is_admin or is_owner))
    return receipt_service.build_order_receipt(order, order.items, redacted=not allow_full)


@router.get("/receipt/{token}/pdf")
async def download_receipt_by_token(
    token: str,
    reveal: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
):
    decoded = decode_receipt_token(token)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")
    order_id, token_version = decoded
    try:
        order_uuid = UUID(order_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")

    order = await order_service.get_order_by_id(session, order_uuid)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    if int(getattr(order, "receipt_token_version", 0) or 0) != int(token_version):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")
    role = getattr(current_user, "role", None) if current_user else None
    role_value = (getattr(role, "value", None) or str(role or "")).strip().lower()
    is_admin = role_value in {"admin", "owner"}
    is_owner = bool(current_user and getattr(order, "user_id", None) and getattr(current_user, "id", None) == order.user_id)
    allow_full = bool(reveal and (is_admin or is_owner))
    ref = order.reference_code or str(order.id)
    filename = f"receipt-{ref}.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    pdf = receipt_service.render_order_receipt_pdf(order, order.items, redacted=not allow_full)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers=headers)


@router.post("/{order_id}/receipt/share", response_model=ReceiptShareTokenRead)
async def create_receipt_share_token(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> ReceiptShareTokenRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    role = getattr(current_user, "role", None)
    role_value = (getattr(role, "value", None) or str(role or "")).strip().lower()
    is_admin = role_value in {"admin", "owner"}
    is_owner = bool(getattr(order, "user_id", None) and getattr(current_user, "id", None) == order.user_id)
    if not (is_admin or is_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    expires_at = datetime.now(timezone.utc) + timedelta(days=int(checkout_settings.receipt_share_days))
    token = create_receipt_token(
        order_id=str(order.id),
        expires_at=expires_at,
        token_version=int(getattr(order, "receipt_token_version", 0) or 0),
    )
    receipt_url = f"{settings.frontend_origin.rstrip('/')}/receipt/{token}"
    receipt_pdf_url = f"{settings.frontend_origin.rstrip('/')}/api/v1/orders/receipt/{token}/pdf"
    return ReceiptShareTokenRead(token=token, receipt_url=receipt_url, receipt_pdf_url=receipt_pdf_url, expires_at=expires_at)


@router.post("/{order_id}/receipt/revoke", response_model=ReceiptShareTokenRead)
async def revoke_receipt_share_token(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> ReceiptShareTokenRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    role = getattr(current_user, "role", None)
    role_value = (getattr(role, "value", None) or str(role or "")).strip().lower()
    is_admin = role_value in {"admin", "owner"}
    is_owner = bool(getattr(order, "user_id", None) and getattr(current_user, "id", None) == order.user_id)
    if not (is_admin or is_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    order.receipt_token_version = int(getattr(order, "receipt_token_version", 0) or 0) + 1
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="receipt_token_revoked", note=f"v{order.receipt_token_version}"))
    await session.commit()
    await session.refresh(order)

    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    expires_at = datetime.now(timezone.utc) + timedelta(days=int(checkout_settings.receipt_share_days))
    token = create_receipt_token(
        order_id=str(order.id),
        expires_at=expires_at,
        token_version=int(getattr(order, "receipt_token_version", 0) or 0),
    )
    receipt_url = f"{settings.frontend_origin.rstrip('/')}/receipt/{token}"
    receipt_pdf_url = f"{settings.frontend_origin.rstrip('/')}/api/v1/orders/receipt/{token}/pdf"
    return ReceiptShareTokenRead(token=token, receipt_url=receipt_url, receipt_pdf_url=receipt_pdf_url, expires_at=expires_at)


@router.post("/{order_id}/cancel-request", response_model=OrderRead)
async def request_order_cancellation(
    order_id: UUID,
    payload: OrderCancelRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_verified_email),
) -> OrderRead:
    order = await order_service.get_order(session, current_user.id, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if OrderStatus(order.status) not in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel request not eligible")

    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason is required")

    if any(getattr(evt, "event", None) == "cancel_requested" for evt in (order.events or [])):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cancel request already exists")

    session.add(OrderEvent(order_id=order.id, event="cancel_requested", note=reason[:2000]))
    await session.commit()
    await session.refresh(order, attribute_names=["events"])

    owner = await auth_service.get_owner_user(session)
    if owner and owner.id:
        await notification_service.create_notification(
            session,
            user_id=owner.id,
            type="admin",
            title="Cancel request" if (owner.preferred_language or "en") != "ro" else "Cerere anulare",
            body=(
                f"Order {order.reference_code or order.id} cancellation requested."
                if (owner.preferred_language or "en") != "ro"
                else f"Cerere de anulare pentru comanda {order.reference_code or order.id}."
            ),
            url=f"/admin/orders/{order.id}",
        )

    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if admin_to:
        background_tasks.add_task(
            email_service.send_order_cancel_request_notification,
            admin_to,
            order,
            requested_by_email=getattr(current_user, "email", None),
            reason=reason,
            lang=owner.preferred_language if owner else None,
        )

    await notification_service.create_notification(
        session,
        user_id=current_user.id,
        type="order",
        title="Cancel requested" if (current_user.preferred_language or "en") != "ro" else "Anulare solicitată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )

    return order


@router.post("/{order_id}/reorder", response_model=CartRead)
async def reorder_order(
    order_id: UUID,
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> CartRead:
    cart = await cart_service.reorder_from_order(session, current_user.id, order_id)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    return await cart_service.serialize_cart(session, cart, checkout_settings=checkout_settings)
