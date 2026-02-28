import csv
import io
import mimetypes
import secrets
import zipfile
from dataclasses import dataclass
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
from app.services import coupons as coupons_service
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


CHARGE_LABELS: dict[str, tuple[str, str]] = {
    "shipping": ("Shipping", "Livrare"),
    "fee": ("Fee", "Taxă"),
    "vat": ("VAT", "TVA"),
    "discount": ("Discount", "Reducere"),
}

DEFAULT_BINARY_MIME_TYPE = "application/octet-stream"
BILLING_ADDRESS_INCOMPLETE_DETAIL = "Billing address is incomplete"
CHECKOUT_BILLING_LABEL = "Checkout (Billing)"
LEGAL_CONSENTS_REQUIRED_DETAIL = "Legal consents required"
EMAIL_ALREADY_REGISTERED_CHECKOUT_DETAIL = "Email already registered; please sign in to checkout."


def _charge_label(kind: str, lang: str | None) -> str:
    ro = (lang or "").strip().lower() == "ro"
    labels = CHARGE_LABELS.get(kind)
    if labels is None:
        return kind
    return labels[1] if ro else labels[0]


def _cart_item_name(item, lang: str | None) -> str:
    product = getattr(item, "product", None)
    variant = getattr(item, "variant", None)
    base = (getattr(product, "name", None) or "").strip() or "Item"
    variant_name = (getattr(variant, "name", None) or "").strip()
    if variant_name:
        return f"{base} ({variant_name})"
    return base


def _stripe_line_item(*, unit_amount: int, name: str, quantity: int) -> dict[str, object]:
    return {
        "price_data": {
            "currency": "ron",
            "unit_amount": unit_amount,
            "product_data": {"name": name},
        },
        "quantity": quantity,
    }


def _stripe_cart_line_item(item, *, lang: str | None) -> dict[str, object] | None:
    unit_price = _as_decimal(getattr(item, "unit_price_at_add", 0))
    unit_amount = _money_to_cents(unit_price)
    quantity = int(getattr(item, "quantity", 0) or 0)
    if quantity <= 0:
        return None
    return _stripe_line_item(unit_amount=unit_amount, name=_cart_item_name(item, lang), quantity=quantity)


def _append_stripe_charge_line_item(
    items: list[dict[str, object]], *, amount_cents: int, charge_kind: str, lang: str | None
) -> None:
    if amount_cents:
        items.append(_stripe_line_item(unit_amount=amount_cents, name=_charge_label(charge_kind, lang), quantity=1))


def _build_stripe_line_items(cart: Cart, totals: Totals, *, lang: str | None) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for item in cart.items:
        line_item = _stripe_cart_line_item(item, lang=lang)
        if line_item is not None:
            items.append(line_item)

    _append_stripe_charge_line_item(
        items,
        amount_cents=_money_to_cents(totals.shipping),
        charge_kind="shipping",
        lang=lang,
    )
    _append_stripe_charge_line_item(
        items,
        amount_cents=_money_to_cents(totals.fee),
        charge_kind="fee",
        lang=lang,
    )
    _append_stripe_charge_line_item(
        items,
        amount_cents=_money_to_cents(totals.tax),
        charge_kind="vat",
        lang=lang,
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


def _strip_text(value: object | None) -> str:
    return str(value or "").strip()


def _default_customer_name(value: str | None) -> str:
    cleaned = _strip_text(value)
    return cleaned if cleaned else "Customer"


def _resolve_country_payload(country_value: str | None) -> tuple[int, str]:
    country = _strip_text(country_value).upper() or "RO"
    if country == "RO":
        return 642, "Romania"
    return 0, country


def _join_address_details(addr: Address) -> str:
    parts = (
        _strip_text(getattr(addr, "line1", None)),
        _strip_text(getattr(addr, "line2", None)),
    )
    return ", ".join(part for part in parts if part)


def _netopia_address_payload(*, email: str, phone: str | None, first_name: str, last_name: str, addr: Address) -> dict[str, Any]:
    country_num, country_name = _resolve_country_payload(getattr(addr, "country", None))
    return {
        "email": _strip_text(email),
        "phone": _strip_text(phone),
        "firstName": _default_customer_name(first_name),
        "lastName": _default_customer_name(last_name),
        "city": _strip_text(getattr(addr, "city", None)),
        "country": int(country_num),
        "countryName": country_name,
        "state": _strip_text(getattr(addr, "region", None)),
        "postalCode": _strip_text(getattr(addr, "postal_code", None)),
        "details": _join_address_details(addr),
    }


def _netopia_product_name(product: Any) -> str:
    name = (getattr(product, "name", None) or "").strip()
    if name:
        return name
    return "Item"


def _netopia_product_code(product: Any) -> str:
    code = (getattr(product, "sku", None) or "").strip()
    if code:
        return code
    return str(getattr(product, "id", "") or "")


def _netopia_product_category(product: Any) -> str:
    category = (getattr(getattr(product, "category", None), "name", None) or "").strip()
    if category:
        return category
    return "Product"


def _netopia_order_item_line(item) -> dict[str, Any] | None:
    product = getattr(item, "product", None)
    subtotal = pricing.quantize_money(_as_decimal(getattr(item, "subtotal", 0)))
    if subtotal <= 0:
        return None
    return {
        "name": _netopia_product_name(product),
        "code": _netopia_product_code(product),
        "category": _netopia_product_category(product),
        "price": subtotal,
        "vat": 0,
    }


def _append_netopia_charge_line(
    lines: list[dict[str, Any]], *, amount_value: object, charge_kind: str, code: str, category: str, lang: str | None
) -> None:
    amount = pricing.quantize_money(_as_decimal(amount_value))
    if amount > 0:
        lines.append({"name": _charge_label(charge_kind, lang), "code": code, "category": category, "price": amount, "vat": 0})


def _rebalance_netopia_lines_total(lines: list[dict[str, Any]], *, target: Decimal) -> None:
    current = sum((row["price"] for row in lines), Decimal("0.00"))
    diff = current - target
    if diff > Decimal("0.00"):
        idx = max(range(len(lines)), key=lambda i: lines[i]["price"])
        lines[idx]["price"] = pricing.quantize_money(max(Decimal("0.00"), lines[idx]["price"] - diff))


def _serialize_netopia_products(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
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


def _build_netopia_products(order: Order, *, lang: str | None) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for item in order.items or []:
        line = _netopia_order_item_line(item)
        if line is not None:
            lines.append(line)

    _append_netopia_charge_line(
        lines,
        amount_value=getattr(order, "shipping_amount", 0),
        charge_kind="shipping",
        code="shipping",
        category="Shipping",
        lang=lang,
    )
    _append_netopia_charge_line(
        lines,
        amount_value=getattr(order, "fee_amount", 0),
        charge_kind="fee",
        code="fee",
        category="Fee",
        lang=lang,
    )
    _append_netopia_charge_line(
        lines,
        amount_value=getattr(order, "tax_amount", 0),
        charge_kind="vat",
        code="vat",
        category="VAT",
        lang=lang,
    )

    _rebalance_netopia_lines_total(
        lines,
        target=pricing.quantize_money(_as_decimal(getattr(order, "total_amount", 0))),
    )
    return _serialize_netopia_products(lines)


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
    courier_clean = _strip_text(courier) or "sameday"
    delivery_clean = _strip_text(delivery_type) or "home"
    if delivery_clean != "locker":
        return courier_clean, delivery_clean, None, None, None, None, None
    return _locker_delivery_payload(
        courier_clean=courier_clean,
        delivery_clean=delivery_clean,
        locker_id=locker_id,
        locker_name=locker_name,
        locker_address=locker_address,
        locker_lat=locker_lat,
        locker_lng=locker_lng,
    )


def _locker_delivery_payload(
    *,
    courier_clean: str,
    delivery_clean: str,
    locker_id: str | None,
    locker_name: str | None,
    locker_address: str | None,
    locker_lat: float | None,
    locker_lng: float | None,
) -> tuple[str, str, str | None, str | None, str | None, float | None, float | None]:
    locker_id_clean = _strip_text(locker_id)
    locker_name_clean = _strip_text(locker_name)
    if not locker_id_clean or not locker_name_clean or locker_lat is None or locker_lng is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Locker selection is required")
    locker_address_clean = _strip_text(locker_address) or None
    return (
        courier_clean,
        delivery_clean,
        locker_id_clean,
        locker_name_clean,
        locker_address_clean,
        float(locker_lat),
        float(locker_lng),
    )


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


def _resolve_order_contact_email(order: Order) -> str | None:
    user_email = _strip_text(getattr(getattr(order, "user", None), "email", None))
    if user_email:
        return user_email
    customer_email = _strip_text(getattr(order, "customer_email", None))
    return customer_email or None


def _admin_actor_label(admin: object) -> str:
    for key in ("email", "username"):
        candidate = _strip_text(getattr(admin, key, None))
        if candidate:
            return candidate
    return "admin"


def _order_email_event_note(admin: object, note: str | None) -> str:
    actor = _admin_actor_label(admin)
    note_clean = _strip_text(note)
    return f"{actor}: {note_clean}" if note_clean else actor


def _shipping_label_event_name(action: str | None) -> str:
    return "shipping_label_printed" if _strip_text(action).lower() == "print" else "shipping_label_downloaded"


def _shipping_label_event_note(admin: object, filename: str) -> str:
    actor = _admin_actor_label(admin)
    return f"{actor}: {filename}" if actor else filename


def _normalize_batch_order_ids(order_ids: list[UUID], *, max_selected: int) -> list[UUID]:
    ids = list(dict.fromkeys(order_ids))
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No orders selected")
    if len(ids) > max_selected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many orders selected")
    return ids


async def _load_order_batch_or_404(
    session: AsyncSession,
    order_ids: list[UUID],
    *,
    load_options: tuple[Any, ...] = (),
) -> list[Order]:
    query = select(Order).execution_options(populate_existing=True).options(*load_options).where(Order.id.in_(order_ids))
    result = await session.execute(query)
    orders = list(result.scalars().unique())
    missing_ids = _missing_batch_order_ids(order_ids, orders)
    if missing_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"missing_order_ids": missing_ids})
    return _ordered_batch_orders(order_ids, orders)


def _missing_batch_order_ids(order_ids: list[UUID], orders: list[Order]) -> list[str]:
    found_ids = {order.id for order in orders}
    return [str(order_id) for order_id in order_ids if order_id not in found_ids]


def _ordered_batch_orders(order_ids: list[UUID], orders: list[Order]) -> list[Order]:
    order_by_id = {order.id: order for order in orders}
    return [order_by_id[order_id] for order_id in order_ids]


MAX_BATCH_SHIPPING_LABEL_ARCHIVE_BYTES = 200 * 1024 * 1024
CANCEL_REQUEST_ELIGIBLE_STATUSES = frozenset(
    {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}
)


def _order_shipping_label_zip_entry(order: Order) -> tuple[Path, str] | None:
    rel = getattr(order, "shipping_label_path", None)
    if not rel:
        return None
    path = private_storage.resolve_private_path(rel)
    if not path.exists():
        return None
    base_name = _sanitize_filename(getattr(order, "shipping_label_filename", None) or path.name)
    ref = getattr(order, "reference_code", None) or str(order.id)[:8]
    zip_name = _sanitize_filename(f"{ref}-{base_name}" if base_name else str(ref))
    return path, zip_name


