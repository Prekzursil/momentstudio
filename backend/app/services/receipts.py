from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Sequence, SupportsFloat, SupportsIndex, cast
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.config import settings
from app.schemas.receipt import ReceiptAddressRead, ReceiptItemRead, ReceiptRead, ReceiptRefundRead
from app.services.font_utils import load_font as _load_font


MoneyValue = str | SupportsFloat | SupportsIndex
RasterFont = ImageFont.ImageFont | ImageFont.FreeTypeFont | ImageFont.TransposedFont
_REPORTLAB_FONTS: tuple[str, str] | None = None


def _order_locale(order) -> str:
    preferred = (getattr(getattr(order, "user", None), "preferred_language", None) or "").strip().lower()
    if preferred in {"en", "ro"}:
        return preferred

    currency = (getattr(order, "currency", None) or "").strip().upper()
    if currency == "RON":
        return "ro"

    country = (getattr(getattr(order, "shipping_address", None), "country", None) or "").strip().upper()
    if country == "RO":
        return "ro"

    return "en"


def _mask_email(email: str) -> str:
    cleaned = (email or "").strip()
    if "@" not in cleaned:
        return "••••••"
    local, _, domain = cleaned.partition("@")
    local = local.strip()
    domain = domain.strip()
    if not local or not domain:
        return "••••••"
    prefix = local[0]
    return f"{prefix}***@{domain}"


def _mask_text(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return "••••••"
    if len(cleaned) <= 1:
        return "•"
    return cleaned[0] + "•" * (len(cleaned) - 1)


def _as_decimal(value: object | None) -> Decimal:
    if value is None:
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0.00")


def _clean_text(value: object | None) -> str:
    return str(value or "").strip()


def _clean_optional_text(value: object | None) -> str | None:
    cleaned = _clean_text(value)
    return cleaned or None


def _attr_text(obj, name: str) -> str:
    return _clean_text(getattr(obj, name, None))


def _attr_optional_text(obj, name: str) -> str | None:
    return _clean_optional_text(getattr(obj, name, None))


def _join_non_empty(parts: Sequence[str], *, separator: str) -> str:
    return separator.join([part for part in parts if part])


def _all_present(values: Sequence[str]) -> bool:
    return all(values)


def _build_receipt_address(addr, *, redacted: bool) -> ReceiptAddressRead | None:
    if not addr:
        return None
    line1 = _attr_text(addr, "line1")
    city = _attr_text(addr, "city")
    postal_code = _attr_text(addr, "postal_code")
    country = _attr_text(addr, "country")
    if not _all_present([line1, city, postal_code, country]):
        return None
    line2 = _attr_optional_text(addr, "line2")
    if redacted:
        line1 = "••••••"
        postal_code = "•••••"
        line2 = None
    return ReceiptAddressRead(
        line1=line1,
        line2=line2,
        city=city,
        region=_attr_optional_text(addr, "region"),
        postal_code=postal_code,
        country=country,
    )


def _build_receipt_items(items: Sequence, *, frontend_origin: str) -> list[ReceiptItemRead]:
    receipt_items: list[ReceiptItemRead] = []
    for item in items:
        product = getattr(item, "product", None)
        slug = (getattr(product, "slug", None) or "").strip() or None
        name = (getattr(product, "name", None) or "").strip() or str(getattr(item, "product_id", ""))
        product_url = f"{frontend_origin}/products/{slug}" if slug else None
        receipt_items.append(
            ReceiptItemRead(
                product_id=getattr(item, "product_id"),
                slug=slug,
                name=name,
                quantity=int(getattr(item, "quantity", 0) or 0),
                unit_price=_as_decimal(getattr(item, "unit_price", None)),
                subtotal=_as_decimal(getattr(item, "subtotal", None)),
                product_url=product_url,
            )
        )
    return receipt_items


def _refund_currency(refund, *, currency: str) -> str:
    return _attr_text(refund, "currency") or currency


def _refund_provider(refund) -> str:
    return _attr_text(refund, "provider") or "manual"


def _refund_note(refund) -> str | None:
    return _attr_optional_text(refund, "note")


def _build_receipt_refunds(order, *, currency: str) -> list[ReceiptRefundRead]:
    receipt_refunds: list[ReceiptRefundRead] = []
    for refund in getattr(order, "refunds", []) or []:
        receipt_refunds.append(
            ReceiptRefundRead(
                amount=_as_decimal(getattr(refund, "amount", None)),
                currency=_refund_currency(refund, currency=currency),
                provider=_refund_provider(refund),
                note=_refund_note(refund),
                created_at=getattr(refund, "created_at", datetime.now(timezone.utc)),
            )
        )
    return receipt_refunds


def _receipt_customer_invoice_fields(order, *, redacted: bool) -> tuple[str | None, str | None, str | None, str | None]:
    customer_email = _attr_optional_text(order, "customer_email")
    customer_name = _attr_optional_text(order, "customer_name")
    invoice_company = _attr_optional_text(order, "invoice_company")
    invoice_vat_id = _attr_optional_text(order, "invoice_vat_id")
    if not redacted:
        return customer_email, customer_name, invoice_company, invoice_vat_id
    masked_name = _mask_text(customer_name or "") if customer_name else None
    return _mask_email(customer_email or ""), masked_name, None, None


def build_order_receipt(order, items: Sequence | None = None, *, redacted: bool = False) -> ReceiptRead:
    items = items or getattr(order, "items", []) or []
    currency = getattr(order, "currency", "RON") or "RON"
    frontend_origin = settings.frontend_origin.rstrip("/")
    receipt_items = _build_receipt_items(items, frontend_origin=frontend_origin)
    receipt_refunds = _build_receipt_refunds(order, currency=currency)

    created_at = getattr(order, "created_at", datetime.now(timezone.utc))
    status_raw = getattr(order, "status", "")
    status_value = getattr(status_raw, "value", status_raw) or ""
    customer_email, customer_name, invoice_company, invoice_vat_id = _receipt_customer_invoice_fields(
        order, redacted=redacted
    )

    return ReceiptRead(
        order_id=getattr(order, "id"),
        reference_code=getattr(order, "reference_code", None),
        status=str(status_value),
        created_at=created_at,
        currency=currency,
        payment_method=getattr(order, "payment_method", None),
        courier=getattr(order, "courier", None),
        delivery_type=getattr(order, "delivery_type", None),
        locker_name=getattr(order, "locker_name", None),
        locker_address=getattr(order, "locker_address", None),
        tracking_number=getattr(order, "tracking_number", None),
        customer_email=customer_email,
        customer_name=customer_name,
        invoice_company=invoice_company,
        invoice_vat_id=invoice_vat_id,
        pii_redacted=redacted,
        shipping_amount=_as_decimal(getattr(order, "shipping_amount", None)),
        tax_amount=_as_decimal(getattr(order, "tax_amount", None)),
        fee_amount=_as_decimal(getattr(order, "fee_amount", None)),
        total_amount=_as_decimal(getattr(order, "total_amount", None)),
        shipping_address=_build_receipt_address(getattr(order, "shipping_address", None), redacted=redacted),
        billing_address=_build_receipt_address(getattr(order, "billing_address", None), redacted=redacted),
        items=receipt_items,
        refunds=receipt_refunds,
    )


def _first_existing_path(candidates: Sequence[str]) -> str | None:
    return next((path for path in candidates if Path(path).exists()), None)


def _reportlab_font_paths() -> tuple[str | None, str | None]:
    regular_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    ]
    bold_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    ]
    regular_path = _first_existing_path(regular_candidates)
    bold_path = _first_existing_path(bold_candidates) or regular_path
    if regular_path is None and bold_path is not None:
        regular_path = bold_path
    return regular_path, bold_path


