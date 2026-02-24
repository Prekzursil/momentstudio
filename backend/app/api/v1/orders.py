import csv
import io
import mimetypes
import secrets
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from functools import partial
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote_plus
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, UploadFile, File, Body, Response, Request
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy import func
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
from app.core.security import create_receipt_token, decode_receipt_token, decode_token
from app.core.rate_limit import per_identifier_limiter
from app.db.session import get_session
from app.models.address import Address
from app.models.cart import Cart
from app.models.email_event import EmailDeliveryEvent
from app.models.order import Order, OrderItem, OrderStatus, OrderEvent
from app.models.order_document_export import OrderDocumentExportKind
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
from app.services import pick_lists as pick_lists_service
from app.services import order_document_exports as order_exports_service
from app.schemas.checkout import (
    CheckoutRequest,
    GuestCheckoutRequest,
    GuestCheckoutResponse,
    GuestEmailVerificationConfirmRequest,
    GuestEmailVerificationRequest,
    GuestEmailVerificationRequestResponse,
    GuestEmailVerificationStatus,
    NetopiaConfirmRequest,
    NetopiaConfirmResponse,
    PayPalCaptureRequest,
    PayPalCaptureResponse,
    StripeConfirmRequest,
    StripeConfirmResponse,
)
from app.schemas.user import UserCreate
from app.schemas.address import AddressCreate
from app.services import payments
from app.services import netopia as netopia_service
from app.services import paypal as paypal_service
from app.services import address as address_service

from app.api.v1 import cart as cart_api
from app.models.legal import LegalConsentContext
from app.schemas.order_admin import (
    AdminOrderEmailEventRead,
    AdminOrderIdsRequest,
    AdminOrderListItem,
    AdminOrderListResponse,
    AdminOrderRead,
    AdminPaginationMeta,
    AdminOrderEmailResendRequest,
)
from app.schemas.order_admin_address import AdminOrderAddressesUpdate
from app.schemas.order_admin_note import OrderAdminNoteCreate
from app.schemas.order_exports_admin import AdminOrderDocumentExportListResponse, AdminOrderDocumentExportRead
from app.schemas.order_fraud_review import OrderFraudReviewRequest
from app.schemas.order_refund import AdminOrderRefundCreate, AdminOrderRefundRequest
from app.schemas.order_shipment import OrderShipmentCreate, OrderShipmentUpdate, OrderShipmentRead
from app.schemas.order_tag import (
    OrderTagCreate,
    OrderTagRenameRequest,
    OrderTagRenameResponse,
    OrderTagsResponse,
    OrderTagStatRead,
    OrderTagStatsResponse,
)
from app.schemas.receipt import ReceiptRead, ReceiptShareTokenRead
from app.services import legal_consents as legal_consents_service
from app.services import notifications as notification_service
from app.services import pii as pii_service
from app.services import pricing
from app.services import promo_usage
from app.services import step_up as step_up_service
from app.services.payment_provider import is_mock_payments


def _user_or_session_or_ip_identifier(request: Request) -> str:
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1]
        decoded = decode_token(token)
        if decoded and decoded.get("sub"):
            return f"user:{decoded['sub']}"
    session_id = (request.headers.get("X-Session-Id") or "").strip()
    if session_id:
        return f"sid:{session_id}"
    return f"ip:{request.client.host if request.client else 'anon'}"


checkout_rate_limit = per_identifier_limiter(
    _user_or_session_or_ip_identifier,
    settings.orders_rate_limit_checkout,
    60 * 10,
    key="orders:checkout",
)
guest_checkout_rate_limit = per_identifier_limiter(
    _user_or_session_or_ip_identifier,
    settings.orders_rate_limit_guest_checkout,
    60 * 10,
    key="orders:guest_checkout",
)
guest_email_request_rate_limit = per_identifier_limiter(
    _user_or_session_or_ip_identifier,
    settings.orders_rate_limit_guest_email_request,
    60 * 10,
    key="orders:guest_email_request",
)

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


def _split_customer_name(value: str) -> tuple[str, str]:
    cleaned = (value or "").strip()
    if not cleaned:
        return "Customer", "Customer"
    parts = cleaned.split()
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], " ".join(parts[1:]).strip() or parts[0]


def _netopia_address_payload(*, email: str, phone: str | None, first_name: str, last_name: str, addr: Address) -> dict[str, Any]:
    country = (getattr(addr, "country", None) or "").strip().upper() or "RO"
    country_num = 642 if country == "RO" else 0
    country_name = "Romania" if country == "RO" else country
    details = (getattr(addr, "line1", None) or "").strip()
    line2 = (getattr(addr, "line2", None) or "").strip()
    if line2:
        details = f"{details}, {line2}" if details else line2
    return {
        "email": (email or "").strip(),
        "phone": (phone or "").strip() or "",
        "firstName": (first_name or "").strip() or "Customer",
        "lastName": (last_name or "").strip() or "Customer",
        "city": (getattr(addr, "city", None) or "").strip(),
        "country": int(country_num),
        "countryName": country_name,
        "state": (getattr(addr, "region", None) or "").strip() or "",
        "postalCode": (getattr(addr, "postal_code", None) or "").strip(),
        "details": details,
    }


def _build_netopia_products(order: Order, *, lang: str | None) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for item in order.items or []:
        product = getattr(item, "product", None)
        name = (getattr(product, "name", None) or "").strip() or "Item"
        code = (getattr(product, "sku", None) or "").strip() or str(getattr(product, "id", "") or "")
        category = (getattr(getattr(product, "category", None), "name", None) or "").strip() or "Product"
        subtotal = pricing.quantize_money(_as_decimal(getattr(item, "subtotal", 0)))
        if subtotal <= 0:
            continue
        lines.append({"name": name, "code": code, "category": category, "price": subtotal, "vat": 0})

    shipping = pricing.quantize_money(_as_decimal(getattr(order, "shipping_amount", 0)))
    if shipping > 0:
        lines.append({"name": _charge_label("shipping", lang), "code": "shipping", "category": "Shipping", "price": shipping, "vat": 0})

    fee = pricing.quantize_money(_as_decimal(getattr(order, "fee_amount", 0)))
    if fee > 0:
        lines.append({"name": _charge_label("fee", lang), "code": "fee", "category": "Fee", "price": fee, "vat": 0})

    tax = pricing.quantize_money(_as_decimal(getattr(order, "tax_amount", 0)))
    if tax > 0:
        lines.append({"name": _charge_label("vat", lang), "code": "vat", "category": "VAT", "price": tax, "vat": 0})

    target = pricing.quantize_money(_as_decimal(getattr(order, "total_amount", 0)))
    current = sum((row["price"] for row in lines), Decimal("0.00"))
    diff = current - target
    if diff > Decimal("0.00"):
        idx = max(range(len(lines)), key=lambda i: lines[i]["price"])
        lines[idx]["price"] = pricing.quantize_money(max(Decimal("0.00"), lines[idx]["price"] - diff))

    out: list[dict[str, Any]] = []
    for row in lines:
        out.append(
            {
                "name": row["name"],
                "code": row["code"],
                "category": row["category"],
                "price": float(row["price"]),
                "vat": float(row["vat"]),
            }
        )
    return out


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


