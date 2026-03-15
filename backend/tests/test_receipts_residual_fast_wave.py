from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4


import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services import receipts


def _raise(exc: BaseException):
    raise exc

def _sample_receipt(**overrides):
    base = {
        'order_id': uuid4(),
        'reference_code': 'REF-1',
        'status': 'paid',
        'created_at': datetime(2026, 3, 1, tzinfo=timezone.utc),
        'currency': 'RON',
        'payment_method': 'stripe',
        'courier': 'fan',
        'delivery_type': 'courier',
        'locker_name': None,
        'locker_address': None,
        'tracking_number': None,
        'customer_email': 'user@example.com',
        'customer_name': 'User Name',
        'invoice_company': None,
        'invoice_vat_id': None,
        'pii_redacted': False,
        'shipping_amount': Decimal('10.00'),
        'tax_amount': Decimal('2.00'),
        'fee_amount': Decimal('1.00'),
        'total_amount': Decimal('20.00'),
        'shipping_address': None,
        'billing_address': None,
        'items': [],
        'refunds': [],
    }
    base.update(overrides)
    return receipts.ReceiptRead(**base)


def _raster_ctx(locale: str = 'en'):
    image = Image.new('RGB', (1200, 1800), color='white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    return receipts._RasterCtx(
        draw=draw,
        page_w=1200,
        page_h=1800,
        margin=80,
        fg=(15, 23, 42),
        muted=(71, 85, 105),
        border=(226, 232, 240),
        title_font=font,
        h_font=font,
        b_font=font,
        small_font=font,
        currency='RON',
        locale=locale,
    )


def test_receipts_reportlab_font_and_payment_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    receipts._REPORTLAB_FONTS = None
    font_paths = ('/opt/momentstudio/fonts/a.ttf', '/opt/momentstudio/fonts/b.ttf')
    monkeypatch.setattr(receipts, '_reportlab_font_paths', lambda: font_paths)
    monkeypatch.setattr(receipts.pdfmetrics, 'getRegisteredFontNames', lambda: ['Helvetica'])
    reg_calls: list[tuple[str, str]] = []
    monkeypatch.setattr(receipts, '_register_font_if_missing', lambda name, path, registered: reg_calls.append((name, path)))
    monkeypatch.setattr(receipts.pdfmetrics, 'registerFontFamily', lambda *args, **kwargs: None)

    assert receipts._register_reportlab_fonts() == ('MomentSans', 'MomentSansBold')
    assert ('MomentSans', font_paths[0]) in reg_calls
    assert receipts._payment_method_bilingual_label('') == ''
    assert receipts._payment_method_bilingual_label('stripe') == 'Stripe'
    assert receipts._payment_method_bilingual_label('paypal') == 'PayPal'


def test_receipts_reportlab_info_and_refund_paths() -> None:
    empty_receipt = _sample_receipt(customer_email=None, customer_name=None)
    story: list[object] = []
    styles = receipts._reportlab_styles('Helvetica', 'Helvetica-Bold')
    base_style, small_muted, _h1, h2, _header_style = styles

    receipts._append_reportlab_customer(story, empty_receipt, base_style=base_style, small_muted=small_muted, h2=h2)
    assert story == []

    with_invoice = _sample_receipt(invoice_company='Moment Studio SRL', invoice_vat_id='RO123')
    receipts._append_reportlab_invoice(story, with_invoice, base_style=base_style, h2=h2)
    assert len(story) > 0

    locker_missing = _sample_receipt(delivery_type='locker', locker_name='', locker_address='')
    assert receipts._reportlab_locker_info_line(locker_missing) is None

    assert receipts._reportlab_money_cell(None, currency='RON', locale='ro') == '—'

    with_refunds = _sample_receipt(
        refunds=[
            receipts.ReceiptRefundRead(
                amount=Decimal('2.00'),
                currency='RON',
                provider='manual',
                note='refunded',
                created_at=datetime(2026, 3, 2, tzinfo=timezone.utc),
            )
        ]
    )
    story = []
    receipts._append_reportlab_refunds(story, with_refunds, base_style=base_style, small_muted=small_muted, h2=h2, locale='en')
    assert story


class _BadDate(datetime):
    def strftime(self, _fmt: str) -> str:
        raise RuntimeError('strftime-fail')


def test_receipts_format_date_and_address_helpers() -> None:
    assert receipts._format_date(_BadDate.now(), locale='en')
    assert receipts._raster_address_lines(None, redacted=False) == []

    addr = SimpleNamespace(line1='Main', line2='Apt 5', postal_code='0101', city='Bucharest', region='RO-B', country='RO')
    assert receipts._raster_address_lines(addr, redacted=True)[0] == '••••••'


def test_receipts_raster_item_wrapping_and_rows() -> None:
    ctx = _raster_ctx()
    wrapped = receipts._wrap_raster_product_name(ctx, name='Very long product name for wrapping in receipt renderer', max_name_width=30)
    assert len(wrapped) >= 2

    item = SimpleNamespace(
        product=SimpleNamespace(name='Long Product Name'),
        product_id='p-1',
        quantity=2,
        unit_price=Decimal('3.50'),
        subtotal=Decimal('7.00'),
    )
    y = receipts._draw_raster_item_row(ctx, y=300, item=item, max_name_width=40)
    assert y > 300


def test_receipts_raster_totals_refunds_and_delivery_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _raster_ctx(locale='ro')
    order = SimpleNamespace(
        shipping_amount=Decimal('10.00'),
        fee_amount=Decimal('1.25'),
        tax_amount=Decimal('2.00'),
        total_amount=Decimal('20.00'),
        refunds=[SimpleNamespace(amount=Decimal('2.00'), provider='manual', note='ok', created_at=datetime(2026, 3, 2, tzinfo=timezone.utc))],
        payment_method='cod',
        courier='fan',
        delivery_type='locker',
        locker_name='Locker One',
        locker_address='Main Street',
    )

    y = receipts._draw_raster_totals(ctx, y=400, order=order)
    assert y > 400

    y2 = receipts._draw_raster_refunds(ctx, y=500, order=order)
    assert y2 > 500

    y3 = receipts._draw_raster_delivery_info(ctx, y=600, order=order)
    assert y3 > 600

    no_total = SimpleNamespace(shipping_amount=None, fee_amount=Decimal('0'), tax_amount=None, total_amount=None)
    assert receipts._draw_raster_totals(ctx, y=700, order=no_total) == 700

    monkeypatch.setattr(receipts, '_draw_raster_refund_entry', lambda _ctx, y, refund: y + 500)
    many_refunds = SimpleNamespace(refunds=[SimpleNamespace(amount=1, provider='m', note='', created_at=datetime.now(timezone.utc)) for _ in range(6)])
    assert receipts._draw_raster_refunds(ctx, y=100, order=many_refunds) > 100


def test_receipts_mask_email_and_fallback_render_path(monkeypatch: pytest.MonkeyPatch) -> None:
    assert receipts._mask_email('broken@') == '••••••'

    called = {'fallback': False}
    monkeypatch.setattr(receipts, '_render_order_receipt_pdf_reportlab', lambda *_a, **_k: _raise(RuntimeError('boom')))
    monkeypatch.setattr(receipts, 'render_order_receipt_pdf_raster', lambda *_a, **_k: called.__setitem__('fallback', True) or b'pdf')

    order = SimpleNamespace(created_at=datetime.now(timezone.utc), items=[], currency='RON')
    result = receipts.render_order_receipt_pdf(order)
    assert result == b'pdf'
    assert called['fallback'] is True