def _collect_batch_shipping_label_files(orders: list[Order]) -> tuple[list[tuple[Order, Path, str]], list[str]]:
    files: list[tuple[Order, Path, str]] = []
    missing_labels: list[str] = []
    total_bytes = 0
    for order in orders:
        zip_entry = _order_shipping_label_zip_entry(order)
        if zip_entry is None:
            missing_labels.append(str(order.id))
            continue
        path, zip_name = zip_entry
        total_bytes += path.stat().st_size
        if total_bytes > MAX_BATCH_SHIPPING_LABEL_ARCHIVE_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shipping labels archive too large")
        files.append((order, path, zip_name))
    return files, missing_labels


def _raise_for_missing_shipping_labels(order_ids: list[str]) -> None:
    if order_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"missing_shipping_label_order_ids": order_ids})


def _build_shipping_labels_zip_buffer(files: list[tuple[Order, Path, str]]) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for _, path, zip_name in files:
            zf.write(path, arcname=zip_name)
    buf.seek(0)
    return buf


def _iter_bytes_buffer(file_obj: io.BytesIO, chunk_size: int = 1024 * 1024):
    while True:
        chunk = file_obj.read(chunk_size)
        if not chunk:
            break
        yield chunk


async def _log_batch_shipping_label_downloads(
    session: AsyncSession, files: list[tuple[Order, Path, str]], admin: object
) -> None:
    note = f"{_admin_actor_label(admin)}: batch"
    for order, _, _ in files:
        session.add(OrderEvent(order_id=order.id, event="shipping_label_downloaded", note=note))
    await session.commit()


async def _save_shipping_label_upload(file: UploadFile, *, order_id: UUID) -> tuple[str, str]:
    return await anyio.to_thread.run_sync(
        partial(
            private_storage.save_private_upload,
            file,
            subdir=f"shipping-labels/{order_id}",
            allowed_content_types=("application/pdf", "image/png", "image/jpeg", "image/webp"),
            max_bytes=None,
        )
    )


def _apply_shipping_label_upload(order: Order, *, rel_path: str, original_name: str) -> str | None:
    old_path = getattr(order, "shipping_label_path", None)
    order.shipping_label_path = rel_path
    order.shipping_label_filename = _sanitize_filename(original_name)
    order.shipping_label_uploaded_at = datetime.now(timezone.utc)
    return old_path


async def _create_shipping_label_export_record(
    session: AsyncSession,
    *,
    order: Order,
    rel_path: str,
    fallback_name: str,
    created_by_user_id: UUID | None,
) -> None:
    filename = _sanitize_filename(getattr(order, "shipping_label_filename", None) or fallback_name or "shipping-label")
    mime_type = mimetypes.guess_type(filename)[0] or DEFAULT_BINARY_MIME_TYPE
    await order_exports_service.create_existing_file_export(
        session,
        kind=OrderDocumentExportKind.shipping_label,
        filename=filename,
        rel_path=rel_path,
        mime_type=mime_type,
        order_id=order.id,
        created_by_user_id=created_by_user_id,
    )


async def _load_admin_order_or_404(session: AsyncSession, order_id: UUID) -> Order:
    order = await order_service.get_order_by_id_admin(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def _can_manage_receipt_share(order: Order, current_user: object) -> bool:
    role = getattr(current_user, "role", None)
    role_value = (getattr(role, "value", None) or str(role or "")).strip().lower()
    is_admin = role_value in {"admin", "owner"}
    is_owner = bool(getattr(order, "user_id", None) and getattr(current_user, "id", None) == order.user_id)
    return bool(is_admin or is_owner)


def _require_receipt_share_access(order: Order, current_user: object) -> None:
    if _can_manage_receipt_share(order, current_user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")


def _decode_receipt_token_order(token: str) -> tuple[UUID, int]:
    decoded = decode_receipt_token(token)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")
    order_id, token_version = decoded
    try:
        return UUID(order_id), int(token_version)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token") from exc


async def _load_receipt_order_from_token(session: AsyncSession, token: str) -> Order:
    order_uuid, token_version = _decode_receipt_token_order(token)
    order = await order_service.get_order_by_id(session, order_uuid)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    if int(getattr(order, "receipt_token_version", 0) or 0) != token_version:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid receipt token")
    return order


def _allow_receipt_full_details(order: Order, current_user: object, *, reveal: bool) -> bool:
    if not reveal:
        return False
    role = getattr(current_user, "role", None) if current_user else None
    role_value = (getattr(role, "value", None) or str(role or "")).strip().lower()
    is_admin = role_value in {"admin", "owner"}
    is_owner = bool(current_user and getattr(order, "user_id", None) and getattr(current_user, "id", None) == order.user_id)
    return bool(is_admin or is_owner)


async def _build_receipt_share_token_read(session: AsyncSession, order: Order) -> ReceiptShareTokenRead:
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    expires_at = datetime.now(timezone.utc) + timedelta(days=int(checkout_settings.receipt_share_days))
    token = create_receipt_token(
        order_id=str(order.id),
        expires_at=expires_at,
        token_version=int(getattr(order, "receipt_token_version", 0) or 0),
    )
    frontend_origin = settings.frontend_origin.rstrip("/")
    receipt_url = f"{frontend_origin}/receipt/{token}"
    receipt_pdf_url = f"{frontend_origin}/api/v1/orders/receipt/{token}/pdf"
    return ReceiptShareTokenRead(token=token, receipt_url=receipt_url, receipt_pdf_url=receipt_pdf_url, expires_at=expires_at)


async def _load_user_cart_for_create_order(session: AsyncSession, user_id: UUID) -> Cart:
    cart_result = await session.execute(
        select(Cart).options(selectinload(Cart.items)).where(Cart.user_id == user_id).with_for_update()
    )
    cart = cart_result.scalar_one_or_none()
    if not cart or not cart.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")
    return cart


async def _resolve_existing_cart_order(session: AsyncSession, cart: Cart) -> Order | None:
    if not cart.last_order_id:
        return None
    existing_order = await order_service.get_order_by_id(session, cart.last_order_id)
    if existing_order:
        return existing_order
    cart.last_order_id = None
    session.add(cart)
    return None


async def _resolve_shipping_country_for_create_order(
    session: AsyncSession, payload: OrderCreate, user_id: UUID
) -> str | None:
    shipping_country: str | None = None
    for address_id in (payload.shipping_address_id, payload.billing_address_id):
        if not address_id:
            continue
        addr = await session.get(Address, address_id)
        if not addr or addr.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid address")
        if address_id == payload.shipping_address_id:
            shipping_country = addr.country
    return shipping_country


async def _resolve_shipping_method_for_create_order(session: AsyncSession, shipping_method_id: UUID | None):
    if not shipping_method_id:
        return None
    shipping_method = await order_service.get_shipping_method(session, shipping_method_id)
    if not shipping_method:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shipping method not found")
    return shipping_method


def _order_placed_title(preferred_language: str | None) -> str:
    if (preferred_language or "en") == "ro":
        return "Comandă plasată"
    return "Order placed"


def _order_reference_body(order: Order) -> str | None:
    if not order.reference_code:
        return None
    return f"Reference {order.reference_code}"


async def _queue_create_order_admin_notification(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    order: Order,
    customer_email: str,
) -> None:
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if not admin_to:
        return
    background_tasks.add_task(
        email_service.send_new_order_notification,
        admin_to,
        order,
        customer_email,
        owner.preferred_language if owner else None,
    )


async def _queue_create_order_notifications(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    order: Order,
    user: User,
    receipt_share_days: int,
) -> None:
    await notification_service.create_notification(
        session,
        user_id=user.id,
        type="order",
        title=_order_placed_title(user.preferred_language),
        body=_order_reference_body(order),
        url=_account_orders_url(order),
    )
    background_tasks.add_task(
        email_service.send_order_confirmation,
        user.email,
        order,
        order.items,
        user.preferred_language,
        receipt_share_days=receipt_share_days,
    )
    await _queue_create_order_admin_notification(
        session,
        background_tasks,
        order=order,
        customer_email=user.email,
    )


@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    response: Response,
    background_tasks: BackgroundTasks,
    payload: OrderCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_verified_email),
):
    cart = await _load_user_cart_for_create_order(session, current_user.id)
    existing_order = await _resolve_existing_cart_order(session, cart)
    if existing_order:
        response.status_code = status.HTTP_200_OK
        return existing_order
    shipping_country = await _resolve_shipping_country_for_create_order(session, payload, current_user.id)
    shipping_method = await _resolve_shipping_method_for_create_order(session, payload.shipping_method_id)
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
    await _queue_create_order_notifications(
        session,
        background_tasks,
        order=order,
        user=current_user,
        receipt_share_days=checkout_settings.receipt_share_days,
    )
    return order


def _guest_checkout_response_from_order(order: Order) -> GuestCheckoutResponse:
    return GuestCheckoutResponse(
        order_id=order.id,
        reference_code=order.reference_code,
        paypal_order_id=order.paypal_order_id,
        paypal_approval_url=getattr(order, "paypal_approval_url", None),
        netopia_ntp_id=getattr(order, "netopia_ntp_id", None),
        netopia_payment_url=getattr(order, "netopia_payment_url", None),
        stripe_session_id=order.stripe_checkout_session_id,
        stripe_checkout_url=getattr(order, "stripe_checkout_url", None),
        payment_method=order.payment_method,
    )


def _guest_checkout_response_with_payment(
    *,
    order: Order,
    payment_method: str,
    stripe_session_id: str | None,
    stripe_checkout_url: str | None,
    paypal_order_id: str | None,
    paypal_approval_url: str | None,
    netopia_ntp_id: str | None,
    netopia_payment_url: str | None,
) -> GuestCheckoutResponse:
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


def _netopia_order_description(order: Order) -> str:
    return f"Order {order.reference_code}" if order.reference_code else f"Order {order.id}"


def _can_restart_existing_netopia_payment(order: Order) -> bool:
    existing_method = (order.payment_method or "").strip().lower()
    existing_netopia_url = (getattr(order, "netopia_payment_url", None) or "").strip()
    return (
        existing_method == "netopia"
        and not existing_netopia_url
        and settings.netopia_enabled
        and netopia_service.is_netopia_configured()
    )


def _assert_netopia_enabled_and_configured() -> None:
    if not settings.netopia_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Netopia is disabled")
    netopia_configured, netopia_reason = netopia_service.netopia_configuration_status()
    if netopia_configured:
        return
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=netopia_reason or "Netopia is not configured",
    )


def _order_contact_email_for_netopia(order: Order, *, fallback_email: str) -> str:
    return getattr(order, "customer_email", None) or fallback_email


def _order_contact_phone_for_netopia(shipping_addr: Address, *, fallback_phone: str | None) -> str | None:
    return getattr(shipping_addr, "phone", None) or fallback_phone


def _netopia_customer_payloads(
    order: Order,
    *,
    email: str,
    phone: str | None,
    shipping_addr: Address,
    billing_addr: Address,
) -> tuple[dict[str, Any], dict[str, Any]]:
    first_name, last_name = _split_customer_name(getattr(order, "customer_name", None) or "")
    return (
        _netopia_address_payload(
            email=email,
            phone=phone,
            first_name=first_name,
            last_name=last_name,
            addr=billing_addr,
        ),
        _netopia_address_payload(
            email=email,
            phone=phone,
            first_name=first_name,
            last_name=last_name,
            addr=shipping_addr,
        ),
    )