def _frontend_base_from_request(request: Request | None) -> str:
    candidate = (request.headers.get("origin") if request else None) or ""
    origin = candidate.strip().rstrip("/")
    if origin:
        allowed = {str(raw or "").strip().rstrip("/") for raw in getattr(settings, "cors_origins", []) or []}
        if origin in allowed:
            return origin
    return settings.frontend_origin.rstrip("/")


@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    response: Response,
    background_tasks: BackgroundTasks,
    payload: OrderCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_verified_email),
):
    cart_result = await session.execute(
        select(Cart).options(selectinload(Cart.items)).where(Cart.user_id == current_user.id).with_for_update()
    )
    cart = cart_result.scalar_one_or_none()
    if not cart or not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    if cart.last_order_id:
        existing_order = await order_service.get_order_by_id(session, cart.last_order_id)
        if existing_order:
            response.status_code = status.HTTP_200_OK
            return existing_order
        cart.last_order_id = None
        session.add(cart)

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
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    _: None = Depends(checkout_rate_limit),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_verified_email),
    session_id: str | None = Depends(cart_api.session_header),
) -> GuestCheckoutResponse:
    required_versions = await legal_consents_service.required_doc_versions(session)
    accepted_versions = await legal_consents_service.latest_accepted_versions(session, user_id=current_user.id)
    needs_consent = not legal_consents_service.is_satisfied(required_versions, accepted_versions)
    if needs_consent and (not payload.accept_terms or not payload.accept_privacy):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Legal consents required")

    base = _frontend_base_from_request(request)

    user_cart = await cart_service.get_cart(session, current_user.id, session_id)
    if not user_cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    last_order_id = await session.scalar(
        select(Cart.last_order_id).where(Cart.id == user_cart.id).with_for_update()
    )
    if last_order_id:
        existing_order = await order_service.get_order_by_id(session, last_order_id)
        if existing_order:
            existing_method = (existing_order.payment_method or "").strip().lower()
            existing_netopia_url = (getattr(existing_order, "netopia_payment_url", None) or "").strip()
            if (
                existing_method == "netopia"
                and not existing_netopia_url
                and settings.netopia_enabled
                and netopia_service.is_netopia_configured()
            ):
                first_name, last_name = _split_customer_name(getattr(existing_order, "customer_name", None) or "")
                shipping_addr_obj = existing_order.shipping_address
                billing_addr_obj = existing_order.billing_address or shipping_addr_obj
                if shipping_addr_obj and billing_addr_obj:
                    billing_payload = _netopia_address_payload(
                        email=getattr(existing_order, "customer_email", None) or current_user.email,
                        phone=getattr(shipping_addr_obj, "phone", None) or getattr(current_user, "phone", None),
                        first_name=first_name,
                        last_name=last_name,
                        addr=billing_addr_obj,
                    )
                    shipping_payload = _netopia_address_payload(
                        email=getattr(existing_order, "customer_email", None) or current_user.email,
                        phone=getattr(shipping_addr_obj, "phone", None) or getattr(current_user, "phone", None),
                        first_name=first_name,
                        last_name=last_name,
                        addr=shipping_addr_obj,
                    )
                    cancel_url = f"{base}/checkout/netopia/cancel?order_id={existing_order.id}"
                    redirect_url = f"{base}/checkout/netopia/return?order_id={existing_order.id}"
                    notify_url = f"{base}/api/v1/payments/netopia/webhook"
                    netopia_ntp_id, netopia_payment_url = await netopia_service.start_payment(
                        order_id=str(existing_order.id),
                        amount_ron=pricing.quantize_money(existing_order.total_amount),
                        description=f"Order {existing_order.reference_code}"
                        if existing_order.reference_code
                        else f"Order {existing_order.id}",
                        billing=billing_payload,
                        shipping=shipping_payload,
                        products=_build_netopia_products(existing_order, lang=current_user.preferred_language),
                        language=(current_user.preferred_language or "ro"),
                        cancel_url=cancel_url,
                        notify_url=notify_url,
                        redirect_url=redirect_url,
                    )
                    existing_order.netopia_ntp_id = netopia_ntp_id
                    existing_order.netopia_payment_url = netopia_payment_url
                    session.add(existing_order)
                    await session.commit()
                    await session.refresh(existing_order)
            response.status_code = status.HTTP_200_OK
            return GuestCheckoutResponse(
                order_id=existing_order.id,
                reference_code=existing_order.reference_code,
                paypal_order_id=existing_order.paypal_order_id,
                paypal_approval_url=getattr(existing_order, "paypal_approval_url", None),
                netopia_ntp_id=getattr(existing_order, "netopia_ntp_id", None),
                netopia_payment_url=getattr(existing_order, "netopia_payment_url", None),
                stripe_session_id=existing_order.stripe_checkout_session_id,
                stripe_checkout_url=getattr(existing_order, "stripe_checkout_url", None),
                payment_method=existing_order.payment_method,
            )
        # Stale pointer; clear it to allow checkout to proceed.
        cart_row = await session.get(Cart, user_cart.id)
        if cart_row:
            cart_row.last_order_id = None
            session.add(cart_row)

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
    netopia_ntp_id = None
    netopia_payment_url = None
    if payment_method == "stripe":
        stripe_line_items = _build_stripe_line_items(user_cart, totals, lang=current_user.preferred_language)
        discount_cents = _money_to_cents(discount_val) if discount_val and discount_val > 0 else None
        stripe_session = await payments.create_checkout_session(
            session=session,
            amount_cents=_money_to_cents(totals.total),
            customer_email=current_user.email,
            success_url=f"{base}/checkout/stripe/return?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/checkout/stripe/cancel?session_id={{CHECKOUT_SESSION_ID}}",
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
            return_url=f"{base}/checkout/paypal/return",
            cancel_url=f"{base}/checkout/paypal/cancel",
            item_total_ron=totals.subtotal,
            shipping_ron=totals.shipping,
            tax_ron=totals.tax,
            fee_ron=totals.fee,
            discount_ron=discount_val,
            items=paypal_items,
        )
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
        stripe_checkout_url=stripe_checkout_url,
        paypal_order_id=paypal_order_id,
        paypal_approval_url=paypal_approval_url,
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
    if payment_method == "netopia":
        if not settings.netopia_enabled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Netopia is disabled")
        netopia_configured, netopia_reason = netopia_service.netopia_configuration_status()
        if not netopia_configured:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=netopia_reason or "Netopia is not configured",
            )
        first_name, last_name = _split_customer_name(getattr(order, "customer_name", None) or "")
        shipping_addr_obj = order.shipping_address or shipping_addr
        billing_addr_obj = order.billing_address or billing_addr or shipping_addr_obj
        billing_payload = _netopia_address_payload(
            email=getattr(order, "customer_email", None) or current_user.email,
            phone=getattr(shipping_addr_obj, "phone", None) or getattr(current_user, "phone", None),
            first_name=first_name,
            last_name=last_name,
            addr=billing_addr_obj,
        )
        shipping_payload = _netopia_address_payload(
            email=getattr(order, "customer_email", None) or current_user.email,
            phone=getattr(shipping_addr_obj, "phone", None) or getattr(current_user, "phone", None),
            first_name=first_name,
            last_name=last_name,
            addr=shipping_addr_obj,
        )
        cancel_url = f"{base}/checkout/netopia/cancel?order_id={order.id}"
        redirect_url = f"{base}/checkout/netopia/return?order_id={order.id}"
        notify_url = f"{base}/api/v1/payments/netopia/webhook"
        netopia_ntp_id, netopia_payment_url = await netopia_service.start_payment(
            order_id=str(order.id),
            amount_ron=pricing.quantize_money(order.total_amount),
            description=f"Order {order.reference_code}" if order.reference_code else f"Order {order.id}",
            billing=billing_payload,
            shipping=shipping_payload,
            products=_build_netopia_products(order, lang=current_user.preferred_language),
            language=(current_user.preferred_language or "ro"),
            cancel_url=cancel_url,
            notify_url=notify_url,
            redirect_url=redirect_url,
        )
        order.netopia_ntp_id = netopia_ntp_id
        order.netopia_payment_url = netopia_payment_url
        session.add(order)
        await session.commit()
        await session.refresh(order)
    if needs_consent:
        legal_consents_service.add_consent_records(
            session,
            context=LegalConsentContext.checkout,
            required_versions=required_versions,
            accepted_at=datetime.now(timezone.utc),
            user_id=current_user.id,
            order_id=order.id,
        )
        await session.commit()
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
        netopia_ntp_id=netopia_ntp_id,
        netopia_payment_url=netopia_payment_url,
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

    mock_mode = is_mock_payments()

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

    if mock_mode:
        outcome = str(payload.mock or "success").strip().lower()
        if outcome == "decline":
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Payment declined")
        capture_id = f"paypal_mock_capture_{secrets.token_hex(8)}"
    else:
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


