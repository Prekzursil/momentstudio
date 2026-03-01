from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import zipfile

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus


def _request(
    *,
    headers: dict[str, str] | None = None,
    client_host: str | None = '127.0.0.1',
) -> Request:
    scope = {
        'type': 'http',
        'http_version': '1.1',
        'method': 'GET',
        'path': '/',
        'raw_path': b'/',
        'query_string': b'',
        'headers': [(k.lower().encode('latin-1'), v.encode('latin-1')) for k, v in (headers or {}).items()],
        'client': (client_host, 1234) if client_host else None,
        'server': ('testserver', 80),
        'scheme': 'http',
    }
    return Request(scope)


def _guest_payload(**overrides: object) -> SimpleNamespace:
    base = {
        'name': 'Guest User',
        'promo_code': '',
        'accept_terms': True,
        'accept_privacy': True,
        'password': 'secret123',
        'username': 'guestuser',
        'first_name': 'Guest',
        'last_name': 'User',
        'date_of_birth': '2000-01-01',
        'phone': '+40723204204',
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_orders_identifier_origin_and_actor_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        orders_api,
        'decode_token',
        lambda token: {'sub': 'user-123'} if token == 'good-token' else None,
    )

    assert orders_api._user_or_session_or_ip_identifier(_request(headers={'authorization': 'Bearer good-token'})) == 'user:user-123'
    assert orders_api._user_or_session_or_ip_identifier(_request(headers={'x-session-id': '  sid-1 '})) == 'sid:sid-1'
    assert orders_api._user_or_session_or_ip_identifier(_request(client_host='198.51.100.23')) == 'ip:198.51.100.23'
    assert orders_api._user_or_session_or_ip_identifier(_request(client_host=None)) == 'ip:anon'

    monkeypatch.setattr(orders_api.settings, 'cors_origins', ['https://allowed.example'], raising=False)
    monkeypatch.setattr(orders_api.settings, 'frontend_origin', 'https://fallback.example/', raising=False)
    assert (
        orders_api._frontend_base_from_request(_request(headers={'origin': 'https://allowed.example/'}))
        == 'https://allowed.example'
    )
    assert (
        orders_api._frontend_base_from_request(_request(headers={'origin': 'https://blocked.example'}))
        == 'https://fallback.example'
    )
    assert orders_api._frontend_base_from_request(None) == 'https://fallback.example'

    order_with_user = SimpleNamespace(user=SimpleNamespace(email=' owner@example.com '), customer_email='fallback@example.com')
    assert orders_api._resolve_order_contact_email(order_with_user) == 'owner@example.com'
    order_without_user = SimpleNamespace(user=None, customer_email=' customer@example.com ')
    assert orders_api._resolve_order_contact_email(order_without_user) == 'customer@example.com'
    assert orders_api._resolve_order_contact_email(SimpleNamespace(user=None, customer_email='  ')) is None

    actor = SimpleNamespace(email='admin@example.com', username='admin-user')
    assert orders_api._admin_actor_label(actor) == 'admin@example.com'
    assert orders_api._order_email_event_note(actor, '  sent update ') == 'admin@example.com: sent update'
    assert orders_api._shipping_label_event_name(' print ') == 'shipping_label_printed'
    assert orders_api._shipping_label_event_note(SimpleNamespace(email='', username='ops'), 'label.pdf') == 'ops: label.pdf'


