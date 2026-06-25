"""Full coverage for ``app.services.receipts``.

The receipts service is a pure renderer (no DB, no network): it turns order-like
objects into a ``ReceiptRead`` schema and into PDF bytes via two engines
(reportlab vector + a Pillow raster fallback). This module drives every branch
with lightweight fake order/item/address/refund objects.

No existing test targets this module, so it is fully disjoint.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services import receipts

_PRODUCT_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
_PRODUCT_ID_2 = uuid.UUID("22222222-2222-2222-2222-222222222222")
_ORDER_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


# --------------------------------------------------------------------------- #
# Fake-object builders                                                         #
# --------------------------------------------------------------------------- #
def _addr(**kw) -> SimpleNamespace:
    base = dict(
        line1="10 Market St",
        line2="Apt 4",
        city="Bucharest",
        region="B",
        postal_code="010101",
        country="RO",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _item(**kw) -> SimpleNamespace:
    product = kw.pop("product", SimpleNamespace(slug="widget", name="Widget"))
    base = dict(
        product=product,
        product_id=_PRODUCT_ID,
        quantity=2,
        unit_price=Decimal("12.50"),
        subtotal=Decimal("25.00"),
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _refund(**kw) -> SimpleNamespace:
    base = dict(
        amount=Decimal("5.00"),
        currency="RON",
        provider="stripe",
        note="partial",
        created_at=datetime(2024, 1, 2, 3, 4, tzinfo=timezone.utc),
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _order(**kw) -> SimpleNamespace:
    base = dict(
        id=_ORDER_ID,
        reference_code="ORD-42",
        status=SimpleNamespace(value="paid"),
        created_at=datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc),
        currency="RON",
        payment_method="stripe",
        courier="sameday",
        delivery_type="locker",
        locker_name="Locker A",
        locker_address="Near park",
        tracking_number="AWB123",
        customer_email="john@example.com",
        customer_name="John Doe",
        invoice_company="ACME SRL",
        invoice_vat_id="RO123",
        shipping_amount=Decimal("20.00"),
        tax_amount=Decimal("4.00"),
        fee_amount=Decimal("2.00"),
        total_amount=Decimal("51.00"),
        shipping_address=_addr(),
        billing_address=_addr(line1="Bill St", city="Cluj", postal_code="400001"),
        items=[_item()],
        refunds=[_refund()],
        user=SimpleNamespace(preferred_language="ro"),
    )
    base.update(kw)
    return SimpleNamespace(**base)


# --------------------------------------------------------------------------- #
# _order_locale                                                                #
# --------------------------------------------------------------------------- #
def test_order_locale_prefers_user_language() -> None:
    order = _order(user=SimpleNamespace(preferred_language="EN"))
    assert receipts._order_locale(order) == "en"


def test_order_locale_falls_back_to_currency_ron() -> None:
    order = _order(user=None, currency="RON")
    assert receipts._order_locale(order) == "ro"


def test_order_locale_falls_back_to_country_ro() -> None:
    order = _order(
        user=None,
        currency="EUR",
        shipping_address=_addr(country="RO"),
    )
    assert receipts._order_locale(order) == "ro"


def test_order_locale_defaults_to_en() -> None:
    order = _order(
        user=None,
        currency="EUR",
        shipping_address=_addr(country="DE"),
    )
    assert receipts._order_locale(order) == "en"


# --------------------------------------------------------------------------- #
# _mask_email / _mask_text                                                     #
# --------------------------------------------------------------------------- #
def test_mask_email_variants() -> None:
    assert receipts._mask_email("john@example.com") == "j***@example.com"
    assert receipts._mask_email("no-at-sign") == "••••••"
    assert receipts._mask_email("@only") == "••••••"
    assert receipts._mask_email("local@") == "••••••"
    assert receipts._mask_email("") == "••••••"


def test_mask_text_variants() -> None:
    assert receipts._mask_text("") == "••••••"
    assert receipts._mask_text("A") == "•"
    assert receipts._mask_text("Hello") == "H••••"


# --------------------------------------------------------------------------- #
# _as_decimal                                                                  #
# --------------------------------------------------------------------------- #
def test_as_decimal_variants() -> None:
    assert receipts._as_decimal(None) == Decimal("0.00")
    assert receipts._as_decimal(Decimal("3.5")) == Decimal("3.5")
    assert receipts._as_decimal("7.25") == Decimal("7.25")
    assert receipts._as_decimal("bad") == Decimal("0.00")


# --------------------------------------------------------------------------- #
# build_order_receipt                                                          #
# --------------------------------------------------------------------------- #
def test_build_order_receipt_full() -> None:
    receipt = receipts.build_order_receipt(_order())
    assert receipt.order_id == _ORDER_ID
    assert receipt.reference_code == "ORD-42"
    assert receipt.customer_email == "john@example.com"
    assert receipt.items[0].product_url.endswith("/products/widget")
    assert receipt.refunds[0].provider == "stripe"
    assert receipt.pii_redacted is False


def test_build_order_receipt_redacted_masks_pii() -> None:
    receipt = receipts.build_order_receipt(_order(), redacted=True)
    assert receipt.customer_email == "j***@example.com"
    assert receipt.customer_name == "J•••••••"
    assert receipt.invoice_company is None
    assert receipt.invoice_vat_id is None
    assert receipt.pii_redacted is True
    # redacted shipping address gets masked line1/postal but stays present
    assert receipt.shipping_address.line1 == "••••••"


def test_build_order_receipt_incomplete_address_dropped() -> None:
    order = _order(shipping_address=_addr(city=""), billing_address=None)
    receipt = receipts.build_order_receipt(order)
    assert receipt.shipping_address is None
    assert receipt.billing_address is None


def test_build_order_receipt_item_without_slug_and_name() -> None:
    item = _item(
        product=SimpleNamespace(slug=None, name=None), product_id=_PRODUCT_ID_2
    )
    order = _order(items=[item], refunds=[])
    receipt = receipts.build_order_receipt(order)
    assert receipt.items[0].slug is None
    assert receipt.items[0].product_url is None
    assert receipt.items[0].name == str(_PRODUCT_ID_2)


def test_build_order_receipt_redacted_without_customer_name() -> None:
    order = _order(customer_name="", refunds=[])
    receipt = receipts.build_order_receipt(order, redacted=True)
    assert receipt.customer_name is None


def test_build_order_receipt_refund_defaults() -> None:
    # No ``created_at`` attribute -> the getattr default datetime.now is used.
    refund = SimpleNamespace(amount=None, currency=None, provider=None, note=None)
    order = _order(refunds=[refund], currency="EUR")
    receipt = receipts.build_order_receipt(order)
    assert receipt.refunds[0].provider == "manual"
    assert receipt.refunds[0].currency == "EUR"
    assert receipt.refunds[0].note is None


def test_build_order_receipt_passes_explicit_items() -> None:
    receipt = receipts.build_order_receipt(_order(items=[]), items=[_item()])
    assert len(receipt.items) == 1


# --------------------------------------------------------------------------- #
# _payment_method_bilingual_label                                             #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "value,expected",
    [
        ("", ""),
        ("stripe", "Stripe"),
        ("paypal", "PayPal"),
        ("netopia", "Netopia"),
        ("cod", "Cash / Numerar"),
        ("other", "OTHER"),
    ],
)
def test_payment_method_label(value: str, expected: str) -> None:
    assert receipts._payment_method_bilingual_label(value) == expected


# --------------------------------------------------------------------------- #
# _money / _format_date                                                        #
# --------------------------------------------------------------------------- #
def test_money_ro_uses_comma() -> None:
    assert receipts._money(Decimal("12.5"), "RON", locale="ro") == "12,50 RON"


def test_money_en_uses_dot() -> None:
    assert receipts._money(Decimal("12.5"), "RON", locale="en") == "12.50 RON"


def test_money_invalid_value_falls_back() -> None:
    assert receipts._money("abc", "RON") == "abc RON"


def test_format_date_ro_and_en() -> None:
    dt = datetime(2024, 3, 4, 9, 8, tzinfo=timezone.utc)
    assert receipts._format_date(dt, locale="ro") == "04.03.2024 09:08"
    assert receipts._format_date(dt, locale="en") == "2024-03-04 09:08"


def test_format_date_non_datetime_returns_str() -> None:
    assert receipts._format_date("2024", locale="en") == "2024"


def test_format_date_strftime_failure_falls_back(monkeypatch) -> None:
    class _BadDate(datetime):
        def strftime(self, fmt):  # noqa: ANN001
            raise ValueError("boom")

    bad = _BadDate(2024, 1, 1, tzinfo=timezone.utc)
    assert receipts._format_date(bad, locale="en") == str(bad)


# --------------------------------------------------------------------------- #
# _register_reportlab_fonts                                                    #
# --------------------------------------------------------------------------- #
def test_register_reportlab_fonts_cached(monkeypatch) -> None:
    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", ("X", "Y"))
    assert receipts._register_reportlab_fonts() == ("X", "Y")


def test_register_reportlab_fonts_no_dejavu_uses_helvetica(monkeypatch) -> None:
    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", None)
    monkeypatch.setattr(receipts.Path, "exists", lambda self: False)
    assert receipts._register_reportlab_fonts() == ("Helvetica", "Helvetica-Bold")


def test_register_reportlab_fonts_with_dejavu(monkeypatch) -> None:
    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", None)
    monkeypatch.setattr(receipts.Path, "exists", lambda self: True)
    registered: list[str] = []

    def fake_register_font(ttfont) -> None:  # noqa: ANN001
        registered.append(ttfont.fontName)

    monkeypatch.setattr(receipts.pdfmetrics, "getRegisteredFontNames", lambda: [])
    monkeypatch.setattr(receipts.pdfmetrics, "registerFont", fake_register_font)
    monkeypatch.setattr(receipts.pdfmetrics, "registerFontFamily", lambda *a, **k: None)

    class _FakeTTFont:
        def __init__(self, name, path):  # noqa: ANN001
            self.fontName = name

    monkeypatch.setattr(receipts, "TTFont", _FakeTTFont)
    assert receipts._register_reportlab_fonts() == ("MomentSans", "MomentSansBold")
    assert "MomentSans" in registered


def test_register_reportlab_fonts_bold_only_reuses_for_regular(monkeypatch) -> None:
    # Regular candidates missing but a bold candidate exists -> the regular path
    # is back-filled from the bold path (line ``regular_path = bold_path``).
    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", None)

    bold_marker = "DejaVuSans-Bold.ttf"

    def selective_exists(self) -> bool:
        return bold_marker in str(self)

    monkeypatch.setattr(receipts.Path, "exists", selective_exists)
    monkeypatch.setattr(receipts.pdfmetrics, "getRegisteredFontNames", lambda: [])
    monkeypatch.setattr(receipts.pdfmetrics, "registerFont", lambda *a, **k: None)
    monkeypatch.setattr(receipts.pdfmetrics, "registerFontFamily", lambda *a, **k: None)

    class _FakeTTFont:
        def __init__(self, name, path):  # noqa: ANN001
            self.fontName = name

    monkeypatch.setattr(receipts, "TTFont", _FakeTTFont)
    assert receipts._register_reportlab_fonts() == ("MomentSans", "MomentSansBold")


def test_register_reportlab_fonts_already_registered(monkeypatch) -> None:
    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", None)
    monkeypatch.setattr(receipts.Path, "exists", lambda self: True)
    monkeypatch.setattr(
        receipts.pdfmetrics,
        "getRegisteredFontNames",
        lambda: ["MomentSans", "MomentSansBold"],
    )

    def _boom(*a, **k):  # registerFont must not be called when already present
        raise AssertionError("should not register")

    monkeypatch.setattr(receipts.pdfmetrics, "registerFont", _boom)
    monkeypatch.setattr(receipts.pdfmetrics, "registerFontFamily", lambda *a, **k: None)
    assert receipts._register_reportlab_fonts() == ("MomentSans", "MomentSansBold")


# --------------------------------------------------------------------------- #
# reportlab renderer                                                           #
# --------------------------------------------------------------------------- #
def test_render_reportlab_full_pdf() -> None:
    out = receipts._render_order_receipt_pdf_reportlab(_order())
    assert out.startswith(b"%PDF")


def test_render_reportlab_partial_sections() -> None:
    # Exercises: customer name without email, only one address present, only the
    # invoice company (no VAT id), an item with no unit/subtotal (-> "—" cells),
    # and a refund without a provider but with a note.
    item = _item(
        product=SimpleNamespace(slug=None, name="NoPrice"),
        unit_price=None,
        subtotal=None,
    )
    refund = _refund(provider="", note="see ticket")
    order = _order(
        customer_email="",
        invoice_vat_id="",
        billing_address=None,
        items=[item],
        refunds=[refund],
    )
    out = receipts._render_order_receipt_pdf_reportlab(order)
    assert out.startswith(b"%PDF")


def test_render_reportlab_email_only_and_vat_only() -> None:
    # Mirror branch: email without name, VAT id without company.
    order = _order(
        customer_name="",
        invoice_company="",
        shipping_address=None,
        refunds=[_refund(note="")],
    )
    out = receipts._render_order_receipt_pdf_reportlab(order)
    assert out.startswith(b"%PDF")


def test_render_reportlab_minimal_no_optional_sections() -> None:
    order = _order(
        reference_code=None,
        customer_email="",
        customer_name="",
        invoice_company="",
        invoice_vat_id="",
        courier="",
        delivery_type="",
        locker_name="",
        locker_address="",
        tracking_number="",
        payment_method="",
        fee_amount=Decimal("0.00"),
        shipping_address=None,
        billing_address=None,
        refunds=[],
        items=[_item(product=SimpleNamespace(slug=None, name="NoLink"))],
    )
    out = receipts._render_order_receipt_pdf_reportlab(order)
    assert out.startswith(b"%PDF")


# --------------------------------------------------------------------------- #
# raster renderer                                                             #
# --------------------------------------------------------------------------- #
def test_render_raster_full_pdf() -> None:
    out = receipts.render_order_receipt_pdf_raster(_order())
    assert out.startswith(b"%PDF")


def test_render_raster_redacted() -> None:
    out = receipts.render_order_receipt_pdf_raster(_order(), redacted=True)
    assert out.startswith(b"%PDF")


def test_render_raster_minimal_and_no_created_at() -> None:
    order = _order(
        reference_code=None,
        created_at=None,
        customer_email="",
        customer_name="",
        invoice_company="",
        invoice_vat_id="",
        courier="",
        delivery_type="",
        payment_method="",
        fee_amount=Decimal("0.00"),
        shipping_amount=None,
        tax_amount=None,
        total_amount=None,
        shipping_address=None,
        billing_address=None,
        refunds=[],
        items=[],
    )
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_partial_sections() -> None:
    # customer name w/o email, only one invoice field, item with no prices,
    # refund without provider but with note.
    item = _item(
        product=SimpleNamespace(slug=None, name="NoPrice"),
        unit_price=None,
        subtotal=None,
    )
    order = _order(
        customer_email="",
        invoice_vat_id="",
        items=[item],
        refunds=[_refund(provider="", note="ticket-1")],
    )
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_email_only_and_vat_only() -> None:
    order = _order(
        customer_name="",
        invoice_company="",
        refunds=[_refund(note="")],
    )
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_single_address_only() -> None:
    # Only a shipping address present -> ``_address_lines(None)`` returns [] for
    # the billing box (line ``return []``).
    order = _order(billing_address=None, refunds=[])
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_unbreakable_long_word_name() -> None:
    # A single word wider than the column forces the wrap loop's ``current``
    # to be empty when the overflow ``else`` branch first runs.
    huge = "X" * 200
    order = _order(
        items=[_item(product=SimpleNamespace(slug=None, name=huge))],
        refunds=[],
    )
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_locker_without_details() -> None:
    # delivery_type == locker but no locker name/address -> the inner block is
    # skipped (line ``if locker_name or locker_address``).
    order = _order(
        delivery_type="locker",
        locker_name="",
        locker_address="",
        refunds=[],
    )
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_long_item_name_wraps() -> None:
    long_name = " ".join(["VeryLongProductWord"] * 20)
    order = _order(
        items=[_item(product=SimpleNamespace(slug=None, name=long_name))],
        refunds=[],
    )
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_many_items_breaks_pagination() -> None:
    items = [
        _item(product=SimpleNamespace(slug=None, name=f"Item {i}")) for i in range(60)
    ]
    order = _order(items=items, refunds=[])
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_many_refunds_break() -> None:
    refunds = [_refund(note="n" * 200) for _ in range(20)]
    order = _order(refunds=refunds, items=[_item()])
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_refund_break_when_page_full() -> None:
    # A full items section pushes ``y`` near the page bottom; the first refund
    # then exceeds the limit and the refund loop breaks (line ``break``).
    items = [
        _item(product=SimpleNamespace(slug=None, name=f"Item {i}")) for i in range(60)
    ]
    refunds = [_refund(note="long note " * 10) for _ in range(5)]
    order = _order(items=items, refunds=refunds)
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


def test_render_raster_locker_delivery_with_details() -> None:
    order = _order(delivery_type="locker", refunds=[])
    out = receipts.render_order_receipt_pdf_raster(order)
    assert out.startswith(b"%PDF")


# --------------------------------------------------------------------------- #
# render_order_receipt_pdf (engine selection + fallback)                       #
# --------------------------------------------------------------------------- #
def test_render_order_receipt_pdf_uses_reportlab() -> None:
    out = receipts.render_order_receipt_pdf(_order())
    assert out.startswith(b"%PDF")


def test_render_order_receipt_pdf_falls_back_to_raster(monkeypatch) -> None:
    def boom(*a, **k):
        raise RuntimeError("reportlab down")

    monkeypatch.setattr(receipts, "_render_order_receipt_pdf_reportlab", boom)
    out = receipts.render_order_receipt_pdf(_order())
    assert out.startswith(b"%PDF")
