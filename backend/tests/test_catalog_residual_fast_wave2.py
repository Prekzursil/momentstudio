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

    async def rollback(self):
        await asyncio.sleep(0)


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

@pytest.mark.anyio
async def test_catalog_residual_wave2_helper_branches_bulk_and_recently_viewed(monkeypatch: pytest.MonkeyPatch) -> None:
    now_cat = SimpleNamespace(slug='rings', sort_order=0, updated_at=None)
    payload = [
        SimpleNamespace(slug='', sort_order=1),
        SimpleNamespace(slug='missing', sort_order=2),
        SimpleNamespace(slug='rings', sort_order=None),
        SimpleNamespace(slug='rings', sort_order=7),
    ]
    updated = catalog_service._collect_category_reorder_updates(payload, {'rings': now_cat})
    assert updated == [now_cat]
    assert now_cat.sort_order == 7
    assert now_cat.updated_at is not None

    async def _load_categories(_session, _slugs):
        await asyncio.sleep(0)
        return {'rings': now_cat}

    monkeypatch.setattr(catalog_service, '_load_categories_by_slug', _load_categories)
    monkeypatch.setattr(catalog_service.CategoryRead, 'model_validate', staticmethod(lambda cat: {'slug': cat.slug, 'sort': cat.sort_order}))

    session = _Session()
    reordered = await catalog_service.reorder_categories(session, [SimpleNamespace(slug='rings', sort_order=3)])
    assert reordered == [{'slug': 'rings', 'sort': 3}]
    assert session.commits == 1

    class _ScalarsResult:
        def __init__(self, values):
            self._values = list(values)

        def __iter__(self):
            return iter(self._values)

        def scalars(self):
            return self

        def all(self):
            return list(self._values)

    class _BulkSession(_Session):
        def __init__(self, values):
            super().__init__()
            self._values = values

        async def execute(self, _stmt):
            await asyncio.sleep(0)
            return _ScalarsResult(self._values)

    ids = {uuid4(), uuid4()}
    await catalog_service._ensure_bulk_categories_exist_or_400(_BulkSession(list(ids)), ids)
    with pytest.raises(HTTPException) as missing_bulk:
        await catalog_service._ensure_bulk_categories_exist_or_400(_BulkSession([]), ids)
    assert missing_bulk.value.status_code == 400

    sale_product = SimpleNamespace(base_price=10, sale_price=7, sale_price_until=None)
    monkeypatch.setattr(catalog_service, 'is_sale_active', lambda _product: True)
    assert catalog_service._effective_feed_price(sale_product) == 7
    monkeypatch.setattr(catalog_service, 'is_sale_active', lambda _product: False)
    assert catalog_service._effective_feed_price(sale_product) == 10

    class _RecentResult:
        def __init__(self, items):
            self._items = list(items)

        def scalars(self):
            return self._items

    class _RecentSession(_Session):
        async def execute(self, _stmt):
            await asyncio.sleep(0)
            return _RecentResult([SimpleNamespace(product='p1'), SimpleNamespace(product='p2')])

    recent = await catalog_service.get_recently_viewed(_RecentSession(), user_id=uuid4(), session_id=None, limit=2)
    assert recent == ['p1', 'p2']
    recent_session = await catalog_service.get_recently_viewed(_RecentSession(), user_id=None, session_id='sid', limit=2)
    assert recent_session == ['p1', 'p2']
    none_recent = await catalog_service.get_recently_viewed(_RecentSession(), user_id=None, session_id=None, limit=2)
    assert none_recent == []