def test_orders_payment_payload_and_normalization_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orders_api.secrets, 'randbelow', lambda _max: 42)
    assert orders_api._generate_guest_email_token() == '000042'
    assert orders_api._normalize_email(' USER@Example.COM ') == 'user@example.com'

    first_id = uuid4()
    second_id = uuid4()
    assert orders_api._account_orders_url(SimpleNamespace(reference_code='REF-1', id=first_id)) == '/account/orders?q=REF-1'
    assert orders_api._account_orders_url(SimpleNamespace(reference_code='', id=second_id)) == f'/account/orders?q={second_id}'

    assert orders_api._as_decimal(Decimal('1.25')) == Decimal('1.25')
    assert orders_api._as_decimal('1.50') == Decimal('1.50')
    assert orders_api._money_to_cents(Decimal('10.00')) == 1000

    assert orders_api._charge_label('shipping', 'ro') == 'Livrare'
    assert orders_api._charge_label('custom', 'en') == 'custom'

    variant_item = SimpleNamespace(
        product=SimpleNamespace(name=' Ring '),
        variant=SimpleNamespace(name=' Size 6 '),
        unit_price_at_add='12.50',
        quantity=2,
    )
    assert orders_api._cart_item_name(variant_item, lang='en') == 'Ring (Size 6)'
    assert orders_api._cart_item_name(SimpleNamespace(product=SimpleNamespace(name=' '), variant=None), lang='en') == 'Item'

    assert (
        orders_api._stripe_cart_line_item(
            SimpleNamespace(product=variant_item.product, variant=None, unit_price_at_add='9.99', quantity=0),
            lang='en',
        )
        is None
    )
    stripe_line = orders_api._stripe_cart_line_item(variant_item, lang='en')
    assert stripe_line is not None
    assert stripe_line['quantity'] == 2

    extra_lines: list[dict[str, object]] = []
    orders_api._append_stripe_charge_line_item(extra_lines, amount_cents=0, charge_kind='shipping', lang='en')
    orders_api._append_stripe_charge_line_item(extra_lines, amount_cents=350, charge_kind='discount', lang='en')
    assert len(extra_lines) == 1
    assert extra_lines[0]['price_data']['product_data']['name'] == 'Discount'

    cart = SimpleNamespace(
        items=[
            SimpleNamespace(product=SimpleNamespace(name='Pendant', sku='SKU-1'), variant=None, unit_price_at_add='19.99', quantity=1),
            SimpleNamespace(product=SimpleNamespace(name='Ignored', sku='SKU-2'), variant=None, unit_price_at_add='5.00', quantity=0),
        ]
    )
    totals = SimpleNamespace(shipping=Decimal('5.00'), fee=Decimal('1.00'), tax=Decimal('0.50'))
    stripe_items = orders_api._build_stripe_line_items(cart, totals, lang='en')
    assert len(stripe_items) == 4
    stripe_names = [line['price_data']['product_data']['name'] for line in stripe_items]
    assert stripe_names == ['Pendant', 'Shipping', 'Fee', 'VAT']

    paypal_items = orders_api._build_paypal_items(
        SimpleNamespace(
            items=[
                SimpleNamespace(product=SimpleNamespace(name='Pendant', sku=' SKU-1 '), variant=None, unit_price_at_add='19.99', quantity=1),
                SimpleNamespace(product=SimpleNamespace(name='Cord', sku=' '), variant=None, unit_price_at_add='4.00', quantity=1),
                SimpleNamespace(product=SimpleNamespace(name='Skip', sku='SKU-0'), variant=None, unit_price_at_add='1.00', quantity=0),
            ]
        ),
        lang='en',
    )
    assert len(paypal_items) == 2
    assert paypal_items[0]['sku'] == 'SKU-1'
    assert 'sku' not in paypal_items[1]

    assert orders_api._split_customer_name(' ') == ('Customer', 'Customer')
    assert orders_api._split_customer_name('Alice') == ('Alice', 'Alice')
    assert orders_api._split_customer_name('Alice B Cooper') == ('Alice', 'B Cooper')

    assert orders_api._resolve_country_payload(None) == (642, 'Romania')
    assert orders_api._resolve_country_payload('us') == (0, 'US')

    address = SimpleNamespace(
        line1=' Main St ',
        line2=' Apt 4 ',
        city='Los Angeles',
        country='us',
        region='CA',
        postal_code='90210',
    )
    assert orders_api._join_address_details(address) == 'Main St, Apt 4'
    payload = orders_api._netopia_address_payload(
        email=' buyer@example.com ',
        phone=None,
        first_name=' ',
        last_name='',
        addr=address,
    )
    assert payload['email'] == 'buyer@example.com'
    assert payload['phone'] == ''
    assert payload['firstName'] == 'Customer'
    assert payload['lastName'] == 'Customer'
    assert payload['country'] == 0
    assert payload['countryName'] == 'US'
    assert payload['details'] == 'Main St, Apt 4'