async def _start_netopia_payment_for_order(
    order: Order,
    *,
    email: str,
    phone: str | None,
    lang: str | None,
    base: str,
    shipping_fallback: Address | None = None,
    billing_fallback: Address | None = None,
) -> tuple[str, str] | None:
    shipping_addr_obj = order.shipping_address or shipping_fallback
    billing_addr_obj = order.billing_address or billing_fallback or shipping_addr_obj
    if not shipping_addr_obj or not billing_addr_obj:
        return None
    contact_email = _order_contact_email_for_netopia(order, fallback_email=email)
    contact_phone = _order_contact_phone_for_netopia(shipping_addr_obj, fallback_phone=phone)
    billing_payload, shipping_payload = _netopia_customer_payloads(
        order,
        email=contact_email,
        phone=contact_phone,
        shipping_addr=shipping_addr_obj,
        billing_addr=billing_addr_obj,
    )
    netopia_ntp_id, netopia_payment_url = await netopia_service.start_payment(
        order_id=str(order.id),
        amount_ron=pricing.quantize_money(order.total_amount),
        description=_netopia_order_description(order),
        billing=billing_payload,
        shipping=shipping_payload,
        products=_build_netopia_products(order, lang=lang),
        language=(lang or "ro"),
        cancel_url=f"{base}/checkout/netopia/cancel?order_id={order.id}",
        notify_url=f"{base}/api/v1/payments/netopia/webhook",
        redirect_url=f"{base}/checkout/netopia/return?order_id={order.id}",
    )
    return netopia_ntp_id, netopia_payment_url


async def _refresh_existing_order_netopia_payment(
    session: AsyncSession,
    order: Order,
    *,
    email: str,
    phone: str | None,
    lang: str | None,
    base: str,
) -> None:
    if not _can_restart_existing_netopia_payment(order):
        return
    started = await _start_netopia_payment_for_order(order, email=email, phone=phone, lang=lang, base=base)
    if not started:
        return
    order.netopia_ntp_id, order.netopia_payment_url = started
    session.add(order)
    await session.commit()
    await session.refresh(order)


async def _clear_cart_last_order_pointer(
    session: AsyncSession,
    *,
    cart_id: UUID,
    cart_row: Cart | None = None,
) -> None:
    cart = cart_row if cart_row is not None else await session.get(Cart, cart_id)
    if not cart:
        return
    cart.last_order_id = None
    session.add(cart)


async def _resolve_existing_checkout_response(
    session: AsyncSession,
    *,
    cart_id: UUID,
    base: str,
    email: str,
    phone: str | None,
    lang: str | None,
    cart_row: Cart | None = None,
) -> GuestCheckoutResponse | None:
    last_order_id = await session.scalar(
        select(Cart.last_order_id).where(Cart.id == cart_id).with_for_update()
    )
    if not last_order_id:
        return None
    existing_order = await order_service.get_order_by_id(session, last_order_id)
    if not existing_order:
        await _clear_cart_last_order_pointer(session, cart_id=cart_id, cart_row=cart_row)
        return None
    await _refresh_existing_order_netopia_payment(session, existing_order, email=email, phone=phone, lang=lang, base=base)
    return _guest_checkout_response_from_order(existing_order)


def _assert_cart_has_items(cart: Cart) -> None:
    if cart.items:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")


def _assert_delivery_available_for_cart(cart: Cart, *, courier: str, delivery_type: str) -> None:
    locker_allowed, allowed_couriers = cart_service.delivery_constraints(cart)
    if not allowed_couriers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No couriers available for cart items")
    if courier not in allowed_couriers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected courier is not available for cart items")
    if delivery_type == "locker" and not locker_allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Locker delivery is not available for cart items")


def _resolve_checkout_phone(*, payload_phone: str | None, fallback_phone: str | None, phone_required: bool) -> str | None:
    phone = (payload_phone or "").strip() or None
    if not phone:
        phone = (fallback_phone or "").strip() or None
    if phone_required and not phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone is required")
    return phone


def _resolve_delivery_and_phone(
    cart: Cart,
    *,
    checkout_settings: Any,
    courier: str,
    delivery_type: str,
    locker_id: str | None,
    locker_name: str | None,
    locker_address: str | None,
    locker_lat: float | None,
    locker_lng: float | None,
    payload_phone: str | None,
    fallback_phone: str | None,
) -> tuple[tuple[str, str, str | None, str | None, str | None, float | None, float | None], str | None]:
    delivery = _delivery_from_payload(
        courier=courier,
        delivery_type=delivery_type,
        locker_id=locker_id,
        locker_name=locker_name,
        locker_address=locker_address,
        locker_lat=locker_lat,
        locker_lng=locker_lng,
    )
    courier_clean, delivery_type_clean, _locker_id, _locker_name, _locker_address, _locker_lat, _locker_lng = delivery
    _assert_delivery_available_for_cart(cart, courier=courier_clean, delivery_type=delivery_type_clean)
    phone_required = bool(
        checkout_settings.phone_required_locker
        if delivery_type_clean == "locker"
        else checkout_settings.phone_required_home
    )
    phone = _resolve_checkout_phone(
        payload_phone=payload_phone,
        fallback_phone=fallback_phone,
        phone_required=phone_required,
    )
    return delivery, phone


async def _resolve_logged_checkout_discount(
    session: AsyncSession,
    *,
    payload: CheckoutRequest,
    current_user: User,
    cart: Cart,
    checkout_settings: Any,
    shipping_method: Any,
) -> tuple[Any, Any, Any, Decimal]:
    if not payload.promo_code:
        return None, None, None, Decimal("0.00")
    rate_flat, rate_per = _shipping_rate_tuple(shipping_method)
    try:
        applied_discount = await coupons_service.apply_discount_code_to_cart(
            session,
            user=current_user,
            cart=cart,
            checkout=checkout_settings,
            shipping_method_rate_flat=rate_flat,
            shipping_method_rate_per_kg=rate_per,
            code=payload.promo_code,
            country_code=payload.country,
        )
        applied_coupon = applied_discount.coupon if applied_discount else None
        coupon_shipping_discount = applied_discount.shipping_discount_ron if applied_discount else Decimal("0.00")
        return None, applied_discount, applied_coupon, coupon_shipping_discount
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            promo = await cart_service.validate_promo(session, payload.promo_code, currency=None)
            return promo, None, None, Decimal("0.00")
        raise


def _shipping_rate_tuple(shipping_method: Any) -> tuple[Decimal | None, Decimal | None]:
    if not shipping_method:
        return None, None
    return (
        Decimal(getattr(shipping_method, "rate_flat", None) or 0),
        Decimal(getattr(shipping_method, "rate_per_kg", None) or 0),
    )


def _has_complete_billing_address(
    *,
    line1: str | None,
    city: str | None,
    postal_code: str | None,
    country: str | None,
) -> bool:
    return bool((line1 or "").strip() and (city or "").strip() and (postal_code or "").strip() and (country or "").strip())


def _checkout_billing_label(*, save_address: bool) -> str:
    if save_address:
        return CHECKOUT_BILLING_LABEL
    return f"{CHECKOUT_BILLING_LABEL} · One-time"


def _billing_line_present(line1: str | None) -> bool:
    return bool((line1 or "").strip())


def _default_shipping_flag(*, save_address: bool, explicit_default: bool | None) -> bool:
    if not save_address:
        return False
    if explicit_default is None:
        return True
    return bool(explicit_default)


def _default_billing_flag(*, save_address: bool, explicit_default: bool | None) -> bool:
    if not save_address:
        return False
    if explicit_default is None:
        return True
    return bool(explicit_default)


def _guest_shipping_label(*, create_account: bool) -> str:
    if create_account:
        return "Checkout"
    return "Guest Checkout"


def _guest_billing_label(*, create_account: bool) -> str:
    if create_account:
        return CHECKOUT_BILLING_LABEL
    return f"Guest {CHECKOUT_BILLING_LABEL}"


def _guest_default_shipping(*, save_address: bool, create_account: bool) -> bool:
    return bool(save_address and create_account)


def _guest_default_billing(*, save_address: bool, create_account: bool, billing_same_as_shipping: bool) -> bool:
    return bool(save_address and create_account and billing_same_as_shipping)


def _checkout_shipping_address_create(
    *,
    payload: CheckoutRequest,
    phone: str | None,
    default_shipping: bool,
    default_billing: bool,
    billing_same_as_shipping: bool,
) -> AddressCreate:
    return AddressCreate(
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
    )


def _checkout_billing_address_create(*, payload: CheckoutRequest, phone: str | None, default_billing: bool) -> AddressCreate:
    return AddressCreate(
        label=_checkout_billing_label(save_address=bool(payload.save_address)),
        phone=phone,
        line1=payload.billing_line1 or payload.line1,
        line2=payload.billing_line2,
        city=payload.billing_city,
        region=payload.billing_region,
        postal_code=payload.billing_postal_code,
        country=payload.billing_country,
        is_default_shipping=False,
        is_default_billing=default_billing,
    )


def _guest_shipping_address_create(
    *,
    payload: GuestCheckoutRequest,
    phone: str | None,
    billing_same_as_shipping: bool,
) -> AddressCreate:
    return AddressCreate(
        label=_guest_shipping_label(create_account=bool(payload.create_account)),
        phone=phone,
        line1=payload.line1,
        line2=payload.line2,
        city=payload.city,
        region=payload.region,
        postal_code=payload.postal_code,
        country=payload.country,
        is_default_shipping=_guest_default_shipping(
            save_address=bool(payload.save_address),
            create_account=bool(payload.create_account),
        ),
        is_default_billing=_guest_default_billing(
            save_address=bool(payload.save_address),
            create_account=bool(payload.create_account),
            billing_same_as_shipping=billing_same_as_shipping,
        ),
    )


def _guest_billing_address_create(*, payload: GuestCheckoutRequest, phone: str | None) -> AddressCreate:
    return AddressCreate(
        label=_guest_billing_label(create_account=bool(payload.create_account)),
        phone=phone,
        line1=payload.billing_line1 or payload.line1,
        line2=payload.billing_line2,
        city=payload.billing_city,
        region=payload.billing_region,
        postal_code=payload.billing_postal_code,
        country=payload.billing_country,
        is_default_shipping=False,
        is_default_billing=bool(payload.save_address and payload.create_account),
    )


async def _create_checkout_addresses(
    session: AsyncSession,
    *,
    payload: CheckoutRequest,
    current_user: User,
    phone: str | None,
) -> tuple[Address, Address]:
    has_billing = _billing_line_present(payload.billing_line1)
    billing_same_as_shipping = not has_billing
    address_user_id = current_user.id if payload.save_address else None
    default_shipping = _default_shipping_flag(
        save_address=bool(payload.save_address),
        explicit_default=payload.default_shipping,
    )
    default_billing = _default_billing_flag(
        save_address=bool(payload.save_address),
        explicit_default=payload.default_billing,
    )
    shipping_addr = await address_service.create_address(
        session,
        address_user_id,
        _checkout_shipping_address_create(
            payload=payload,
            phone=phone,
            default_shipping=default_shipping,
            default_billing=default_billing,
            billing_same_as_shipping=billing_same_as_shipping,
        ),
    )
    if not has_billing:
        return shipping_addr, shipping_addr
    if not _has_complete_billing_address(
        line1=payload.billing_line1,
        city=payload.billing_city,
        postal_code=payload.billing_postal_code,
        country=payload.billing_country,
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=BILLING_ADDRESS_INCOMPLETE_DETAIL)
    billing_addr = await address_service.create_address(
        session,
        address_user_id,
        _checkout_billing_address_create(payload=payload, phone=phone, default_billing=default_billing),
    )
    return shipping_addr, billing_addr


