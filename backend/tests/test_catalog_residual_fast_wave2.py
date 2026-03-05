from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import catalog as catalog_service


class _Session:
    def __init__(self):
        self.added: list[object] = []
        self.executed: list[object] = []
        self.commits = 0
        self.flushed = 0

    async def get(self, _model, _id):
        await asyncio.sleep(0)
        return None

    async def execute(self, stmt):
        await asyncio.sleep(0)
        self.executed.append(stmt)
        return SimpleNamespace()

    def add(self, obj):
        self.added.append(obj)

    def add_all(self, objs):
        self.added.extend(objs)

    async def commit(self):
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, _obj, **_kwargs):
        await asyncio.sleep(0)

    async def flush(self):
        await asyncio.sleep(0)
        self.flushed += 1


class _Payload:
    def __init__(self, **data):
        self._data = data

    def model_dump(self, **_kwargs):
        return dict(self._data)


@pytest.mark.anyio
async def test_catalog_residual_wave2_product_feed_csv_and_reorder_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _feed(_session, *, lang=None):
        await asyncio.sleep(0)
        return [
            SimpleNamespace(
                slug='a',
                name='Name A',
                price=10.5,
                currency='RON',
                description=None,
                category_slug=None,
                tags=['one', 'two'],
            )
        ]

    monkeypatch.setattr(catalog_service, 'get_product_feed', _feed)
    csv_payload = await catalog_service.get_product_feed_csv(_Session(), lang='ro')
    assert 'slug,name,price,currency,description,category_slug,tags' in csv_payload
    assert 'a,Name A,10.5,RON,,,"one,two"' in csv_payload.replace('\r\n', '\n')

    empty = await catalog_service.reorder_categories(_Session(), [])
    assert empty == []

    async def _load_by_slug(_session, _slugs):
        await asyncio.sleep(0)
        return {'rings': SimpleNamespace(slug='rings', sort_order=7, updated_at=None)}

    monkeypatch.setattr(catalog_service, '_load_categories_by_slug', _load_by_slug)
    no_updates = await catalog_service.reorder_categories(
        _Session(),
        [SimpleNamespace(slug='rings', sort_order=None)],
    )
    assert no_updates == []


@pytest.mark.anyio
async def test_catalog_residual_wave2_variant_adjustment_and_finalize_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    product = SimpleNamespace(id=uuid4(), stock_quantity=1)

    class _VariantSession(_Session):
        def __init__(self, variant):
            super().__init__()
            self.variant = variant

        async def get(self, _model, _id):
            await asyncio.sleep(0)
            return self.variant

    wrong_variant = SimpleNamespace(id=uuid4(), product_id=uuid4(), stock_quantity=4)
    with pytest.raises(HTTPException) as invalid_variant:
        await catalog_service._apply_variant_stock_adjustment(
            _VariantSession(wrong_variant),
            product=product,
            variant_id=wrong_variant.id,
            delta=1,
        )
    assert invalid_variant.value.status_code == 400

    valid_variant = SimpleNamespace(id=uuid4(), product_id=product.id, stock_quantity=5)
    variant_session = _VariantSession(valid_variant)
    vid, before, after = await catalog_service._apply_variant_stock_adjustment(
        variant_session,
        product=product,
        variant_id=valid_variant.id,
        delta=-2,
    )
    assert vid == valid_variant.id
    assert (before, after, valid_variant.stock_quantity) == (5, 3, 3)

    fulfilled = {'n': 0}
    alerted = {'n': 0}

    async def _fulfill(_session, *, product):
        await asyncio.sleep(0)
        fulfilled['n'] += 1

    async def _alert(_session, product):
        await asyncio.sleep(0)
        alerted['n'] += 1

    monkeypatch.setattr(catalog_service, 'fulfill_back_in_stock_requests', _fulfill)
    monkeypatch.setattr(catalog_service, '_maybe_alert_low_stock', _alert)

    session = _Session()
    await catalog_service._finalize_product_level_stock_adjustment(
        session,
        payload=SimpleNamespace(variant_id=uuid4()),
        product=product,
        was_out_of_stock=True,
    )
    assert fulfilled['n'] == 0

    await catalog_service._finalize_product_level_stock_adjustment(
        session,
        payload=SimpleNamespace(variant_id=None),
        product=SimpleNamespace(stock_quantity=2),
        was_out_of_stock=True,
    )
    assert fulfilled['n'] == 1
    assert alerted['n'] == 1