def test_orders_netopia_product_and_charge_helpers() -> None:
    named = SimpleNamespace(name=' Ring ', sku=' SKU-1 ', category=SimpleNamespace(name=' Jewelry '))
    fallback = SimpleNamespace(id=uuid4(), name=' ', sku=' ', category=None)

    assert orders_api._netopia_product_name(named) == 'Ring'
    assert orders_api._netopia_product_name(fallback) == 'Item'
    assert orders_api._netopia_product_code(named) == 'SKU-1'
    assert orders_api._netopia_product_code(fallback) == str(fallback.id)
    assert orders_api._netopia_product_category(named) == 'Jewelry'
    assert orders_api._netopia_product_category(fallback) == 'Product'

    assert (
        orders_api._netopia_order_item_line(
            SimpleNamespace(product=named, subtotal=Decimal('0.00')),
        )
        is None
    )
    line = orders_api._netopia_order_item_line(SimpleNamespace(product=named, subtotal=Decimal('19.99')))
    assert line is not None
    assert line['price'] == Decimal('19.99')

    lines: list[dict[str, object]] = []
    orders_api._append_netopia_charge_line(
        lines,
        amount_value=Decimal('0.00'),
        charge_kind='shipping',
        code='shipping',
        category='Shipping',
        lang='en',
    )
    orders_api._append_netopia_charge_line(
        lines,
        amount_value=Decimal('7.50'),
        charge_kind='shipping',
        code='shipping',
        category='Shipping',
        lang='ro',
    )
    assert len(lines) == 1
    assert lines[0]['name'] == 'Livrare'

    rebalance = [
        {'name': 'A', 'code': 'a', 'category': 'cat', 'price': Decimal('10.00'), 'vat': 0},
        {'name': 'B', 'code': 'b', 'category': 'cat', 'price': Decimal('5.00'), 'vat': 0},
    ]
    orders_api._rebalance_netopia_lines_total(rebalance, target=Decimal('12.00'))
    assert sum((row['price'] for row in rebalance), Decimal('0.00')) == Decimal('12.00')

    order = SimpleNamespace(
        items=[SimpleNamespace(product=named, subtotal=Decimal('20.00'))],
        shipping_amount=Decimal('3.00'),
        fee_amount=Decimal('1.00'),
        tax_amount=Decimal('1.00'),
        total_amount=Decimal('24.00'),
    )
    products = orders_api._build_netopia_products(order, lang='en')
    assert len(products) == 4
    assert {item['name'] for item in products} >= {'Ring', 'Shipping'}


