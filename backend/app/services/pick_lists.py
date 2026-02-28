from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.packing_slips import _register_reportlab_fonts


@dataclass(frozen=True)
class PickListRow:
    sku: str
    product_name: str
    variant_name: str | None
    quantity: int
    order_refs: tuple[str, ...]


_DEFAULT_TITLE: Final[str] = "Picking list"


@dataclass
class _PickListAccumulator:
    sku: str
    product_name: str
    variant_name: str | None
    quantity: int = 0
    order_refs: set[str] = field(default_factory=set)


def _order_ref(order: object) -> str:
    return str(getattr(order, "reference_code", None) or getattr(order, "id", "") or "").strip()


def _iter_order_items(order: object) -> list[object]:
    return list(getattr(order, "items", []) or [])


def _pick_list_item_fields(item_any: Any) -> tuple[tuple[str, str], str, str, str | None]:
    product: Any = getattr(item_any, "product", None)
    sku = str(getattr(product, "sku", None) or "").strip() or "—"
    product_name = str(getattr(product, "name", None) or getattr(item_any, "product_id", "") or "").strip() or "—"
    variant: Any = getattr(item_any, "variant", None)
    variant_name_raw = str(getattr(variant, "name", None) or "").strip()
    return (sku, variant_name_raw), sku, product_name, variant_name_raw or None


def _get_or_create_group(
    grouped: dict[tuple[str, str], _PickListAccumulator],
    *,
    key: tuple[str, str],
    sku: str,
    product_name: str,
    variant_name: str | None,
) -> _PickListAccumulator:
    current = grouped.get(key)
    if current is None:
        current = _PickListAccumulator(
            sku=sku,
            product_name=product_name,
            variant_name=variant_name,
        )
        grouped[key] = current
    return current


def _item_qty(item_any: Any) -> int:
    return int(getattr(item_any, "quantity", 0) or 0)


def _rows_from_grouped(grouped: dict[tuple[str, str], _PickListAccumulator]) -> list[PickListRow]:
    rows: list[PickListRow] = []
    for key in sorted(grouped.keys(), key=lambda k: (k[0], k[1])):
        entry = grouped[key]
        order_refs = tuple(sorted(v for v in entry.order_refs if v))
        rows.append(
            PickListRow(
                sku=entry.sku,
                product_name=entry.product_name,
                variant_name=entry.variant_name,
                quantity=int(entry.quantity),
                order_refs=order_refs,
            )
        )
    return rows


def build_pick_list_rows(orders: Sequence[object]) -> list[PickListRow]:
    grouped: dict[tuple[str, str], _PickListAccumulator] = {}
    for order in orders:
        ref = _order_ref(order)
        for item in _iter_order_items(order):
            item_any: Any = item
            key, sku, product_name, variant_name = _pick_list_item_fields(item_any)
            current = _get_or_create_group(
                grouped,
                key=key,
                sku=sku,
                product_name=product_name,
                variant_name=variant_name,
            )
            current.quantity += _item_qty(item_any)
            if ref:
                current.order_refs.add(ref)

    return _rows_from_grouped(grouped)


def render_pick_list_csv(rows: Sequence[PickListRow]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["sku", "product_name", "variant", "quantity", "orders"])
    for row in rows:
        writer.writerow(
            [
                row.sku,
                row.product_name,
                row.variant_name or "",
                str(int(row.quantity)),
                ", ".join(row.order_refs),
            ]
        )
    return buf.getvalue().encode("utf-8")


def _fmt_dt(value: datetime | None) -> str:
    if not value:
        return ""
    try:
        return value.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


def render_pick_list_pdf(
    rows: Sequence[PickListRow],
    *,
    orders: Sequence[object] | None = None,
    title: str | None = None,
) -> bytes:
    font_regular, font_bold = _register_reportlab_fonts()
    base, muted, h1 = _pick_list_styles(font_regular, font_bold)
    buf = io.BytesIO()
    doc = _pick_list_doc_template(buf, title)
    story = _pick_list_story(rows=rows, base=base, muted=muted, h1=h1, font_bold=font_bold, orders=orders)
    doc.build(story)
    return buf.getvalue()


def _pick_list_styles(font_regular: str, font_bold: str) -> tuple[ParagraphStyle, ParagraphStyle, ParagraphStyle]:
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
    return base, muted, h1


def _pick_list_doc_template(buf: io.BytesIO, title: str | None) -> SimpleDocTemplate:
    return SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title or _DEFAULT_TITLE,
    )


def _pick_list_story(
    *,
    rows: Sequence[PickListRow],
    base: ParagraphStyle,
    muted: ParagraphStyle,
    h1: ParagraphStyle,
    font_bold: str,
    orders: Sequence[object] | None,
) -> list[object]:
    story: list[object] = [Paragraph("Picking list / Listă colectare", h1)]
    _append_pick_list_order_details(story, muted, orders)
    story.append(Spacer(1, 10))
    table_rows = _pick_list_table_rows(rows, base)
    story.append(_pick_list_table(table_rows, font_bold))
    return story


def _append_pick_list_order_details(
    story: list[object],
    muted: ParagraphStyle,
    orders: Sequence[object] | None,
) -> None:
    if not orders:
        return

    refs = [(_order_ref(o) or "").strip() for o in orders]
    refs = [r for r in refs if r]
    if refs:
        story.append(Paragraph(f"Orders / Comenzi: {', '.join(refs)}", muted))
    created_at = _fmt_dt(datetime.now())
    if created_at:
        story.append(Paragraph(f"Generated / Generat: {created_at}", muted))


def _pick_list_table_rows(rows: Sequence[PickListRow], base: ParagraphStyle) -> list[list[object]]:
    table_rows: list[list[object]] = [
        [
            Paragraph("SKU", base),
            Paragraph("Product / Produs", base),
            Paragraph("Variant", base),
            Paragraph("Qty", base),
            Paragraph("Orders", base),
        ]
    ]
    for row in rows:
        table_rows.append(
            [
                Paragraph(row.sku, base),
                Paragraph(row.product_name, base),
                Paragraph(row.variant_name or "—", base),
                Paragraph(str(int(row.quantity)), base),
                Paragraph(", ".join(row.order_refs) or "—", base),
            ]
        )
    return table_rows


def _pick_list_table(table_rows: list[list[object]], font_bold: str) -> Table:
    table = Table(
        table_rows,
        colWidths=[28 * mm, 62 * mm, 28 * mm, 15 * mm, 45 * mm],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("FONTNAME", (0, 0), (-1, 0), font_bold),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table
