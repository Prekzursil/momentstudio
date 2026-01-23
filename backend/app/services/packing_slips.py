import io
from datetime import datetime
from pathlib import Path
from typing import Final, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


_DEFAULT_TITLE: Final[str] = "Packing slips"
_REPORTLAB_FONTS: tuple[str, str] | None = None


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
    bold_path = next((p for p in bold_candidates if Path(p).exists()), None)

    if regular_path and bold_path:
        pdfmetrics.registerFont(TTFont("MomentSans", regular_path))
        pdfmetrics.registerFont(TTFont("MomentSansBold", bold_path))
        _REPORTLAB_FONTS = ("MomentSans", "MomentSansBold")
        return _REPORTLAB_FONTS

    _REPORTLAB_FONTS = ("Helvetica", "Helvetica-Bold")
    return _REPORTLAB_FONTS


def _fmt_dt(value: datetime | None) -> str:
    if not value:
        return ""
    try:
        return value.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


def _addr_lines(addr) -> list[str]:
    if not addr:
        return []
    parts: list[str] = []
    line1 = (getattr(addr, "line1", None) or "").strip()
    line2 = (getattr(addr, "line2", None) or "").strip()
    city = (getattr(addr, "city", None) or "").strip()
    region = (getattr(addr, "region", None) or "").strip()
    postal = (getattr(addr, "postal_code", None) or "").strip()
    country = (getattr(addr, "country", None) or "").strip()
    if line1:
        parts.append(line1)
    if line2:
        parts.append(line2)
    city_parts = ", ".join([p for p in [city, region] if p])
    if postal or city_parts:
        parts.append(" ".join([p for p in [postal, city_parts] if p]).strip())
    if country:
        parts.append(country)
    return parts


def render_batch_packing_slips_pdf(orders: Sequence[object], *, title: str | None = None) -> bytes:
    font_regular, font_bold = _register_reportlab_fonts()
    styles = getSampleStyleSheet()
    base = ParagraphStyle(
        "base",
        parent=styles["Normal"],
        fontName=font_regular,
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#0f172a"),
    )
    muted = ParagraphStyle(
        "muted",
        parent=base,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#475569"),
    )
    h1 = ParagraphStyle(
        "h1",
        parent=base,
        fontName=font_bold,
        fontSize=16,
        leading=20,
        spaceAfter=8,
    )
    h2 = ParagraphStyle(
        "h2",
        parent=base,
        fontName=font_bold,
        fontSize=11,
        leading=14,
        spaceBefore=8,
        spaceAfter=4,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title or _DEFAULT_TITLE,
    )

    story: list[object] = []
    for idx, order in enumerate(orders):
        if idx:
            story.append(PageBreak())

        ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
        created_at = _fmt_dt(getattr(order, "created_at", None))
        customer_name = (getattr(order, "customer_name", None) or "").strip()
        customer_email = (getattr(order, "customer_email", None) or "").strip()

        story.append(Paragraph("Packing slip / Aviz", h1))
        story.append(Paragraph(f"Order / Comandă: <b>{ref}</b>", base))
        if created_at:
            story.append(Paragraph(f"Date / Dată: {created_at}", muted))
        if customer_name or customer_email:
            detail = " · ".join([p for p in [customer_name, customer_email] if p])
            story.append(Paragraph(f"Customer / Client: {detail}", muted))

        shipping_addr = getattr(order, "shipping_address", None)
        billing_addr = getattr(order, "billing_address", None)
        addr_table = Table(
            [
                [
                    Paragraph("Shipping / Livrare", h2),
                    Paragraph("Billing / Facturare", h2),
                ],
                [
                    Paragraph("<br/>".join(_addr_lines(shipping_addr)) or "—", base),
                    Paragraph("<br/>".join(_addr_lines(billing_addr)) or "—", base),
                ],
            ],
            colWidths=[85 * mm, 85 * mm],
            hAlign="LEFT",
        )
        addr_table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#f8fafc")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(Spacer(1, 8))
        story.append(addr_table)

        items = list(getattr(order, "items", []) or [])
        story.append(Spacer(1, 10))
        story.append(Paragraph("Items / Produse", h2))

        rows: list[list[object]] = [
            [Paragraph("Product / Produs", base), Paragraph("Qty", base), Paragraph("SKU", base)]
        ]
        for item in items:
            product = getattr(item, "product", None)
            name = (getattr(product, "name", None) or str(getattr(item, "product_id", ""))).strip() or "—"
            sku = (getattr(product, "sku", None) or "").strip() or "—"
            qty = int(getattr(item, "quantity", 0) or 0)
            rows.append([Paragraph(name, base), Paragraph(str(qty), base), Paragraph(sku, base)])

        if len(rows) == 1:
            rows.append([Paragraph("—", base), Paragraph("0", base), Paragraph("—", base)])

        table = Table(rows, colWidths=[120 * mm, 20 * mm, 40 * mm], hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                    ("FONTNAME", (0, 0), (-1, 0), font_bold),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(table)

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    return pdf


def render_packing_slip_pdf(order: object) -> bytes:
    return render_batch_packing_slips_pdf([order], title="Packing slip")