def _register_font_if_missing(font_name: str, font_path: str, registered: set[str]) -> None:
    if font_name not in registered:
        pdfmetrics.registerFont(TTFont(font_name, font_path))


def _register_reportlab_fonts() -> tuple[str, str]:
    global _REPORTLAB_FONTS
    if _REPORTLAB_FONTS is not None:
        return _REPORTLAB_FONTS

    regular_path, bold_path = _reportlab_font_paths()
    if regular_path and bold_path:
        registered = set(pdfmetrics.getRegisteredFontNames())
        _register_font_if_missing("MomentSans", regular_path, registered)
        _register_font_if_missing("MomentSansBold", bold_path, registered)
        pdfmetrics.registerFontFamily(
            "MomentSans",
            normal="MomentSans",
            bold="MomentSansBold",
            italic="MomentSans",
            boldItalic="MomentSansBold",
        )
        _REPORTLAB_FONTS = ("MomentSans", "MomentSansBold")
        return _REPORTLAB_FONTS

    _REPORTLAB_FONTS = ("Helvetica", "Helvetica-Bold")
    return _REPORTLAB_FONTS


def _payment_method_bilingual_label(payment_method: str) -> str:
    value = (payment_method or "").strip().lower()
    if not value:
        return ""
    if value == "stripe":
        return "Stripe"
    if value == "paypal":
        return "PayPal"
    if value == "netopia":
        return "Netopia"
    if value == "cod":
        return "Cash / Numerar"
    return value.upper()


