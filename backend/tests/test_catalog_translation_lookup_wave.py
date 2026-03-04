from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import catalog as catalog_service


class _ScalarRowsResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def scalars(self) -> "_ScalarRowsResult":
        return self

    def all(self) -> list[object]:
        return list(self._rows)


class _SessionStub:
    def __init__(self) -> None:
        self.execute_results: list[object] = []
        self.scalar_results: list[object] = []
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.commits = 0
        self.refreshed: list[object] = []

    async def execute(self, _stmt: object) -> object:
        await asyncio.sleep(0)
        if not self.execute_results:
            raise AssertionError('Unexpected execute() call')
        return self.execute_results.pop(0)

    async def scalar(self, _stmt: object) -> object:
        await asyncio.sleep(0)
        if not self.scalar_results:
            return None
        return self.scalar_results.pop(0)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, obj: object) -> None:
        await asyncio.sleep(0)
        self.refreshed.append(obj)

    async def delete(self, obj: object) -> None:
        await asyncio.sleep(0)
        self.deleted.append(obj)


@pytest.mark.anyio
async def test_catalog_category_translation_crud_branches() -> None:
    session = _SessionStub()
    category = SimpleNamespace(id=uuid4())

    session.execute_results = [_ScalarRowsResult([SimpleNamespace(lang='en'), SimpleNamespace(lang='ro')])]
    rows = await catalog_service.list_category_translations(session, category)
    assert [row.lang for row in rows] == ['en', 'ro']

    existing = SimpleNamespace(name='Old', description='Old desc')
    session.scalar_results = [existing]
    updated = await catalog_service.upsert_category_translation(
        session,
        category=category,
        lang='en',
        payload=SimpleNamespace(name='New', description='Desc'),
    )
    assert updated is existing
    assert existing.name == 'New'
    assert session.commits >= 1

    session.scalar_results = [None]
    created = await catalog_service.upsert_category_translation(
        session,
        category=category,
        lang='ro',
        payload=SimpleNamespace(name='Nume', description='Descriere'),
    )
    assert getattr(created, 'lang') == 'ro'
    assert session.refreshed

    session.scalar_results = [None]
    with pytest.raises(HTTPException, match='Category translation not found'):
        await catalog_service.delete_category_translation(session, category=category, lang='de')

    victim = SimpleNamespace(lang='ro')
    session.scalar_results = [victim]
    await catalog_service.delete_category_translation(session, category=category, lang='ro')
    assert victim in session.deleted


@pytest.mark.anyio
async def test_catalog_product_translation_crud_branches() -> None:
    session = _SessionStub()
    product = SimpleNamespace(id=uuid4())

    session.execute_results = [_ScalarRowsResult([SimpleNamespace(lang='en')])]
    rows = await catalog_service.list_product_translations(session, product)
    assert len(rows) == 1

    existing = SimpleNamespace(name='Old', short_description='old')
    session.scalar_results = [existing]
    updated = await catalog_service.upsert_product_translation(
        session,
        product=product,
        lang='en',
        payload=SimpleNamespace(
            name='New',
            short_description='Short',
            long_description='Long',
            meta_title='Meta',
            meta_description='Meta desc',
        ),
    )
    assert updated is existing
    assert existing.meta_title == 'Meta'

    session.scalar_results = [None]
    created = await catalog_service.upsert_product_translation(
        session,
        product=product,
        lang='ro',
        payload=SimpleNamespace(
            name='Produs',
            short_description='Scurt',
            long_description='Lung',
            meta_title='Titlu',
            meta_description='Descriere',
        ),
    )
    assert getattr(created, 'lang') == 'ro'

    session.scalar_results = [None]
    with pytest.raises(HTTPException, match='Product translation not found'):
        await catalog_service.delete_product_translation(session, product=product, lang='de')

    victim = SimpleNamespace(lang='en')
    session.scalar_results = [victim]
    await catalog_service.delete_product_translation(session, product=product, lang='en')
    assert victim in session.deleted


