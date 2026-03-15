from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import catalog as catalog_service


class _ScalarOneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)


class _QueueSession:
    def __init__(self, execute_results=None, get_result=None):
        self._results = list(execute_results or [])
        self._get_result = get_result
        self.added = []
        self.deleted = []
        self.commits = 0

    def execute(self, *_args, **_kwargs):
        if self._results:
            return self._results.pop(0)
        return _ScalarsResult([])

    def get(self, *_args, **_kwargs):
        return self._get_result

    def add(self, value):
        self.added.append(value)

    def delete(self, value):
        self.deleted.append(value)

    def commit(self):
        self.commits += 1

    def refresh(self, _value):
        return None


def test_catalog_is_sale_active_branches() -> None:
    now = datetime.now(timezone.utc)
    product = SimpleNamespace(sale_price=None, sale_start_at=None, sale_end_at=None)
    assert catalog_service.is_sale_active(product, now=now) is False

    product.sale_price = Decimal('10.00')
    product.sale_start_at = now + timedelta(hours=1)
    product.sale_end_at = None
    assert catalog_service.is_sale_active(product, now=now) is False

    product.sale_start_at = now - timedelta(hours=1)
    product.sale_end_at = now
    assert catalog_service.is_sale_active(product, now=now) is False

    product.sale_end_at = now + timedelta(hours=1)
    assert catalog_service.is_sale_active(product, now=now) is True


@pytest.mark.anyio
async def test_catalog_create_category_and_relation_validators(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = SimpleNamespace(
        name='Rings',
        description='desc',
        thumbnail_url=None,
        banner_url=None,
        is_visible=True,
        sort_order=1,
        parent_id=None,
        tax_group_id=None,
    )
    session = _QueueSession(get_result=None)

    seen = {'count': 0}

    def _get_by_slug(_session, slug: str):
        seen['count'] += 1
        return SimpleNamespace(slug='rings') if seen['count'] == 1 else None

    monkeypatch.setattr(catalog_service, 'get_category_by_slug', _get_by_slug)
    category = await catalog_service.create_category(session, payload)
    assert category.slug.startswith('rings')
    assert session.commits == 1

    missing_parent_payload = SimpleNamespace(**{**payload.__dict__, 'parent_id': uuid4()})
    with pytest.raises(HTTPException, match='Parent category not found'):
        await catalog_service.create_category(_QueueSession(get_result=None), missing_parent_payload)

    missing_tax_payload = SimpleNamespace(**{**payload.__dict__, 'tax_group_id': uuid4()})
    with pytest.raises(HTTPException, match='Tax group not found'):
        await catalog_service.create_category(_QueueSession(get_result=None), missing_tax_payload)


@pytest.mark.anyio
async def test_catalog_update_helpers_and_import_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {'parent': 0, 'tax': 0}

    def _parent(_session, *, category_id, parent_id):
        del category_id, parent_id
        calls['parent'] += 1

    def _tax(_session, tax_group_id):
        del tax_group_id
        calls['tax'] += 1

    monkeypatch.setattr(catalog_service, '_validate_category_parent_assignment', _parent)
    monkeypatch.setattr(catalog_service, '_validate_category_tax_group', _tax)

    await catalog_service._validate_category_update_relations(
        _QueueSession(),
        uuid4(),
        {'parent_id': uuid4(), 'tax_group_id': uuid4()},
    )
    assert calls == {'parent': 1, 'tax': 1}

    product = SimpleNamespace(slug='ring-one')
    payload_ok = SimpleNamespace(model_dump=lambda exclude_unset=True: {'slug': 'ring-one', 'name': 'Ring'})
    assert catalog_service._normalize_product_update_payload_or_400(product, payload_ok) == {'name': 'Ring'}

    payload_bad = SimpleNamespace(model_dump=lambda exclude_unset=True: {'slug': 'ring-two'})
    with pytest.raises(HTTPException, match='Slug cannot be changed'):
        catalog_service._normalize_product_update_payload_or_400(product, payload_bad)

    good = SimpleNamespace(variants=[SimpleNamespace(name='S'), SimpleNamespace(name='M')])
    catalog_service._validate_variant_payload_names_or_400(good)
    with pytest.raises(HTTPException, match='Variant name is required'):
        catalog_service._validate_variant_payload_names_or_400(SimpleNamespace(variants=[SimpleNamespace(name='')]))
    with pytest.raises(HTTPException, match='Variant names must be unique'):
        catalog_service._validate_variant_payload_names_or_400(
            SimpleNamespace(variants=[SimpleNamespace(name='S'), SimpleNamespace(name=' s ')])
        )

    parsed, error = catalog_service._parse_category_import_row_or_error(
        2,
        {'slug': 'rings', 'name': 'Rings', 'parent_slug': '', 'sort_order': '1', 'is_visible': 'yes'},
        seen=set(),
    )
    assert error is None
    assert parsed and parsed['slug'] == 'rings'

    missing_rows = [
        {'idx': 2, 'slug': 'rings', 'parent_slug': 'jewelry'},
        {'idx': 3, 'slug': 'bracelets', 'parent_slug': None},
    ]
    session_missing = _QueueSession(execute_results=[_ScalarsResult([])])
    errors = await catalog_service._collect_missing_parent_errors(session_missing, missing_rows, {'rings', 'bracelets'})
    assert errors == ['Row 2: parent category jewelry not found']


@pytest.mark.anyio
async def test_catalog_record_recently_viewed_paths() -> None:
    product = SimpleNamespace(id=uuid4())
    user_id = uuid4()

    no_context = _QueueSession()
    await catalog_service.record_recently_viewed(no_context, product, None, None)
    assert no_context.commits == 0

    existing_view = SimpleNamespace(viewed_at=datetime.now(timezone.utc) - timedelta(days=1))
    extra_old = SimpleNamespace(viewed_at=datetime.now(timezone.utc) - timedelta(days=2))
    session = _QueueSession(
        execute_results=[_ScalarOneResult(existing_view), _ScalarsResult([existing_view, extra_old])]
    )
    await catalog_service.record_recently_viewed(session, product, user_id, None, limit=1)
    assert session.commits >= 1
    assert session.deleted == [extra_old]
