from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

from app.services import packing_slips


def _address(**overrides):
    base = {
        'line1': 'Street 1',
        'line2': 'Apt 2',
        'city': 'Bucharest',
        'region': 'B',
        'postal_code': '010101',
        'country': 'RO',
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _order(*, locale: str | None = 'ro', currency: str = 'RON'):
    product = SimpleNamespace(id=uuid4(), name='Mug', sku='MUG-1')
    item = SimpleNamespace(product=product, product_id=product.id, quantity=2)
    user = SimpleNamespace(preferred_language=locale)
    return SimpleNamespace(
        id=uuid4(),
        reference_code='REF-1',
        created_at=datetime(2026, 1, 2, 3, 4, 5),
        customer_name='Ada Lovelace',
        customer_email='ada@example.com',
        currency=currency,
        user=user,
        shipping_address=_address(),
        billing_address=_address(line2=''),
        items=[item],
    )


def test_locale_datetime_and_address_helpers_cover_guards():
    order = _order(locale='ro')
    assert packing_slips._order_locale(order) == 'ro'
    assert packing_slips._fmt_dt(order.created_at, locale='ro') == '02.01.2026 03:04'
    assert packing_slips._fmt_dt(order.created_at, locale='en') == '2026-01-02 03:04'
    assert packing_slips._fmt_dt(None) == ''

    fallback_currency = _order(locale='xx', currency='RON')
    assert packing_slips._order_locale(fallback_currency) == 'ro'

    fallback_country = _order(locale='xx', currency='USD')
    fallback_country.shipping_address = _address(country='RO')
    assert packing_slips._order_locale(fallback_country) == 'ro'

    fallback_en = _order(locale='xx', currency='USD')
    fallback_en.shipping_address = _address(country='US')
    assert packing_slips._order_locale(fallback_en) == 'en'

    lines = packing_slips._addr_lines(_address(line2='', region=''))
    assert lines == ['Street 1', '010101 Bucharest', 'RO']
    assert packing_slips._addr_lines(None) == []


def test_filename_and_row_helpers_cover_empty_paths_and_missing_items():

    found = packing_slips._first_existing_path(['missing-file', __file__])
    assert found == __file__

    rows = packing_slips._line_item_rows(SimpleNamespace(items=[]), base=packing_slips._base_paragraph_styles(font_regular='Helvetica', font_bold='Helvetica-Bold')[0])
    assert len(rows) == 2


def test_render_batch_and_single_pdf_smoke():
    order_a = _order(locale='ro')
    order_b = _order(locale='en', currency='USD')

    batch_pdf = packing_slips.render_batch_packing_slips_pdf([order_a, order_b], title='Batch')
    assert batch_pdf.startswith(b'%PDF')
    assert len(batch_pdf) > 500

    single_pdf = packing_slips.render_packing_slip_pdf(order_a)
    assert single_pdf.startswith(b'%PDF')
    assert len(single_pdf) > 300
