from email.message import EmailMessage
from types import SimpleNamespace

from app.services import email as email_service


def test_first_non_empty_str_prefers_first_non_blank_value() -> None:
    assert email_service._first_non_empty_str(None, '  ', 'Alice', default='fallback') == 'Alice'
    assert email_service._first_non_empty_str(None, '', default='fallback') == 'fallback'


def test_apply_message_headers_skips_protected_and_blank_entries() -> None:
    msg = EmailMessage()
    msg['Subject'] = 'Original'
    msg['From'] = 'from@example.com'
    msg['To'] = 'to@example.com'

    email_service._apply_message_headers(
        msg,
        {
            'X-Trace': 'abc123',
            'subject': 'ignored',
            ' ': 'ignored',
            'X-Empty': '',
        },
    )

    assert msg['Subject'] == 'Original'
    assert msg['X-Trace'] == 'abc123'
    assert 'X-Empty' not in msg


def test_add_message_attachments_only_accepts_binary_content() -> None:
    msg = EmailMessage()
    msg.set_content('hello')

    email_service._add_message_attachments(
        msg,
        [
            {'filename': 'valid.txt', 'mime': 'text/plain', 'content': b'hello'},
            {'filename': 'invalid.txt', 'mime': 'text/plain', 'content': 'not-bytes'},
        ],
    )

    attachments = list(msg.iter_attachments())
    assert len(attachments) == 1
    assert attachments[0].get_filename() == 'valid.txt'


def test_build_message_populates_html_headers_and_attachments() -> None:
    msg = email_service._build_message(
        to_email='user@example.com',
        subject='Subject',
        text_body='Text body',
        html_body='<p>HTML</p>',
        headers={'X-Custom': 'yes', 'From': 'ignored@example.com'},
        attachments=[{'filename': 'a.bin', 'mime': 'application/octet-stream', 'content': b'xx'}],
    )

    assert msg['To'] == 'user@example.com'
    assert msg['Subject'] == 'Subject'
    assert msg['X-Custom'] == 'yes'
    assert msg.is_multipart()
    assert any(part.get_content_subtype() == 'html' for part in msg.walk())
    assert any(part.get_filename() == 'a.bin' for part in msg.walk())


def test_html_pre_escapes_content() -> None:
    rendered = email_service._html_pre('<b>unsafe</b>')
    assert '&lt;b&gt;unsafe&lt;/b&gt;' in rendered


def test_money_str_formats_and_fallback_truncates() -> None:
    assert email_service._money_str('12.3456', 'RON') == '12.35 RON'

    long_value = 'x' * 80
    fallback = email_service._money_str(long_value, 'EUR')
    assert fallback.endswith(' EUR')
    assert '...' in fallback


def test_language_helpers_and_optional_labeled_line() -> None:
    assert email_service._lang_or_default('ro') == 'ro'
    assert email_service._lang_or_default('fr') == 'en'
    assert email_service._localized_text(lang='ro', ro='Salut', en='Hello') == 'Salut'

    lines: list[str] = []
    email_service._append_optional_labeled_line(lines, value=' 123 ', label_ro='Telefon', label_en='Phone', lang='en')
    email_service._append_optional_labeled_line(lines, value=' ', label_ro='Telefon', label_en='Phone', lang='en')
    assert lines == ['Phone: 123']


def test_marketing_unsubscribe_context_builds_headers(monkeypatch) -> None:
    monkeypatch.setattr(email_service.newsletter_tokens, 'create_newsletter_token', lambda **_: 'token-1')
    monkeypatch.setattr(
        email_service.newsletter_tokens,
        'build_frontend_unsubscribe_url',
        lambda token: f'https://site.test/unsubscribe/{token}',
    )
    monkeypatch.setattr(
        email_service.newsletter_tokens,
        'build_api_unsubscribe_url',
        lambda token: f'https://api.test/unsubscribe/{token}',
    )
    monkeypatch.setattr(email_service.settings, 'list_unsubscribe_mailto', 'help@example.com')

    unsubscribe_url, headers = email_service._marketing_unsubscribe_context(to_email='User@Example.com')

    assert unsubscribe_url == 'https://site.test/unsubscribe/token-1'
    assert '<https://api.test/unsubscribe/token-1>' in headers['List-Unsubscribe']
    assert '<mailto:help@example.com>' in headers['List-Unsubscribe']
    assert headers['List-Unsubscribe-Post'] == 'List-Unsubscribe=One-Click'


def test_delivery_and_payment_related_helpers(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, 'frontend_origin', 'https://shop.test')

    order = SimpleNamespace(
        courier='fan',
        delivery_type='locker',
        locker_name='Locker 10',
        locker_address='Main Street',
    )

    lines = email_service._delivery_lines(order, lang='en')
    assert lines[0] == 'Delivery: Fan Courier · Locker pickup'
    assert lines[1] == 'Locker: Locker 10 — Main Street'
    assert email_service._payment_method_label('cod', lang='en') == 'Cash'

    product = SimpleNamespace(name='Tea Set', slug='tea-set')
    item = SimpleNamespace(product=product, product_id='p1', quantity=2, unit_price='13.5')
    assert '/products/tea-set' in email_service._order_item_line(item, currency='RON')

    item_without_price = SimpleNamespace(product=None, product_id='p2', quantity=1, unit_price=None)
    assert email_service._order_item_line(item_without_price, currency='RON') == '- p2 ×1'