def _reportlab_styles(font_regular: str, font_bold: str) -> tuple[ParagraphStyle, ParagraphStyle, ParagraphStyle, ParagraphStyle, ParagraphStyle]:
    styles = getSampleStyleSheet()
    base_style = ParagraphStyle(
        "base",
        parent=styles["Normal"],
        fontName=font_regular,
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#0f172a"),
    )
    small_muted = ParagraphStyle(
        "muted",
        parent=base_style,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#475569"),
    )
    h1 = ParagraphStyle("h1", parent=base_style, fontName=font_bold, fontSize=18, leading=22)
    h2 = ParagraphStyle(
        "h2",
        parent=base_style,
        fontName=font_bold,
        fontSize=11,
        leading=14,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=6,
        spaceAfter=4,
    )
    header_style = ParagraphStyle("tableHeader", parent=small_muted, fontName=font_bold, textColor=colors.HexColor("#475569"))
    return base_style, small_muted, h1, h2, header_style


def _reportlab_doc(receipt: ReceiptRead) -> tuple[io.BytesIO, SimpleDocTemplate]:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Receipt {receipt.reference_code or receipt.order_id}",
    )
    return buf, doc


def _reportlab_address_lines(addr: ReceiptAddressRead | None) -> str:
    if not addr:
        return "—"
    parts = [addr.line1, addr.line2 or "", f"{addr.postal_code} {addr.city}", addr.region or "", addr.country]
    safe = [xml_escape(part) for part in parts if part]
    return "<br/>".join(safe) if safe else "—"


def _append_reportlab_header(
    story: list[object],
    receipt: ReceiptRead,
    *,
    base_style: ParagraphStyle,
    small_muted: ParagraphStyle,
    h1: ParagraphStyle,
    locale: str,
) -> None:
    story.append(Paragraph("Receipt / Chitanță", h1))
    story.append(Spacer(1, 6))
    ref = receipt.reference_code or str(receipt.order_id)
    created = _format_date(receipt.created_at, locale=locale)
    story.append(Paragraph(f"Order / Comandă: <b>{xml_escape(ref)}</b>", base_style))
    story.append(Paragraph(f"Date / Dată: {xml_escape(created)}", small_muted))
    story.append(Spacer(1, 10))


def _append_reportlab_customer(
    story: list[object], receipt: ReceiptRead, *, base_style: ParagraphStyle, small_muted: ParagraphStyle, h2: ParagraphStyle
) -> None:
    if not (receipt.customer_name or receipt.customer_email):
        return
    story.append(Paragraph("Customer / Client", h2))
    if receipt.customer_name:
        story.append(Paragraph(xml_escape(receipt.customer_name), base_style))
    if receipt.customer_email:
        story.append(Paragraph(xml_escape(receipt.customer_email), small_muted))
    story.append(Spacer(1, 8))


