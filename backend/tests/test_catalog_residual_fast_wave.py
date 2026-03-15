from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import catalog as catalog_service


class _ScalarSession:
    def __init__(self, values: list[object]):
        self.values = list(values)

    async def scalar(self, _stmt: object):
        await asyncio.sleep(0)
        if not self.values:
            raise AssertionError('Unexpected scalar() call')
        return self.values.pop(0)


@pytest.mark.anyio
async def test_resolve_create_product_slug_retries_until_unique(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def _ensure_slug_unique(_session, slug: str, **_kwargs):
        await asyncio.sleep(0)
        calls.append(slug)
        if slug in {'ring', 'ring-2'}:
            raise HTTPException(status_code=409, detail='duplicate')

    monkeypatch.setattr(catalog_service, '_ensure_slug_unique', _ensure_slug_unique)

    slug = await catalog_service._resolve_create_product_slug(
        SimpleNamespace(),
        SimpleNamespace(slug='ring', name='Ring Name'),
    )

    assert slug == 'ring-3'
    assert calls[:3] == ['ring', 'ring-2', 'ring-3']


@pytest.mark.anyio
async def test_validate_update_product_payload_runs_price_and_sku_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    called: dict[str, object] = {}

    async def _ensure_sku_unique(_session, sku: str, **kwargs):
        await asyncio.sleep(0)
        called['sku'] = sku
        called['exclude_id'] = kwargs.get('exclude_id')

    monkeypatch.setattr(catalog_service, '_ensure_sku_unique', _ensure_sku_unique)

    product = SimpleNamespace(id=uuid4(), base_price=Decimal('10.00'), currency='RON')
    await catalog_service._validate_update_product_payload(
        SimpleNamespace(),
        product,
        {'base_price': Decimal('12.50'), 'currency': 'RON', 'sku': 'SKU-NEW'},
    )

    assert called['sku'] == 'SKU-NEW'
    assert called['exclude_id'] == product.id


@pytest.mark.anyio
async def test_resolve_duplicate_sort_order_handles_empty_and_existing_custom_orders() -> None:
    empty_session = _ScalarSession([0])
    assert await catalog_service._resolve_duplicate_sort_order(empty_session, uuid4()) == 0

    existing_session = _ScalarSession([2, 9])
    assert await catalog_service._resolve_duplicate_sort_order(existing_session, uuid4()) == 10


def test_parse_import_product_row_error_and_success_paths() -> None:
    missing, missing_err = catalog_service._parse_import_product_row({'name': 'Only Name'}, 2)
    assert missing is None
    assert missing_err and 'missing slug, name, or category_slug' in missing_err

    bad_price, bad_price_err = catalog_service._parse_import_product_row(
        {
            'slug': 'ring',
            'name': 'Ring',
            'category_slug': 'jewelry',
            'base_price': 'abc',
            'stock_quantity': '5',
            'currency': 'RON',
            'status': 'draft',
        },
        3,
    )
    assert bad_price is None
    assert bad_price_err and 'invalid base_price' in bad_price_err

    parsed, parsed_err = catalog_service._parse_import_product_row(
        {
            'slug': 'ring-1',
            'name': 'Ring One',
            'category_slug': 'jewelry',
            'base_price': '19.90',
            'stock_quantity': '5',
            'currency': 'ron',
            'status': 'published',
            'is_featured': 'yes',
            'is_active': '1',
            'short_description': 'Short',
            'long_description': 'Long',
            'tags': 'new, sale',
        },
        4,
    )
    assert parsed_err is None
    assert parsed and parsed['slug'] == 'ring-1'
    assert parsed['currency'] == 'RON'
    assert parsed['is_featured'] is True
    assert parsed['is_active'] is True
    assert parsed['tag_slugs'] == ['new', 'sale']


def test_parse_category_import_row_or_error_paths() -> None:
    seen: set[str] = set()

    invalid, invalid_err = catalog_service._parse_category_import_row_or_error(
        2,
        {'slug': '', 'name': 'Name'},
        seen,
    )
    assert invalid is None
    assert invalid_err and 'missing slug or name' in invalid_err

    parsed, parsed_err = catalog_service._parse_category_import_row_or_error(
        3,
        {
            'slug': 'rings',
            'name': 'Rings',
            'description': 'Rings desc',
            'parent_slug': '',
            'sort_order': '2',
            'is_visible': 'yes',
            'name_ro': 'Inele',
            'name_en': 'Rings',
            'description_ro': 'Descriere',
            'description_en': 'Description',
        },
        seen,
    )
    assert parsed_err is None
    assert parsed and parsed['slug'] == 'rings'
    assert parsed['sort_order'] == 2
    assert parsed['is_visible'] is True

    duplicate, duplicate_err = catalog_service._parse_category_import_row_or_error(
        4,
        {'slug': 'rings', 'name': 'Rings Duplicate'},
        seen,
    )
    assert duplicate is None
    assert duplicate_err and 'duplicate slug rings' in duplicate_err
