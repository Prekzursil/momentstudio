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


def _first_existing_path(candidates: Sequence[str]) -> str | None:
    return next((path for path in candidates if Path(path).exists()), None)


def _resolve_font_paths() -> tuple[str | None, str | None]:
    regular_candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    )
    bold_candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    )
    regular_path = _first_existing_path(regular_candidates)
    bold_path = _first_existing_path(bold_candidates) or regular_path
    if regular_path is None and bold_path is not None:
        regular_path = bold_path
    return regular_path, bold_path


def _register_moment_fonts(*, regular_path: str, bold_path: str) -> tuple[str, str]:
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
    return ("MomentSans", "MomentSansBold")


def _order_locale(order: object) -> str:
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


def _register_reportlab_fonts() -> tuple[str, str]:
    global _REPORTLAB_FONTS
    if _REPORTLAB_FONTS is not None:
        return _REPORTLAB_FONTS
    regular_path, bold_path = _resolve_font_paths()
    if regular_path and bold_path:
        _REPORTLAB_FONTS = _register_moment_fonts(regular_path=regular_path, bold_path=bold_path)
        return _REPORTLAB_FONTS
    _REPORTLAB_FONTS = ("Helvetica", "Helvetica-Bold")
    return _REPORTLAB_FONTS


def _fmt_dt(value: datetime | None, *, locale: str | None = None) -> str:
    if not value:
        return ""
    normalized = "ro" if (locale or "").strip().lower() == "ro" else "en"
    try:
        if normalized == "ro":
            return value.strftime("%d.%m.%Y %H:%M")
        return value.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


def _addr_lines(addr) -> list[str]:
    if not addr:
        return []
    def _clean(attr: str) -> str:
        return (getattr(addr, attr, None) or "").strip()

    def _append(parts: list[str], value: str) -> None:
        if value:
            parts.append(value)

    parts: list[str] = []
    line1 = _clean("line1")
    line2 = _clean("line2")
    city = _clean("city")
    region = _clean("region")
    postal = _clean("postal_code")
    country = _clean("country")
    _append(parts, line1)
    _append(parts, line2)
    city_region_parts: list[str] = []
    _append(city_region_parts, city)
    _append(city_region_parts, region)
    city_region = ", ".join(city_region_parts)
    locality_parts: list[str] = []
    _append(locality_parts, postal)
    _append(locality_parts, city_region)
    locality_line = " ".join(locality_parts).strip()
    _append(parts, locality_line)
    _append(parts, country)
    return parts


def _base_paragraph_styles(*, font_regular: str, font_bold: str) -> tuple[ParagraphStyle, ParagraphStyle, ParagraphStyle, ParagraphStyle]:
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
    return base, muted, h1, h2


def _order_header_story(order: object, *, base: ParagraphStyle, muted: ParagraphStyle, h1: ParagraphStyle) -> list[object]:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    created_at = _fmt_dt(getattr(order, "created_at", None), locale=_order_locale(order))
    customer_name = (getattr(order, "customer_name", None) or "").strip()
    customer_email = (getattr(order, "customer_email", None) or "").strip()
    lines: list[object] = [
        Paragraph("Packing slip / Aviz", h1),
        Paragraph(f"Order / Comandă: <b>{ref}</b>", base),
    ]
    if created_at:
        lines.append(Paragraph(f"Date / Dată: {created_at}", muted))
    detail = " · ".join(part for part in (customer_name, customer_email) if part)
    if detail:
        lines.append(Paragraph(f"Customer / Client: {detail}", muted))
    return lines


def _address_table(order: object, *, h2: ParagraphStyle, base: ParagraphStyle) -> Table:
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
    return addr_table


def _line_item_rows(order: object, *, base: ParagraphStyle) -> list[list[object]]:
    def _row_for_item(item: object) -> list[object]:
        product = getattr(item, "product", None)
        name = (getattr(product, "name", None) or str(getattr(item, "product_id", ""))).strip() or "—"
        sku = (getattr(product, "sku", None) or "").strip() or "—"
        qty = int(getattr(item, "quantity", 0) or 0)
        return [Paragraph(name, base), Paragraph(str(qty), base), Paragraph(sku, base)]

    rows: list[list[object]] = [[Paragraph("Product / Produs", base), Paragraph("Qty", base), Paragraph("SKU", base)]]
    line_items = [_row_for_item(item) for item in list(getattr(order, "items", []) or [])]
    if not line_items:
        line_items = [[Paragraph("—", base), Paragraph("0", base), Paragraph("—", base)]]
    rows.extend(line_items)
    return rows


def _items_table(order: object, *, base: ParagraphStyle, font_bold: str) -> Table:
    table = Table(_line_item_rows(order, base=base), colWidths=[120 * mm, 20 * mm, 40 * mm], hAlign="LEFT")
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
    return table


def _append_order_story(
    story: list[object],
    *,
    order: object,
    base: ParagraphStyle,
    muted: ParagraphStyle,
    h1: ParagraphStyle,
    h2: ParagraphStyle,
    font_bold: str,
) -> None:
    story.extend(_order_header_story(order, base=base, muted=muted, h1=h1))
    story.append(Spacer(1, 8))
    story.append(_address_table(order, h2=h2, base=base))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Items / Produse", h2))
    story.append(_items_table(order, base=base, font_bold=font_bold))


def render_batch_packing_slips_pdf(orders: Sequence[object], *, title: str | None = None) -> bytes:
    font_regular, font_bold = _register_reportlab_fonts()
    base, muted, h1, h2 = _base_paragraph_styles(font_regular=font_regular, font_bold=font_bold)

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
        _append_order_story(
            story,
            order=order,
            base=base,
            muted=muted,
            h1=h1,
            h2=h2,
            font_bold=font_bold,
        )

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    return pdf


def render_packing_slip_pdf(order: object) -> bytes:
    return render_batch_packing_slips_pdf([order], title="Packing slip")