def test_orders_shipping_label_archive_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    label_path = tmp_path / 'label.pdf'
    label_path.write_bytes(b'pdf-content')

    monkeypatch.setattr(
        orders_api.private_storage,
        'resolve_private_path',
        lambda rel: tmp_path / Path(rel).name,
    )

    existing_order = SimpleNamespace(
        id=uuid4(),
        shipping_label_path='nested/label.pdf',
        shipping_label_filename='../invoice.pdf',
        reference_code='REF-42',
    )
    missing_order = SimpleNamespace(
        id=uuid4(),
        shipping_label_path='nested/missing.pdf',
        shipping_label_filename='missing.pdf',
        reference_code='REF-43',
    )

    zip_entry = orders_api._order_shipping_label_zip_entry(existing_order)
    assert zip_entry is not None
    assert zip_entry[0] == label_path
    assert zip_entry[1] == 'REF-42-invoice.pdf'
    assert orders_api._order_shipping_label_zip_entry(missing_order) is None

    files, missing = orders_api._collect_batch_shipping_label_files([existing_order, missing_order])
    assert len(files) == 1
    assert missing == [str(missing_order.id)]

    with pytest.raises(HTTPException, match='missing_shipping_label_order_ids'):
        orders_api._raise_for_missing_shipping_labels(missing)

    buf = orders_api._build_shipping_labels_zip_buffer(files)
    with zipfile.ZipFile(buf) as archive:
        assert archive.namelist() == ['REF-42-invoice.pdf']
    buf.seek(0)
    chunks = list(orders_api._iter_bytes_buffer(buf, chunk_size=3))
    assert b''.join(chunks)

    monkeypatch.setattr(orders_api, 'MAX_BATCH_SHIPPING_LABEL_ARCHIVE_BYTES', 1)
    with pytest.raises(HTTPException, match='archive too large'):
        orders_api._collect_batch_shipping_label_files([existing_order])


def test_orders_receipt_and_confirmation_access_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    order_id = uuid4()
    owner_id = uuid4()
    order = SimpleNamespace(id=order_id, user_id=owner_id, netopia_ntp_id='NTP-1')

    admin_user = SimpleNamespace(id=uuid4(), role='admin')
    owner_user = SimpleNamespace(id=owner_id, role='customer')
    other_user = SimpleNamespace(id=uuid4(), role='customer')

    assert orders_api._can_manage_receipt_share(order, admin_user) is True
    assert orders_api._can_manage_receipt_share(order, owner_user) is True
    assert orders_api._can_manage_receipt_share(order, other_user) is False
    orders_api._require_receipt_share_access(order, admin_user)
    with pytest.raises(HTTPException, match='Not allowed'):
        orders_api._require_receipt_share_access(order, other_user)

    monkeypatch.setattr(orders_api, 'decode_receipt_token', lambda token: (str(order_id), 2) if token == 'valid' else None)
    decoded_order_id, token_version = orders_api._decode_receipt_token_order('valid')
    assert decoded_order_id == order_id
    assert token_version == 2
    with pytest.raises(HTTPException, match='Invalid receipt token'):
        orders_api._decode_receipt_token_order('invalid')

    monkeypatch.setattr(orders_api, 'decode_receipt_token', lambda _token: ('bad-uuid', 'x'))
    with pytest.raises(HTTPException, match='Invalid receipt token'):
        orders_api._decode_receipt_token_order('bad')

    assert orders_api._allow_receipt_full_details(order, owner_user, reveal=True) is True
    assert orders_api._allow_receipt_full_details(order, admin_user, reveal=True) is True
    assert orders_api._allow_receipt_full_details(order, other_user, reveal=True) is False
    assert orders_api._allow_receipt_full_details(order, owner_user, reveal=False) is False

    orders_api._assert_confirmation_order_match(order, order_id)
    with pytest.raises(HTTPException, match='Order mismatch'):
        orders_api._assert_confirmation_order_match(order, uuid4())
    orders_api._assert_confirmation_access(order, owner_user, payload_order_id=None)
    orders_api._assert_confirmation_access(order, None, payload_order_id=order_id)
    with pytest.raises(HTTPException, match='Not allowed'):
        orders_api._assert_confirmation_access(order, other_user, payload_order_id=None)


