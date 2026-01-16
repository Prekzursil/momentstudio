from __future__ import annotations

import io
from datetime import datetime
from decimal import Decimal
from typing import Sequence, SupportsFloat, SupportsIndex

from PIL import Image, ImageDraw, ImageFont


Font = ImageFont.FreeTypeFont | ImageFont.ImageFont
MoneyValue = str | SupportsFloat | SupportsIndex


def _load_font(size: int, *, bold: bool = False) -> Font:
    candidates: list[str] = []
    if bold:
        candidates.extend(
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            ]
        )
    else:
        candidates.extend(
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ]
        )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _money(value: MoneyValue, currency: str) -> str:
    try:
        if isinstance(value, Decimal):
            return f"{value.quantize(Decimal('0.01'))} {currency}"
        return f"{float(value):.2f} {currency}"
    except Exception:
        return f"{value} {currency}"


def _format_date(value: object) -> str:
    if isinstance(value, datetime):
        try:
            return value.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return str(value)
    return str(value)


def render_order_receipt_pdf(order, items: Sequence | None = None) -> bytes:
    """Render a simple bilingual (RO/EN) receipt PDF.

    This is intentionally implemented as a PDF-embedded raster image so we can
    reliably render Romanian diacritics without introducing heavy PDF deps.
    """

    items = items or getattr(order, "items", []) or []
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
        draw.text((margin, y), f"Date / Dată: {_format_date(created_at)}", fill=muted, font=small_font)
        y += 26
    draw.line((margin, y + 14, page_w - margin, y + 14), fill=border, width=2)
    y += 40

    customer_email = (getattr(order, "customer_email", None) or "").strip()
    customer_name = (getattr(order, "customer_name", None) or "").strip()
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
        parts = [
            (getattr(addr, "line1", None) or "").strip(),
            (getattr(addr, "line2", None) or "").strip(),
            " ".join(
                [
                    (getattr(addr, "postal_code", None) or "").strip(),
                    (getattr(addr, "city", None) or "").strip(),
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
            draw.text((page_w - margin - 170, y), _money(unit_price, currency), fill=fg, font=small_font)
        if subtotal is not None:
            draw.text((page_w - margin - 70, y), _money(subtotal, currency), fill=fg, font=small_font, anchor="ra")
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
    tax_amount = getattr(order, "tax_amount", None)
    total_amount = getattr(order, "total_amount", None)

    def _right(label: str, value: MoneyValue) -> None:
        nonlocal y
        draw.text((page_w - margin - 240, y), label, fill=muted, font=small_font)
        draw.text((page_w - margin - 70, y), _money(value, currency), fill=fg, font=small_font, anchor="ra")
        y += 22

    if shipping_amount is not None:
        _right("Shipping / Livrare", shipping_amount)
    if tax_amount is not None:
        _right("Tax / Taxe", tax_amount)
    if total_amount is not None:
        draw.text((page_w - margin - 240, y), "Total / Total", fill=fg, font=h_font)
        draw.text((page_w - margin - 70, y + 2), _money(total_amount, currency), fill=fg, font=h_font, anchor="ra")
        y += 30

    y += 10
    pm = (getattr(order, "payment_method", None) or "").strip().lower()
    if pm:
        draw.text((margin, y), f"Payment / Plată: {pm}", fill=muted, font=small_font)
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