@pytest.mark.anyio
async def test_catalog_residual_wave2_import_and_notification_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    bad_row, bad_error = catalog_service._parse_import_product_row({'slug': '', 'name': 'N', 'category_slug': 'c'}, 1)
    assert bad_row is None
    assert 'missing slug' in str(bad_error)

    parsed_row, parsed_error = catalog_service._parse_import_product_row(
        {
            'slug': 's-1',
            'name': 'Name',
            'category_slug': 'cat',
            'base_price': '12.5',
            'stock_quantity': '5',
            'currency': 'RON',
            'status': 'published',
            'is_featured': 'true',
            'is_active': 'false',
            'tags': 'a,b',
        },
        2,
    )
    assert parsed_error is None
    assert parsed_row is not None and parsed_row['slug'] == 's-1'
    assert parsed_row['is_featured'] is True
    assert parsed_row['is_active'] is False

    seen: set[str] = set()
    dup_row, dup_error = catalog_service._parse_category_import_row_or_error(3, {'slug': 'same', 'name': 'N'}, seen)
    assert dup_row is not None and dup_error is None
    _, second_error = catalog_service._parse_category_import_row_or_error(4, {'slug': 'same', 'name': 'N2'}, seen)
    assert second_error is not None

    row_cycle, cycle_error = catalog_service._parse_category_import_row_or_error(
        5,
        {'slug': 'self', 'name': 'Self', 'parent_slug': 'self'},
        set(),
    )
    assert row_cycle is None and cycle_error is not None

    class _ParentResult:
        def __init__(self, values):
            self._values = list(values)

        def scalars(self):
            return self

        def all(self):
            return list(self._values)

    class _HierarchyResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return list(self._rows)

    class _ImportSession(_Session):
        def __init__(self, parent_values, hierarchy_rows):
            super().__init__()
            self.parent_values = parent_values
            self.hierarchy_rows = hierarchy_rows
            self.call = 0

        async def execute(self, _stmt):
            await asyncio.sleep(0)
            self.call += 1
            if self.call == 1:
                return _ParentResult(self.parent_values)
            return _HierarchyResult(self.hierarchy_rows)

    rows = [
        {'idx': 1, 'slug': 'child', 'parent_slug': 'parent'},
        {'idx': 2, 'slug': 'node-a', 'parent_slug': 'node-b'},
        {'idx': 3, 'slug': 'node-b', 'parent_slug': 'node-a'},
    ]
    missing_parent_errors = await catalog_service._collect_missing_parent_errors(_ImportSession([], []), rows, {'child', 'node-a', 'node-b'})
    assert missing_parent_errors

    hierarchy_errors = await catalog_service._collect_category_hierarchy_errors(
        _ImportSession([], [(uuid4(), 'live-root', None)]),
        rows,
    )
    assert any('cycle' in err.lower() for err in hierarchy_errors)

    calls: list[tuple[str, str]] = []

    async def _upsert_lang(_session, *, category, lang, raw_name, raw_desc):
        await asyncio.sleep(0)
        calls.append((lang, raw_name))

    monkeypatch.setattr(catalog_service, '_upsert_import_category_translation_for_lang', _upsert_lang)
    await catalog_service._upsert_import_category_translations(
        _Session(),
        [
            {'slug': 'a', 'name_ro': 'Nume', 'name_en': 'Name', 'description_ro': 'RO', 'description_en': 'EN'},
            {'slug': 'missing', 'name_ro': 'Skip', 'name_en': 'Skip'},
        ],
        {'a': SimpleNamespace(id=uuid4(), slug='a')},
    )
    assert ('ro', 'Nume') in calls and ('en', 'Name') in calls

    async def _send(email: str, _product_name: str):
        await asyncio.sleep(0)
        return email.endswith('@ok.test')

    monkeypatch.setattr(catalog_service.email_service, 'send_back_in_stock', _send)
    sent = await catalog_service.notify_back_in_stock(['a@ok.test', 'b@fail.test', 'c@ok.test'], 'Product')
    assert sent == 2


@pytest.mark.anyio
async def test_catalog_residual_wave2_add_image_and_csv_rollback_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeImage:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    session = _Session()
    product = SimpleNamespace(id=uuid4(), slug='ring')
    payload = _Payload(url='https://cdn.test/a.jpg', alt_text='alt', sort_order=1)
    monkeypatch.setattr(catalog_service, 'ProductImage', _FakeImage)

    created = await catalog_service.add_product_image(session, product, payload)
    assert created.product is product
    assert session.commits == 1
    assert session.added

    class _RollupResult:
        def __init__(self, values):
            self._values = list(values)

        def scalars(self):
            return self

        def all(self):
            return list(self._values)

    class _RollbackSession(_Session):
        def __init__(self):
            super().__init__()
            self.rollbacks = 0

        async def execute(self, _stmt):
            await asyncio.sleep(0)
            return _RollupResult([])

        async def rollback(self):
            await asyncio.sleep(0)
            self.rollbacks += 1

    rollback_session = _RollbackSession()
    duplicate_csv = "slug,name,parent_slug,sort_order\nsame,One,,\nsame,Two,,\n"
    result = await catalog_service.import_categories_csv(rollback_session, duplicate_csv, dry_run=False)
    assert result['errors']
    assert rollback_session.rollbacks == 1


@pytest.mark.anyio
async def test_catalog_residual_wave2_import_products_invalid_row_and_parent_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(catalog_service, '_parse_import_product_row', lambda *_args, **_kwargs: (None, None))

    finalized: list[tuple[bool, list[str]]] = []

    async def _finalize(_session, *, dry_run: bool, errors: list[str]):
        await asyncio.sleep(0)
        finalized.append((dry_run, list(errors)))

    monkeypatch.setattr(catalog_service, '_finalize_import_products_transaction', _finalize)
    csv_payload = "slug,name,category_slug\nring,Ring,cat\n"
    imported = await catalog_service.import_products_csv(_Session(), csv_payload, dry_run=True)
    assert any('invalid row' in err for err in imported['errors'])
    assert finalized and finalized[0][0] is True

    class _ParentResult:
        def __init__(self, values):
            self._values = list(values)

        def scalars(self):
            return self

        def all(self):
            return list(self._values)

    class _FoundParentSession(_Session):
        async def execute(self, _stmt):
            await asyncio.sleep(0)
            return _ParentResult(['parent-a'])

    rows = [{'idx': 2, 'slug': 'child', 'parent_slug': 'parent-a'}]
    errors = await catalog_service._collect_missing_parent_errors(_FoundParentSession(), rows, {'child'})
    assert errors == []


def test_catalog_residual_wave2_category_parser_error_branches() -> None:
    _, parent_error = catalog_service._parse_category_import_row_or_error(
        10,
        {'slug': 'self', 'name': 'Self', 'parent_slug': 'self'},
        set(),
    )
    assert parent_error is not None and 'parent_slug' in parent_error

    _, sort_error = catalog_service._parse_category_import_row_or_error(
        11,
        {'slug': 'valid-slug', 'name': 'Name', 'sort_order': 'abc'},
        set(),
    )
    assert sort_error is not None and 'sort_order' in sort_error

    _, translation_error = catalog_service._parse_category_import_row_or_error(
        12,
        {'slug': 'valid-slug-2', 'name': 'Name', 'description_en': 'Needs translation'},
        set(),
    )
    assert translation_error is not None and 'description_en' in translation_error

