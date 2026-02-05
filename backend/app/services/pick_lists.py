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


def build_pick_list_rows(orders: Sequence[object]) -> list[PickListRow]:
    grouped: dict[tuple[str, str], _PickListAccumulator] = {}
    for order in orders:
        ref = _order_ref(order)
        for item in list(getattr(order, "items", []) or []):
            item_any: Any = item
            product: Any = getattr(item_any, "product", None)
            sku = str(getattr(product, "sku", None) or "").strip() or "—"
            product_name = (
                str(getattr(product, "name", None) or getattr(item_any, "product_id", "") or "").strip() or "—"
            )
            variant: Any = getattr(item_any, "variant", None)
            variant_name_raw = str(getattr(variant, "name", None) or "").strip()
            key = (sku, variant_name_raw)
            current = grouped.get(key)
            if current is None:
                current = _PickListAccumulator(
                    sku=sku,
                    product_name=product_name,
                    variant_name=variant_name_raw or None,
                )
                grouped[key] = current

            qty = int(getattr(item_any, "quantity", 0) or 0)
            current.quantity += qty
            if ref:
                current.order_refs.add(ref)

    rows: list[PickListRow] = []
    for key in sorted(grouped.keys(), key=lambda k: (k[0], k[1])):
        entry = grouped[key]
        order_refs = tuple(sorted([v for v in entry.order_refs if v]))
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
    story.append(Paragraph("Picking list / Listă colectare", h1))

    if orders:
        refs = [(_order_ref(o) or "").strip() for o in orders]
        refs = [r for r in refs if r]
        if refs:
            story.append(Paragraph(f"Orders / Comenzi: {', '.join(refs)}", muted))
        created_at = _fmt_dt(datetime.now())
        if created_at:
            story.append(Paragraph(f"Generated / Generat: {created_at}", muted))

    story.append(Spacer(1, 10))

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
    story.append(table)

    doc.build(story)
    return buf.getvalue()