@pytest.mark.anyio
async def test_catalog_residual_wave2_restore_soft_deleted_and_persist_update_short_circuit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    restored_log = {'called': False}
    slug_attempts: list[str] = []

    async def _ensure_slug_unique(_session, slug, **_kwargs):
        await asyncio.sleep(0)
        slug_attempts.append(slug)
        if len(slug_attempts) == 1:
            raise HTTPException(status_code=409, detail='duplicate')

    async def _log(*_args, **_kwargs):
        await asyncio.sleep(0)
        restored_log['called'] = True

    monkeypatch.setattr(catalog_service, '_ensure_slug_unique', _ensure_slug_unique)
    monkeypatch.setattr(catalog_service, '_log_product_action', _log)

    session = _Session()
    product = SimpleNamespace(
        id=uuid4(),
        name='Ring',
        slug='ring--deleted',
        deleted_slug='ring',
        is_deleted=True,
        deleted_at='x',
        deleted_by='y',
    )
    restored = await catalog_service.restore_soft_deleted_product(session, product, user_id=uuid4())
    assert restored.slug == 'ring-2'
    assert restored.is_deleted is False
    assert restored.deleted_slug is None
    assert restored_log['called'] is True

    untouched = SimpleNamespace(id=uuid4(), is_deleted=False)
    same = await catalog_service.restore_soft_deleted_product(_Session(), untouched, user_id=None)
    assert same is untouched

    commit_false_session = _Session()
    await catalog_service._persist_updated_product(
        commit_false_session,
        product=SimpleNamespace(id=uuid4()),
        commit=False,
        was_out_of_stock=False,
        is_now_out_of_stock=False,
        changes={},
        patch_snapshot={},
        user_id=None,
        source=None,
    )
    assert commit_false_session.flushed == 1
    assert commit_false_session.commits == 0


@pytest.mark.anyio
async def test_catalog_residual_wave2_featured_collection_create_update_and_tax_group_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = {'n': 0}

    async def _existing(_session, slug):
        await asyncio.sleep(0)
        seen['n'] += 1
        return object() if seen['n'] == 1 else None

    async def _load_products(_session, ids):
        await asyncio.sleep(0)
        return [SimpleNamespace(id=i) for i in ids]

    class _Collection:
        def __init__(self, slug: str, name: str, description: str | None = None):
            self.slug = slug
            self.name = name
            self.description = description
            self.products = []

    monkeypatch.setattr(catalog_service, 'FeaturedCollection', _Collection)
    monkeypatch.setattr(catalog_service, 'get_featured_collection_by_slug', _existing)
    monkeypatch.setattr(catalog_service, '_load_products_by_ids', _load_products)

    session = _Session()
    payload = SimpleNamespace(name='Spring Picks', description='desc', product_ids=[uuid4(), uuid4()])
    created = await catalog_service.create_featured_collection(session, payload)
    assert created.slug.startswith('spring-picks')
    assert created.slug.endswith('-2')
    assert len(created.products) == 2

    update_payload = _Payload(name='Updated', product_ids=[uuid4()])
    updated = await catalog_service.update_featured_collection(session, created, update_payload)
    assert updated.name == 'Updated'
    assert len(updated.products) == 1

    class _TaxSession(_Session):
        async def get(self, _model, _id):
            await asyncio.sleep(0)
            return None

    await catalog_service._validate_category_tax_group(_TaxSession(), None)

    with pytest.raises(HTTPException) as tax_missing:
        await catalog_service._validate_category_tax_group(_TaxSession(), uuid4())
    assert tax_missing.value.status_code == 400