def _payment_confirmation_query(stmt):
    return stmt.options(
        selectinload(Order.user),
        selectinload(Order.items).selectinload(OrderItem.product),
        selectinload(Order.events),
        selectinload(Order.shipping_address),
        selectinload(Order.billing_address),
    )


async def _get_order_by_stripe_session_id(session: AsyncSession, session_id: str) -> Order:
    result = await session.execute(
        _payment_confirmation_query(select(Order).where(Order.stripe_checkout_session_id == session_id))
    )
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


async def _get_order_by_id_for_confirmation(session: AsyncSession, order_id: UUID) -> Order:
    result = await session.execute(_payment_confirmation_query(select(Order).where(Order.id == order_id)))
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def _assert_confirmation_order_match(order: Order, payload_order_id: UUID | None) -> None:
    if payload_order_id and order.id != payload_order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order mismatch")


def _assert_confirmation_access(order: Order, current_user: User | None, payload_order_id: UUID | None) -> None:
    if not order.user_id:
        return
    same_user = current_user and order.user_id == getattr(current_user, "id", None)
    guest_return = bool(payload_order_id and order.id == payload_order_id)
    if same_user or guest_return:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")


def _stripe_session_value(checkout_session: Any, key: str) -> Any:
    return getattr(checkout_session, key, None) or (checkout_session.get(key) if hasattr(checkout_session, "get") else None)


def _retrieve_paid_stripe_session(session_id: str, *, mock_mode: bool) -> Any | None:
    if mock_mode:
        return None
    if not payments.is_stripe_configured():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stripe not configured")
    payments.init_stripe()
    try:
        checkout_session = payments.stripe.checkout.Session.retrieve(session_id)  # type: ignore[attr-defined]
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe session lookup failed") from exc
    if str(_stripe_session_value(checkout_session, "payment_status") or "").lower() != "paid":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment not completed")
    return checkout_session


def _apply_stripe_confirmation_outcome(
    payload: StripeConfirmRequest, *, mock_mode: bool, order: Order, checkout_session: Any | None
) -> None:
    if mock_mode:
        outcome = str(payload.mock or "success").strip().lower()
        if outcome == "decline":
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Payment declined")
        return
    payment_intent_id = _stripe_session_value(checkout_session, "payment_intent")
    if payment_intent_id and not order.stripe_payment_intent_id:
        order.stripe_payment_intent_id = str(payment_intent_id)


def _order_has_payment_captured(order: Order) -> bool:
    return any(getattr(evt, "event", None) == "payment_captured" for evt in (order.events or []))


async def _finalize_order_after_payment_capture(
    session: AsyncSession, order: Order, *, note: str, add_capture_event: bool
) -> bool:
    captured_added = False
    if add_capture_event:
        session.add(OrderEvent(order_id=order.id, event="payment_captured", note=note))
        captured_added = True
        await promo_usage.record_promo_usage(session, order=order, note=note)
    if order.status == OrderStatus.pending_payment:
        order.status = OrderStatus.pending_acceptance
        session.add(OrderEvent(order_id=order.id, event="status_change", note="pending_payment -> pending_acceptance"))
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return captured_added


async def _payment_capture_receipt_share_days(
    session: AsyncSession,
    *,
    include_receipt_share_days: bool,
) -> int | None:
    if not include_receipt_share_days:
        return None
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    return checkout_settings.receipt_share_days


def _payment_capture_contact(order: Order) -> tuple[str | None, str | None]:
    customer_to = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
    customer_lang = order.user.preferred_language if order.user else None
    return customer_to, customer_lang


def _queue_payment_capture_customer_email(
    background_tasks: BackgroundTasks,
    order: Order,
    *,
    customer_to: str | None,
    customer_lang: str | None,
    receipt_share_days: int | None,
) -> None:
    if not customer_to:
        return
    if receipt_share_days is None:
        background_tasks.add_task(email_service.send_order_confirmation, customer_to, order, order.items, customer_lang)
        return
    background_tasks.add_task(
        email_service.send_order_confirmation,
        customer_to,
        order,
        order.items,
        customer_lang,
        receipt_share_days=receipt_share_days,
    )


async def _queue_payment_capture_admin_email(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    *,
    customer_to: str | None,
) -> None:
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if not admin_to:
        return
    background_tasks.add_task(
        email_service.send_new_order_notification,
        admin_to,
        order,
        customer_to,
        owner.preferred_language if owner else None,
    )


async def _notify_payment_capture_user(session: AsyncSession, order: Order) -> None:
    if not (order.user and order.user.id):
        return
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title="Payment received" if (order.user.preferred_language or "en") != "ro" else "Plată confirmată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


