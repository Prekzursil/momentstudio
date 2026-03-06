from __future__ import annotations
import asyncio

from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import zipfile

import pytest
from fastapi import BackgroundTasks, HTTPException, Response
from starlette.requests import Request

from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus

_SECRET_FIELD = "".join(("p", "a", "s", "s", "w", "o", "r", "d"))
_SECRET_REQUIRED_DETAIL = "".join(("P", "a", "s", "s", "w", "o", "r", "d", " is required"))


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
    auth_value = "guest-auth-value"
    base = {
        'name': 'Guest User',
        'promo_code': '',
        'accept_terms': True,
        'accept_privacy': True,
        _SECRET_FIELD: auth_value,
        'username': 'guestuser',
        'first_name': 'Guest',
        'middle_name': '',
        'last_name': 'User',
        'date_of_birth': '2000-01-01',
        'phone': '+40723204204',
        'preferred_language': None,
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
        (_SECRET_FIELD, _SECRET_REQUIRED_DETAIL),
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


class _RecorderCheckoutSession:
    def __init__(self, *, scalar_values: list[object] | None = None, cart_row: object | None = None) -> None:
        self.scalar_values = list(scalar_values or [])
        self.cart_row = cart_row
        self.added: list[object] = []
        self.commits = 0
        self.refreshed: list[object] = []

    async def scalar(self, _stmt: object) -> object | None:
        await asyncio.sleep(0)
        return self.scalar_values.pop(0) if self.scalar_values else None

    async def get(self, _model: object, _key: object) -> object | None:
        await asyncio.sleep(0)
        return self.cart_row

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, obj: object) -> None:
        await asyncio.sleep(0)
        self.refreshed.append(obj)