async def _create_guest_checkout_addresses(
    session: AsyncSession,
    *,
    payload: GuestCheckoutRequest,
    user_id: UUID | None,
    phone: str | None,
) -> tuple[Address, Address]:
    has_billing = _billing_line_present(payload.billing_line1)
    billing_same_as_shipping = not has_billing
    shipping_addr = await address_service.create_address(
        session,
        user_id,
        _guest_shipping_address_create(
            payload=payload,
            phone=phone,
            billing_same_as_shipping=billing_same_as_shipping,
        ),
    )
    if not has_billing:
        return shipping_addr, shipping_addr
    if not _has_complete_billing_address(
        line1=payload.billing_line1,
        city=payload.billing_city,
        postal_code=payload.billing_postal_code,
        country=payload.billing_country,
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=BILLING_ADDRESS_INCOMPLETE_DETAIL)
    billing_addr = await address_service.create_address(
        session,
        user_id,
        _guest_billing_address_create(payload=payload, phone=phone),
    )
    return shipping_addr, billing_addr


async def _resolve_checkout_totals(
    session: AsyncSession,
    *,
    cart: Cart,
    shipping_method: Any,
    promo: Any,
    checkout_settings: Any,
    country_code: str | None,
    applied_coupon: Any,
    applied_discount: Any,
) -> tuple[Totals, Decimal]:
    if applied_coupon and applied_discount:
        return applied_discount.totals, applied_discount.discount_ron
    return await cart_service.calculate_totals_async(
        session,
        cart,
        shipping_method=shipping_method,
        promo=promo,
        checkout_settings=checkout_settings,
        country_code=country_code,
    )


async def _initialize_checkout_payment(
    *,
    session: AsyncSession,
    cart: Cart,
    totals: Totals,
    discount_val: Decimal,
    payment_method: str | None,
    base: str,
    lang: str | None,
    customer_email: str,
    user_id: UUID | None,
    promo_code: str | None,
) -> tuple[str, str | None, str | None, str | None, str | None]:
    chosen_payment = payment_method or "stripe"
    stripe_session_id = None
    stripe_checkout_url = None
    paypal_order_id = None
    paypal_approval_url = None
    if chosen_payment == "stripe":
        stripe_line_items = _build_stripe_line_items(cart, totals, lang=lang)
        discount_cents = _money_to_cents(discount_val) if discount_val and discount_val > 0 else None
        stripe_session = await payments.create_checkout_session(
            session=session,
            amount_cents=_money_to_cents(totals.total),
            customer_email=customer_email,
            success_url=f"{base}/checkout/stripe/return?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/checkout/stripe/cancel?session_id={{CHECKOUT_SESSION_ID}}",
            lang=lang,
            metadata={"cart_id": str(cart.id), "user_id": str(user_id) if user_id else ""},
            line_items=stripe_line_items,
            discount_cents=discount_cents,
            promo_code=promo_code,
        )
        stripe_session_id = str(stripe_session.get("session_id"))
        stripe_checkout_url = str(stripe_session.get("checkout_url"))
    elif chosen_payment == "paypal":
        paypal_items = _build_paypal_items(cart, lang=lang)
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
    return chosen_payment, stripe_session_id, stripe_checkout_url, paypal_order_id, paypal_approval_url


@dataclass(frozen=True)
class _CheckoutOrderBuildInput:
    user_id: UUID | None
    customer_email: str
    customer_name: str
    cart: Cart
    shipping_addr: Address
    billing_addr: Address
    shipping_method: Any
    payment_method: str
    stripe_session_id: str | None
    stripe_checkout_url: str | None
    paypal_order_id: str | None
    paypal_approval_url: str | None
    delivery: tuple[str, str, str | None, str | None, str | None, float | None, float | None]
    discount_val: Decimal
    promo_code: str | None
    invoice_company: str | None
    invoice_vat_id: str | None
    totals: Totals


async def _build_checkout_order(
    session: AsyncSession,
    *,
    payload: _CheckoutOrderBuildInput,
) -> Order:
    courier, delivery_type, locker_id, locker_name, locker_address, locker_lat, locker_lng = payload.delivery
    return await order_service.build_order_from_cart(
        session,
        payload.user_id,
        customer_email=payload.customer_email,
        customer_name=payload.customer_name,
        cart=payload.cart,
        shipping_address_id=payload.shipping_addr.id,
        billing_address_id=payload.billing_addr.id,
        shipping_method=payload.shipping_method,
        payment_method=payload.payment_method,
        payment_intent_id=None,
        stripe_checkout_session_id=payload.stripe_session_id,
        stripe_checkout_url=payload.stripe_checkout_url,
        paypal_order_id=payload.paypal_order_id,
        paypal_approval_url=payload.paypal_approval_url,
        courier=courier,
        delivery_type=delivery_type,
        locker_id=locker_id,
        locker_name=locker_name,
        locker_address=locker_address,
        locker_lat=locker_lat,
        locker_lng=locker_lng,
        discount=payload.discount_val,
        promo_code=payload.promo_code,
        invoice_company=payload.invoice_company,
        invoice_vat_id=payload.invoice_vat_id,
        tax_amount=payload.totals.tax,
        fee_amount=payload.totals.fee,
        shipping_amount=payload.totals.shipping,
        total_amount=payload.totals.total,
    )


async def _maybe_start_new_order_netopia_payment(
    session: AsyncSession,
    order: Order,
    *,
    payment_method: str,
    base: str,
    email: str,
    phone: str | None,
    lang: str | None,
    shipping_fallback: Address | None,
    billing_fallback: Address | None,
    commit: bool,
) -> tuple[str | None, str | None]:
    if payment_method != "netopia":
        return None, None
    _assert_netopia_enabled_and_configured()
    started = await _start_netopia_payment_for_order(
        order,
        email=email,
        phone=phone,
        lang=lang,
        base=base,
        shipping_fallback=shipping_fallback,
        billing_fallback=billing_fallback,
    )
    if not started:
        return None, None
    order.netopia_ntp_id, order.netopia_payment_url = started
    session.add(order)
    if commit:
        await session.commit()
        await session.refresh(order)
    return started


async def _add_checkout_consents(
    session: AsyncSession,
    *,
    required_versions: Any,
    user_id: UUID | None,
    order_id: UUID,
    should_add: bool,
    commit: bool,
) -> None:
    if not should_add:
        return
    legal_consents_service.add_consent_records(
        session,
        context=LegalConsentContext.checkout,
        required_versions=required_versions,
        accepted_at=datetime.now(timezone.utc),
        user_id=user_id,
        order_id=order_id,
    )
    if commit:
        await session.commit()


async def _reserve_checkout_coupon(
    session: AsyncSession,
    *,
    current_user: User,
    order: Order,
    applied_coupon: Any,
    discount_val: Decimal,
    coupon_shipping_discount: Decimal,
    payment_method: str,
) -> None:
    if not applied_coupon:
        return
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


async def _create_checkout_notification(
    session: AsyncSession,
    *,
    user_id: UUID,
    preferred_language: str | None,
    order: Order,
) -> None:
    await notification_service.create_notification(
        session,
        user_id=user_id,
        type="order",
        title=_order_placed_title(preferred_language),
        body=_order_reference_body(order),
        url=_account_orders_url(order),
    )


async def _queue_cod_checkout_emails(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    payment_method: str,
    customer_email: str,
    preferred_language: str | None,
    order: Order,
    receipt_share_days: int,
) -> None:
    if (payment_method or "").strip().lower() != "cod":
        return
    background_tasks.add_task(
        email_service.send_order_confirmation,
        customer_email,
        order,
        order.items,
        preferred_language,
        receipt_share_days=receipt_share_days,
    )
    owner = await auth_service.get_owner_user(session)
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if not admin_to:
        return
    background_tasks.add_task(
        email_service.send_new_order_notification,
        admin_to,
        order,
        customer_email,
        owner.preferred_language if owner else None,
    )


def _require_guest_customer_name(payload: GuestCheckoutRequest) -> str:
    customer_name = (payload.name or "").strip()
    if customer_name:
        return customer_name
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")


def _assert_guest_checkout_consents(payload: GuestCheckoutRequest) -> None:
    if payload.accept_terms and payload.accept_privacy:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=LEGAL_CONSENTS_REQUIRED_DETAIL)


def _assert_guest_checkout_no_coupon(payload: GuestCheckoutRequest) -> None:
    if not (payload.promo_code or "").strip():
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sign in to use coupons.")


async def _assert_guest_email_available(session: AsyncSession, email: str) -> None:
    if not await auth_service.is_email_taken(session, email):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=EMAIL_ALREADY_REGISTERED_CHECKOUT_DETAIL,
    )


def _validate_guest_account_creation(payload: GuestCheckoutRequest) -> None:
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


async def _maybe_create_guest_checkout_user(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    payload: GuestCheckoutRequest,
    email: str,
    customer_name: str,
) -> UUID | None:
    if not payload.create_account:
        return None
    _validate_guest_account_creation(payload)
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
    background_tasks.add_task(
        email_service.send_welcome_email,
        user.email,
        first_name=user.first_name,
        lang=user.preferred_language,
    )
    return user.id


@dataclass(frozen=True)
class _CheckoutResolvedInputs:
    shipping_method: Any
    checkout_settings: Any
    delivery: tuple[str, str, str | None, str | None, str | None, float | None, float | None]
    phone: str | None
    promo: Any
    applied_discount: Any
    applied_coupon: Any
    coupon_shipping_discount: Decimal


@dataclass(frozen=True)
class _CheckoutPreparedData:
    order: Order
    checkout_settings: Any
    payment_method: str
    stripe_session_id: str | None
    stripe_checkout_url: str | None
    paypal_order_id: str | None
    paypal_approval_url: str | None
    shipping_addr: Address
    billing_addr: Address
    phone: str | None
    applied_coupon: Any
    discount_val: Decimal
    coupon_shipping_discount: Decimal


@dataclass(frozen=True)
class _CheckoutPaymentData:
    shipping_addr: Address
    billing_addr: Address
    totals: Totals
    discount_val: Decimal
    payment_method: str
    stripe_session_id: str | None
    stripe_checkout_url: str | None
    paypal_order_id: str | None
    paypal_approval_url: str | None


async def _resolve_logged_checkout_inputs(
    session: AsyncSession,
    *,
    payload: CheckoutRequest,
    current_user: User,
    cart: Cart,
) -> _CheckoutResolvedInputs:
    shipping_method = await _resolve_shipping_method_for_create_order(session, payload.shipping_method_id)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    delivery, phone = _resolve_delivery_and_phone(
        cart,
        checkout_settings=checkout_settings,
        courier=payload.courier,
        delivery_type=payload.delivery_type,
        locker_id=payload.locker_id,
        locker_name=payload.locker_name,
        locker_address=payload.locker_address,
        locker_lat=payload.locker_lat,
        locker_lng=payload.locker_lng,
        payload_phone=payload.phone,
        fallback_phone=getattr(current_user, "phone", None),
    )
    promo, applied_discount, applied_coupon, coupon_shipping_discount = await _resolve_logged_checkout_discount(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
        checkout_settings=checkout_settings,
        shipping_method=shipping_method,
    )
    return _CheckoutResolvedInputs(
        shipping_method=shipping_method,
        checkout_settings=checkout_settings,
        delivery=delivery,
        phone=phone,
        promo=promo,
        applied_discount=applied_discount,
        applied_coupon=applied_coupon,
        coupon_shipping_discount=coupon_shipping_discount,
    )