def _reportlab_addresses_table(receipt: ReceiptRead, *, base_style: ParagraphStyle, doc: SimpleDocTemplate) -> Table:
    table = Table(
        [
            [
                Paragraph("<b>Shipping / Livrare</b><br/>" + _reportlab_address_lines(receipt.shipping_address), base_style),
                Paragraph("<b>Billing / Facturare</b><br/>" + _reportlab_address_lines(receipt.billing_address), base_style),
            ]
        ],
        colWidths=[(doc.width - 12) / 2, (doc.width - 12) / 2],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#e2e8f0")),
                ("INNERGRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#e2e8f0")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _append_reportlab_addresses(
    story: list[object], receipt: ReceiptRead, *, base_style: ParagraphStyle, h2: ParagraphStyle, doc: SimpleDocTemplate
) -> None:
    if not (receipt.shipping_address or receipt.billing_address):
        return
    story.append(Paragraph("Addresses / Adrese", h2))
    story.append(_reportlab_addresses_table(receipt, base_style=base_style, doc=doc))
    story.append(Spacer(1, 10))


def _append_reportlab_invoice(story: list[object], receipt: ReceiptRead, *, base_style: ParagraphStyle, h2: ParagraphStyle) -> None:
    if not (receipt.invoice_company or receipt.invoice_vat_id):
        return
    story.append(Paragraph("Invoice / Factură", h2))
    if receipt.invoice_company:
        story.append(Paragraph(f"Company / Firmă: {xml_escape(receipt.invoice_company)}", base_style))
    if receipt.invoice_vat_id:
        story.append(Paragraph(f"VAT ID / CUI: {xml_escape(receipt.invoice_vat_id)}", base_style))
    story.append(Spacer(1, 8))


def _reportlab_payment_info_line(receipt: ReceiptRead) -> str | None:
    if not receipt.payment_method:
        return None
    label = _payment_method_bilingual_label(receipt.payment_method)
    return f"Payment / Plată: {xml_escape(label)}"


def _reportlab_delivery_info_line(receipt: ReceiptRead) -> str | None:
    detail = _join_non_empty([part for part in [receipt.courier, receipt.delivery_type] if part], separator=" · ")
    if not detail:
        return None
    return f"Delivery / Livrare: {xml_escape(detail)}"


def _reportlab_locker_info_line(receipt: ReceiptRead) -> str | None:
    if receipt.delivery_type != "locker":
        return None
    locker = _join_non_empty([part for part in [receipt.locker_name, receipt.locker_address] if part], separator=" — ")
    if not locker:
        return None
    return f"Locker: {xml_escape(locker)}"


def _reportlab_tracking_info_line(receipt: ReceiptRead) -> str | None:
    if not receipt.tracking_number:
        return None
    return f"AWB / Tracking: {xml_escape(receipt.tracking_number)}"


def _reportlab_info_lines(receipt: ReceiptRead) -> list[str]:
    candidates = [
        _reportlab_payment_info_line(receipt),
        _reportlab_delivery_info_line(receipt),
        _reportlab_locker_info_line(receipt),
        _reportlab_tracking_info_line(receipt),
    ]
    return [line for line in candidates if line]


def _append_reportlab_info(story: list[object], receipt: ReceiptRead, *, small_muted: ParagraphStyle) -> None:
    info_lines = _reportlab_info_lines(receipt)
    if not info_lines:
        return
    story.append(Paragraph("<br/>".join(info_lines), small_muted))
    story.append(Spacer(1, 10))


def _reportlab_money_cell(value: MoneyValue | None, *, currency: str, locale: str) -> str:
    if value is None:
        return "—"
    return xml_escape(_money(value, currency, locale=locale))


def _reportlab_item_rows(
    receipt: ReceiptRead, *, base_style: ParagraphStyle, header_style: ParagraphStyle, locale: str
) -> list[list[object]]:
    rows: list[list[object]] = [
        [Paragraph("Product / Produs", header_style), Paragraph("Qty", header_style), Paragraph("Unit", header_style), Paragraph("Total", header_style)]
    ]
    for item in receipt.items:
        name = xml_escape(item.name)
        if item.product_url:
            link = xml_escape(item.product_url)
            name = f'<font color="#4f46e5"><link href="{link}">{name}</link></font>'
        rows.append(
            [
                Paragraph(name, base_style),
                Paragraph(str(item.quantity), base_style),
                Paragraph(_reportlab_money_cell(item.unit_price, currency=receipt.currency, locale=locale), base_style),
                Paragraph(_reportlab_money_cell(item.subtotal, currency=receipt.currency, locale=locale), base_style),
            ]
        )
    return rows


def _reportlab_items_table(rows: list[list[object]], *, doc: SimpleDocTemplate) -> Table:
    table = Table(rows, colWidths=[doc.width * 0.55, doc.width * 0.10, doc.width * 0.17, doc.width * 0.18])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#e2e8f0")),
                ("LINEABOVE", (0, 1), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("ALIGN", (1, 1), (1, -1), "RIGHT"),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("ALIGN", (3, 1), (3, -1), "RIGHT"),
            ]
        )
    )
    return table


def _append_reportlab_items(
    story: list[object],
    receipt: ReceiptRead,
    *,
    base_style: ParagraphStyle,
    h2: ParagraphStyle,
    header_style: ParagraphStyle,
    doc: SimpleDocTemplate,
    locale: str,
) -> None:
    story.append(Paragraph("Items / Produse", h2))
    rows = _reportlab_item_rows(receipt, base_style=base_style, header_style=header_style, locale=locale)
    story.append(_reportlab_items_table(rows, doc=doc))
    story.append(Spacer(1, 12))


def _reportlab_totals_rows(
    receipt: ReceiptRead, *, base_style: ParagraphStyle, small_muted: ParagraphStyle, locale: str
) -> list[list[object]]:
    rows: list[list[object]] = [
        [
            Paragraph("Shipping / Livrare", small_muted),
            Paragraph(_reportlab_money_cell(receipt.shipping_amount or Decimal("0.00"), currency=receipt.currency, locale=locale), base_style),
        ]
    ]
    if receipt.fee_amount and receipt.fee_amount != 0:
        rows.append(
            [
                Paragraph("Additional / Cost supl.", small_muted),
                Paragraph(_reportlab_money_cell(receipt.fee_amount, currency=receipt.currency, locale=locale), base_style),
            ]
        )
    rows.append(
        [
            Paragraph("VAT / TVA", small_muted),
            Paragraph(_reportlab_money_cell(receipt.tax_amount or Decimal("0.00"), currency=receipt.currency, locale=locale), base_style),
        ]
    )
    rows.append(
        [
            Paragraph("<b>Total / Total</b>", base_style),
            Paragraph(
                f"<b>{_reportlab_money_cell(receipt.total_amount or Decimal('0.00'), currency=receipt.currency, locale=locale)}</b>",
                base_style,
            ),
        ]
    )
    return rows