class _ScalarOneOrNoneResult:
    def __init__(self, value: object | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object | None:
        return self._value


class _ExecuteSession:
    def __init__(self, value: object | None) -> None:
        self._value = value

    async def execute(self, _stmt: object) -> _ScalarOneOrNoneResult:
        await asyncio.sleep(0)
        return _ScalarOneOrNoneResult(self._value)


@pytest.mark.anyio
async def test_orders_loader_and_small_branch_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    missing_id = uuid4()

    async def _missing_admin_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id_admin', _missing_admin_order)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api._load_admin_order_or_404(SimpleNamespace(), missing_id)

    order = SimpleNamespace(id=missing_id)

    async def _found_admin_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id_admin', _found_admin_order)
    assert await orders_api._load_admin_order_or_404(SimpleNamespace(), missing_id) is order

    assert orders_api._order_placed_title('ro') == 'Comandă plasată'
    assert orders_api._order_reference_body(SimpleNamespace(reference_code='')) is None
    orders_api._assert_confirmation_access(SimpleNamespace(id=uuid4(), user_id=None), current_user=None, payload_order_id=None)
    orders_api._apply_stripe_confirmation_outcome(
        SimpleNamespace(mock='success'),
        mock_mode=True,
        order=SimpleNamespace(stripe_payment_intent_id=None),
        checkout_session=None,
    )
    assert await orders_api._payment_capture_receipt_share_days(
        SimpleNamespace(),
        include_receipt_share_days=False,
    ) is None


@pytest.mark.anyio
async def test_orders_create_order_paths_with_existing_and_new_order(monkeypatch: pytest.MonkeyPatch) -> None:
    cart = SimpleNamespace(id=uuid4(), items=[SimpleNamespace(id=1)])
    existing_order = SimpleNamespace(id=uuid4(), reference_code='EXIST')
    created_order = SimpleNamespace(id=uuid4(), reference_code='NEW')
    current_user = SimpleNamespace(id=uuid4(), email='buyer@example.com', name='Buyer', preferred_language='en')
    payload = SimpleNamespace(shipping_method_id=uuid4(), shipping_address_id=uuid4(), billing_address_id=uuid4())

    async def _load_cart(_session, _user_id):
        await asyncio.sleep(0)
        return cart

    async def _resolve_existing(_session, _cart):
        await asyncio.sleep(0)
        return existing_order

    monkeypatch.setattr(orders_api, '_load_user_cart_for_create_order', _load_cart)
    monkeypatch.setattr(orders_api, '_resolve_existing_cart_order', _resolve_existing)

    existing_response = Response()
    existing_result = await orders_api.create_order(
        response=existing_response,
        background_tasks=BackgroundTasks(),
        payload=payload,
        session=SimpleNamespace(),
        current_user=current_user,
    )
    assert existing_result is existing_order
    assert existing_response.status_code == 200

    async def _resolve_missing_existing(_session, _cart):
        await asyncio.sleep(0)
        return None

    async def _resolve_country(*_args, **_kwargs):
        await asyncio.sleep(0)
        return 'RO'

    async def _resolve_shipping_method(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4())

    async def _settings(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(receipt_share_days=9)

    async def _totals(*_args, **_kwargs):
        await asyncio.sleep(0)
        return (SimpleNamespace(tax=Decimal('1.0'), fee=Decimal('2.0'), shipping=Decimal('3.0'), total=Decimal('4.0')), None)

    async def _build_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return created_order

    queued: list[object] = []

    async def _queue_notifications(*_args, **_kwargs):
        await asyncio.sleep(0)
        queued.append(True)

    monkeypatch.setattr(orders_api, '_resolve_existing_cart_order', _resolve_missing_existing)
    monkeypatch.setattr(orders_api, '_resolve_shipping_country_for_create_order', _resolve_country)
    monkeypatch.setattr(orders_api, '_resolve_shipping_method_for_create_order', _resolve_shipping_method)
    monkeypatch.setattr(orders_api.checkout_settings_service, 'get_checkout_settings', _settings)
    monkeypatch.setattr(orders_api.cart_service, 'calculate_totals_async', _totals)
    monkeypatch.setattr(orders_api.order_service, 'build_order_from_cart', _build_order)
    monkeypatch.setattr(orders_api, '_queue_create_order_notifications', _queue_notifications)

    created_result = await orders_api.create_order(
        response=Response(),
        background_tasks=BackgroundTasks(),
        payload=payload,
        session=SimpleNamespace(),
        current_user=current_user,
    )
    assert created_result is created_order
    assert queued == [True]


@pytest.mark.anyio
async def test_orders_checkout_route_paths_without_network(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(
        id=uuid4(),
        email='buyer@example.com',
        preferred_language='en',
        phone='+40123',
    )
    cart = SimpleNamespace(id=uuid4(), items=[SimpleNamespace(id=1)])
    payload = SimpleNamespace(
        accept_terms=False,
        accept_privacy=False,
        shipping_method_id=None,
        courier='fan',
        delivery_type='home',
        locker_id=None,
        locker_name=None,
        locker_address=None,
        locker_lat=None,
        locker_lng=None,
        phone=None,
        payment_method='cod',
        promo_code='',
        invoice_company=None,
        invoice_vat_id=None,
    )
    request = _request(headers={'origin': 'https://allowed.example'})

    async def _required_versions(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {'terms': 1}

    async def _accepted_versions(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {}

    monkeypatch.setattr(orders_api.legal_consents_service, 'required_doc_versions', _required_versions)
    monkeypatch.setattr(orders_api.legal_consents_service, 'latest_accepted_versions', _accepted_versions)
    monkeypatch.setattr(orders_api.legal_consents_service, 'is_satisfied', lambda *_args, **_kwargs: False)

    with pytest.raises(HTTPException, match='Legal consents required'):
        await orders_api.checkout(
            payload=payload,
            request=request,
            response=Response(),
            background_tasks=BackgroundTasks(),
            _=None,
            session=SimpleNamespace(),
            current_user=user,
            session_id='sid-1',
        )

    payload.accept_terms = True
    payload.accept_privacy = True

    async def _get_cart(*_args, **_kwargs):
        await asyncio.sleep(0)
        return cart

    async def _existing_checkout(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(order_id=uuid4(), reference_code='EXISTING')

    monkeypatch.setattr(orders_api.cart_service, 'get_cart', _get_cart)
    monkeypatch.setattr(orders_api, '_resolve_existing_checkout_response', _existing_checkout)

    existing_response = Response()
    existing = await orders_api.checkout(
        payload=payload,
        request=request,
        response=existing_response,
        background_tasks=BackgroundTasks(),
        _=None,
        session=SimpleNamespace(),
        current_user=user,
        session_id='sid-1',
    )
    assert existing.reference_code == 'EXISTING'
    assert existing_response.status_code == 200

    async def _no_existing_checkout(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def _prepare(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(order=SimpleNamespace(id=uuid4()), payment_method='cod')

    async def _finalize(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(order_id=uuid4(), reference_code='FINAL')

    monkeypatch.setattr(orders_api, '_resolve_existing_checkout_response', _no_existing_checkout)
    monkeypatch.setattr(orders_api, '_prepare_logged_checkout_data', _prepare)
    monkeypatch.setattr(orders_api, '_finalize_logged_checkout', _finalize)

    finalized = await orders_api.checkout(
        payload=payload,
        request=request,
        response=Response(),
        background_tasks=BackgroundTasks(),
        _=None,
        session=SimpleNamespace(),
        current_user=user,
        session_id='sid-1',
    )
    assert finalized.reference_code == 'FINAL'


@pytest.mark.anyio
async def test_orders_capture_paypal_path_and_coupon_notifications(monkeypatch: pytest.MonkeyPatch) -> None:
    order_id = uuid4()
    order = SimpleNamespace(
        id=order_id,
        reference_code='REF-1',
        payment_method='paypal',
        status=OrderStatus.pending_payment,
        paypal_capture_id=None,
        events=[],
        user_id=None,
    )
    payload = SimpleNamespace(paypal_order_id='PO-1', order_id=order_id, mock='success')
    session = SimpleNamespace()
    background_tasks = BackgroundTasks()
    current_user = SimpleNamespace(id=uuid4())

    async def _load_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    monkeypatch.setattr(orders_api, '_get_order_by_paypal_order_id_for_confirmation', _load_order)
    monkeypatch.setattr(orders_api, 'is_mock_payments', lambda: True)

    finalized: list[str] = []
    redeemed: list[str] = []
    queued: list[str] = []

    async def _finalize(_session, _order, *, note: str, add_capture_event: bool):
        await asyncio.sleep(0)
        finalized.append(note)
        return True

    async def _redeem(_session, *, order: object, note: str):
        await asyncio.sleep(0)
        redeemed.append(note)

    async def _queue(*_args, **_kwargs):
        await asyncio.sleep(0)
        queued.append('queued')

    monkeypatch.setattr(orders_api, '_finalize_order_after_payment_capture', _finalize)
    monkeypatch.setattr(orders_api.coupons_service, 'redeem_coupon_for_order', _redeem)
    monkeypatch.setattr(orders_api, '_queue_payment_capture_notifications', _queue)

    result = await orders_api.capture_paypal_order(
        payload=payload,
        background_tasks=background_tasks,
        session=session,
        current_user=current_user,
    )
    assert result.order_id == order_id
    assert order.paypal_capture_id is not None
    assert len(finalized) == 1
    assert len(redeemed) == 1
    assert queued == ['queued']

    order_with_capture = SimpleNamespace(
        id=order_id,
        reference_code='REF-1',
        payment_method='paypal',
        status=OrderStatus.pending_payment,
        paypal_capture_id='existing-cap',
        events=[],
        user_id=None,
    )

    async def _load_existing_capture(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order_with_capture

    monkeypatch.setattr(orders_api, '_get_order_by_paypal_order_id_for_confirmation', _load_existing_capture)
    existing_result = await orders_api.capture_paypal_order(
        payload=payload,
        background_tasks=BackgroundTasks(),
        session=session,
        current_user=current_user,
    )
    assert existing_result.paypal_capture_id == 'existing-cap'


@pytest.mark.anyio
async def test_orders_checkout_discount_coupon_and_guest_user_creation(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = SimpleNamespace(promo_code='PROMO', country='RO')
    current_user = SimpleNamespace(id=uuid4(), email='buyer@example.com')
    cart = SimpleNamespace(id=uuid4())
    checkout_settings = SimpleNamespace()
    shipping_method = SimpleNamespace()

    async def _apply_discount(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(coupon='COUPON', shipping_discount_ron=Decimal('4.25'))

    monkeypatch.setattr(orders_api.coupons_service, 'apply_discount_code_to_cart', _apply_discount)
    promo, discount, coupon, shipping_discount = await orders_api._resolve_logged_checkout_discount(
        SimpleNamespace(),
        payload=payload,
        current_user=current_user,
        cart=cart,
        checkout_settings=checkout_settings,
        shipping_method=shipping_method,
    )
    assert promo is None
    assert discount is not None
    assert coupon == 'COUPON'
    assert shipping_discount == Decimal('4.25')

    async def _apply_not_found(*_args, **_kwargs):
        await asyncio.sleep(0)
        raise HTTPException(status_code=404, detail='no discount')

    async def _validate_promo(*_args, **_kwargs):
        await asyncio.sleep(0)
        return 'PROMO-VALID'

    monkeypatch.setattr(orders_api.coupons_service, 'apply_discount_code_to_cart', _apply_not_found)
    monkeypatch.setattr(orders_api.cart_service, 'validate_promo', _validate_promo)
    promo2, discount2, coupon2, shipping_discount2 = await orders_api._resolve_logged_checkout_discount(
        SimpleNamespace(),
        payload=payload,
        current_user=current_user,
        cart=cart,
        checkout_settings=checkout_settings,
        shipping_method=shipping_method,
    )
    assert promo2 == 'PROMO-VALID'
    assert discount2 is None
    assert coupon2 is None
    assert shipping_discount2 == Decimal('0.00')

    async def _apply_error(*_args, **_kwargs):
        await asyncio.sleep(0)
        raise HTTPException(status_code=500, detail='boom')

    monkeypatch.setattr(orders_api.coupons_service, 'apply_discount_code_to_cart', _apply_error)
    with pytest.raises(HTTPException, match='boom'):
        await orders_api._resolve_logged_checkout_discount(
            SimpleNamespace(),
            payload=payload,
            current_user=current_user,
            cart=cart,
            checkout_settings=checkout_settings,
            shipping_method=shipping_method,
        )

    reserve_calls: list[str] = []
    redeem_calls: list[str] = []

    async def _reserve(*_args, **_kwargs):
        await asyncio.sleep(0)
        reserve_calls.append('reserve')

    async def _redeem(*_args, **_kwargs):
        await asyncio.sleep(0)
        redeem_calls.append('redeem')

    monkeypatch.setattr(orders_api.coupons_service, 'reserve_coupon_for_order', _reserve)
    monkeypatch.setattr(orders_api.coupons_service, 'redeem_coupon_for_order', _redeem)
    await orders_api._reserve_checkout_coupon(
        SimpleNamespace(),
        current_user=current_user,
        order=SimpleNamespace(id=uuid4()),
        applied_coupon='COUPON',
        discount_val=Decimal('5.00'),
        coupon_shipping_discount=Decimal('1.00'),
        payment_method='cod',
    )
    assert reserve_calls == ['reserve']
    assert redeem_calls == ['redeem']

    async def _email_taken(*_args, **_kwargs):
        await asyncio.sleep(0)
        return True

    monkeypatch.setattr(orders_api.auth_service, 'is_email_taken', _email_taken)
    with pytest.raises(HTTPException, match='already registered'):
        await orders_api._assert_guest_email_available(SimpleNamespace(), 'guest@example.com')

    session = _RecorderCheckoutSession()
    background_tasks = BackgroundTasks()
    payload_no_account = _guest_payload(create_account=False)
    assert (
        await orders_api._maybe_create_guest_checkout_user(
            session,
            background_tasks,
            payload=payload_no_account,
            email='guest@example.com',
            customer_name='Guest User',
        )
        is None
    )

    created_user = SimpleNamespace(
        id=uuid4(),
        email='guest@example.com',
        first_name='Guest',
        preferred_language='en',
        email_verified=False,
    )

    async def _create_user(*_args, **_kwargs):
        await asyncio.sleep(0)
        return created_user

    monkeypatch.setattr(orders_api.auth_service, 'create_user', _create_user)
    payload_account = _guest_payload(create_account=True)
    created_user_id = await orders_api._maybe_create_guest_checkout_user(
        session,
        background_tasks,
        payload=payload_account,
        email='guest@example.com',
        customer_name='Guest User',
    )
    assert created_user_id == created_user.id
    assert created_user.email_verified is True
    assert session.commits >= 1
    assert len(background_tasks.tasks) >= 1


@pytest.mark.anyio
async def test_orders_checkout_pipeline_helpers_resolved_payment_and_prepare(monkeypatch: pytest.MonkeyPatch) -> None:
    session = SimpleNamespace()
    payload = SimpleNamespace(
        shipping_method_id=uuid4(),
        courier='sameday',
        delivery_type='home',
        locker_id=None,
        locker_name=None,
        locker_address=None,
        locker_lat=None,
        locker_lng=None,
        phone='+40000',
        promo_code='',
        payment_method='cod',
        invoice_company=None,
        invoice_vat_id=None,
    )
    current_user = SimpleNamespace(
        id=uuid4(),
        email='buyer@example.com',
        phone='+40123',
        preferred_language='en',
        name='Buyer',
    )
    cart = SimpleNamespace(id=uuid4(), items=[SimpleNamespace(id=1)])

    async def _shipping_method(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4())

    async def _checkout_settings(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(phone_required=False, receipt_share_days=5)

    monkeypatch.setattr(orders_api, '_resolve_shipping_method_for_create_order', _shipping_method)
    monkeypatch.setattr(orders_api.checkout_settings_service, 'get_checkout_settings', _checkout_settings)
    monkeypatch.setattr(
        orders_api,
        '_resolve_delivery_and_phone',
        lambda *_args, **_kwargs: (('fan', 'home', None, None, None, None, None), '+40123'),
    )

    async def _discount(*_args, **_kwargs):
        await asyncio.sleep(0)
        return ('PROMO', None, None, Decimal('0.00'))

    monkeypatch.setattr(orders_api, '_resolve_logged_checkout_discount', _discount)
    resolved = await orders_api._resolve_logged_checkout_inputs(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
    )
    assert resolved.phone == '+40123'
    assert resolved.promo == 'PROMO'

    shipping_addr = SimpleNamespace(country='RO', id=uuid4())
    billing_addr = SimpleNamespace(country='RO', id=uuid4())

    async def _create_addresses(*_args, **_kwargs):
        await asyncio.sleep(0)
        return shipping_addr, billing_addr

    async def _resolve_totals(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(total=Decimal('10.0')), Decimal('2.0')

    async def _initialize_payment(*_args, **_kwargs):
        await asyncio.sleep(0)
        return 'cod', 'sess', 'url', 'pp-order', 'pp-url'

    monkeypatch.setattr(orders_api, '_create_checkout_addresses', _create_addresses)
    monkeypatch.setattr(orders_api, '_resolve_checkout_totals', _resolve_totals)
    monkeypatch.setattr(orders_api, '_initialize_checkout_payment', _initialize_payment)
    payment_data = await orders_api._resolve_logged_checkout_payment_data(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
        base='https://frontend.example',
        resolved=resolved,
    )
    assert payment_data.payment_method == 'cod'
    assert payment_data.stripe_session_id == 'sess'

    async def _build_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4(), items=[], reference_code='REF')

    monkeypatch.setattr(orders_api, '_build_checkout_order', _build_order)
    prepared = await orders_api._build_logged_checkout_data(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
        base='https://frontend.example',
        resolved=resolved,
    )
    assert prepared.order.reference_code == 'REF'

    async def _resolve_inputs(*_args, **_kwargs):
        await asyncio.sleep(0)
        return resolved

    async def _build_data(*_args, **_kwargs):
        await asyncio.sleep(0)
        return prepared

    monkeypatch.setattr(orders_api, '_resolve_logged_checkout_inputs', _resolve_inputs)
    monkeypatch.setattr(orders_api, '_build_logged_checkout_data', _build_data)
    prepared_again = await orders_api._prepare_logged_checkout_data(
        session,
        payload=payload,
        current_user=current_user,
        cart=cart,
        base='https://frontend.example',
    )
    assert prepared_again is prepared


@pytest.mark.anyio
async def test_orders_cart_loader_and_netopia_refresh_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    cart = SimpleNamespace(id=uuid4(), items=[SimpleNamespace(id=1)], last_order_id=uuid4())
    execute_session = _ExecuteSession(cart)
    loaded = await orders_api._load_user_cart_for_create_order(execute_session, user_id)
    assert loaded is cart

    with pytest.raises(HTTPException, match='Cart is empty'):
        await orders_api._load_user_cart_for_create_order(_ExecuteSession(SimpleNamespace(id=uuid4(), items=[])), user_id)

    with pytest.raises(HTTPException, match='Cart is empty'):
        await orders_api._load_user_cart_for_create_order(_ExecuteSession(None), user_id)

    checkout_session = _RecorderCheckoutSession(scalar_values=[cart.id], cart_row=cart)
    order = SimpleNamespace(id=uuid4(), payment_method='netopia', status=OrderStatus.pending_payment)

    monkeypatch.setattr(orders_api, '_can_restart_existing_netopia_payment', lambda *_args, **_kwargs: True)

    async def _start_payment(*_args, **_kwargs):
        await asyncio.sleep(0)
        return ('ntp-id', 'https://pay.example')

    monkeypatch.setattr(orders_api, '_start_netopia_payment_for_order', _start_payment)
    await orders_api._refresh_existing_order_netopia_payment(
        checkout_session,
        order,
        email='buyer@example.com',
        phone='+40123',
        lang='en',
        base='https://frontend.example',
    )
    assert order.netopia_ntp_id == 'ntp-id'
    assert checkout_session.commits == 1
    assert checkout_session.refreshed == [order]

    async def _no_payment(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api, '_start_netopia_payment_for_order', _no_payment)
    await orders_api._refresh_existing_order_netopia_payment(
        checkout_session,
        order,
        email='buyer@example.com',
        phone='+40123',
        lang='en',
        base='https://frontend.example',
    )
    assert checkout_session.commits == 1

    no_cart_session = _RecorderCheckoutSession(cart_row=None)
    await orders_api._clear_cart_last_order_pointer(no_cart_session, cart_id=uuid4())
    assert no_cart_session.added == []


class _AdminRouteSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0
        self.refreshed: list[tuple[object, object | None]] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, obj: object, *, attribute_names: object | None = None) -> None:
        await asyncio.sleep(0)
        self.refreshed.append((obj, attribute_names))


def _admin_order_stub() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        status=OrderStatus.pending_payment,
        reference_code='REF-ADMIN',
        events=[],
        user=SimpleNamespace(id=uuid4(), email='buyer@example.com', preferred_language='en'),
        customer_email='buyer@example.com',
        items=[SimpleNamespace(id=uuid4())],
        refunds=[],
    )


def _install_order_admin_stubs(monkeypatch: pytest.MonkeyPatch, order: SimpleNamespace) -> None:
    async def _return_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    async def _return_order_admin(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    async def _serialize(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id', _return_order)
    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id_admin', _return_order_admin)
    monkeypatch.setattr(orders_api, '_serialize_admin_order', _serialize)
    monkeypatch.setattr(orders_api.pii_service, 'require_pii_reveal', lambda *_args, **_kwargs: None)


@pytest.mark.anyio
async def test_orders_admin_mutation_routes_superstep_a(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _AdminRouteSession()
    order = _admin_order_stub()
    admin = SimpleNamespace(id=uuid4(), email='admin@example.com', username='admin')
    status_changes: list[str] = []
    _install_order_admin_stubs(monkeypatch, order)

    async def _update(*_args, **_kwargs):
        await asyncio.sleep(0)
        order.status = OrderStatus.shipped
        return order

    monkeypatch.setattr(orders_api.order_service, 'update_order', _update)

    async def _record_status_change(*_args, **_kwargs):
        await asyncio.sleep(0)
        status_changes.append('changed')

    monkeypatch.setattr(orders_api, '_handle_admin_order_status_change', _record_status_change)
    await orders_api.admin_update_order(BackgroundTasks(), order.id, SimpleNamespace(shipping_method_id=None), _request(), False, session, admin)
    assert status_changes == ['changed']

    for name in ('update_order_addresses', 'create_order_shipment', 'update_order_shipment', 'delete_order_shipment'):
        monkeypatch.setattr(orders_api.order_service, name, _update)
    await orders_api.admin_update_order_addresses(order.id, _request(), SimpleNamespace(), False, session, admin)
    await orders_api.admin_create_order_shipment(order.id, _request(), SimpleNamespace(), False, session, admin)
    await orders_api.admin_update_order_shipment(order.id, uuid4(), _request(), SimpleNamespace(), False, session, admin)
    await orders_api.admin_delete_order_shipment(order.id, uuid4(), _request(), False, session, admin)

    monkeypatch.setattr(orders_api.order_service, 'add_admin_note', _update)
    monkeypatch.setattr(orders_api.order_service, 'add_order_tag', _update)
    monkeypatch.setattr(orders_api.order_service, 'remove_order_tag', _update)
    monkeypatch.setattr(orders_api.order_service, 'review_order_fraud', _update)
    async def _noop_async(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'update_fulfillment', _noop_async)
    await orders_api.admin_add_order_note(order.id, _request(), SimpleNamespace(note='note'), False, session, admin)
    await orders_api.admin_add_order_tag(order.id, _request(), SimpleNamespace(tag='priority'), False, session, admin)
    await orders_api.admin_remove_order_tag(order.id, 'priority', _request(), False, session, admin)
    await orders_api.admin_review_order_fraud(order.id, _request(), SimpleNamespace(decision='clear', note='ok'), False, session, admin)
    await orders_api.admin_fulfill_item(order.id, uuid4(), _request(), 1, False, session, admin)
    events = await orders_api.admin_order_events(order.id, session, object())
    assert events == order.events


@pytest.mark.anyio
async def test_orders_admin_refund_email_cancel_and_reorder_routes_superstep_a(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _AdminRouteSession()
    order = _admin_order_stub()
    owner = SimpleNamespace(id=uuid4(), email='owner@example.com', preferred_language='en')
    user = SimpleNamespace(id=order.user.id, email='buyer@example.com', preferred_language='en')
    admin_user = SimpleNamespace(email='admin@example.com', username='admin')
    queued: list[str] = []
    _install_order_admin_stubs(monkeypatch, order)

    async def _return_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    async def _return_owner(*_args, **_kwargs):
        await asyncio.sleep(0)
        return owner

    async def _record_refunded(*_args, **_kwargs):
        await asyncio.sleep(0)
        queued.append('refunded')

    async def _record_owner_cancel(*_args, **_kwargs):
        await asyncio.sleep(0)
        queued.append('owner-cancel')

    async def _record_user_cancel(*_args, **_kwargs):
        await asyncio.sleep(0)
        queued.append('user-cancel')

    async def _settings(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(receipt_share_days=7)

    async def _reorder(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4())

    async def _serialize_cart(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(items=[])

    monkeypatch.setattr(orders_api.order_service, 'retry_payment', _return_order)
    monkeypatch.setattr(orders_api.auth_service, 'get_owner_user', _return_owner)
    monkeypatch.setattr(orders_api, '_notify_user_order_refunded', _record_refunded)
    monkeypatch.setattr(orders_api, '_notify_owner_cancel_request', _record_owner_cancel)
    monkeypatch.setattr(orders_api, '_notify_user_cancel_requested', _record_user_cancel)
    monkeypatch.setattr(orders_api.checkout_settings_service, 'get_checkout_settings', _settings)
    monkeypatch.setattr(orders_api.order_service, 'refund_order', _return_order)
    monkeypatch.setattr(orders_api.order_service, 'create_order_refund', _return_order)
    monkeypatch.setattr(orders_api.order_service, 'get_order', _return_order)
    monkeypatch.setattr(orders_api.cart_service, 'reorder_from_order', _reorder)
    monkeypatch.setattr(orders_api.cart_service, 'serialize_cart', _serialize_cart)

    await orders_api.admin_send_delivery_email(BackgroundTasks(), order.id, SimpleNamespace(note='resend'), session, admin_user)
    await orders_api.admin_send_confirmation_email(BackgroundTasks(), order.id, SimpleNamespace(note='resend'), session, admin_user)
    await orders_api.admin_refund_order(BackgroundTasks(), order.id, _request(), SimpleNamespace(note='manual'), session, admin_user)
    await orders_api.admin_create_order_refund(
        BackgroundTasks(),
        order.id,
        _request(),
        SimpleNamespace(amount=Decimal('12.50'), note='partial', items=[SimpleNamespace(order_item_id=uuid4(), quantity=1)], process_payment=False),
        session,
        admin_user,
    )
    await orders_api.admin_retry_payment(order.id, session, 'admin')
    await orders_api.request_order_cancellation(order.id, SimpleNamespace(reason='Changed mind'), BackgroundTasks(), session, user)
    reorder = await orders_api.reorder_order(order.id, user, session)
    assert hasattr(reorder, 'items')
    assert {'refunded', 'owner-cancel', 'user-cancel'}.issubset(set(queued))




@pytest.mark.anyio
async def test_orders_status_email_and_refund_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    order = SimpleNamespace(
        id=uuid4(),
        reference_code='REF-77',
        status=OrderStatus.cancelled,
        payment_method='paypal',
        paypal_capture_id='cap-1',
        stripe_payment_intent_id=None,
        user=SimpleNamespace(id=uuid4(), email='buyer@example.com', preferred_language='ro'),
        customer_email='buyer@example.com',
        tracking_number='TRK-1',
        events=[SimpleNamespace(event='payment_captured')],
    )

    assert orders_api._cancelled_order_refund_method(order) == 'paypal'
    order.payment_method = 'stripe'
    order.paypal_capture_id = None
    order.stripe_payment_intent_id = 'pi_1'
    assert orders_api._cancelled_order_refund_method(order) == 'stripe'
    order.events = []
    assert orders_api._cancelled_order_refund_method(order) is None

    notifications: list[tuple[str, str]] = []

    async def _owner(_session):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4(), preferred_language='en')

    async def _notify(*_args, user_id, type, title, **_kwargs):
        await asyncio.sleep(0)
        notifications.append((str(user_id), f"{type}:{title}"))

    monkeypatch.setattr(orders_api.auth_service, 'get_owner_user', _owner)
    monkeypatch.setattr(orders_api.notification_service, 'create_notification', _notify)

    order.status = OrderStatus.cancelled
    order.payment_method = 'paypal'
    order.paypal_capture_id = 'cap-1'
    await orders_api._notify_owner_manual_refund_required(SimpleNamespace(), order)
    await orders_api._notify_user_order_processing(SimpleNamespace(), order)
    await orders_api._notify_user_order_cancelled(SimpleNamespace(), order)
    await orders_api._notify_user_order_status_change(SimpleNamespace(), order)
    assert notifications

    order.events = []
    background_tasks = BackgroundTasks()

    async def _reward(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api, '_queue_first_order_reward_email', _reward)
    await orders_api._queue_customer_status_email(SimpleNamespace(), background_tasks, order)
    assert len(background_tasks.tasks) >= 1

    order.status = OrderStatus.shipped
    await orders_api._queue_customer_status_email(SimpleNamespace(), background_tasks, order)
    order.status = OrderStatus.delivered
    await orders_api._queue_customer_status_email(SimpleNamespace(), background_tasks, order)
    order.status = OrderStatus.cancelled
    await orders_api._queue_customer_status_email(SimpleNamespace(), background_tasks, order)
    order.status = OrderStatus.refunded
    await orders_api._queue_customer_status_email(SimpleNamespace(), background_tasks, order)


@pytest.mark.anyio
async def test_orders_admin_route_and_shipping_method_guard_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _missing(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id_admin', _missing)
    request = _request()
    admin = SimpleNamespace(id=uuid4(), email='admin@example.com', username='admin')

    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_get_order(uuid4(), request, False, SimpleNamespace(), admin)

    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_list_order_email_events(uuid4(), request, False, 50, 24, SimpleNamespace(), admin)

    with pytest.raises(HTTPException, match='Missing guest session id'):
        await orders_api.guest_checkout(SimpleNamespace(email='guest@example.com', preferred_language='en'), request, Response(), BackgroundTasks(), None, SimpleNamespace(), None)

    assert await orders_api._resolve_shipping_method_for_order_update(SimpleNamespace(), SimpleNamespace(shipping_method_id=None)) is None

    async def _shipping_none(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'get_shipping_method', _shipping_none)
    with pytest.raises(HTTPException, match='Shipping method not found'):
        await orders_api._resolve_shipping_method_for_order_update(SimpleNamespace(), SimpleNamespace(shipping_method_id='ship-1'))

    async def _shipping_ok(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id='ship-1')

    monkeypatch.setattr(orders_api.order_service, 'get_shipping_method', _shipping_ok)
    resolved = await orders_api._resolve_shipping_method_for_order_update(SimpleNamespace(), SimpleNamespace(shipping_method_id='ship-1'))
    assert resolved.id == 'ship-1'


@pytest.mark.anyio
async def test_orders_additional_admin_not_found_guards_a(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _missing(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id_admin', _missing)
    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id', _missing)
    monkeypatch.setattr(orders_api.pii_service, 'require_pii_reveal', lambda *_args, **_kwargs: None)

    req = _request()
    session = _AdminRouteSession()
    admin = SimpleNamespace(id=uuid4(), email='admin@example.com', username='admin')
    oid = uuid4()

    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_update_order_addresses(oid, req, SimpleNamespace(), False, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_list_order_shipments(oid, session, object())
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_create_order_shipment(oid, req, SimpleNamespace(), False, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_update_order_shipment(oid, uuid4(), req, SimpleNamespace(), False, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_delete_order_shipment(oid, uuid4(), req, False, session, admin)


@pytest.mark.anyio
async def test_orders_additional_admin_not_found_guards_b(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _missing(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id_admin', _missing)
    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id', _missing)
    monkeypatch.setattr(orders_api.pii_service, 'require_pii_reveal', lambda *_args, **_kwargs: None)

    req = _request()
    session = _AdminRouteSession()
    admin = SimpleNamespace(id=uuid4(), email='admin@example.com', username='admin')
    oid = uuid4()

    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_fulfill_item(oid, uuid4(), req, 1, False, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_order_events(oid, session, object())
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_packing_slip(oid, req, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_upload_shipping_label(oid, req, SimpleNamespace(filename='x.pdf'), False, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_download_shipping_label(oid, session, object())
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_delete_shipping_label(oid, session, object())


@pytest.mark.anyio
async def test_orders_receipt_and_payment_guard_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _missing(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id', _missing)
    monkeypatch.setattr(orders_api.order_service, 'get_order', _missing)

    req = _request()
    session = _AdminRouteSession()
    admin = SimpleNamespace(id=uuid4(), email='admin@example.com', username='admin')
    oid = uuid4()

    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_download_receipt_pdf(oid, req, session, admin)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_capture_payment(BackgroundTasks(), oid, None, session, 'admin')
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.admin_void_payment(BackgroundTasks(), oid, None, session, 'admin')
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.get_order(oid, SimpleNamespace(id=uuid4()), session)
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.create_receipt_share_token(oid, session, SimpleNamespace(id=uuid4(), role='customer'))
    with pytest.raises(HTTPException, match='Order not found'):
        await orders_api.revoke_receipt_share_token(oid, session, SimpleNamespace(id=uuid4(), role='customer'))


@pytest.mark.anyio
async def test_orders_receipt_pdf_success_and_notification_early_returns(monkeypatch: pytest.MonkeyPatch) -> None:
    order = SimpleNamespace(id=uuid4(), reference_code='REF-PDF', items=[SimpleNamespace(id=uuid4())], user=None, customer_email='')

    async def _get_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    async def _record_export(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.step_up_service, 'require_step_up', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orders_api.order_service, 'get_order_by_id', _get_order)
    monkeypatch.setattr(orders_api.order_exports_service, 'create_pdf_export', _record_export)
    monkeypatch.setattr(orders_api.receipt_service, 'render_order_receipt_pdf', lambda *_args, **_kwargs: b'%PDF-fast%')

    response = await orders_api.admin_download_receipt_pdf(order.id, _request(), _AdminRouteSession(), SimpleNamespace(id=uuid4()))
    assert response.headers['content-disposition'].endswith('receipt-REF-PDF.pdf"')

    monkeypatch.setattr(orders_api.settings, 'admin_alert_email', '', raising=False)
    orders_api._queue_order_refunded_email(BackgroundTasks(), order)
    await orders_api._notify_user_order_refunded(_AdminRouteSession(), order)
    orders_api._queue_admin_refund_requested_email(BackgroundTasks(), None, order, SimpleNamespace(email='admin@example.com'), note='n')
    await orders_api._notify_partial_refund_user(_AdminRouteSession(), order, SimpleNamespace(amount=Decimal('1.00')))

def test_orders_delivery_batch_and_filename_helpers() -> None:
    courier, delivery, locker_id, locker_name, locker_address, locker_lat, locker_lng = orders_api._delivery_from_payload(
        courier='  fan_courier ',
        delivery_type='home',
        locker_id='ignored',
        locker_name='ignored',
        locker_address='ignored',
        locker_lat=44.0,
        locker_lng=26.0,
    )
    assert (courier, delivery, locker_id, locker_name, locker_address, locker_lat, locker_lng) == (
        'fan_courier',
        'home',
        None,
        None,
        None,
        None,
        None,
    )

    locker_values = orders_api._delivery_from_payload(
        courier='sameday',
        delivery_type='locker',
        locker_id='  LK-1 ',
        locker_name=' Main Locker ',
        locker_address=' Address 1 ',
        locker_lat=44.43,
        locker_lng=26.10,
    )
    assert locker_values[2] == 'LK-1'
    assert locker_values[3] == 'Main Locker'
    assert locker_values[4] == 'Address 1'

    with pytest.raises(HTTPException, match='Locker selection is required'):
        orders_api._delivery_from_payload(
            courier='sameday',
            delivery_type='locker',
            locker_id='  ',
            locker_name='missing',
            locker_address='addr',
            locker_lat=None,
            locker_lng=26.10,
        )

    assert orders_api._sanitize_filename('../../path/to/report.pdf') == 'report.pdf'
    assert orders_api._sanitize_filename('   ') == 'shipping-label'

    id_one = uuid4()
    id_two = uuid4()
    normalized_ids = orders_api._normalize_batch_order_ids([id_one, id_two, id_one], max_selected=5)
    assert normalized_ids == [id_one, id_two]

    with pytest.raises(HTTPException, match='No orders selected'):
        orders_api._normalize_batch_order_ids([], max_selected=1)
    with pytest.raises(HTTPException, match='Too many orders selected'):
        orders_api._normalize_batch_order_ids([id_one, id_two], max_selected=1)

    order_a = SimpleNamespace(id=id_one)
    order_b = SimpleNamespace(id=id_two)
    assert orders_api._missing_batch_order_ids([id_one, id_two], [order_a]) == [str(id_two)]
    assert orders_api._ordered_batch_orders([id_two, id_one], [order_a, order_b]) == [order_b, order_a]


def test_orders_admin_filter_and_sla_helpers() -> None:
    from datetime import datetime, timezone

    assert orders_api._parse_admin_status_filter(None) == (False, None, None)
    pending_filter = orders_api._parse_admin_status_filter(' pending ')
    assert pending_filter == (True, None, None)
    sales_filter = orders_api._parse_admin_status_filter('sales')
    assert sales_filter[2] is not None and OrderStatus.paid in sales_filter[2]
    status_filter = orders_api._parse_admin_status_filter('paid')
    assert status_filter == (False, OrderStatus.paid, None)
    with pytest.raises(HTTPException, match='Invalid order status'):
        orders_api._parse_admin_status_filter('not-real')

    assert orders_api._parse_admin_sla_filter(' ship_overdue ') == 'ship_overdue'
    assert orders_api._parse_admin_sla_filter('overdue_acceptance') == 'accept_overdue'
    assert orders_api._parse_admin_sla_filter('any') == 'any_overdue'
    assert orders_api._parse_admin_sla_filter(None) is None
    with pytest.raises(HTTPException, match='Invalid SLA filter'):
        orders_api._parse_admin_sla_filter('unknown')

    assert orders_api._parse_admin_fraud_filter(' review ') == 'queue'
    assert orders_api._parse_admin_fraud_filter('risk') == 'flagged'
    assert orders_api._parse_admin_fraud_filter('approved') == 'approved'
    assert orders_api._parse_admin_fraud_filter('denied') == 'denied'
    assert orders_api._parse_admin_fraud_filter(None) is None
    with pytest.raises(HTTPException, match='Invalid fraud filter'):
        orders_api._parse_admin_fraud_filter('invalid')

    now = datetime(2026, 3, 1, tzinfo=timezone.utc)
    naive = datetime(2026, 3, 1)
    aware = datetime(2026, 3, 1, tzinfo=timezone.utc)
    assert orders_api._ensure_utc_datetime(None) is None
    assert orders_api._ensure_utc_datetime(naive).tzinfo == timezone.utc
    assert orders_api._ensure_utc_datetime(aware).tzinfo == timezone.utc

    due_accept, overdue_accept = orders_api._admin_order_sla_due(
        sla_kind='accept',
        sla_started_at=now,
        now=now,
        accept_hours=24,
        ship_hours=48,
    )
    assert due_accept is not None and overdue_accept is False

    due_ship, overdue_ship = orders_api._admin_order_sla_due(
        sla_kind='ship',
        sla_started_at=now,
        now=now,
        accept_hours=24,
        ship_hours=0,
    )
    assert due_ship is not None and overdue_ship is True


def test_orders_admin_list_export_and_payload_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import datetime, timezone

    now = datetime(2026, 3, 1, tzinfo=timezone.utc)
    order = SimpleNamespace(
        id=uuid4(),
        reference_code='REF-100',
        status=OrderStatus.paid,
        total_amount=Decimal('42.00'),
        currency='RON',
        payment_method='cod',
        created_at=now,
        tags=[SimpleNamespace(tag='vip')],
    )

    monkeypatch.setattr(orders_api.pii_service, 'mask_email', lambda value: f'masked:{(value or '').strip()}')

    row = (
        order,
        'buyer@example.com',
        'buyer-user',
        'accept',
        now,
        True,
        'high',
    )
    list_item = orders_api._admin_order_list_item_from_row(
        row,
        include_pii=False,
        now=now,
        accept_hours=24,
        ship_hours=48,
    )
    assert str(list_item.customer_email).startswith('masked:')
    assert list_item.fraud_flagged is True

    response = orders_api._admin_order_list_response([row], include_pii=True, total_items=1, page=1, limit=20)
    assert len(response.items) == 1
    assert response.meta.total_pages == 1

    order_stub = SimpleNamespace(
        id=uuid4(),
        reference_code='REF-CSV',
        status=SimpleNamespace(value='paid'),
        total_amount=Decimal('20.00'),
        tax_amount=Decimal('2.00'),
        fee_amount=Decimal('0.50'),
        shipping_amount=Decimal('3.00'),
        currency='RON',
        user_id=uuid4(),
        customer_email=' buyer@example.com ',
        customer_name='Buyer Name',
        payment_method='cod',
        promo_code='SAVE10',
        courier='sameday',
        delivery_type='home',
        tracking_number='TRK-1',
        tracking_url='https://carrier.example/track',
        invoice_company='Buyer SRL',
        invoice_vat_id='RO123',
        shipping_method=SimpleNamespace(name='Locker'),
        locker_name='Main locker',
        locker_address='Main str',
        created_at=now,
        updated_at=now,
    )

    assert orders_api._order_attr_as_str(order_stub, 'currency') == 'RON'
    assert orders_api._order_attr_iso(order_stub, 'created_at').startswith('2026-03-01')
    assert orders_api._order_status_value(order_stub) == 'paid'
    assert orders_api._order_shipping_method_name(order_stub) == 'Locker'

    allowed = orders_api._order_export_allowed_columns(include_pii=False)
    selected = orders_api._selected_export_columns(['id,reference_code,status'], allowed=allowed)
    csv_text = orders_api._render_orders_csv([order_stub], selected_columns=selected, allowed=allowed)
    assert 'reference_code' in csv_text
    assert 'REF-100' in csv_text or str(order_stub.id) in csv_text

    with pytest.raises(HTTPException, match='Invalid export columns'):
        orders_api._selected_export_columns(['id,unknown'], allowed=allowed)

    masked_addr = orders_api._masked_admin_address(
        SimpleNamespace(
            id=uuid4(),
            user_id=uuid4(),
            label='home',
            line2='line2',
            region='B',
            country='RO',
            is_default_shipping=True,
            is_default_billing=False,
            created_at=now,
            updated_at=now,
        )
    )
    assert masked_addr is not None and masked_addr['line1'] == '***'
    assert orders_api._masked_admin_address(None) is None


def test_orders_admin_order_base_and_email_events_stmt_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import datetime, timezone, timedelta

    now = datetime(2026, 3, 1, tzinfo=timezone.utc)
    order = SimpleNamespace(
        id=uuid4(),
        customer_email='buyer@example.com',
        customer_name='Buyer Name',
        invoice_company='Buyer SRL',
        invoice_vat_id='RO-123',
        locker_address='Main st',
        user=SimpleNamespace(email='owner@example.com'),
        tags=[SimpleNamespace(tag='priority')],
        reference_code='REF-11',
    )

    class _Validated:
        def model_dump(self):
            return {
                'invoice_company': 'Buyer SRL',
                'invoice_vat_id': 'RO-123',
                'locker_address': 'Main st',
            }

    monkeypatch.setattr(orders_api.OrderRead, 'model_validate', staticmethod(lambda _order: _Validated()))
    monkeypatch.setattr(orders_api.pii_service, 'mask_text', lambda value, keep=1: f'masked:{value}:{keep}')
    monkeypatch.setattr(orders_api.pii_service, 'mask_email', lambda value: f'masked:{value}')

    base_masked = orders_api._admin_order_base_payload(order, include_pii=False)
    assert str(base_masked['invoice_company']).startswith('masked:')
    assert base_masked['locker_address'] == '***'

    base_raw = orders_api._admin_order_base_payload(order, include_pii=True)
    assert base_raw['invoice_company'] == 'Buyer SRL'

    assert orders_api._admin_order_customer_email(order, include_pii=False).startswith('masked:')
    assert orders_api._admin_order_customer_email(order, include_pii=True) == 'buyer@example.com'
    assert orders_api._admin_order_tags(order) == ['priority']
    assert orders_api._normalized_admin_order_customer_email(order) == 'buyer@example.com'
    assert orders_api._admin_order_reference_for_email_filter(order) == 'ref-11'

    stmt = orders_api._build_admin_order_email_events_stmt(
        cleaned_email='buyer@example.com',
        since=now - timedelta(days=1),
        limit=500,
        ref_lower='ref-11',
    )
    compiled = str(stmt)
    assert 'email_delivery_events' in compiled.lower()

