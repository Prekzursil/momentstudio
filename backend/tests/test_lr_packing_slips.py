"""Lean-gate unit coverage for ``app.services.packing_slips`` (reportlab PDF)."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import packing_slips as ps


@pytest.fixture(autouse=True)
def _reset_font_cache(monkeypatch):
    monkeypatch.setattr(ps, "_REPORTLAB_FONTS", None)
    yield
    ps._REPORTLAB_FONTS = None


# --------------------------------------------------------------------------- #
# _order_locale                                                               #
# --------------------------------------------------------------------------- #
def test_order_locale_from_user_preference() -> None:
    order = SimpleNamespace(user=SimpleNamespace(preferred_language="RO"))
    assert ps._order_locale(order) == "ro"


def test_order_locale_from_user_preference_en() -> None:
    order = SimpleNamespace(user=SimpleNamespace(preferred_language="en"))
    assert ps._order_locale(order) == "en"


def test_order_locale_from_currency() -> None:
    order = SimpleNamespace(user=None, currency="RON")
    assert ps._order_locale(order) == "ro"


def test_order_locale_from_shipping_country() -> None:
    order = SimpleNamespace(
        user=None, currency="EUR", shipping_address=SimpleNamespace(country="ro")
    )
    assert ps._order_locale(order) == "ro"


def test_order_locale_defaults_to_en() -> None:
    order = SimpleNamespace(
        user=None, currency="USD", shipping_address=SimpleNamespace(country="US")
    )
    assert ps._order_locale(order) == "en"


# --------------------------------------------------------------------------- #
# _fmt_dt                                                                     #
# --------------------------------------------------------------------------- #
def test_fmt_dt_empty() -> None:
    assert ps._fmt_dt(None) == ""


def test_fmt_dt_ro() -> None:
    out = ps._fmt_dt(datetime(2024, 3, 5, 14, 30), locale="ro")
    assert out == "05.03.2024 14:30"


def test_fmt_dt_en() -> None:
    out = ps._fmt_dt(datetime(2024, 3, 5, 14, 30), locale="en")
    assert out == "2024-03-05 14:30"


def test_fmt_dt_strftime_failure(monkeypatch) -> None:
    class BadDate:
        def __bool__(self) -> bool:
            return True

        def strftime(self, fmt):  # noqa: ANN001
            raise ValueError("bad")

        def __str__(self) -> str:
            return "fallback-str"

    assert ps._fmt_dt(BadDate(), locale="en") == "fallback-str"


# --------------------------------------------------------------------------- #
# _addr_lines                                                                 #
# --------------------------------------------------------------------------- #
def test_addr_lines_none() -> None:
    assert ps._addr_lines(None) == []


def test_addr_lines_full() -> None:
    addr = SimpleNamespace(
        line1="1 Main",
        line2="Apt 2",
        city="Bucharest",
        region="IF",
        postal_code="010101",
        country="RO",
    )
    out = ps._addr_lines(addr)
    assert out[0] == "1 Main"
    assert out[1] == "Apt 2"
    assert "010101" in out[2]
    assert out[-1] == "RO"


def test_addr_lines_minimal() -> None:
    addr = SimpleNamespace(
        line1="", line2="", city="", region="", postal_code="", country=""
    )
    assert ps._addr_lines(addr) == []


# --------------------------------------------------------------------------- #
# _register_reportlab_fonts                                                    #
# --------------------------------------------------------------------------- #
def test_register_fonts_fallback_helvetica(monkeypatch) -> None:
    # No DejaVu fonts present -> Helvetica fallback.
    monkeypatch.setattr(ps.Path, "exists", lambda self: False)
    assert ps._register_reportlab_fonts() == ("Helvetica", "Helvetica-Bold")


def test_register_fonts_cached(monkeypatch) -> None:
    monkeypatch.setattr(ps, "_REPORTLAB_FONTS", ("Cached", "CachedBold"))
    assert ps._register_reportlab_fonts() == ("Cached", "CachedBold")


def test_register_fonts_registers_truetype(monkeypatch, tmp_path) -> None:
    # Pretend the DejaVu fonts exist and capture registration calls.
    monkeypatch.setattr(ps.Path, "exists", lambda self: True)
    registered: list[str] = []
    monkeypatch.setattr(ps.pdfmetrics, "getRegisteredFontNames", lambda: [])
    monkeypatch.setattr(
        ps.pdfmetrics, "registerFont", lambda font: registered.append("font")
    )
    monkeypatch.setattr(ps.pdfmetrics, "registerFontFamily", lambda *a, **k: None)

    class _FakeTTFont:
        def __init__(self, name, path):  # noqa: ANN001
            pass

    monkeypatch.setattr(ps, "TTFont", _FakeTTFont)
    out = ps._register_reportlab_fonts()
    assert out == ("MomentSans", "MomentSansBold")
    assert len(registered) == 2


def test_register_fonts_bold_only_backfills_regular(monkeypatch) -> None:
    # Only the bold font path exists -> regular_path is backfilled from bold.
    def only_bold_exists(self) -> bool:
        return "Bold" in str(self)

    monkeypatch.setattr(ps.Path, "exists", only_bold_exists)
    monkeypatch.setattr(ps.pdfmetrics, "getRegisteredFontNames", lambda: [])
    monkeypatch.setattr(ps.pdfmetrics, "registerFont", lambda font: None)
    monkeypatch.setattr(ps.pdfmetrics, "registerFontFamily", lambda *a, **k: None)

    class _FakeTTFont:
        def __init__(self, name, path):  # noqa: ANN001
            pass

    monkeypatch.setattr(ps, "TTFont", _FakeTTFont)
    assert ps._register_reportlab_fonts() == ("MomentSans", "MomentSansBold")


def test_register_fonts_skips_already_registered(monkeypatch) -> None:
    monkeypatch.setattr(ps.Path, "exists", lambda self: True)
    monkeypatch.setattr(
        ps.pdfmetrics,
        "getRegisteredFontNames",
        lambda: ["MomentSans", "MomentSansBold"],
    )
    calls: list[int] = []
    monkeypatch.setattr(ps.pdfmetrics, "registerFont", lambda font: calls.append(1))
    monkeypatch.setattr(ps.pdfmetrics, "registerFontFamily", lambda *a, **k: None)
    out = ps._register_reportlab_fonts()
    assert out == ("MomentSans", "MomentSansBold")
    assert calls == []  # already registered -> no new registration


# --------------------------------------------------------------------------- #
# render PDFs                                                                  #
# --------------------------------------------------------------------------- #
def _order(**kw):
    defaults = dict(
        reference_code="REF-1",
        id="oid",
        created_at=datetime(2024, 1, 1, 9, 0),
        customer_name="Jane",
        customer_email="jane@example.com",
        currency="RON",
        user=None,
        shipping_address=SimpleNamespace(
            line1="1 St",
            line2="",
            city="Buc",
            region="IF",
            postal_code="010",
            country="RO",
        ),
        billing_address=None,
        items=[
            SimpleNamespace(
                product=SimpleNamespace(name="Widget", sku="W1"),
                product_id="p1",
                quantity=2,
            )
        ],
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def test_render_single_packing_slip_pdf() -> None:
    pdf = ps.render_packing_slip_pdf(_order())
    assert pdf.startswith(b"%PDF")


def test_render_batch_multiple_orders_with_page_break() -> None:
    # Two orders -> a PageBreak between them; second order has no items/created_at.
    o2 = _order(
        reference_code=None,
        created_at=None,
        customer_name="",
        customer_email="",
        items=[],
    )
    pdf = ps.render_batch_packing_slips_pdf([_order(), o2], title="Batch")
    assert pdf.startswith(b"%PDF")


def test_render_batch_empty() -> None:
    pdf = ps.render_batch_packing_slips_pdf([])
    assert pdf.startswith(b"%PDF")