def _append_reportlab_totals(
    story: list[object], receipt: ReceiptRead, *, base_style: ParagraphStyle, small_muted: ParagraphStyle, doc: SimpleDocTemplate, locale: str
) -> None:
    totals_rows = _reportlab_totals_rows(receipt, base_style=base_style, small_muted=small_muted, locale=locale)
    totals = Table(totals_rows, colWidths=[doc.width * 0.75, doc.width * 0.25])
    totals.setStyle(TableStyle([("ALIGN", (1, 0), (1, -1), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story.append(totals)


def _append_reportlab_refunds(
    story: list[object],
    receipt: ReceiptRead,
    *,
    base_style: ParagraphStyle,
    small_muted: ParagraphStyle,
    h2: ParagraphStyle,
    locale: str,
) -> None:
    if not receipt.refunds:
        return
    story.append(Spacer(1, 10))
    story.append(Paragraph("Refunds / Rambursări", h2))
    for refund in receipt.refunds:
        amount = _money(refund.amount, receipt.currency, locale=locale)
        created_at = _format_date(refund.created_at, locale=locale)
        provider = (refund.provider or "").strip()
        summary = f"{xml_escape(created_at)} — {xml_escape(amount)}"
        if provider:
            summary = f"{summary} ({xml_escape(provider)})"
        story.append(Paragraph(summary, base_style))
        if refund.note:
            story.append(Paragraph(xml_escape(refund.note), small_muted))
        story.append(Spacer(1, 4))


def _render_order_receipt_pdf_reportlab(order, items: Sequence | None = None, *, redacted: bool = False) -> bytes:
    """Render a bilingual (RO/EN) receipt PDF with clickable product links."""

    items = items or getattr(order, "items", []) or []
    locale = _order_locale(order)
    receipt = build_order_receipt(order, items, redacted=redacted)

    font_regular, font_bold = _register_reportlab_fonts()
    base_style, small_muted, h1, h2, header_style = _reportlab_styles(font_regular, font_bold)
    buf, doc = _reportlab_doc(receipt)
    story: list[object] = []
    _append_reportlab_header(story, receipt, base_style=base_style, small_muted=small_muted, h1=h1, locale=locale)
    _append_reportlab_customer(story, receipt, base_style=base_style, small_muted=small_muted, h2=h2)
    _append_reportlab_addresses(story, receipt, base_style=base_style, h2=h2, doc=doc)
    _append_reportlab_invoice(story, receipt, base_style=base_style, h2=h2)
    _append_reportlab_info(story, receipt, small_muted=small_muted)
    _append_reportlab_items(story, receipt, base_style=base_style, h2=h2, header_style=header_style, doc=doc, locale=locale)
    _append_reportlab_totals(story, receipt, base_style=base_style, small_muted=small_muted, doc=doc, locale=locale)
    _append_reportlab_refunds(story, receipt, base_style=base_style, small_muted=small_muted, h2=h2, locale=locale)
    story.append(Spacer(1, 10))
    story.append(Paragraph("Thank you! / Mulțumim!", small_muted))
    doc.build(story)
    return buf.getvalue()


def _money(value: MoneyValue, currency: str, *, locale: str | None = None) -> str:
    try:
        normalized = "ro" if (locale or "").strip().lower() == "ro" else "en"
        amount = value if isinstance(value, Decimal) else Decimal(str(value))
        rendered = format(amount.quantize(Decimal("0.01")), ".2f")
        if normalized == "ro":
            rendered = rendered.replace(".", ",")
        return f"{rendered} {currency}"
    except Exception:
        return f"{value} {currency}"


def _format_date(value: object, *, locale: str | None = None) -> str:
    if isinstance(value, datetime):
        normalized = "ro" if (locale or "").strip().lower() == "ro" else "en"
        try:
            if normalized == "ro":
                return value.strftime("%d.%m.%Y %H:%M")
            return value.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return str(value)
    return str(value)


def render_order_receipt_pdf(order, items: Sequence | None = None, *, redacted: bool = False) -> bytes:
    try:
        return _render_order_receipt_pdf_reportlab(order, items, redacted=redacted)
    except Exception:
        # Fallback to the legacy raster implementation for maximum resilience.
        return render_order_receipt_pdf_raster(order, items, redacted=redacted)


@dataclass(frozen=True)
class _RasterCtx:
    draw: ImageDraw.ImageDraw
    page_w: int
    page_h: int
    margin: int
    fg: tuple[int, int, int]
    muted: tuple[int, int, int]
    border: tuple[int, int, int]
    title_font: RasterFont
    h_font: RasterFont
    b_font: RasterFont
    small_font: RasterFont
    currency: str
    locale: str


def _raster_address_lines(addr, *, redacted: bool) -> list[str]:
    if not addr:
        return []
    line1 = _attr_text(addr, "line1")
    line2 = _attr_text(addr, "line2")
    postal_code = _attr_text(addr, "postal_code")
    city = _attr_text(addr, "city")
    if redacted and (line1 or postal_code):
        line1 = "••••••"
        line2 = ""
        postal_code = "•••••"
    city_line = _join_non_empty([postal_code, city], separator=" ")
    region = _attr_text(addr, "region")
    country = _attr_text(addr, "country")
    return [part for part in [line1, line2, city_line, region, country] if part]


def _draw_raster_header(ctx: _RasterCtx, *, ref: str, created_at: object) -> int:
    y = ctx.margin
    ctx.draw.text((ctx.margin, y), "Receipt / Chitanță", fill=ctx.fg, font=ctx.title_font)
    y += 58
    ctx.draw.text((ctx.margin, y), f"Order / Comandă: {ref}", fill=ctx.fg, font=ctx.h_font)
    y += 30
    if created_at:
        rendered_date = _format_date(created_at, locale=ctx.locale)
        ctx.draw.text((ctx.margin, y), f"Date / Dată: {rendered_date}", fill=ctx.muted, font=ctx.small_font)
        y += 26
    ctx.draw.line((ctx.margin, y + 14, ctx.page_w - ctx.margin, y + 14), fill=ctx.border, width=2)
    return y + 40


def _draw_raster_customer(ctx: _RasterCtx, *, y: int, customer_name: str, customer_email: str) -> int:
    if not (customer_name or customer_email):
        return y
    ctx.draw.text((ctx.margin, y), "Customer / Client", fill=ctx.fg, font=ctx.h_font)
    y += 26
    if customer_name:
        ctx.draw.text((ctx.margin, y), customer_name, fill=ctx.fg, font=ctx.b_font)
        y += 22
    if customer_email:
        ctx.draw.text((ctx.margin, y), customer_email, fill=ctx.muted, font=ctx.small_font)
        y += 22
    return y + 10


def _draw_raster_addresses(ctx: _RasterCtx, *, y: int, ship_addr, bill_addr, redacted: bool) -> int:
    if not (ship_addr or bill_addr):
        return y
    ctx.draw.text((ctx.margin, y), "Addresses / Adrese", fill=ctx.fg, font=ctx.h_font)
    y += 26
    box_w = (ctx.page_w - ctx.margin * 2 - 24) // 2
    box_h = 170
    box_y = y
    entries = [("Shipping / Livrare", ship_addr), ("Billing / Facturare", bill_addr)]
    for index, (label, address) in enumerate(entries):
        x0 = ctx.margin + index * (box_w + 24)
        ctx.draw.rounded_rectangle((x0, box_y, x0 + box_w, box_y + box_h), radius=18, outline=ctx.border, width=2)
        ctx.draw.text((x0 + 18, box_y + 14), label, fill=ctx.muted, font=ctx.small_font)
        ay = box_y + 44
        for line in _raster_address_lines(address, redacted=redacted)[:6]:
            ctx.draw.text((x0 + 18, ay), line, fill=ctx.fg, font=ctx.small_font)
            ay += 22
    return y + box_h + 22


def _draw_raster_invoice(ctx: _RasterCtx, *, y: int, invoice_company: str, invoice_vat_id: str) -> int:
    if not (invoice_company or invoice_vat_id):
        return y
    ctx.draw.text((ctx.margin, y), "Invoice / Factură", fill=ctx.fg, font=ctx.h_font)
    y += 26
    if invoice_company:
        ctx.draw.text((ctx.margin, y), f"Company / Firmă: {invoice_company}", fill=ctx.fg, font=ctx.small_font)
        y += 22
    if invoice_vat_id:
        ctx.draw.text((ctx.margin, y), f"VAT ID / CUI: {invoice_vat_id}", fill=ctx.fg, font=ctx.small_font)
        y += 22
    return y + 10


def _wrap_raster_product_name(ctx: _RasterCtx, *, name: str, max_name_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in name.split():
        candidate = f"{current} {word}".strip()
        bbox = ctx.draw.textbbox((0, 0), candidate, font=ctx.small_font)
        if bbox[2] - bbox[0] <= max_name_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines or [name]


def _draw_raster_item_row(ctx: _RasterCtx, *, y: int, item, max_name_width: int) -> int:
    product = getattr(item, "product", None)
    name = _attr_text(product, "name") or str(getattr(item, "product_id", ""))
    name = name.strip() or "—"
    qty = int(getattr(item, "quantity", 0) or 0)
    unit_price = getattr(item, "unit_price", None)
    subtotal = getattr(item, "subtotal", None)
    wrapped_name = _wrap_raster_product_name(ctx, name=name, max_name_width=max_name_width)
    ctx.draw.text((ctx.margin, y), wrapped_name[0], fill=ctx.fg, font=ctx.small_font)
    ctx.draw.text((ctx.page_w - ctx.margin - 240, y), str(qty), fill=ctx.fg, font=ctx.small_font)
    if unit_price is not None:
        unit_label = _money(unit_price, ctx.currency, locale=ctx.locale)
        ctx.draw.text((ctx.page_w - ctx.margin - 170, y), unit_label, fill=ctx.fg, font=ctx.small_font)
    if subtotal is not None:
        total_label = _money(subtotal, ctx.currency, locale=ctx.locale)
        ctx.draw.text((ctx.page_w - ctx.margin - 70, y), total_label, fill=ctx.fg, font=ctx.small_font, anchor="ra")
    y += 22
    for extra in wrapped_name[1:3]:
        ctx.draw.text((ctx.margin, y), extra, fill=ctx.fg, font=ctx.small_font)
        y += 22
    return y + 6


def _draw_raster_items(ctx: _RasterCtx, *, y: int, items: Sequence) -> int:
    ctx.draw.text((ctx.margin, y), "Items / Produse", fill=ctx.fg, font=ctx.h_font)
    y += 26
    ctx.draw.text((ctx.margin, y), "Product / Produs", fill=ctx.muted, font=ctx.small_font)
    ctx.draw.text((ctx.page_w - ctx.margin - 240, y), "Qty", fill=ctx.muted, font=ctx.small_font)
    ctx.draw.text((ctx.page_w - ctx.margin - 170, y), "Unit", fill=ctx.muted, font=ctx.small_font)
    ctx.draw.text((ctx.page_w - ctx.margin - 70, y), "Total", fill=ctx.muted, font=ctx.small_font, anchor="ra")
    y += 16
    ctx.draw.line((ctx.margin, y + 10, ctx.page_w - ctx.margin, y + 10), fill=ctx.border, width=2)
    y += 24
    max_name_width = ctx.page_w - ctx.margin * 2 - 270
    for item in items[:30]:
        y = _draw_raster_item_row(ctx, y=y, item=item, max_name_width=max_name_width)
        if y > ctx.page_h - 320:
            break
    y += 6
    ctx.draw.line((ctx.margin, y, ctx.page_w - ctx.margin, y), fill=ctx.border, width=2)
    return y + 24


def _draw_raster_right_value(ctx: _RasterCtx, *, y: int, label: str, value: MoneyValue) -> int:
    ctx.draw.text((ctx.page_w - ctx.margin - 240, y), label, fill=ctx.muted, font=ctx.small_font)
    value_label = _money(value, ctx.currency, locale=ctx.locale)
    ctx.draw.text((ctx.page_w - ctx.margin - 70, y), value_label, fill=ctx.fg, font=ctx.small_font, anchor="ra")
    return y + 22


def _draw_raster_totals(ctx: _RasterCtx, *, y: int, order) -> int:
    total_lines: list[tuple[str, MoneyValue]] = []
    shipping_amount = getattr(order, "shipping_amount", None)
    fee_amount = getattr(order, "fee_amount", None)
    tax_amount = getattr(order, "tax_amount", None)
    total_amount = getattr(order, "total_amount", None)
    if shipping_amount is not None:
        total_lines.append(("Shipping / Livrare", shipping_amount))
    if fee_amount is not None and Decimal(str(fee_amount or 0)) != 0:
        total_lines.append(("Additional / Cost supl.", fee_amount))
    if tax_amount is not None:
        total_lines.append(("VAT / TVA", tax_amount))
    for label, value in total_lines:
        y = _draw_raster_right_value(ctx, y=y, label=label, value=value)
    if total_amount is None:
        return y
    ctx.draw.text((ctx.page_w - ctx.margin - 240, y), "Total / Total", fill=ctx.fg, font=ctx.h_font)
    total_label = _money(total_amount, ctx.currency, locale=ctx.locale)
    ctx.draw.text((ctx.page_w - ctx.margin - 70, y + 2), total_label, fill=ctx.fg, font=ctx.h_font, anchor="ra")
    return y + 30


def _draw_raster_refund_entry(ctx: _RasterCtx, *, y: int, refund) -> int:
    amount = _money(getattr(refund, "amount", 0), ctx.currency, locale=ctx.locale)
    created = _format_date(getattr(refund, "created_at", None), locale=ctx.locale)
    provider = _attr_text(refund, "provider")
    line = f"{created} · {amount}"
    if provider:
        line = f"{line} ({provider})"
    ctx.draw.text((ctx.margin, y), line, fill=ctx.muted, font=ctx.small_font)
    y += 20
    note = _attr_text(refund, "note")
    if note:
        ctx.draw.text((ctx.margin, y), note[:120], fill=ctx.fg, font=ctx.small_font)
        y += 22
    return y


def _draw_raster_refunds(ctx: _RasterCtx, *, y: int, order) -> int:
    refunds = list(getattr(order, "refunds", []) or [])
    if not refunds:
        return y
    y += 10
    ctx.draw.text((ctx.margin, y), "Refunds / Rambursări", fill=ctx.fg, font=ctx.h_font)
    y += 24
    for refund in refunds[-5:]:
        y = _draw_raster_refund_entry(ctx, y=y, refund=refund)
        if y > ctx.page_h - 220:
            break
    return y


def _draw_raster_delivery_info(ctx: _RasterCtx, *, y: int, order) -> int:
    y += 10
    payment_method = _attr_text(order, "payment_method")
    if payment_method:
        line = f"Payment / Plată: {_payment_method_bilingual_label(payment_method)}"
        ctx.draw.text((ctx.margin, y), line, fill=ctx.muted, font=ctx.small_font)
        y += 22
    courier = _attr_text(order, "courier")
    delivery_type = _attr_text(order, "delivery_type")
    delivery_line = _join_non_empty([courier, delivery_type], separator=" · ")
    if delivery_line:
        ctx.draw.text((ctx.margin, y), f"Delivery / Livrare: {delivery_line}", fill=ctx.muted, font=ctx.small_font)
        y += 22
    if delivery_type.lower() != "locker":
        return y
    locker_line = _join_non_empty([_attr_text(order, "locker_name"), _attr_text(order, "locker_address")], separator=" — ")
    if locker_line:
        ctx.draw.text((ctx.margin, y), f"Locker: {locker_line}", fill=ctx.muted, font=ctx.small_font)
        y += 22
    return y


def _raster_order_values(order, items: Sequence | None) -> tuple[Sequence, str, str, object, str]:
    resolved_items = items or getattr(order, "items", []) or []
    locale = _order_locale(order)
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    created_at = getattr(order, "created_at", None)
    currency = getattr(order, "currency", "RON") or "RON"
    return resolved_items, locale, ref, created_at, currency


def _raster_style_values() -> tuple[int, int, int, tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    return 1240, 1754, 84, (15, 23, 42), (71, 85, 105), (226, 232, 240)


def _raster_customer_values(order, *, redacted: bool) -> tuple[str, str]:
    customer_email = _attr_text(order, "customer_email")
    customer_name = _attr_text(order, "customer_name")
    if redacted:
        customer_email = _mask_email(customer_email) if customer_email else ""
        customer_name = _mask_text(customer_name) if customer_name else ""
    return customer_name, customer_email


def _raster_invoice_values(order, *, redacted: bool) -> tuple[str, str]:
    invoice_company = _attr_text(order, "invoice_company")
    invoice_vat_id = _attr_text(order, "invoice_vat_id")
    if redacted:
        return "", ""
    return invoice_company, invoice_vat_id


def render_order_receipt_pdf_raster(order, items: Sequence | None = None, *, redacted: bool = False) -> bytes:
    """Legacy receipt renderer (PDF-embedded raster image).

    Kept as a fallback in case the PDF engine/font stack fails.
    """

    items, locale, ref, created_at, currency = _raster_order_values(order, items)
    page_w, page_h, margin, fg, muted, border = _raster_style_values()  # ~A4 @ 150dpi
    img = Image.new("RGB", (page_w, page_h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    title_font = cast(RasterFont, _load_font(44, bold=True))
    h_font = cast(RasterFont, _load_font(18, bold=True))
    b_font = cast(RasterFont, _load_font(16, bold=False))
    small_font = cast(RasterFont, _load_font(14, bold=False))
    ctx = _RasterCtx(
        draw=draw,
        page_w=page_w,
        page_h=page_h,
        margin=margin,
        fg=fg,
        muted=muted,
        border=border,
        title_font=title_font,
        h_font=h_font,
        b_font=b_font,
        small_font=small_font,
        currency=currency,
        locale=locale,
    )
    y = _draw_raster_header(ctx, ref=ref, created_at=created_at)
    customer_name, customer_email = _raster_customer_values(order, redacted=redacted)
    y = _draw_raster_customer(ctx, y=y, customer_name=customer_name, customer_email=customer_email)
    ship_addr = getattr(order, "shipping_address", None)
    bill_addr = getattr(order, "billing_address", None)
    y = _draw_raster_addresses(ctx, y=y, ship_addr=ship_addr, bill_addr=bill_addr, redacted=redacted)
    invoice_company, invoice_vat_id = _raster_invoice_values(order, redacted=redacted)
    y = _draw_raster_invoice(ctx, y=y, invoice_company=invoice_company, invoice_vat_id=invoice_vat_id)
    y = _draw_raster_items(ctx, y=y, items=items)
    y = _draw_raster_totals(ctx, y=y, order=order)
    y = _draw_raster_refunds(ctx, y=y, order=order)
    y = _draw_raster_delivery_info(ctx, y=y, order=order)
    y = max(y, page_h - margin - 50)
    draw.text((margin, y), "Thank you! / Mulțumim!", fill=muted, font=small_font)

    buf = io.BytesIO()
    img.save(buf, format="PDF")
    return buf.getvalue()