async def _queue_payment_capture_notifications(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    *,
    include_receipt_share_days: bool,
) -> None:
    receipt_share_days = await _payment_capture_receipt_share_days(
        session,
        include_receipt_share_days=include_receipt_share_days,
    )
    customer_to, customer_lang = _payment_capture_contact(order)
    _queue_payment_capture_customer_email(
        background_tasks,
        order,
        customer_to=customer_to,
        customer_lang=customer_lang,
        receipt_share_days=receipt_share_days,
    )
    await _queue_payment_capture_admin_email(
        session,
        background_tasks,
        order,
        customer_to=customer_to,
    )
    await _notify_payment_capture_user(session, order)


def _netopia_confirmation_transaction_id(order: Order, payload_ntp_id: str | None) -> str:
    if payload_ntp_id and order.netopia_ntp_id and payload_ntp_id != order.netopia_ntp_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transaction mismatch")
    ntp_id = (order.netopia_ntp_id or "").strip()
    if not ntp_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Netopia transaction id")
    return ntp_id


def _assert_netopia_status_completed(status_data: dict[str, Any]) -> None:
    payment = status_data.get("payment") if isinstance(status_data, dict) else None
    payment_status_raw = payment.get("status") if isinstance(payment, dict) else None
    try:
        payment_status = int(payment_status_raw) if payment_status_raw is not None else None
    except Exception:
        payment_status = None
    if payment_status not in {3, 5}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment not completed")


def _netopia_error_details(status_data: dict[str, Any]) -> tuple[str, str]:
    error = status_data.get("error")
    if not isinstance(error, dict):
        return "", ""
    raw_code = error.get("code")
    raw_message = error.get("message")
    error_code = str(raw_code).strip() if raw_code is not None else ""
    error_message = str(raw_message).strip() if raw_message is not None else ""
    return error_code, error_message


def _assert_netopia_error_success(status_data: dict[str, Any]) -> None:
    error_code, error_message = _netopia_error_details(status_data)
    if not error_code:
        return
    if error_code.lower() in {"00", "0", "approved"}:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=error_message or f"Payment not completed (Netopia {error_code})",
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

    mock_mode = is_mock_payments()
    checkout_session = _retrieve_paid_stripe_session(session_id, mock_mode=mock_mode)
    order = await _get_order_by_stripe_session_id(session, session_id)
    _assert_confirmation_order_match(order, payload.order_id)
    _assert_confirmation_access(order, current_user, payload.order_id)
    _apply_stripe_confirmation_outcome(payload, mock_mode=mock_mode, order=order, checkout_session=checkout_session)

    note = f"Stripe session {session_id}"
    captured_added = await _finalize_order_after_payment_capture(
        session,
        order,
        note=note,
        add_capture_event=not _order_has_payment_captured(order),
    )
    await coupons_service.redeem_coupon_for_order(session, order=order, note=note)
    if captured_added:
        await _queue_payment_capture_notifications(
            session,
            background_tasks,
            order,
            include_receipt_share_days=False,
        )

    return StripeConfirmResponse(order_id=order.id, reference_code=order.reference_code, status=order.status)


@router.post("/netopia/confirm", response_model=NetopiaConfirmResponse)
async def confirm_netopia_payment(
    payload: NetopiaConfirmRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> NetopiaConfirmResponse:
    order = await _get_order_by_id_for_confirmation(session, payload.order_id)
    if (order.payment_method or "").strip().lower() != "netopia":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not a Netopia order")
    _assert_confirmation_access(order, current_user, payload.order_id)

    ntp_id = _netopia_confirmation_transaction_id(order, payload.ntp_id)
    if _order_has_payment_captured(order):
        return NetopiaConfirmResponse(order_id=order.id, reference_code=order.reference_code, status=order.status)

    status_data = await netopia_service.get_status(ntp_id=ntp_id, order_id=str(order.id))
    _assert_netopia_status_completed(status_data if isinstance(status_data, dict) else {})
    _assert_netopia_error_success(status_data if isinstance(status_data, dict) else {})

    note = f"Netopia {ntp_id}".strip()
    await _finalize_order_after_payment_capture(session, order, note=note, add_capture_event=True)
    await coupons_service.redeem_coupon_for_order(session, order=order, note=note)
    await _queue_payment_capture_notifications(
        session,
        background_tasks,
        order,
        include_receipt_share_days=True,
    )

    return NetopiaConfirmResponse(order_id=order.id, reference_code=order.reference_code, status=order.status)


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
    request: Request,
    q: str | None = Query(default=None, max_length=200),
    user_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=50),
    sla: str | None = Query(default=None, max_length=30),
    fraud: str | None = Query(default=None, max_length=30),
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
        pii_service.require_pii_reveal(admin, request=request)
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
    sla_clean = (sla or "").strip().lower() if sla else None
    parsed_sla: str | None = None
    if sla_clean:
        if sla_clean in {"accept_overdue", "acceptance_overdue", "overdue_acceptance", "overdue_accept"}:
            parsed_sla = "accept_overdue"
        elif sla_clean in {"ship_overdue", "shipping_overdue", "overdue_shipping", "overdue_ship"}:
            parsed_sla = "ship_overdue"
        elif sla_clean in {"any_overdue", "overdue", "any"}:
            parsed_sla = "any_overdue"
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SLA filter")
    fraud_clean = (fraud or "").strip().lower() if fraud else None
    parsed_fraud: str | None = None
    if fraud_clean:
        if fraud_clean in {"queue", "review", "needs_review", "needs-review"}:
            parsed_fraud = "queue"
        elif fraud_clean in {"flagged", "risk"}:
            parsed_fraud = "flagged"
        elif fraud_clean in {"approved"}:
            parsed_fraud = "approved"
        elif fraud_clean in {"denied"}:
            parsed_fraud = "denied"
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid fraud filter")
    rows, total_items = await order_service.admin_search_orders(
        session,
        q=q,
        user_id=user_id,
        status=parsed_status,
        statuses=parsed_statuses,
        pending_any=pending_any,
        tag=tag,
        sla=parsed_sla,
        fraud=parsed_fraud,
        from_dt=from_dt,
        to_dt=to_dt,
        page=page,
        limit=limit,
        include_test=include_test,
    )
    now = datetime.now(timezone.utc)
    accept_hours = max(1, int(getattr(settings, "order_sla_accept_hours", 24) or 24))
    ship_hours = max(1, int(getattr(settings, "order_sla_ship_hours", 48) or 48))

    def _ensure_utc(dt: datetime | None) -> datetime | None:
        if not dt:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    items: list[AdminOrderListItem] = []
    for (order, email, username, sla_kind, sla_started_at, fraud_flagged, fraud_severity) in rows:
        sla_started_at = _ensure_utc(sla_started_at)
        sla_due_at: datetime | None = None
        sla_overdue = False
        if sla_kind == "accept" and sla_started_at:
            sla_due_at = sla_started_at + timedelta(hours=accept_hours)
            sla_overdue = sla_due_at <= now
        elif sla_kind == "ship" and sla_started_at:
            sla_due_at = sla_started_at + timedelta(hours=ship_hours)
            sla_overdue = sla_due_at <= now

        items.append(
            AdminOrderListItem(
                id=order.id,
                reference_code=order.reference_code,
                status=order.status,
                total_amount=order.total_amount,
                currency=order.currency,
                payment_method=getattr(order, "payment_method", None),
                created_at=order.created_at,
                customer_email=email if include_pii else pii_service.mask_email(email),
                customer_username=username,
                tags=[t.tag for t in (getattr(order, "tags", None) or [])],
                sla_kind=sla_kind,
                sla_started_at=sla_started_at,
                sla_due_at=sla_due_at,
                sla_overdue=sla_overdue,
                fraud_flagged=bool(fraud_flagged),
                fraud_severity=fraud_severity,
            )
        )
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


