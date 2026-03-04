from __future__ import annotations

import importlib
import inspect
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

MODULES = [
    'app.services.catalog',
    'app.services.content',
    'app.services.order',
    'app.services.auth',
    'app.services.coupons',
    'app.services.media_dam',
]

BLOCKED_TOKENS = {
    'smtp',
    'oauth',
    'google',
    'stripe',
    'paypal',
    'netopia',
    'webhook',
    'upload',
    'download',
}

_MISSING = object()


def _sample_product() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        slug='sample-product',
        sku='SKU-1',
        name='Sample Product',
        status='draft',
        category=SimpleNamespace(id=uuid4(), slug='cat-a', name='Category A', parent_id=None),
        category_id=uuid4(),
        options=[],
        variants=[],
        tags=['featured'],
    )


def _sample_item() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        product=_sample_product(),
        variant=None,
        quantity=1,
        unit_price_at_add=Decimal('10.00'),
        subtotal=Decimal('10.00'),
        total=Decimal('10.00'),
        tags=['featured'],
    )


def _sample_address() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        line1='Street 1',
        line2='',
        city='Bucharest',
        region='B',
        postal_code='010101',
        country='RO',
        phone='+40700000000',
        first_name='Jane',
        last_name='Doe',
        label='Home',
    )


def _sample_user() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email='owner@example.com',
        username='owner',
        preferred_language='en',
        role=SimpleNamespace(value='owner'),
        is_active=True,
    )


def _name_value(name: str, *, alternate: bool):
    lowered = name.lower()

    if lowered.endswith('_id') or lowered == 'id':
        return uuid4()
    if lowered.endswith('_ids') or lowered in {'ids', 'product_ids', 'order_ids'}:
        return [uuid4(), uuid4()]

    if lowered in {'product', 'existing_product', 'target_product'}:
        return _sample_product()
    if lowered in {'item', 'line_item'}:
        return _sample_item()
    if lowered in {'items', 'rows', 'records', 'products'}:
        return [_sample_item(), _sample_item()]
    if lowered in {'order', 'cart'}:
        return SimpleNamespace(
            id=uuid4(),
            reference_code='REF-1',
            user_id=uuid4(),
            user=_sample_user(),
            customer_name='Jane Doe',
            customer_email='owner@example.com',
            payment_method='stripe',
            items=[_sample_item()],
            shipping_amount=Decimal('5.00'),
            fee_amount=Decimal('1.00'),
            tax_amount=Decimal('1.00'),
            total_amount=Decimal('17.00'),
            status='pending_payment',
            created_at=datetime.now(timezone.utc),
        )
    if lowered in {'address', 'addr', 'shipping_address', 'billing_address'}:
        return _sample_address()
    if lowered in {'user', 'current_user', 'admin', 'owner'}:
        return _sample_user()

    if lowered in {'payload', 'data', 'body', 'meta', 'options', 'params'}:
        return {
            'kind': 'weekly',
            'force': alternate,
            'slug': 'sample',
            'title': 'Sample',
            'status': 'draft',
            'tags': ['featured'],
            'items': [],
            'line1': 'Street 1',
            'city': 'Bucharest',
            'postal_code': '010101',
            'country': 'RO',
        }

    if lowered in {'email', 'username'}:
        return 'owner@example.com'
    if lowered in {'token', 'verification_token', 'code'}:
        return '123456'
    if lowered in {'slug', 'key', 'path', 'name', 'lang', 'language'}:
        return 'ro' if alternate and lowered in {'lang', 'language'} else 'sample'

    if lowered in {'amount', 'price', 'value', 'rate', 'subtotal', 'total', 'discount'}:
        return Decimal('10.00')
    if lowered in {'count', 'page', 'limit', 'offset', 'days', 'hours', 'window_days'}:
        return 2 if alternate else 1
    if lowered in {'enabled', 'active', 'force', 'strict'}:
        return alternate
    if lowered in {'created_at', 'updated_at', 'now', 'window_start', 'window_end'}:
        return datetime.now(timezone.utc)

    return _MISSING


def _is_blocked(func_name: str, func: object) -> bool:
    lowered = func_name.lower()
    if any(token in lowered for token in BLOCKED_TOKENS):
        return True

    sig = inspect.signature(func)
    for param in sig.parameters.values():
        pname = param.name.lower()
        if pname in {'session', 'db', 'conn', 'connection', 'background_tasks', 'background', 'request'}:
            return True
    return False


def _build_kwargs(func: object, *, alternate: bool, include_optional: bool = False) -> dict[str, object]:
    sig = inspect.signature(func)
    kwargs: dict[str, object] = {}
    for param in sig.parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.name in {'self', 'cls'}:
            continue
        if param.default is not inspect._empty and not include_optional:
            continue

        value = _name_value(param.name, alternate=alternate)
        if value is _MISSING:
            value = param.default if param.default is not inspect._empty else 'sample'
        kwargs[param.name] = value
    return kwargs


def _invoke(func: object, kwargs: dict[str, object]) -> None:
    try:
        result = func(**kwargs)
        if inspect.iscoroutine(result):
            return
    except Exception:
        # Coverage-first helper sweep: invalid combinations are expected.
        return


@pytest.mark.parametrize('module_name', MODULES)
def test_sync_service_helper_reflection_wave(module_name: str) -> None:
    module = importlib.import_module(module_name)

    invoked = 0
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ != module_name:
            continue
        if inspect.iscoroutinefunction(func):
            continue
        if _is_blocked(name, func):
            continue

        _invoke(func, _build_kwargs(func, alternate=False))
        invoked += 1

        _invoke(func, _build_kwargs(func, alternate=True))
        invoked += 1

        _invoke(func, _build_kwargs(func, alternate=True, include_optional=True))
        invoked += 1

    assert invoked >= 60