def test_orders_checkout_and_guest_validation_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    cart = SimpleNamespace(items=[SimpleNamespace(id=1)])
    orders_api._assert_cart_has_items(cart)
    with pytest.raises(HTTPException, match='Cart is empty'):
        orders_api._assert_cart_has_items(SimpleNamespace(items=[]))

    monkeypatch.setattr(orders_api.cart_service, 'delivery_constraints', lambda _cart: (False, {'sameday'}))
    orders_api._assert_delivery_available_for_cart(cart, courier='sameday', delivery_type='home')
    with pytest.raises(HTTPException, match='Locker delivery is not available'):
        orders_api._assert_delivery_available_for_cart(cart, courier='sameday', delivery_type='locker')
    with pytest.raises(HTTPException, match='Selected courier is not available'):
        orders_api._assert_delivery_available_for_cart(cart, courier='fan', delivery_type='home')

    monkeypatch.setattr(orders_api.cart_service, 'delivery_constraints', lambda _cart: (False, set()))
    with pytest.raises(HTTPException, match='No couriers available'):
        orders_api._assert_delivery_available_for_cart(cart, courier='sameday', delivery_type='home')

    assert (
        orders_api._resolve_checkout_phone(
            payload_phone='  +40123 ',
            fallback_phone='+40999',
            phone_required=True,
        )
        == '+40123'
    )
    assert (
        orders_api._resolve_checkout_phone(
            payload_phone=' ',
            fallback_phone=' +40999 ',
            phone_required=False,
        )
        == '+40999'
    )
    with pytest.raises(HTTPException, match='Phone is required'):
        orders_api._resolve_checkout_phone(payload_phone=' ', fallback_phone=None, phone_required=True)

    assert orders_api._shipping_rate_tuple(None) == (None, None)
    rates = orders_api._shipping_rate_tuple(SimpleNamespace(rate_flat='7.5', rate_per_kg='1.25'))
    assert rates == (Decimal('7.5'), Decimal('1.25'))

    assert orders_api._has_complete_billing_address(line1='a', city='b', postal_code='c', country='ro') is True
    assert orders_api._has_complete_billing_address(line1='a', city='b', postal_code=' ', country='ro') is False
    assert orders_api._checkout_billing_label(save_address=True) == 'Checkout (Billing)'
    assert orders_api._checkout_billing_label(save_address=False) == 'Checkout (Billing) · One-time'
    assert orders_api._billing_line_present('  ') is False
    assert orders_api._default_shipping_flag(save_address=True, explicit_default=None) is True
    assert orders_api._default_shipping_flag(save_address=False, explicit_default=True) is False
    assert orders_api._guest_shipping_label(create_account=False) == 'Guest Checkout'
    assert orders_api._guest_billing_label(create_account=False) == 'Guest Checkout (Billing)'
    assert orders_api._guest_default_shipping(save_address=True, create_account=True) is True
    assert orders_api._guest_default_billing(save_address=True, create_account=True, billing_same_as_shipping=True) is True

    assert orders_api._require_guest_customer_name(_guest_payload(name='  Alice  ')) == 'Alice'
    with pytest.raises(HTTPException, match='Name is required'):
        orders_api._require_guest_customer_name(_guest_payload(name=' '))

    orders_api._assert_guest_checkout_consents(_guest_payload())
    with pytest.raises(HTTPException, match='Legal consents required'):
        orders_api._assert_guest_checkout_consents(_guest_payload(accept_terms=False))

    orders_api._assert_guest_checkout_no_coupon(_guest_payload(promo_code=' '))
    with pytest.raises(HTTPException, match='Sign in to use coupons'):
        orders_api._assert_guest_checkout_no_coupon(_guest_payload(promo_code='SAVE10'))

    required_fields = [
        ('password', 'Password is required'),
        ('username', 'Username is required'),
        ('first_name', 'First name is required'),
        ('last_name', 'Last name is required'),
        ('date_of_birth', 'Date of birth is required'),
        ('phone', 'Phone is required'),
    ]
    for field, detail in required_fields:
        with pytest.raises(HTTPException, match=detail):
            orders_api._validate_guest_account_creation(_guest_payload(**{field: None}))