@pytest.mark.anyio
async def test_catalog_product_image_translation_crud_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()
    image = SimpleNamespace(id=uuid4(), product_id=uuid4())
    audit_calls: list[dict[str, object]] = []

    async def _log_action(_session: object, product_id: object, action: str, user_id: object, data: dict[str, object]) -> None:
        await asyncio.sleep(0)
        audit_calls.append({'product_id': product_id, 'action': action, 'user_id': user_id, 'data': data})

    monkeypatch.setattr(catalog_service, '_log_product_action', _log_action)

    session.execute_results = [_ScalarRowsResult([SimpleNamespace(lang='en')])]
    rows = await catalog_service.list_product_image_translations(session, image=image)
    assert len(rows) == 1

    existing = SimpleNamespace(alt_text='Old', caption='Old')
    session.scalar_results = [existing]
    updated = await catalog_service.upsert_product_image_translation(
        session,
        image=image,
        lang='en',
        payload=SimpleNamespace(alt_text='  New alt  ', caption='  New cap  '),
        user_id=uuid4(),
        source='admin',
    )
    assert updated is existing
    assert existing.alt_text == 'New alt'
    assert existing.caption == 'New cap'

    session.scalar_results = [None]
    created = await catalog_service.upsert_product_image_translation(
        session,
        image=image,
        lang='ro',
        payload=SimpleNamespace(alt_text='  ', caption='  Caption  '),
        user_id=None,
        source=None,
    )
    assert getattr(created, 'lang') == 'ro'
    assert getattr(created, 'alt_text') == ''

    session.scalar_results = [None]
    with pytest.raises(HTTPException, match='Product image translation not found'):
        await catalog_service.delete_product_image_translation(session, image=image, lang='de')

    victim = SimpleNamespace(lang='ro')
    session.scalar_results = [victim]
    await catalog_service.delete_product_image_translation(session, image=image, lang='ro', user_id=uuid4(), source='admin')
    assert victim in session.deleted
    assert audit_calls


def test_catalog_image_optimization_error_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    image = SimpleNamespace(url='/media/test.jpg')

    monkeypatch.setattr(catalog_service, 'get_media_image_stats', lambda _url: {'width': 100, 'height': 50})
    stats = catalog_service.get_product_image_optimization_stats(image)
    assert stats['width'] == 100

    monkeypatch.setattr(catalog_service, 'get_media_image_stats', lambda _url: (_ for _ in ()).throw(ValueError('bad image')))
    with pytest.raises(HTTPException, match='bad image'):
        catalog_service.get_product_image_optimization_stats(image)

    monkeypatch.setattr(catalog_service, 'get_media_image_stats', lambda _url: (_ for _ in ()).throw(RuntimeError('boom')))
    with pytest.raises(HTTPException, match='Unable to read image stats'):
        catalog_service.get_product_image_optimization_stats(image)


def test_catalog_thumbnail_reprocess_error_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    image = SimpleNamespace(url='/media/test.jpg')

    monkeypatch.setattr(catalog_service, 'regenerate_media_thumbnails', lambda _url: {'generated': 3})
    result = catalog_service.reprocess_product_image_thumbnails(image)
    assert result['generated'] == 3

    monkeypatch.setattr(catalog_service, 'regenerate_media_thumbnails', lambda _url: (_ for _ in ()).throw(FileNotFoundError('missing')))
    with pytest.raises(HTTPException, match='Image file not found'):
        catalog_service.reprocess_product_image_thumbnails(image)

    monkeypatch.setattr(catalog_service, 'regenerate_media_thumbnails', lambda _url: (_ for _ in ()).throw(ValueError('invalid')))
    with pytest.raises(HTTPException, match='invalid'):
        catalog_service.reprocess_product_image_thumbnails(image)

    monkeypatch.setattr(catalog_service, 'regenerate_media_thumbnails', lambda _url: (_ for _ in ()).throw(RuntimeError('bad')))
    with pytest.raises(HTTPException, match='Unable to reprocess thumbnails'):
        catalog_service.reprocess_product_image_thumbnails(image)