@router.get("/admin/tags/stats", response_model=OrderTagStatsResponse)
async def admin_list_order_tag_stats(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("orders")),
) -> OrderTagStatsResponse:
    rows = await order_service.list_order_tag_stats(session)
    return OrderTagStatsResponse(items=[OrderTagStatRead(tag=tag, count=count) for tag, count in rows])


@router.post("/admin/tags/rename", response_model=OrderTagRenameResponse)
async def admin_rename_order_tag(
    payload: OrderTagRenameRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> OrderTagRenameResponse:
    result = await order_service.rename_order_tag(
        session,
        from_tag=payload.from_tag,
        to_tag=payload.to_tag,
        actor_user_id=getattr(admin, "id", None),
    )
    return OrderTagRenameResponse(**result)


@router.get("/admin/export")
async def admin_export_orders(
    request: Request,
    columns: list[str] | None = Query(default=None),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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


@router.get("/admin/exports", response_model=AdminOrderDocumentExportListResponse)
async def admin_list_document_exports(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("orders")),
) -> AdminOrderDocumentExportListResponse:
    rows, total_items = await order_exports_service.list_exports(session, page=page, limit=limit)
    items: list[AdminOrderDocumentExportRead] = []
    for export, ref in rows:
        order_count = len(getattr(export, "order_ids", None) or []) or (1 if getattr(export, "order_id", None) else 0)
        items.append(
            AdminOrderDocumentExportRead(
                id=export.id,
                kind=getattr(getattr(export, "kind", None), "value", None) or str(getattr(export, "kind", "")),
                filename=export.filename,
                mime_type=export.mime_type,
                created_at=export.created_at,
                expires_at=export.expires_at,
                order_id=getattr(export, "order_id", None),
                order_reference=ref,
                order_count=order_count,
            )
        )
    total_pages = max(1, (int(total_items) + int(limit) - 1) // int(limit))
    meta = AdminPaginationMeta(total_items=int(total_items), total_pages=total_pages, page=int(page), limit=int(limit))
    return AdminOrderDocumentExportListResponse(items=items, meta=meta)


@router.get("/admin/exports/{export_id}/download")
async def admin_download_document_export(
    export_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> FileResponse:
    step_up_service.require_step_up(request, admin)
    export, _ref = await order_exports_service.get_export(session, export_id)
    if not export:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
    expires_at = getattr(export, "expires_at", None)
    if expires_at and expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export expired")
    path = private_storage.resolve_private_path(export.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
    filename = Path(export.filename).name or path.name
    headers = {"Cache-Control": "no-store"}
    media_type = export.mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=filename, headers=headers)


async def _serialize_admin_order(
    session: AsyncSession,
    order: Order,
    *,
    include_pii: bool = False,
    current_user: User | None = None,
) -> AdminOrderRead:
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
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)

    return await _serialize_admin_order(session, order, include_pii=include_pii, current_user=admin)


@router.get("/admin/{order_id}/email-events", response_model=list[AdminOrderEmailEventRead])
async def admin_list_order_email_events(
    order_id: UUID,
    request: Request,
    include_pii: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    since_hours: int = Query(default=168, ge=1, le=2160),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> list[AdminOrderEmailEventRead]:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)

    customer_email = getattr(order, "customer_email", None) or (
        getattr(order.user, "email", None) if getattr(order, "user", None) else None
    )
    cleaned_email = (customer_email or "").strip().lower()
    if not cleaned_email:
        return []

    ref = (getattr(order, "reference_code", None) or str(getattr(order, "id", "")) or "").strip()
    ref_lower = ref.lower()

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=max(1, int(since_hours or 0)))

    stmt = (
        select(EmailDeliveryEvent)
        .where(EmailDeliveryEvent.created_at >= since)
        .where(func.lower(EmailDeliveryEvent.to_email) == cleaned_email)
        .order_by(EmailDeliveryEvent.created_at.desc())
        .limit(max(1, min(int(limit or 0), 200)))
    )
    if ref_lower:
        stmt = stmt.where(func.lower(EmailDeliveryEvent.subject).like(f"%{ref_lower}%"))

    rows = (await session.execute(stmt)).scalars().all()
    to_email_value = cleaned_email if include_pii else pii_service.mask_email(cleaned_email)
    return [
        AdminOrderEmailEventRead(
            id=row.id,
            to_email=to_email_value,
            subject=row.subject,
            status=row.status,
            error_message=row.error_message,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/guest-checkout/email/request", response_model=GuestEmailVerificationRequestResponse)
async def request_guest_email_verification(
    payload: GuestEmailVerificationRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(guest_email_request_rate_limit),
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

    background_tasks.add_task(email_service.send_verification_email, email, token, lang, "guest")
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
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    _: None = Depends(guest_checkout_rate_limit),
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
):
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")

    cart = await cart_service.get_cart(session, None, session_id)
    if not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    email = _normalize_email(str(payload.email))
    if not cart.guest_email_verified_at or _normalize_email(cart.guest_email or "") != email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email verification required")

    base = _frontend_base_from_request(request)

    last_order_id = await session.scalar(
        select(Cart.last_order_id).where(Cart.id == cart.id).with_for_update()
    )
    if last_order_id:
        existing_order = await order_service.get_order_by_id(session, last_order_id)
        if existing_order:
            existing_method = (existing_order.payment_method or "").strip().lower()
            existing_netopia_url = (getattr(existing_order, "netopia_payment_url", None) or "").strip()
            if (
                existing_method == "netopia"
                and not existing_netopia_url
                and settings.netopia_enabled
                and netopia_service.is_netopia_configured()
            ):
                first_name, last_name = _split_customer_name(getattr(existing_order, "customer_name", None) or "")
                shipping_addr_obj = existing_order.shipping_address
                billing_addr_obj = existing_order.billing_address or shipping_addr_obj
                if shipping_addr_obj and billing_addr_obj:
                    billing_payload = _netopia_address_payload(
                        email=getattr(existing_order, "customer_email", None) or email,
                        phone=getattr(shipping_addr_obj, "phone", None),
                        first_name=first_name,
                        last_name=last_name,
                        addr=billing_addr_obj,
                    )
                    shipping_payload = _netopia_address_payload(
                        email=getattr(existing_order, "customer_email", None) or email,
                        phone=getattr(shipping_addr_obj, "phone", None),
                        first_name=first_name,
                        last_name=last_name,
                        addr=shipping_addr_obj,
                    )
                    cancel_url = f"{base}/checkout/netopia/cancel?order_id={existing_order.id}"
                    redirect_url = f"{base}/checkout/netopia/return?order_id={existing_order.id}"
                    notify_url = f"{base}/api/v1/payments/netopia/webhook"
                    netopia_ntp_id, netopia_payment_url = await netopia_service.start_payment(
                        order_id=str(existing_order.id),
                        amount_ron=pricing.quantize_money(existing_order.total_amount),
                        description=f"Order {existing_order.reference_code}"
                        if existing_order.reference_code
                        else f"Order {existing_order.id}",
                        billing=billing_payload,
                        shipping=shipping_payload,
                        products=_build_netopia_products(existing_order, lang=payload.preferred_language),
                        language=(payload.preferred_language or "ro"),
                        cancel_url=cancel_url,
                        notify_url=notify_url,
                        redirect_url=redirect_url,
                    )
                    existing_order.netopia_ntp_id = netopia_ntp_id
                    existing_order.netopia_payment_url = netopia_payment_url
                    session.add(existing_order)
                    await session.commit()
                    await session.refresh(existing_order)
            response.status_code = status.HTTP_200_OK
            return GuestCheckoutResponse(
                order_id=existing_order.id,
                reference_code=existing_order.reference_code,
                paypal_order_id=existing_order.paypal_order_id,
                paypal_approval_url=getattr(existing_order, "paypal_approval_url", None),
                netopia_ntp_id=getattr(existing_order, "netopia_ntp_id", None),
                netopia_payment_url=getattr(existing_order, "netopia_payment_url", None),
                stripe_session_id=existing_order.stripe_checkout_session_id,
                stripe_checkout_url=getattr(existing_order, "stripe_checkout_url", None),
                payment_method=existing_order.payment_method,
            )
        cart.last_order_id = None
        session.add(cart)

    if await auth_service.is_email_taken(session, email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered; please sign in to checkout.",
        )

    required_versions = await legal_consents_service.required_doc_versions(session)
    if not payload.accept_terms or not payload.accept_privacy:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Legal consents required")

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
    netopia_ntp_id = None
    netopia_payment_url = None
    if payment_method == "stripe":
        stripe_line_items = _build_stripe_line_items(cart, totals, lang=payload.preferred_language)
        discount_cents = _money_to_cents(discount_val) if discount_val and discount_val > 0 else None
        stripe_session = await payments.create_checkout_session(
            session=session,
            amount_cents=_money_to_cents(totals.total),
            customer_email=email,
            success_url=f"{base}/checkout/stripe/return?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/checkout/stripe/cancel?session_id={{CHECKOUT_SESSION_ID}}",
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
            return_url=f"{base}/checkout/paypal/return",
            cancel_url=f"{base}/checkout/paypal/cancel",
            item_total_ron=totals.subtotal,
            shipping_ron=totals.shipping,
            tax_ron=totals.tax,
            fee_ron=totals.fee,
            discount_ron=discount_val,
            items=paypal_items,
        )
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
        stripe_checkout_url=stripe_checkout_url,
        paypal_order_id=paypal_order_id,
        paypal_approval_url=paypal_approval_url,
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
    if payment_method == "netopia":
        if not settings.netopia_enabled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Netopia is disabled")
        netopia_configured, netopia_reason = netopia_service.netopia_configuration_status()
        if not netopia_configured:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=netopia_reason or "Netopia is not configured",
            )
        first_name, last_name = _split_customer_name(getattr(order, "customer_name", None) or "")
        shipping_addr_obj = order.shipping_address or shipping_addr
        billing_addr_obj = order.billing_address or billing_addr or shipping_addr_obj
        billing_payload = _netopia_address_payload(
            email=getattr(order, "customer_email", None) or email,
            phone=getattr(shipping_addr_obj, "phone", None),
            first_name=first_name,
            last_name=last_name,
            addr=billing_addr_obj,
        )
        shipping_payload = _netopia_address_payload(
            email=getattr(order, "customer_email", None) or email,
            phone=getattr(shipping_addr_obj, "phone", None),
            first_name=first_name,
            last_name=last_name,
            addr=shipping_addr_obj,
        )
        cancel_url = f"{base}/checkout/netopia/cancel?order_id={order.id}"
        redirect_url = f"{base}/checkout/netopia/return?order_id={order.id}"
        notify_url = f"{base}/api/v1/payments/netopia/webhook"
        netopia_ntp_id, netopia_payment_url = await netopia_service.start_payment(
            order_id=str(order.id),
            amount_ron=pricing.quantize_money(order.total_amount),
            description=f"Order {order.reference_code}" if order.reference_code else f"Order {order.id}",
            billing=billing_payload,
            shipping=shipping_payload,
            products=_build_netopia_products(order, lang=payload.preferred_language),
            language=(payload.preferred_language or "ro"),
            cancel_url=cancel_url,
            notify_url=notify_url,
            redirect_url=redirect_url,
        )
        order.netopia_ntp_id = netopia_ntp_id
        order.netopia_payment_url = netopia_payment_url
        session.add(order)
    legal_consents_service.add_consent_records(
        session,
        context=LegalConsentContext.checkout,
        required_versions=required_versions,
        accepted_at=datetime.now(timezone.utc),
        user_id=user_id,
        order_id=order.id,
    )
    await session.commit()

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
        netopia_ntp_id=netopia_ntp_id,
        netopia_payment_url=netopia_payment_url,
        stripe_session_id=stripe_session_id,
        stripe_checkout_url=stripe_checkout_url,
        payment_method=payment_method,
    )


async def _resolve_shipping_method_for_order_update(session: AsyncSession, payload: OrderUpdate):
    if not payload.shipping_method_id:
        return None
    shipping_method = await order_service.get_shipping_method(session, payload.shipping_method_id)
    if not shipping_method:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    return shipping_method


async def _release_coupon_for_status_change(session: AsyncSession, order: Order, payload: OrderUpdate) -> None:
    if order.status == OrderStatus.cancelled:
        await coupons_service.release_coupon_for_order(session, order=order, reason=(payload.cancel_reason or "cancelled")[:255])
    elif order.status == OrderStatus.refunded:
        await coupons_service.release_coupon_for_order(session, order=order, reason="refunded")


def _cancelled_order_refund_method(order: Order) -> str | None:
    payment_method = (order.payment_method or "").strip().lower()
    if payment_method == "paypal":
        if order.paypal_capture_id:
            return payment_method
        return None
    if payment_method == "stripe":
        if order.stripe_payment_intent_id and _order_has_payment_captured(order):
            return payment_method
    return None


def _owner_prefers_romanian(owner: User) -> bool:
    return (owner.preferred_language or "en") == "ro"


def _manual_refund_notification_title(owner: User) -> str:
    if _owner_prefers_romanian(owner):
        return "Rambursare necesară"
    return "Refund required"


def _manual_refund_notification_body(order: Order, *, payment_method: str, owner: User) -> str:
    if _owner_prefers_romanian(owner):
        return f"Comanda {order.reference_code or order.id} a fost anulată și necesită o rambursare manuală ({payment_method})."
    return f"Order {order.reference_code or order.id} was cancelled and needs a manual refund ({payment_method})."


async def _notify_owner_manual_refund_required(session: AsyncSession, order: Order) -> None:
    if order.status != OrderStatus.cancelled:
        return
    payment_method = _cancelled_order_refund_method(order)
    if not payment_method:
        return
    owner = await auth_service.get_owner_user(session)
    if not owner:
        return
    if not owner.id:
        return
    await notification_service.create_notification(
        session,
        user_id=owner.id,
        type="admin",
        title=_manual_refund_notification_title(owner),
        body=_manual_refund_notification_body(order, payment_method=payment_method, owner=owner),
        url=f"/admin/orders/{order.id}",
    )


def _order_customer_contact(order: Order) -> tuple[str | None, str | None]:
    customer_email = (order.user.email if order.user and order.user.email else None) or getattr(order, "customer_email", None)
    customer_lang = order.user.preferred_language if order.user else None
    return customer_email, customer_lang


async def _queue_first_order_reward_email(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    *,
    customer_lang: str | None,
) -> None:
    if not (order.user and order.user.email):
        return
    coupon = await coupons_service.issue_first_order_reward_if_eligible(
        session,
        user=order.user,
        order=order,
        validity_days=int(getattr(settings, "first_order_reward_coupon_validity_days", 30) or 30),
    )
    if coupon:
        background_tasks.add_task(
            email_service.send_coupon_assigned,
            order.user.email,
            coupon_code=coupon.code,
            promotion_name="First order reward",
            promotion_description="20% off your next order (one-time).",
            ends_at=getattr(coupon, "ends_at", None),
            lang=customer_lang,
        )


async def _queue_customer_status_email(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
) -> None:
    customer_email, customer_lang = _order_customer_contact(order)
    if not customer_email:
        return
    if order.status == OrderStatus.paid:
        background_tasks.add_task(email_service.send_order_processing_update, customer_email, order, lang=customer_lang)
    elif order.status == OrderStatus.shipped:
        background_tasks.add_task(
            email_service.send_shipping_update,
            customer_email,
            order,
            order.tracking_number,
            customer_lang,
        )
    elif order.status == OrderStatus.delivered:
        background_tasks.add_task(email_service.send_delivery_confirmation, customer_email, order, customer_lang)
        await _queue_first_order_reward_email(session, background_tasks, order, customer_lang=customer_lang)
    elif order.status == OrderStatus.cancelled:
        background_tasks.add_task(email_service.send_order_cancelled_update, customer_email, order, lang=customer_lang)
    elif order.status == OrderStatus.refunded:
        background_tasks.add_task(email_service.send_order_refunded_update, customer_email, order, lang=customer_lang)


def _order_update_notification_title(order: Order) -> str:
    language = (order.user.preferred_language if order.user else None) or "en"
    titles = {
        OrderStatus.paid: ("Order processing", "Comandă în procesare"),
        OrderStatus.shipped: ("Order shipped", "Comandă expediată"),
        OrderStatus.delivered: ("Order complete", "Comandă finalizată"),
        OrderStatus.cancelled: ("Order cancelled", "Comandă anulată"),
        OrderStatus.refunded: ("Order refunded", "Comandă rambursată"),
    }
    en_title, ro_title = titles.get(order.status, ("Order update", "Actualizare comandă"))
    if language == "ro":
        return ro_title
    return en_title


async def _notify_user_order_status_change(session: AsyncSession, order: Order) -> None:
    if not (order.user and order.user.id):
        return
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title=_order_update_notification_title(order),
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


async def _handle_admin_order_status_change(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    order: Order,
    payload: OrderUpdate,
) -> None:
    await _release_coupon_for_status_change(session, order, payload)
    await _notify_owner_manual_refund_required(session, order)
    await _queue_customer_status_email(session, background_tasks, order)
    await _notify_user_order_status_change(session, order)


@router.patch("/admin/{order_id}", response_model=AdminOrderRead)
async def admin_update_order(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    payload: OrderUpdate,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    previous_status = order.status
    shipping_method = await _resolve_shipping_method_for_order_update(session, payload)
    updated = await order_service.update_order(session, order, payload, shipping_method=shipping_method)
    if previous_status != updated.status:
        await _handle_admin_order_status_change(session, background_tasks, updated, payload)
    full = await order_service.get_order_by_id_admin(session, order_id)
    if not full:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await _serialize_admin_order(session, full, include_pii=include_pii, current_user=admin)


@router.patch("/admin/{order_id}/addresses", response_model=AdminOrderRead)
async def admin_update_order_addresses(
    order_id: UUID,
    request: Request,
    payload: AdminOrderAddressesUpdate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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
    request: Request,
    payload: OrderShipmentCreate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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
    request: Request,
    payload: OrderShipmentUpdate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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
    request: Request,
    file: UploadFile = File(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    old_path = getattr(order, "shipping_label_path", None)
    rel_path, original_name = await anyio.to_thread.run_sync(
        partial(
            private_storage.save_private_upload,
            file,
            subdir=f"shipping-labels/{order_id}",
            allowed_content_types=("application/pdf", "image/png", "image/jpeg", "image/webp"),
            max_bytes=None,
        )
    )
    now = datetime.now(timezone.utc)
    order.shipping_label_path = rel_path
    order.shipping_label_filename = _sanitize_filename(original_name)
    order.shipping_label_uploaded_at = now
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="shipping_label_uploaded", note=order.shipping_label_filename))
    await session.commit()

    filename = _sanitize_filename(getattr(order, "shipping_label_filename", None) or original_name or "shipping-label")
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    await order_exports_service.create_existing_file_export(
        session,
        kind=OrderDocumentExportKind.shipping_label,
        filename=filename,
        rel_path=rel_path,
        mime_type=mime_type,
        order_id=order.id,
        created_by_user_id=getattr(admin, "id", None),
    )

    if old_path and old_path != rel_path:
        private_storage.delete_private_file(old_path)

    full = await order_service.get_order_by_id_admin(session, order_id)
    if not full:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return await _serialize_admin_order(session, full, include_pii=include_pii, current_user=admin)


@router.get("/admin/{order_id}/shipping-label")
async def admin_download_shipping_label(
    order_id: UUID,
    request: Request,
    action: str | None = Query(default=None, max_length=20),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> FileResponse:
    step_up_service.require_step_up(request, admin)
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
    request: Request,
    payload: AdminOrderRefundRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    admin_user=Depends(require_admin),
):
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
    request: Request,
    payload: AdminOrderRefundCreate = Body(...),
    session: AsyncSession = Depends(get_session),
    admin_user=Depends(require_admin),
) -> AdminOrderRead:
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
    request: Request,
    payload: OrderAdminNoteCreate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    updated = await order_service.add_admin_note(session, order, note=payload.note, actor_user_id=getattr(admin, "id", None))

    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.post("/admin/{order_id}/tags", response_model=AdminOrderRead)
async def admin_add_order_tag(
    order_id: UUID,
    request: Request,
    payload: OrderTagCreate = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    updated = await order_service.remove_order_tag(
        session, order, tag=tag, actor_user_id=getattr(admin, "id", None)
    )

    return await _serialize_admin_order(session, updated, include_pii=include_pii, current_user=admin)


@router.post("/admin/{order_id}/fraud-review", response_model=AdminOrderRead)
async def admin_review_order_fraud(
    order_id: UUID,
    request: Request,
    payload: OrderFraudReviewRequest = Body(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
) -> AdminOrderRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    updated = await order_service.review_order_fraud(
        session,
        order,
        decision=payload.decision,
        note=payload.note,
        actor_user_id=getattr(admin, "id", None),
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
    request: Request,
    shipped_quantity: int = 0,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
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
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    pdf = await anyio.to_thread.run_sync(partial(packing_slips_service.render_packing_slip_pdf, order))
    ref = getattr(order, "reference_code", None) or str(order.id)
    await order_exports_service.create_pdf_export(
        session,
        kind=OrderDocumentExportKind.packing_slip,
        filename=f"packing-slip-{ref}.pdf",
        content=pdf,
        order_id=order.id,
        created_by_user_id=getattr(admin, "id", None),
    )
    headers = {"Content-Disposition": f"attachment; filename=packing-slip-{ref}.pdf"}
    return Response(content=pdf, media_type="application/pdf", headers=headers)


@router.post("/admin/batch/packing-slips")
async def admin_batch_packing_slips(
    payload: AdminOrderIdsRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
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
    pdf = await anyio.to_thread.run_sync(
        partial(packing_slips_service.render_batch_packing_slips_pdf, ordered)
    )
    await order_exports_service.create_pdf_export(
        session,
        kind=OrderDocumentExportKind.packing_slips_batch,
        filename="packing-slips.pdf",
        content=pdf,
        order_ids=ids,
        created_by_user_id=getattr(admin, "id", None),
    )
    headers = {"Content-Disposition": "attachment; filename=packing-slips.pdf"}
    return Response(content=pdf, media_type="application/pdf", headers=headers)


@router.post("/admin/batch/pick-list.csv")
async def admin_batch_pick_list_csv(
    payload: AdminOrderIdsRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
    ids = list(dict.fromkeys(payload.order_ids))
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No orders selected")
    if len(ids) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many orders selected")

    result = await session.execute(
        select(Order)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.items).selectinload(OrderItem.variant),
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
    rows = pick_lists_service.build_pick_list_rows(ordered)
    csv_bytes = pick_lists_service.render_pick_list_csv(rows)
    headers = {
        "Content-Disposition": 'attachment; filename="pick-list.csv"',
        "Cache-Control": "no-store",
    }
    return Response(content=csv_bytes, media_type="text/csv; charset=utf-8", headers=headers)


@router.post("/admin/batch/pick-list.pdf")
async def admin_batch_pick_list_pdf(
    payload: AdminOrderIdsRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
    ids = list(dict.fromkeys(payload.order_ids))
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No orders selected")
    if len(ids) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many orders selected")

    result = await session.execute(
        select(Order)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.items).selectinload(OrderItem.variant),
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
    rows = pick_lists_service.build_pick_list_rows(ordered)
    pdf = pick_lists_service.render_pick_list_pdf(rows, orders=ordered)
    headers = {
        "Content-Disposition": 'attachment; filename="pick-list.pdf"',
        "Cache-Control": "no-store",
    }
    return Response(content=pdf, media_type="application/pdf", headers=headers)


@router.post("/admin/batch/shipping-labels.zip")
async def admin_batch_shipping_labels_zip(
    payload: AdminOrderIdsRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
    ids = list(dict.fromkeys(payload.order_ids))
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No orders selected")
    if len(ids) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many orders selected")

    result = await session.execute(select(Order).execution_options(populate_existing=True).where(Order.id.in_(ids)))
    orders = list(result.scalars().unique())
    found = {o.id for o in orders}
    missing = [str(order_id) for order_id in ids if order_id not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"missing_order_ids": missing})

    order_by_id = {o.id: o for o in orders}
    ordered = [order_by_id[order_id] for order_id in ids if order_id in order_by_id]

    files: list[tuple[Order, Path, str]] = []
    missing_labels: list[str] = []
    total_bytes = 0
    for order in ordered:
        rel = getattr(order, "shipping_label_path", None)
        if not rel:
            missing_labels.append(str(order.id))
            continue
        path = private_storage.resolve_private_path(rel)
        if not path.exists():
            missing_labels.append(str(order.id))
            continue

        size = path.stat().st_size
        total_bytes += size
        if total_bytes > 200 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shipping labels archive too large")

        base_name = _sanitize_filename(getattr(order, "shipping_label_filename", None) or path.name)
        ref = getattr(order, "reference_code", None) or str(order.id)[:8]
        zip_name = _sanitize_filename(f"{ref}-{base_name}" if base_name else str(ref))
        files.append((order, path, zip_name))

    if missing_labels:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"missing_shipping_label_order_ids": missing_labels},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for _, path, zip_name in files:
            zf.write(path, arcname=zip_name)
    buf.seek(0)

    actor = (getattr(admin, "email", None) or getattr(admin, "username", None) or "admin").strip()
    note = f"{actor}: batch" if actor else "batch"
    for order, _, _ in files:
        session.add(OrderEvent(order_id=order.id, event="shipping_label_downloaded", note=note))
    await session.commit()

    def _iter_zip(file_obj: io.BytesIO, chunk_size: int = 1024 * 1024):
        while True:
            chunk = file_obj.read(chunk_size)
            if not chunk:
                break
            yield chunk

    headers = {
        "Content-Disposition": 'attachment; filename="shipping-labels.zip"',
        "Cache-Control": "no-store",
    }
    return StreamingResponse(_iter_zip(buf), media_type="application/zip", headers=headers)


@router.get("/admin/{order_id}/receipt")
async def admin_download_receipt_pdf(
    order_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("orders")),
):
    step_up_service.require_step_up(request, admin)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    ref = getattr(order, "reference_code", None) or str(order.id)
    filename = f"receipt-{ref}.pdf"
    pdf = await anyio.to_thread.run_sync(
        partial(receipt_service.render_order_receipt_pdf, order, order.items)
    )
    await order_exports_service.create_pdf_export(
        session,
        kind=OrderDocumentExportKind.receipt,
        filename=filename,
        content=pdf,
        order_id=order.id,
        created_by_user_id=getattr(admin, "id", None),
    )
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers=headers)


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
    pdf = await anyio.to_thread.run_sync(
        partial(receipt_service.render_order_receipt_pdf, order, order.items, redacted=not allow_full)
    )
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