def test_orders_payment_confirmation_helpers() -> None:
    assert orders_api._required_paypal_order_id('  PO-1 ') == 'PO-1'
    with pytest.raises(HTTPException, match='PayPal order id is required'):
        orders_api._required_paypal_order_id('  ')

    orders_api._assert_paypal_capture_order(SimpleNamespace(payment_method='paypal'))
    with pytest.raises(HTTPException, match='not a PayPal order'):
        orders_api._assert_paypal_capture_order(SimpleNamespace(payment_method='stripe'))

    allowed_statuses = [OrderStatus.pending_payment, OrderStatus.pending_acceptance, OrderStatus.paid]
    for allowed in allowed_statuses:
        orders_api._assert_paypal_capture_status(SimpleNamespace(status=allowed))
    with pytest.raises(HTTPException, match='cannot be captured'):
        orders_api._assert_paypal_capture_status(SimpleNamespace(status=OrderStatus.cancelled))

    assert orders_api._stripe_session_value({'payment_intent': 'pi_dict'}, 'payment_intent') == 'pi_dict'
    assert orders_api._stripe_session_value(SimpleNamespace(payment_intent='pi_obj'), 'payment_intent') == 'pi_obj'
    assert orders_api._stripe_session_value(SimpleNamespace(), 'payment_intent') is None

    with pytest.raises(HTTPException, match='Payment declined'):
        orders_api._apply_stripe_confirmation_outcome(
            SimpleNamespace(mock='decline'),
            mock_mode=True,
            order=SimpleNamespace(stripe_payment_intent_id=None),
            checkout_session=None,
        )

    stripe_order = SimpleNamespace(stripe_payment_intent_id=None)
    orders_api._apply_stripe_confirmation_outcome(
        SimpleNamespace(mock='success'),
        mock_mode=False,
        order=stripe_order,
        checkout_session={'payment_intent': 'pi_123'},
    )
    assert stripe_order.stripe_payment_intent_id == 'pi_123'

    assert orders_api._order_has_payment_captured(SimpleNamespace(events=[SimpleNamespace(event='payment_captured')])) is True
    assert orders_api._order_has_payment_captured(SimpleNamespace(events=[SimpleNamespace(event='status_change')])) is False

    order = SimpleNamespace(netopia_ntp_id='NTP-1')
    assert orders_api._netopia_confirmation_transaction_id(order, payload_ntp_id='NTP-1') == 'NTP-1'
    with pytest.raises(HTTPException, match='Transaction mismatch'):
        orders_api._netopia_confirmation_transaction_id(order, payload_ntp_id='NTP-2')
    with pytest.raises(HTTPException, match='Missing Netopia transaction id'):
        orders_api._netopia_confirmation_transaction_id(SimpleNamespace(netopia_ntp_id=''), payload_ntp_id=None)

    orders_api._assert_netopia_status_completed({'payment': {'status': 3}})
    orders_api._assert_netopia_status_completed({'payment': {'status': '5'}})
    with pytest.raises(HTTPException, match='Payment not completed'):
        orders_api._assert_netopia_status_completed({'payment': {'status': 1}})

    assert orders_api._netopia_error_details({'error': {'code': '00', 'message': 'OK'}}) == ('00', 'OK')
    assert orders_api._netopia_error_details({'error': 'invalid'}) == ('', '')
    orders_api._assert_netopia_error_success({'error': {'code': '00', 'message': 'Approved'}})
    with pytest.raises(HTTPException, match='Declined by bank'):
        orders_api._assert_netopia_error_success({'error': {'code': '51', 'message': 'Declined by bank'}})

    contact = orders_api._payment_capture_contact(
        SimpleNamespace(
            user=SimpleNamespace(email='owner@example.com', preferred_language='ro'),
            customer_email='fallback@example.com',
        )
    )
    assert contact == ('owner@example.com', 'ro')
    fallback_contact = orders_api._payment_capture_contact(SimpleNamespace(user=None, customer_email='fallback@example.com'))
    assert fallback_contact == ('fallback@example.com', None)
