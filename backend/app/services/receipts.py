from __future__ import annotations

import io
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Sequence, SupportsFloat, SupportsIndex
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageDraw
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


def build_order_receipt(order, items: Sequence | None = None, *, redacted: bool = False) -> ReceiptRead:
    items = items or getattr(order, "items", []) or []
    currency = getattr(order, "currency", "RON") or "RON"
    frontend_origin = settings.frontend_origin.rstrip("/")

    def _addr(addr) -> ReceiptAddressRead | None:
        if not addr:
            return None
        line1 = (getattr(addr, "line1", None) or "").strip()
        city = (getattr(addr, "city", None) or "").strip()
        postal_code = (getattr(addr, "postal_code", None) or "").strip()
        country = (getattr(addr, "country", None) or "").strip()
        if not line1 or not city or not postal_code or not country:
            return None
        if redacted:
            line1 = "••••••"
            postal_code = "•••••"
            line2 = None
        else:
            line2 = (getattr(addr, "line2", None) or "").strip() or None
        return ReceiptAddressRead(
            line1=line1,
            line2=line2,
            city=city,
            region=(getattr(addr, "region", None) or "").strip() or None,
            postal_code=postal_code,
            country=country,
        )

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

    receipt_refunds: list[ReceiptRefundRead] = []
    for refund in getattr(order, "refunds", []) or []:
        receipt_refunds.append(
            ReceiptRefundRead(
                amount=_as_decimal(getattr(refund, "amount", None)),
                currency=(getattr(refund, "currency", None) or currency) or currency,
                provider=(getattr(refund, "provider", None) or "").strip() or "manual",
                note=(getattr(refund, "note", None) or "").strip() or None,
                created_at=getattr(refund, "created_at", datetime.now(timezone.utc)),
            )
        )

    created_at = getattr(order, "created_at", datetime.now(timezone.utc))
    status_raw = getattr(order, "status", "")
    status_value = getattr(status_raw, "value", status_raw) or ""
    customer_email = (getattr(order, "customer_email", None) or "").strip() or None
    customer_name = (getattr(order, "customer_name", None) or "").strip() or None
    invoice_company = (getattr(order, "invoice_company", None) or "").strip() or None
    invoice_vat_id = (getattr(order, "invoice_vat_id", None) or "").strip() or None
    if redacted:
        customer_email = _mask_email(customer_email or "")
        customer_name = _mask_text(customer_name or "") if customer_name else None
        invoice_company = None
        invoice_vat_id = None

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
        shipping_address=_addr(getattr(order, "shipping_address", None)),
        billing_address=_addr(getattr(order, "billing_address", None)),
        items=receipt_items,
        refunds=receipt_refunds,
    )


def _register_reportlab_fonts() -> tuple[str, str]:
    global _REPORTLAB_FONTS
    if _REPORTLAB_FONTS is not None:
        return _REPORTLAB_FONTS

    regular_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    ]
    bold_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    ]

    regular_path = next((p for p in regular_candidates if Path(p).exists()), None)
    bold_path = next((p for p in bold_candidates if Path(p).exists()), None) or regular_path
    if regular_path is None and bold_path is not None:
        regular_path = bold_path

    if regular_path and bold_path:
        registered = set(pdfmetrics.getRegisteredFontNames())
        if "MomentSans" not in registered:
            pdfmetrics.registerFont(TTFont("MomentSans", regular_path))
        if "MomentSansBold" not in registered:
            pdfmetrics.registerFont(TTFont("MomentSansBold", bold_path))
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