async def _build_logged_checkout_data(
    session: AsyncSession,
    *,
    payload: CheckoutRequest,
    current_user: User,
    cart: Cart,
    base: str,
    resolved: _CheckoutResolvedInputs,
) -> _CheckoutPreparedData:
    payment = await _resolve_logged_checkout_payment_data(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
        base=base,
        resolved=resolved,
    )
    order = await _build_checkout_order(
        session,
        payload=_CheckoutOrderBuildInput(
            user_id=current_user.id,
            customer_email=current_user.email,
            customer_name=getattr(current_user, "name", None) or current_user.email,
            cart=cart,
            shipping_addr=payment.shipping_addr,
            billing_addr=payment.billing_addr,
            shipping_method=resolved.shipping_method,
            payment_method=payment.payment_method,
            stripe_session_id=payment.stripe_session_id,
            stripe_checkout_url=payment.stripe_checkout_url,
            paypal_order_id=payment.paypal_order_id,
            paypal_approval_url=payment.paypal_approval_url,
            delivery=resolved.delivery,
            discount_val=payment.discount_val,
            promo_code=payload.promo_code,
            invoice_company=payload.invoice_company,
            invoice_vat_id=payload.invoice_vat_id,
            totals=payment.totals,
        ),
    )
    return _logged_checkout_prepared_data(order=order, resolved=resolved, payment=payment)


def _logged_checkout_prepared_data(
    *,
    order: Order,
    resolved: _CheckoutResolvedInputs,
    payment: _CheckoutPaymentData,
) -> _CheckoutPreparedData:
    return _CheckoutPreparedData(
        order=order,
        checkout_settings=resolved.checkout_settings,
        payment_method=payment.payment_method,
        stripe_session_id=payment.stripe_session_id,
        stripe_checkout_url=payment.stripe_checkout_url,
        paypal_order_id=payment.paypal_order_id,
        paypal_approval_url=payment.paypal_approval_url,
        shipping_addr=payment.shipping_addr,
        billing_addr=payment.billing_addr,
        phone=resolved.phone,
        applied_coupon=resolved.applied_coupon,
        discount_val=payment.discount_val,
        coupon_shipping_discount=resolved.coupon_shipping_discount,
    )


async def _resolve_logged_checkout_payment_data(
    session: AsyncSession,
    *,
    payload: CheckoutRequest,
    current_user: User,
    cart: Cart,
    base: str,
    resolved: _CheckoutResolvedInputs,
) -> _CheckoutPaymentData:
    shipping_addr, billing_addr = await _create_checkout_addresses(
        session,
        payload=payload,
        current_user=current_user,
        phone=resolved.phone,
    )
    totals, discount_val = await _resolve_checkout_totals(
        session,
        cart=cart,
        shipping_method=resolved.shipping_method,
        promo=resolved.promo,
        checkout_settings=resolved.checkout_settings,
        country_code=shipping_addr.country,
        applied_coupon=resolved.applied_coupon,
        applied_discount=resolved.applied_discount,
    )
    payment_method, stripe_session_id, stripe_checkout_url, paypal_order_id, paypal_approval_url = await _initialize_checkout_payment(
        session=session,
        cart=cart,
        totals=totals,
        discount_val=discount_val,
        payment_method=payload.payment_method,
        base=base,
        lang=current_user.preferred_language,
        customer_email=current_user.email,
        user_id=current_user.id,
        promo_code=payload.promo_code,
    )
    return _CheckoutPaymentData(
        shipping_addr=shipping_addr,
        billing_addr=billing_addr,
        totals=totals,
        discount_val=discount_val,
        payment_method=payment_method,
        stripe_session_id=stripe_session_id,
        stripe_checkout_url=stripe_checkout_url,
        paypal_order_id=paypal_order_id,
        paypal_approval_url=paypal_approval_url,
    )


async def _prepare_logged_checkout_data(
    session: AsyncSession,
    *,
    payload: CheckoutRequest,
    current_user: User,
    cart: Cart,
    base: str,
) -> _CheckoutPreparedData:
    resolved = await _resolve_logged_checkout_inputs(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
    )
    return await _build_logged_checkout_data(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
        base=base,
        resolved=resolved,
    )


async def _run_logged_checkout_side_effects(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    current_user: User,
    required_versions: Any,
    needs_consent: bool,
    prepared: _CheckoutPreparedData,
) -> None:
    await _add_checkout_consents(
        session,
        required_versions=required_versions,
        user_id=current_user.id,
        order_id=prepared.order.id,
        should_add=needs_consent,
        commit=True,
    )
    await _reserve_checkout_coupon(
        session,
        current_user=current_user,
        order=prepared.order,
        applied_coupon=prepared.applied_coupon,
        discount_val=prepared.discount_val,
        coupon_shipping_discount=prepared.coupon_shipping_discount,
        payment_method=prepared.payment_method,
    )
    await _create_checkout_notification(
        session,
        user_id=current_user.id,
        preferred_language=current_user.preferred_language,
        order=prepared.order,
    )
    await _queue_cod_checkout_emails(
        session,
        background_tasks,
        payment_method=prepared.payment_method,
        customer_email=current_user.email,
        preferred_language=current_user.preferred_language,
        order=prepared.order,
        receipt_share_days=prepared.checkout_settings.receipt_share_days,
    )


async def _finalize_logged_checkout(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    current_user: User,
    base: str,
    required_versions: Any,
    needs_consent: bool,
    prepared: _CheckoutPreparedData,
) -> GuestCheckoutResponse:
    netopia_ntp_id, netopia_payment_url = await _maybe_start_new_order_netopia_payment(
        session,
        prepared.order,
        payment_method=prepared.payment_method,
        base=base,
        email=current_user.email,
        phone=prepared.phone,
        lang=current_user.preferred_language,
        shipping_fallback=prepared.shipping_addr,
        billing_fallback=prepared.billing_addr,
        commit=True,
    )
    await _run_logged_checkout_side_effects(
        session,
        background_tasks,
        current_user=current_user,
        required_versions=required_versions,
        needs_consent=needs_consent,
        prepared=prepared,
    )
    return _guest_checkout_response_with_payment(
        order=prepared.order,
        payment_method=prepared.payment_method,
        stripe_session_id=prepared.stripe_session_id,
        stripe_checkout_url=prepared.stripe_checkout_url,
        paypal_order_id=prepared.paypal_order_id,
        paypal_approval_url=prepared.paypal_approval_url,
        netopia_ntp_id=netopia_ntp_id,
        netopia_payment_url=netopia_payment_url,
    )


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=LEGAL_CONSENTS_REQUIRED_DETAIL)
    base = _frontend_base_from_request(request)
    user_cart = await cart_service.get_cart(session, current_user.id, session_id)
    _assert_cart_has_items(user_cart)
    existing_response = await _resolve_existing_checkout_response(
        session,
        cart_id=user_cart.id,
        base=base,
        email=current_user.email,
        phone=getattr(current_user, "phone", None),
        lang=current_user.preferred_language,
    )
    if existing_response:
        response.status_code = status.HTTP_200_OK
        return existing_response
    prepared = await _prepare_logged_checkout_data(
        session,
        payload=payload,
        current_user=current_user,
        cart=user_cart,
        base=base,
    )
    return await _finalize_logged_checkout(
        session,
        background_tasks,
        current_user=current_user,
        base=base,
        required_versions=required_versions,
        needs_consent=needs_consent,
        prepared=prepared,
    )


def _paypal_capture_response(order: Order) -> PayPalCaptureResponse:
    return PayPalCaptureResponse(
        order_id=order.id,
        reference_code=order.reference_code,
        status=order.status,
        paypal_capture_id=order.paypal_capture_id,
    )


def _required_paypal_order_id(paypal_order_id: str | None) -> str:
    value = (paypal_order_id or "").strip()
    if value:
        return value
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PayPal order id is required")


def _assert_paypal_capture_order(order: Order) -> None:
    if (order.payment_method or "").strip().lower() == "paypal":
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order is not a PayPal order")


def _assert_paypal_capture_status(order: Order) -> None:
    if order.status in {OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid}:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order cannot be captured")


async def _resolve_paypal_capture_id(
    payload: PayPalCaptureRequest,
    *,
    paypal_order_id: str,
    mock_mode: bool,
) -> str:
    if not mock_mode:
        return await paypal_service.capture_order(paypal_order_id=paypal_order_id)
    outcome = str(payload.mock or "success").strip().lower()
    if outcome == "decline":
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Payment declined")
    return f"paypal_mock_capture_{secrets.token_hex(8)}"