def _render_order_receipt_pdf_reportlab(order, items: Sequence | None = None, *, redacted: bool = False) -> bytes:
    """Render a bilingual (RO/EN) receipt PDF with clickable product links."""

    items = items or getattr(order, "items", []) or []
    locale = _order_locale(order)
    receipt = build_order_receipt(order, items, redacted=redacted)

    font_regular, font_bold = _register_reportlab_fonts()
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
    h1 = ParagraphStyle(
        "h1",
        parent=base_style,
        fontName=font_bold,
        fontSize=18,
        leading=22,
    )
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

    story: list[object] = []

    story.append(Paragraph("Receipt / Chitanță", h1))
    story.append(Spacer(1, 6))
    ref = receipt.reference_code or str(receipt.order_id)
    created = _format_date(receipt.created_at, locale=locale)
    story.append(Paragraph(f"Order / Comandă: <b>{xml_escape(ref)}</b>", base_style))
    story.append(Paragraph(f"Date / Dată: {xml_escape(created)}", small_muted))
    story.append(Spacer(1, 10))

    if receipt.customer_name or receipt.customer_email:
        story.append(Paragraph("Customer / Client", h2))
        if receipt.customer_name:
            story.append(Paragraph(xml_escape(receipt.customer_name), base_style))
        if receipt.customer_email:
            story.append(Paragraph(xml_escape(receipt.customer_email), small_muted))
        story.append(Spacer(1, 8))

    if receipt.shipping_address or receipt.billing_address:
        story.append(Paragraph("Addresses / Adrese", h2))

        def _addr_lines(addr: ReceiptAddressRead | None) -> str:
            if not addr:
                return "—"
            parts = [
                addr.line1,
                addr.line2 or "",
                f"{addr.postal_code} {addr.city}",
                addr.region or "",
                addr.country,
            ]
            safe = [xml_escape(p) for p in parts if p]
            return "<br/>".join(safe) if safe else "—"

        addr_table = Table(
            [
                [
                    Paragraph("<b>Shipping / Livrare</b><br/>" + _addr_lines(receipt.shipping_address), base_style),
                    Paragraph("<b>Billing / Facturare</b><br/>" + _addr_lines(receipt.billing_address), base_style),
                ]
            ],
            colWidths=[(doc.width - 12) / 2, (doc.width - 12) / 2],
        )
        addr_table.setStyle(
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
        story.append(addr_table)
        story.append(Spacer(1, 10))

    if receipt.invoice_company or receipt.invoice_vat_id:
        story.append(Paragraph("Invoice / Factură", h2))
        if receipt.invoice_company:
            story.append(Paragraph(f"Company / Firmă: {xml_escape(receipt.invoice_company)}", base_style))
        if receipt.invoice_vat_id:
            story.append(Paragraph(f"VAT ID / CUI: {xml_escape(receipt.invoice_vat_id)}", base_style))
        story.append(Spacer(1, 8))

    # Payment / delivery info
    info_lines: list[str] = []
    if receipt.payment_method:
        info_lines.append(f"Payment / Plată: {xml_escape(_payment_method_bilingual_label(receipt.payment_method))}")
    if receipt.courier or receipt.delivery_type:
        detail = " · ".join([x for x in [receipt.courier, receipt.delivery_type] if x])
        info_lines.append(f"Delivery / Livrare: {xml_escape(detail)}")
    if receipt.delivery_type == "locker" and (receipt.locker_name or receipt.locker_address):
        locker_detail = " — ".join([x for x in [receipt.locker_name, receipt.locker_address] if x])
        info_lines.append(f"Locker: {xml_escape(locker_detail)}")
    if receipt.tracking_number:
        info_lines.append(f"AWB / Tracking: {xml_escape(receipt.tracking_number)}")
    if info_lines:
        story.append(Paragraph("<br/>".join(info_lines), small_muted))
        story.append(Spacer(1, 10))

    story.append(Paragraph("Items / Produse", h2))

    header_style = ParagraphStyle(
        "tableHeader",
        parent=small_muted,
        fontName=font_bold,
        textColor=colors.HexColor("#475569"),
    )

    def _money_cell(value: MoneyValue | None) -> str:
        if value is None:
            return "—"
        return xml_escape(_money(value, receipt.currency, locale=locale))

    rows: list[list[object]] = [
        [
            Paragraph("Product / Produs", header_style),
            Paragraph("Qty", header_style),
            Paragraph("Unit", header_style),
            Paragraph("Total", header_style),
        ]
    ]

    for it in receipt.items:
        name = xml_escape(it.name)
        if it.product_url:
            link = xml_escape(it.product_url)
            name = f'<font color="#4f46e5"><link href="{link}">{name}</link></font>'
        rows.append(
            [
                Paragraph(name, base_style),
                Paragraph(str(it.quantity), base_style),
                Paragraph(_money_cell(it.unit_price), base_style),
                Paragraph(_money_cell(it.subtotal), base_style),
            ]
        )

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
    story.append(table)
    story.append(Spacer(1, 12))

    # Totals
    totals_rows: list[list[object]] = []
    totals_rows.append(
        [
            Paragraph("Shipping / Livrare", small_muted),
            Paragraph(_money_cell(receipt.shipping_amount or Decimal("0.00")), base_style),
        ]
    )
    if receipt.fee_amount and receipt.fee_amount != 0:
        totals_rows.append(
            [
                Paragraph("Additional / Cost supl.", small_muted),
                Paragraph(_money_cell(receipt.fee_amount), base_style),
            ]
        )
    totals_rows.append(
        [
            Paragraph("VAT / TVA", small_muted),
            Paragraph(_money_cell(receipt.tax_amount or Decimal("0.00")), base_style),
        ]
    )
    totals_rows.append(
        [
            Paragraph("<b>Total / Total</b>", base_style),
            Paragraph(f"<b>{_money_cell(receipt.total_amount or Decimal('0.00'))}</b>", base_style),
        ]
    )
    totals = Table(totals_rows, colWidths=[doc.width * 0.75, doc.width * 0.25])
    totals.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(totals)

    if receipt.refunds:
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


def render_order_receipt_pdf_raster(order, items: Sequence | None = None, *, redacted: bool = False) -> bytes:
    """Legacy receipt renderer (PDF-embedded raster image).

    Kept as a fallback in case the PDF engine/font stack fails.
    """

    items = items or getattr(order, "items", []) or []
    locale = _order_locale(order)
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    created_at = getattr(order, "created_at", None)
    currency = getattr(order, "currency", "RON") or "RON"

    page_w, page_h = 1240, 1754  # ~A4 @ 150dpi
    margin = 84
    bg = (255, 255, 255)
    fg = (15, 23, 42)  # slate-900-ish
    muted = (71, 85, 105)  # slate-600-ish
    border = (226, 232, 240)  # slate-200-ish

    img = Image.new("RGB", (page_w, page_h), bg)
    draw = ImageDraw.Draw(img)

    title_font = _load_font(44, bold=True)
    h_font = _load_font(18, bold=True)
    b_font = _load_font(16, bold=False)
    small_font = _load_font(14, bold=False)

    y = margin
    draw.text((margin, y), "Receipt / Chitanță", fill=fg, font=title_font)
    y += 58
    draw.text((margin, y), f"Order / Comandă: {ref}", fill=fg, font=h_font)
    y += 30
    if created_at:
        draw.text((margin, y), f"Date / Dată: {_format_date(created_at, locale=locale)}", fill=muted, font=small_font)
        y += 26
    draw.line((margin, y + 14, page_w - margin, y + 14), fill=border, width=2)
    y += 40

    customer_email = (getattr(order, "customer_email", None) or "").strip()
    customer_name = (getattr(order, "customer_name", None) or "").strip()
    if redacted:
        customer_email = _mask_email(customer_email) if customer_email else ""
        customer_name = _mask_text(customer_name) if customer_name else ""
    if customer_name or customer_email:
        draw.text((margin, y), "Customer / Client", fill=fg, font=h_font)
        y += 26
        if customer_name:
            draw.text((margin, y), customer_name, fill=fg, font=b_font)
            y += 22
        if customer_email:
            draw.text((margin, y), customer_email, fill=muted, font=small_font)
            y += 22
        y += 10

    def _address_lines(addr) -> list[str]:
        if not addr:
            return []
        line1 = (getattr(addr, "line1", None) or "").strip()
        line2 = (getattr(addr, "line2", None) or "").strip()
        postal_code = (getattr(addr, "postal_code", None) or "").strip()
        city = (getattr(addr, "city", None) or "").strip()
        if redacted and (line1 or postal_code):
            line1 = "••••••"
            line2 = ""
            postal_code = "•••••"
        parts = [
            line1,
            line2,
            " ".join(
                [
                    postal_code,
                    city,
                ]
            ).strip(),
            (getattr(addr, "region", None) or "").strip(),
            (getattr(addr, "country", None) or "").strip(),
        ]
        return [p for p in parts if p]

    ship_addr = getattr(order, "shipping_address", None)
    bill_addr = getattr(order, "billing_address", None)

    if ship_addr or bill_addr:
        draw.text((margin, y), "Addresses / Adrese", fill=fg, font=h_font)
        y += 26

        box_w = (page_w - margin * 2 - 24) // 2
        box_h = 170
        box_y = y
        for idx, (label, addr) in enumerate(
            [
                ("Shipping / Livrare", ship_addr),
                ("Billing / Facturare", bill_addr),
            ]
        ):
            x0 = margin + idx * (box_w + 24)
            draw.rounded_rectangle((x0, box_y, x0 + box_w, box_y + box_h), radius=18, outline=border, width=2)
            draw.text((x0 + 18, box_y + 14), label, fill=muted, font=small_font)
            ay = box_y + 44
            for line in _address_lines(addr)[:6]:
                draw.text((x0 + 18, ay), line, fill=fg, font=small_font)
                ay += 22
        y += box_h + 22

    invoice_company = (getattr(order, "invoice_company", None) or "").strip()
    invoice_vat_id = (getattr(order, "invoice_vat_id", None) or "").strip()
    if redacted:
        invoice_company = ""
        invoice_vat_id = ""
    if invoice_company or invoice_vat_id:
        draw.text((margin, y), "Invoice / Factură", fill=fg, font=h_font)
        y += 26
        if invoice_company:
            draw.text((margin, y), f"Company / Firmă: {invoice_company}", fill=fg, font=small_font)
            y += 22
        if invoice_vat_id:
            draw.text((margin, y), f"VAT ID / CUI: {invoice_vat_id}", fill=fg, font=small_font)
            y += 22
        y += 10

    draw.text((margin, y), "Items / Produse", fill=fg, font=h_font)
    y += 26

    # Table-ish header
    draw.text((margin, y), "Product / Produs", fill=muted, font=small_font)
    draw.text((page_w - margin - 240, y), "Qty", fill=muted, font=small_font)
    draw.text((page_w - margin - 170, y), "Unit", fill=muted, font=small_font)
    draw.text((page_w - margin - 70, y), "Total", fill=muted, font=small_font, anchor="ra")
    y += 16
    draw.line((margin, y + 10, page_w - margin, y + 10), fill=border, width=2)
    y += 24

    for item in items[:30]:
        product = getattr(item, "product", None)
        name = (getattr(product, "name", None) or str(getattr(item, "product_id", ""))).strip() or "—"
        qty = int(getattr(item, "quantity", 0) or 0)
        unit_price = getattr(item, "unit_price", None)
        subtotal = getattr(item, "subtotal", None)

        # Wrap product name if needed.
        max_name_width = page_w - margin * 2 - 270
        name_lines: list[str] = []
        current = ""
        for word in name.split():
            candidate = f"{current} {word}".strip()
            bbox = draw.textbbox((0, 0), candidate, font=small_font)
            if bbox[2] - bbox[0] <= max_name_width:
                current = candidate
            else:
                if current:
                    name_lines.append(current)
                current = word
        if current:
            name_lines.append(current)
        if not name_lines:
            name_lines = [name]

        draw.text((margin, y), name_lines[0], fill=fg, font=small_font)
        draw.text((page_w - margin - 240, y), str(qty), fill=fg, font=small_font)
        if unit_price is not None:
            draw.text((page_w - margin - 170, y), _money(unit_price, currency, locale=locale), fill=fg, font=small_font)
        if subtotal is not None:
            draw.text((page_w - margin - 70, y), _money(subtotal, currency, locale=locale), fill=fg, font=small_font, anchor="ra")
        y += 22

        for extra in name_lines[1:3]:
            draw.text((margin, y), extra, fill=fg, font=small_font)
            y += 22

        y += 6
        if y > page_h - 320:
            break

    y += 6
    draw.line((margin, y, page_w - margin, y), fill=border, width=2)
    y += 24

    # Totals
    shipping_amount = getattr(order, "shipping_amount", None)
    fee_amount = getattr(order, "fee_amount", None)
    tax_amount = getattr(order, "tax_amount", None)
    total_amount = getattr(order, "total_amount", None)

    def _right(label: str, value: MoneyValue) -> None:
        nonlocal y
        draw.text((page_w - margin - 240, y), label, fill=muted, font=small_font)
        draw.text((page_w - margin - 70, y), _money(value, currency, locale=locale), fill=fg, font=small_font, anchor="ra")
        y += 22

    if shipping_amount is not None:
        _right("Shipping / Livrare", shipping_amount)
    if fee_amount is not None and Decimal(str(fee_amount or 0)) != 0:
        _right("Additional / Cost supl.", fee_amount)
    if tax_amount is not None:
        _right("VAT / TVA", tax_amount)
    if total_amount is not None:
        draw.text((page_w - margin - 240, y), "Total / Total", fill=fg, font=h_font)
        draw.text((page_w - margin - 70, y + 2), _money(total_amount, currency, locale=locale), fill=fg, font=h_font, anchor="ra")
        y += 30

    refunds = list(getattr(order, "refunds", []) or [])
    if refunds:
        y += 10
        draw.text((margin, y), "Refunds / Rambursări", fill=fg, font=h_font)
        y += 24
        for refund in refunds[-5:]:
            amount = _money(getattr(refund, "amount", 0), currency, locale=locale)
            created = _format_date(getattr(refund, "created_at", None), locale=locale)
            provider = (getattr(refund, "provider", None) or "").strip()
            line = f"{created} · {amount}"
            if provider:
                line = f"{line} ({provider})"
            draw.text((margin, y), line, fill=muted, font=small_font)
            y += 20
            note = (getattr(refund, "note", None) or "").strip()
            if note:
                draw.text((margin, y), note[:120], fill=fg, font=small_font)
                y += 22
            if y > page_h - 220:
                break

    y += 10
    pm = (getattr(order, "payment_method", None) or "").strip()
    if pm:
        draw.text((margin, y), f"Payment / Plată: {_payment_method_bilingual_label(pm)}", fill=muted, font=small_font)
        y += 22
    courier = (getattr(order, "courier", None) or "").strip()
    delivery_type = (getattr(order, "delivery_type", None) or "").strip()
    if courier or delivery_type:
        draw.text(
            (margin, y),
            f"Delivery / Livrare: {' · '.join([x for x in [courier, delivery_type] if x])}",
            fill=muted,
            font=small_font,
        )
        y += 22
    if delivery_type.lower() == "locker":
        locker_name = (getattr(order, "locker_name", None) or "").strip()
        locker_address = (getattr(order, "locker_address", None) or "").strip()
        if locker_name or locker_address:
            draw.text((margin, y), f"Locker: {' — '.join([x for x in [locker_name, locker_address] if x])}", fill=muted, font=small_font)
            y += 22

    y = max(y, page_h - margin - 50)
    draw.text((margin, y), "Thank you! / Mulțumim!", fill=muted, font=small_font)

    buf = io.BytesIO()
    img.save(buf, format="PDF")
    return buf.getvalue()