@router.post("/paypal/capture", response_model=PayPalCaptureResponse)
async def capture_paypal_order(
    payload: PayPalCaptureRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> PayPalCaptureResponse:
    paypal_order_id = _required_paypal_order_id(payload.paypal_order_id)
    order = await _get_order_by_paypal_order_id_for_confirmation(session, paypal_order_id)
    _assert_confirmation_order_match(order, payload.order_id)
    _assert_paypal_capture_order(order)
    _assert_confirmation_access(order, current_user, payload.order_id)
    if order.paypal_capture_id:
        return _paypal_capture_response(order)
    _assert_paypal_capture_status(order)
    capture_id = await _resolve_paypal_capture_id(payload, paypal_order_id=paypal_order_id, mock_mode=is_mock_payments())
    capture_note = f"PayPal {capture_id}".strip()
    order.paypal_capture_id = capture_id or order.paypal_capture_id
    await _finalize_order_after_payment_capture(
        session,
        order,
        note=capture_note,
        add_capture_event=True,
    )
    await coupons_service.redeem_coupon_for_order(session, order=order, note=capture_note)
    await _queue_payment_capture_notifications(
        session,
        background_tasks,
        order,
        include_receipt_share_days=True,
    )
    return _paypal_capture_response(order)


def _payment_confirmation_query(stmt):
    return stmt.options(
        selectinload(Order.user),
        selectinload(Order.items).selectinload(OrderItem.product),
        selectinload(Order.events),
        selectinload(Order.shipping_address),
        selectinload(Order.billing_address),
    )


async def _get_order_by_paypal_order_id_for_confirmation(session: AsyncSession, paypal_order_id: str) -> Order:
    result = await session.execute(
        _payment_confirmation_query(select(Order).where(Order.paypal_order_id == paypal_order_id))
    )
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


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


def _parse_admin_status_filter(raw_status: str | None) -> tuple[bool, OrderStatus | None, list[OrderStatus] | None]:
    status_clean = (raw_status or "").strip().lower()
    if not status_clean:
        return False, None, None
    if status_clean == "pending":
        return True, None, None
    if status_clean == "sales":
        return False, None, [OrderStatus.paid, OrderStatus.shipped, OrderStatus.delivered, OrderStatus.refunded]
    try:
        return False, OrderStatus(status_clean), None
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order status") from exc


def _parse_admin_sla_filter(raw_sla: str | None) -> str | None:
    sla_clean = (raw_sla or "").strip().lower()
    if not sla_clean:
        return None
    if sla_clean in {"accept_overdue", "acceptance_overdue", "overdue_acceptance", "overdue_accept"}:
        return "accept_overdue"
    if sla_clean in {"ship_overdue", "shipping_overdue", "overdue_shipping", "overdue_ship"}:
        return "ship_overdue"
    if sla_clean in {"any_overdue", "overdue", "any"}:
        return "any_overdue"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SLA filter")


def _parse_admin_fraud_filter(raw_fraud: str | None) -> str | None:
    fraud_clean = (raw_fraud or "").strip().lower()
    if not fraud_clean:
        return None
    if fraud_clean in {"queue", "review", "needs_review", "needs-review"}:
        return "queue"
    if fraud_clean in {"flagged", "risk"}:
        return "flagged"
    if fraud_clean in {"approved"}:
        return "approved"
    if fraud_clean in {"denied"}:
        return "denied"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid fraud filter")


def _ensure_utc_datetime(dt: datetime | None) -> datetime | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _admin_order_sla_due(
    *,
    sla_kind: str | None,
    sla_started_at: datetime | None,
    now: datetime,
    accept_hours: int,
    ship_hours: int,
) -> tuple[datetime | None, bool]:
    if not sla_started_at:
        return None, False
    if sla_kind == "accept":
        due_at = sla_started_at + timedelta(hours=accept_hours)
        return due_at, due_at <= now
    if sla_kind == "ship":
        due_at = sla_started_at + timedelta(hours=ship_hours)
        return due_at, due_at <= now
    return None, False


def _admin_order_list_item_from_row(
    row: tuple[Order, str | None, str | None, str | None, datetime | None, Any, Any],
    *,
    include_pii: bool,
    now: datetime,
    accept_hours: int,
    ship_hours: int,
) -> AdminOrderListItem:
    order, email, username, sla_kind, sla_started_at, fraud_flagged, fraud_severity = row
    started_at_utc = _ensure_utc_datetime(sla_started_at)
    sla_due_at, sla_overdue = _admin_order_sla_due(
        sla_kind=sla_kind,
        sla_started_at=started_at_utc,
        now=now,
        accept_hours=accept_hours,
        ship_hours=ship_hours,
    )
    return AdminOrderListItem(
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
        sla_started_at=started_at_utc,
        sla_due_at=sla_due_at,
        sla_overdue=sla_overdue,
        fraud_flagged=bool(fraud_flagged),
        fraud_severity=fraud_severity,
    )


def _admin_order_list_response(
    rows: list[tuple[Order, str | None, str | None, str | None, datetime | None, Any, Any]],
    *,
    include_pii: bool,
    total_items: int,
    page: int,
    limit: int,
) -> AdminOrderListResponse:
    now = datetime.now(timezone.utc)
    accept_hours = max(1, int(getattr(settings, "order_sla_accept_hours", 24) or 24))
    ship_hours = max(1, int(getattr(settings, "order_sla_ship_hours", 48) or 48))
    items = [
        _admin_order_list_item_from_row(
            row,
            include_pii=include_pii,
            now=now,
            accept_hours=accept_hours,
            ship_hours=ship_hours,
        )
        for row in rows
    ]
    total_pages = max(1, (int(total_items) + limit - 1) // limit)
    meta = AdminPaginationMeta(total_items=int(total_items), total_pages=total_pages, page=page, limit=limit)
    return AdminOrderListResponse(items=items, meta=meta)


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
    pending_any, parsed_status, parsed_statuses = _parse_admin_status_filter(status)
    parsed_sla = _parse_admin_sla_filter(sla)
    parsed_fraud = _parse_admin_fraud_filter(fraud)
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
    return _admin_order_list_response(rows, include_pii=include_pii, total_items=total_items, page=page, limit=limit)


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


def _order_attr_as_str(order: Order, attr: str) -> str:
    return str(getattr(order, attr, "") or "")


def _order_attr_iso(order: Order, attr: str) -> str:
    value = getattr(order, attr, None)
    if value:
        return value.isoformat()
    return ""


def _order_status_value(order: Order) -> str:
    return getattr(order.status, "value", str(order.status))


def _order_user_id(order: Order) -> str:
    if order.user_id:
        return str(order.user_id)
    return ""


def _order_shipping_method_name(order: Order) -> str:
    shipping_method = getattr(order, "shipping_method", None)
    return getattr(shipping_method, "name", "") or ""


def _masked_order_export_columns() -> dict[str, Callable[[Order], Any]]:
    return {
        "customer_email": lambda o: pii_service.mask_email(_order_attr_as_str(o, "customer_email")) or "",
        "customer_name": lambda o: pii_service.mask_text(_order_attr_as_str(o, "customer_name"), keep=1) or "",
        "invoice_company": lambda o: pii_service.mask_text(_order_attr_as_str(o, "invoice_company"), keep=1) or "",
        "invoice_vat_id": lambda o: pii_service.mask_text(_order_attr_as_str(o, "invoice_vat_id"), keep=2) or "",
        "locker_address": lambda o: "***" if _order_attr_as_str(o, "locker_address").strip() else "",
    }


def _order_export_allowed_columns(*, include_pii: bool) -> dict[str, Callable[[Order], Any]]:
    allowed: dict[str, Callable[[Order], Any]] = {
        "id": lambda o: str(o.id),
        "reference_code": lambda o: o.reference_code or "",
        "status": _order_status_value,
        "total_amount": lambda o: str(o.total_amount),
        "tax_amount": lambda o: str(o.tax_amount),
        "fee_amount": lambda o: str(getattr(o, "fee_amount", 0) or 0),
        "shipping_amount": lambda o: str(o.shipping_amount),
        "currency": lambda o: o.currency or "",
        "user_id": _order_user_id,
        "customer_email": lambda o: _order_attr_as_str(o, "customer_email"),
        "customer_name": lambda o: _order_attr_as_str(o, "customer_name"),
        "payment_method": lambda o: _order_attr_as_str(o, "payment_method"),
        "promo_code": lambda o: _order_attr_as_str(o, "promo_code"),
        "courier": lambda o: _order_attr_as_str(o, "courier"),
        "delivery_type": lambda o: _order_attr_as_str(o, "delivery_type"),
        "tracking_number": lambda o: _order_attr_as_str(o, "tracking_number"),
        "tracking_url": lambda o: _order_attr_as_str(o, "tracking_url"),
        "invoice_company": lambda o: _order_attr_as_str(o, "invoice_company"),
        "invoice_vat_id": lambda o: _order_attr_as_str(o, "invoice_vat_id"),
        "shipping_method": _order_shipping_method_name,
        "locker_name": lambda o: _order_attr_as_str(o, "locker_name"),
        "locker_address": lambda o: _order_attr_as_str(o, "locker_address"),
        "created_at": lambda o: _order_attr_iso(o, "created_at"),
        "updated_at": lambda o: _order_attr_iso(o, "updated_at"),
    }
    if not include_pii:
        allowed.update(_masked_order_export_columns())
    return allowed


def _selected_export_columns(
    columns: list[str] | None,
    *,
    allowed: dict[str, Callable[[Order], Any]],
) -> list[str]:
    default_columns = ["id", "reference_code", "status", "total_amount", "currency", "user_id", "created_at"]
    if not columns:
        return default_columns
    requested: list[str] = []
    for raw in columns:
        for part in str(raw).split(","):
            cleaned = part.strip()
            if cleaned:
                requested.append(cleaned)
    invalid = [column for column in requested if column not in allowed]
    if not invalid:
        return requested
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid export columns: {', '.join(sorted(set(invalid)))}. Allowed: {', '.join(sorted(allowed.keys()))}",
    )


def _render_orders_csv(
    orders: list[Order],
    *,
    selected_columns: list[str],
    allowed: dict[str, Callable[[Order], Any]],
) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(selected_columns)
    for order in orders:
        writer.writerow([allowed[column](order) for column in selected_columns])
    return buffer.getvalue()


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
    allowed = _order_export_allowed_columns(include_pii=include_pii)
    selected_columns = _selected_export_columns(columns, allowed=allowed)
    csv_text = _render_orders_csv(orders, selected_columns=selected_columns, allowed=allowed)
    headers = {"Content-Disposition": "attachment; filename=orders.csv"}
    return StreamingResponse(iter([csv_text]), media_type="text/csv", headers=headers)


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
    media_type = export.mime_type or mimetypes.guess_type(filename)[0] or DEFAULT_BINARY_MIME_TYPE
    return FileResponse(path, media_type=media_type, filename=filename, headers=headers)


def _masked_admin_address(addr: Address | None) -> dict[str, Any] | None:
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


def _admin_order_base_payload(order: Order, *, include_pii: bool) -> dict[str, Any]:
    base = OrderRead.model_validate(order).model_dump()
    if include_pii:
        return base
    base["invoice_company"] = pii_service.mask_text(base.get("invoice_company"), keep=1)
    base["invoice_vat_id"] = pii_service.mask_text(base.get("invoice_vat_id"), keep=2)
    base["locker_address"] = "***" if (base.get("locker_address") or "").strip() else base.get("locker_address")
    return base


def _admin_order_customer_email(order: Order, *, include_pii: bool) -> str | None:
    customer_email = getattr(order, "customer_email", None) or (
        getattr(order.user, "email", None) if getattr(order, "user", None) else None
    )
    if include_pii:
        return customer_email
    return pii_service.mask_email(customer_email)


def _admin_order_tags(order: Order) -> list[str]:
    return [tag.tag for tag in (getattr(order, "tags", None) or [])]


def _normalized_admin_order_customer_email(order: Order) -> str:
    customer_email = getattr(order, "customer_email", None) or (
        getattr(order.user, "email", None) if getattr(order, "user", None) else None
    )
    return (customer_email or "").strip().lower()


def _admin_order_reference_for_email_filter(order: Order) -> str:
    return ((getattr(order, "reference_code", None) or str(getattr(order, "id", "")) or "").strip()).lower()


def _build_admin_order_email_events_stmt(
    *,
    cleaned_email: str,
    since: datetime,
    limit: int,
    ref_lower: str,
):
    stmt = (
        select(EmailDeliveryEvent)
        .where(EmailDeliveryEvent.created_at >= since)
        .where(func.lower(EmailDeliveryEvent.to_email) == cleaned_email)
        .order_by(EmailDeliveryEvent.created_at.desc())
        .limit(max(1, min(int(limit or 0), 200)))
    )
    if ref_lower:
        stmt = stmt.where(func.lower(EmailDeliveryEvent.subject).like(f"%{ref_lower}%"))
    return stmt


async def _serialize_admin_order(
    session: AsyncSession,
    order: Order,
    *,
    include_pii: bool = False,
    current_user: User | None = None,
) -> AdminOrderRead:
    fraud_signals = await order_service.compute_fraud_signals(session, order)
    base = _admin_order_base_payload(order, include_pii=include_pii)
    return AdminOrderRead(
        **base,
        customer_email=_admin_order_customer_email(order, include_pii=include_pii),
        customer_username=getattr(order.user, "username", None) if getattr(order, "user", None) else None,
        shipping_address=order.shipping_address if include_pii else _masked_admin_address(getattr(order, "shipping_address", None)),
        billing_address=order.billing_address if include_pii else _masked_admin_address(getattr(order, "billing_address", None)),
        tracking_url=getattr(order, "tracking_url", None),
        shipping_label_filename=getattr(order, "shipping_label_filename", None),
        shipping_label_uploaded_at=getattr(order, "shipping_label_uploaded_at", None),
        has_shipping_label=bool(getattr(order, "shipping_label_path", None)),
        refunds=getattr(order, "refunds", []) or [],
        admin_notes=getattr(order, "admin_notes", []) or [],
        tags=_admin_order_tags(order),
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

    cleaned_email = _normalized_admin_order_customer_email(order)
    if not cleaned_email:
        return []

    since = datetime.now(timezone.utc) - timedelta(hours=max(1, int(since_hours or 0)))
    stmt = _build_admin_order_email_events_stmt(
        cleaned_email=cleaned_email,
        since=since,
        limit=limit,
        ref_lower=_admin_order_reference_for_email_filter(order),
    )

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
            detail=EMAIL_ALREADY_REGISTERED_CHECKOUT_DETAIL,
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


def _normalized_cart_guest_email(cart: Cart) -> str:
    return _normalize_email(getattr(cart, "guest_email", None) or "")


def _normalized_guest_email_token(token: str | None) -> str:
    return (token or "").strip()


def _cart_guest_email_token_expiry(cart: Cart) -> datetime | None:
    expires = cart.guest_email_verification_expires_at
    if expires and expires.tzinfo is None:
        return expires.replace(tzinfo=timezone.utc)
    return expires


def _assert_guest_email_token_state(cart: Cart, *, email: str, now: datetime) -> tuple[str, int]:
    if not cart.guest_email or _normalized_cart_guest_email(cart) != email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email mismatch")

    expires = _cart_guest_email_token_expiry(cart)
    stored_token = _normalized_guest_email_token(getattr(cart, "guest_email_verification_token", None))
    if not stored_token or not expires or expires < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    attempts = int(getattr(cart, "guest_email_verification_attempts", 0) or 0)
    if attempts >= GUEST_EMAIL_TOKEN_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts; request a new code.")
    return stored_token, attempts


async def _record_guest_email_token_failure(session: AsyncSession, cart: Cart, *, attempts: int, now: datetime) -> None:
    cart.guest_email_verification_attempts = attempts + 1
    cart.guest_email_verification_last_attempt_at = now
    session.add(cart)
    await session.commit()


async def _mark_guest_email_verified(session: AsyncSession, cart: Cart, *, now: datetime) -> GuestEmailVerificationStatus:
    cart.guest_email_verified_at = now
    cart.guest_email_verification_token = None
    cart.guest_email_verification_expires_at = None
    cart.guest_email_verification_attempts = 0
    cart.guest_email_verification_last_attempt_at = None
    session.add(cart)
    await session.commit()
    await session.refresh(cart)
    return GuestEmailVerificationStatus(email=cart.guest_email, verified=True)


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
    token = _normalized_guest_email_token(payload.token)
    now = datetime.now(timezone.utc)
    stored_token, attempts = _assert_guest_email_token_state(cart, email=email, now=now)

    if stored_token != token:
        await _record_guest_email_token_failure(session, cart, attempts=attempts, now=now)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    return await _mark_guest_email_verified(session, cart, now=now)


@router.get("/guest-checkout/email/status", response_model=GuestEmailVerificationStatus)
async def guest_email_verification_status(
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
) -> GuestEmailVerificationStatus:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")
    cart = await cart_service.get_cart(session, None, session_id)
    return GuestEmailVerificationStatus(email=cart.guest_email, verified=cart.guest_email_verified_at is not None)


def _assert_guest_email_verified_for_checkout(cart: Cart, *, email: str) -> None:
    if cart.guest_email_verified_at and _normalized_cart_guest_email(cart) == email:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email verification required")


@dataclass(frozen=True)
class _GuestCheckoutPreparedData:
    order: Order
    required_versions: Any
    user_id: UUID | None
    checkout_settings: Any
    payment_method: str
    stripe_session_id: str | None
    stripe_checkout_url: str | None
    paypal_order_id: str | None
    paypal_approval_url: str | None
    shipping_addr: Address
    billing_addr: Address
    phone: str | None


@dataclass(frozen=True)
class _GuestCheckoutContext:
    required_versions: Any
    user_id: UUID | None
    customer_name: str
    shipping_method: Any
    checkout_settings: Any
    delivery: tuple[str, str, str | None, str | None, str | None, float | None, float | None]
    phone: str | None
    shipping_addr: Address
    billing_addr: Address


async def _resolve_guest_checkout_context(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    payload: GuestCheckoutRequest,
    cart: Cart,
    email: str,
) -> _GuestCheckoutContext:
    await _assert_guest_email_available(session, email)
    required_versions = await legal_consents_service.required_doc_versions(session)
    _assert_guest_checkout_consents(payload)
    customer_name = _require_guest_customer_name(payload)
    user_id = await _maybe_create_guest_checkout_user(session, background_tasks, payload=payload, email=email, customer_name=customer_name)
    shipping_method = await _resolve_shipping_method_for_create_order(session, payload.shipping_method_id)
    _assert_guest_checkout_no_coupon(payload)
    checkout_settings = await checkout_settings_service.get_checkout_settings(session)
    delivery, phone = _resolve_delivery_and_phone(
        cart,
        checkout_settings=checkout_settings,
        courier=payload.courier,
        delivery_type=payload.delivery_type,
        locker_id=payload.locker_id,
        locker_name=payload.locker_name,
        locker_address=payload.locker_address,
        locker_lat=payload.locker_lat,
        locker_lng=payload.locker_lng,
        payload_phone=payload.phone,
        fallback_phone=None,
    )
    shipping_addr, billing_addr = await _create_guest_checkout_addresses(session, payload=payload, user_id=user_id, phone=phone)
    return _GuestCheckoutContext(
        required_versions=required_versions,
        user_id=user_id,
        customer_name=customer_name,
        shipping_method=shipping_method,
        checkout_settings=checkout_settings,
        delivery=delivery,
        phone=phone,
        shipping_addr=shipping_addr,
        billing_addr=billing_addr,
    )


async def _resolve_guest_checkout_payment_data(
    session: AsyncSession,
    *,
    payload: GuestCheckoutRequest,
    cart: Cart,
    email: str,
    base: str,
    context: _GuestCheckoutContext,
) -> _CheckoutPaymentData:
    totals, discount_val = await _resolve_checkout_totals(
        session,
        cart=cart,
        shipping_method=context.shipping_method,
        promo=None,
        checkout_settings=context.checkout_settings,
        country_code=context.shipping_addr.country,
        applied_coupon=None,
        applied_discount=None,
    )
    payment_method, stripe_session_id, stripe_checkout_url, paypal_order_id, paypal_approval_url = await _initialize_checkout_payment(
        session=session,
        cart=cart,
        totals=totals,
        discount_val=discount_val,
        payment_method=payload.payment_method,
        base=base,
        lang=payload.preferred_language,
        customer_email=email,
        user_id=context.user_id,
        promo_code=None,
    )
    return _CheckoutPaymentData(
        shipping_addr=context.shipping_addr,
        billing_addr=context.billing_addr,
        totals=totals,
        discount_val=discount_val,
        payment_method=payment_method,
        stripe_session_id=stripe_session_id,
        stripe_checkout_url=stripe_checkout_url,
        paypal_order_id=paypal_order_id,
        paypal_approval_url=paypal_approval_url,
    )


def _guest_checkout_prepared_data(
    *,
    order: Order,
    context: _GuestCheckoutContext,
    payment: _CheckoutPaymentData,
) -> _GuestCheckoutPreparedData:
    return _GuestCheckoutPreparedData(
        order=order,
        required_versions=context.required_versions,
        user_id=context.user_id,
        checkout_settings=context.checkout_settings,
        payment_method=payment.payment_method,
        stripe_session_id=payment.stripe_session_id,
        stripe_checkout_url=payment.stripe_checkout_url,
        paypal_order_id=payment.paypal_order_id,
        paypal_approval_url=payment.paypal_approval_url,
        shipping_addr=context.shipping_addr,
        billing_addr=context.billing_addr,
        phone=context.phone,
    )


async def _build_guest_checkout_prepared_data(
    session: AsyncSession,
    *,
    payload: GuestCheckoutRequest,
    cart: Cart,
    email: str,
    base: str,
    context: _GuestCheckoutContext,
) -> _GuestCheckoutPreparedData:
    payment = await _resolve_guest_checkout_payment_data(
        session,
        payload=payload,
        cart=cart,
        email=email,
        base=base,
        context=context,
    )
    order = await _build_checkout_order(
        session,
        payload=_CheckoutOrderBuildInput(
            user_id=context.user_id,
            customer_email=email,
            customer_name=context.customer_name,
            cart=cart,
            shipping_addr=context.shipping_addr,
            billing_addr=context.billing_addr,
            shipping_method=context.shipping_method,
            payment_method=payment.payment_method,
            stripe_session_id=payment.stripe_session_id,
            stripe_checkout_url=payment.stripe_checkout_url,
            paypal_order_id=payment.paypal_order_id,
            paypal_approval_url=payment.paypal_approval_url,
            delivery=context.delivery,
            discount_val=payment.discount_val,
            promo_code=None,
            invoice_company=payload.invoice_company,
            invoice_vat_id=payload.invoice_vat_id,
            totals=payment.totals,
        ),
    )
    return _guest_checkout_prepared_data(order=order, context=context, payment=payment)


async def _prepare_guest_checkout_data(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    payload: GuestCheckoutRequest,
    cart: Cart,
    email: str,
    base: str,
) -> _GuestCheckoutPreparedData:
    context = await _resolve_guest_checkout_context(
        session,
        background_tasks,
        payload=payload,
        cart=cart,
        email=email,
    )
    return await _build_guest_checkout_prepared_data(
        session,
        payload=payload,
        cart=cart,
        email=email,
        base=base,
        context=context,
    )


async def _finalize_guest_checkout(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    *,
    payload: GuestCheckoutRequest,
    email: str,
    base: str,
    prepared: _GuestCheckoutPreparedData,
) -> GuestCheckoutResponse:
    netopia_ntp_id, netopia_payment_url = await _maybe_start_new_order_netopia_payment(
        session,
        prepared.order,
        payment_method=prepared.payment_method,
        base=base,
        email=email,
        phone=prepared.phone,
        lang=payload.preferred_language,
        shipping_fallback=prepared.shipping_addr,
        billing_fallback=prepared.billing_addr,
        commit=False,
    )
    legal_consents_service.add_consent_records(
        session,
        context=LegalConsentContext.checkout,
        required_versions=prepared.required_versions,
        accepted_at=datetime.now(timezone.utc),
        user_id=prepared.user_id,
        order_id=prepared.order.id,
    )
    await session.commit()
    await _queue_cod_checkout_emails(
        session,
        background_tasks,
        payment_method=prepared.payment_method,
        customer_email=email,
        preferred_language=payload.preferred_language,
        order=prepared.order,
        receipt_share_days=prepared.checkout_settings.receipt_share_days,
    )
    return _guest_checkout_response_with_payment(
        order=prepared.order,
        payment_method=prepared.payment_method,
        stripe_session_id=prepared.stripe_session_id,
        stripe_checkout_url=prepared.stripe_checkout_url,
        paypal_order_id=prepared.paypal_order_id,
        paypal_approval_url=prepared.paypal_approval_url,
        netopia_ntp_id=netopia_ntp_id,
        netopia_payment_url=netopia_payment_url,
    )


@router.post("/guest-checkout", status_code=status.HTTP_201_CREATED)
async def guest_checkout(
    payload: GuestCheckoutRequest,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    _: None = Depends(guest_checkout_rate_limit),
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Depends(cart_api.session_header),
) -> GuestCheckoutResponse:
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing guest session id")
    cart = await cart_service.get_cart(session, None, session_id)
    _assert_cart_has_items(cart)
    email = _normalize_email(str(payload.email))
    _assert_guest_email_verified_for_checkout(cart, email=email)
    base = _frontend_base_from_request(request)
    existing_response = await _resolve_existing_checkout_response(
        session,
        cart_id=cart.id,
        base=base,
        email=email,
        phone=None,
        lang=payload.preferred_language,
        cart_row=cart,
    )
    if existing_response:
        response.status_code = status.HTTP_200_OK
        return existing_response
    prepared = await _prepare_guest_checkout_data(
        session,
        background_tasks,
        payload=payload,
        cart=cart,
        email=email,
        base=base,
    )
    return await _finalize_guest_checkout(
        session,
        background_tasks,
        payload=payload,
        email=email,
        base=base,
        prepared=prepared,
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


def _queue_order_processing_email(background_tasks: BackgroundTasks, order: Order) -> None:
    customer_email, customer_lang = _order_customer_contact(order)
    if customer_email:
        background_tasks.add_task(email_service.send_order_processing_update, customer_email, order, lang=customer_lang)


def _queue_order_cancelled_email(background_tasks: BackgroundTasks, order: Order) -> None:
    customer_email, customer_lang = _order_customer_contact(order)
    if customer_email:
        background_tasks.add_task(email_service.send_order_cancelled_update, customer_email, order, lang=customer_lang)


async def _notify_user_order_processing(session: AsyncSession, order: Order) -> None:
    if not (order.user and order.user.id):
        return
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title="Order processing" if (order.user.preferred_language or "en") != "ro" else "Comandă în procesare",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


async def _notify_user_order_cancelled(session: AsyncSession, order: Order) -> None:
    if not (order.user and order.user.id):
        return
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title="Order cancelled" if (order.user.preferred_language or "en") != "ro" else "Comandă anulată",
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


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

    rel_path, original_name = await _save_shipping_label_upload(file, order_id=order_id)
    old_path = _apply_shipping_label_upload(order, rel_path=rel_path, original_name=original_name)
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="shipping_label_uploaded", note=order.shipping_label_filename))
    await session.commit()

    await _create_shipping_label_export_record(
        session,
        order=order,
        rel_path=rel_path,
        fallback_name=original_name,
        created_by_user_id=getattr(admin, "id", None),
    )

    if old_path and old_path != rel_path:
        private_storage.delete_private_file(old_path)

    full = await _load_admin_order_or_404(session, order_id)
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
    event = _shipping_label_event_name(action)
    note = _shipping_label_event_note(admin, filename)
    session.add(OrderEvent(order_id=order.id, event=event, note=note))
    await session.commit()
    media_type = mimetypes.guess_type(filename)[0] or DEFAULT_BINARY_MIME_TYPE
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


def _normalize_optional_note(note: str | None) -> str | None:
    note_clean = (note or "").strip()
    return note_clean or None


def _queue_order_refunded_email(background_tasks: BackgroundTasks, order: Order) -> None:
    customer_to, customer_lang = _order_customer_contact(order)
    if not customer_to:
        return
    background_tasks.add_task(email_service.send_order_refunded_update, customer_to, order, lang=customer_lang)


async def _notify_user_order_refunded(session: AsyncSession, order: Order) -> None:
    if not (order.user and order.user.id):
        return
    title = "Comandă rambursată" if (order.user.preferred_language or "en") == "ro" else "Order refunded"
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title=title,
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


def _refund_admin_customer_email(order: Order) -> str | None:
    return getattr(order, "customer_email", None) or (order.user.email if order.user and order.user.email else None)


def _queue_admin_refund_requested_email(
    background_tasks: BackgroundTasks,
    owner: User | None,
    order: Order,
    admin_user: object,
    *,
    note: str | None,
) -> None:
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if not admin_to:
        return
    background_tasks.add_task(
        email_service.send_refund_requested_notification,
        admin_to,
        order,
        customer_email=_refund_admin_customer_email(order),
        requested_by_email=getattr(admin_user, "email", None),
        note=note,
        lang=owner.preferred_language if owner else None,
    )


def _admin_refund_items(payload: AdminOrderRefundCreate) -> list[tuple[UUID, int]]:
    return [(row.order_item_id, int(row.quantity)) for row in (payload.items or [])]


def _admin_refund_actor_label(admin_user: object) -> str:
    return (getattr(admin_user, "email", None) or getattr(admin_user, "username", None) or "admin").strip()


def _latest_order_refund_record(order: Order):
    refunds = getattr(order, "refunds", None) or []
    return refunds[-1] if refunds else None


def _queue_partial_refund_customer_email(
    background_tasks: BackgroundTasks,
    order: Order,
    refund_record: object,
) -> None:
    customer_to, customer_lang = _order_customer_contact(order)
    if customer_to:
        background_tasks.add_task(email_service.send_order_partial_refund_update, customer_to, order, refund_record, lang=customer_lang)


async def _notify_partial_refund_user(session: AsyncSession, order: Order, refund_record: object) -> None:
    if not (order.user and order.user.id):
        return
    amount = getattr(refund_record, "amount", None)
    currency = getattr(order, "currency", None) or "RON"
    body = f"{amount} {currency}" if amount is not None else None
    await notification_service.create_notification(
        session,
        user_id=order.user.id,
        type="order",
        title="Partial refund issued" if (order.user.preferred_language or "en") != "ro" else "Rambursare parțială",
        body=body,
        url="/account/orders",
    )


async def _post_create_order_refund_side_effects(
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    updated: Order,
) -> None:
    if updated.status == OrderStatus.refunded:
        await coupons_service.release_coupon_for_order(session, order=updated, reason="refunded")

    refund_record = _latest_order_refund_record(updated)
    if not refund_record:
        return

    _queue_partial_refund_customer_email(background_tasks, updated, refund_record)
    await _notify_partial_refund_user(session, updated, refund_record)


@router.post("/admin/{order_id}/refund", response_model=OrderRead)
async def admin_refund_order(
    background_tasks: BackgroundTasks,
    order_id: UUID,
    request: Request,
    payload: AdminOrderRefundRequest = Body(...),
    session: AsyncSession = Depends(get_session),
    admin_user=Depends(require_admin),
):
    note = _normalize_optional_note(payload.note)
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    updated = await order_service.refund_order(session, order, note=note)
    await coupons_service.release_coupon_for_order(session, order=updated, reason="refunded")
    _queue_order_refunded_email(background_tasks, updated)
    await _notify_user_order_refunded(session, updated)
    owner = await auth_service.get_owner_user(session)
    _queue_admin_refund_requested_email(background_tasks, owner, updated, admin_user, note=note)
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

    updated = await order_service.create_order_refund(
        session,
        order,
        amount=payload.amount,
        note=payload.note,
        items=_admin_refund_items(payload),
        process_payment=bool(payload.process_payment),
        actor=_admin_refund_actor_label(admin_user),
    )
    await _post_create_order_refund_side_effects(session, background_tasks, updated)
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
    to_email = _resolve_order_contact_email(order)
    if not to_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order customer email missing")
    event_note = _order_email_event_note(admin, payload.note)
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
    to_email = _resolve_order_contact_email(order)
    if not to_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order customer email missing")
    event_note = _order_email_event_note(admin, payload.note)
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
    ids = _normalize_batch_order_ids(payload.order_ids, max_selected=50)
    ordered = await _load_order_batch_or_404(
        session,
        ids,
        load_options=(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.user),
            selectinload(Order.shipping_address),
            selectinload(Order.billing_address),
        ),
    )
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
    ids = _normalize_batch_order_ids(payload.order_ids, max_selected=100)
    ordered = await _load_order_batch_or_404(
        session,
        ids,
        load_options=(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.items).selectinload(OrderItem.variant),
        ),
    )
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
    ids = _normalize_batch_order_ids(payload.order_ids, max_selected=100)
    ordered = await _load_order_batch_or_404(
        session,
        ids,
        load_options=(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.items).selectinload(OrderItem.variant),
        ),
    )
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
    ids = _normalize_batch_order_ids(payload.order_ids, max_selected=50)
    ordered = await _load_order_batch_or_404(session, ids)
    files, missing_labels = _collect_batch_shipping_label_files(ordered)
    _raise_for_missing_shipping_labels(missing_labels)
    buf = _build_shipping_labels_zip_buffer(files)
    await _log_batch_shipping_label_downloads(session, files, admin)
    headers = {
        "Content-Disposition": 'attachment; filename="shipping-labels.zip"',
        "Cache-Control": "no-store",
    }
    return StreamingResponse(_iter_bytes_buffer(buf), media_type="application/zip", headers=headers)


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
    _queue_order_processing_email(background_tasks, updated)
    await _notify_user_order_processing(session, updated)
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
    _queue_order_cancelled_email(background_tasks, updated)
    await _notify_user_order_cancelled(session, updated)
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
    order = await _load_receipt_order_from_token(session, token)
    allow_full = _allow_receipt_full_details(order, current_user, reveal=reveal)
    return receipt_service.build_order_receipt(order, order.items, redacted=not allow_full)


@router.get("/receipt/{token}/pdf")
async def download_receipt_by_token(
    token: str,
    reveal: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
):
    order = await _load_receipt_order_from_token(session, token)
    allow_full = _allow_receipt_full_details(order, current_user, reveal=reveal)
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
    _require_receipt_share_access(order, current_user)
    return await _build_receipt_share_token_read(session, order)


@router.post("/{order_id}/receipt/revoke", response_model=ReceiptShareTokenRead)
async def revoke_receipt_share_token(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> ReceiptShareTokenRead:
    order = await order_service.get_order_by_id(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    _require_receipt_share_access(order, current_user)

    order.receipt_token_version = int(getattr(order, "receipt_token_version", 0) or 0) + 1
    session.add(order)
    session.add(OrderEvent(order_id=order.id, event="receipt_token_revoked", note=f"v{order.receipt_token_version}"))
    await session.commit()
    await session.refresh(order)
    return await _build_receipt_share_token_read(session, order)


def _validate_cancel_request_eligibility(order: Order) -> None:
    if OrderStatus(order.status) not in CANCEL_REQUEST_ELIGIBLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel request not eligible")


def _require_cancel_request_reason(payload: OrderCancelRequest) -> str:
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cancel reason is required")
    return reason


def _ensure_cancel_request_not_duplicate(order: Order) -> None:
    if any(getattr(evt, "event", None) == "cancel_requested" for evt in (order.events or [])):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cancel request already exists")


def _cancel_request_owner_title(owner: User) -> str:
    return "Cerere anulare" if _owner_prefers_romanian(owner) else "Cancel request"


def _cancel_request_owner_body(order: Order, owner: User) -> str:
    if _owner_prefers_romanian(owner):
        return f"Cerere de anulare pentru comanda {order.reference_code or order.id}."
    return f"Order {order.reference_code or order.id} cancellation requested."


async def _notify_owner_cancel_request(session: AsyncSession, owner: User | None, order: Order) -> None:
    if not (owner and owner.id):
        return
    await notification_service.create_notification(
        session,
        user_id=owner.id,
        type="admin",
        title=_cancel_request_owner_title(owner),
        body=_cancel_request_owner_body(order, owner),
        url=f"/admin/orders/{order.id}",
    )


def _queue_admin_cancel_request_email(
    background_tasks: BackgroundTasks,
    owner: User | None,
    order: Order,
    *,
    requested_by_email: str | None,
    reason: str,
) -> None:
    admin_to = (owner.email if owner and owner.email else None) or settings.admin_alert_email
    if not admin_to:
        return
    background_tasks.add_task(
        email_service.send_order_cancel_request_notification,
        admin_to,
        order,
        requested_by_email=requested_by_email,
        reason=reason,
        lang=owner.preferred_language if owner else None,
    )


async def _notify_user_cancel_requested(session: AsyncSession, current_user: object, order: Order) -> None:
    title = "Anulare solicitată" if (getattr(current_user, "preferred_language", None) or "en") == "ro" else "Cancel requested"
    await notification_service.create_notification(
        session,
        user_id=current_user.id,
        type="order",
        title=title,
        body=f"Reference {order.reference_code}" if order.reference_code else None,
        url=_account_orders_url(order),
    )


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

    _validate_cancel_request_eligibility(order)
    reason = _require_cancel_request_reason(payload)
    _ensure_cancel_request_not_duplicate(order)

    session.add(OrderEvent(order_id=order.id, event="cancel_requested", note=reason[:2000]))
    await session.commit()
    await session.refresh(order, attribute_names=["events"])

    owner = await auth_service.get_owner_user(session)
    await _notify_owner_cancel_request(session, owner, order)
    _queue_admin_cancel_request_email(
        background_tasks,
        owner,
        order,
        requested_by_email=getattr(current_user, "email", None),
        reason=reason,
    )
    await _notify_user_cancel_requested(session, current_user, order)

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
