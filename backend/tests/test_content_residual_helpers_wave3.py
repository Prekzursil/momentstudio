from __future__ import annotations
import asyncio

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.services import content as content_service


def test_content_legal_bilingual_and_slug_validation_branches() -> None:
    draft_block = SimpleNamespace(
        status=content_service.ContentStatus.draft,
        lang='en',
        title='Terms',
        body_markdown='Body',
        translations=[],
    )
    content_service._enforce_legal_pages_bilingual('page.terms', draft_block)

    with pytest.raises(content_service.HTTPException, match='base language'):
        content_service._enforce_legal_pages_bilingual(
            'page.terms',
            SimpleNamespace(
                status=content_service.ContentStatus.published,
                lang='de',
                title='Terms',
                body_markdown='Body',
                translations=[],
            ),
        )

    with pytest.raises(content_service.HTTPException, match='missing: ro'):
        content_service._enforce_legal_pages_bilingual(
            'page.terms',
            SimpleNamespace(
                status=content_service.ContentStatus.published,
                lang='en',
                title='Terms',
                body_markdown='Body',
                translations=[SimpleNamespace(lang='en', title='Terms', body_markdown='Body')],
            ),
        )

    assert content_service._validate_page_slug('  Fancy  Page ') == 'fancy-page'
    with pytest.raises(content_service.HTTPException, match='reserved'):
        content_service._validate_page_slug('admin')
    with pytest.raises(content_service.HTTPException, match='Invalid page slug'):
        content_service._validate_page_slug('   ')


def test_content_translation_and_meta_translation_requirements() -> None:
    block = SimpleNamespace(
        lang='en',
        title='Base',
        body_markdown='Body',
        translations=[SimpleNamespace(lang='ro', title='Titlu', body_markdown='Corp')],
    )

    content_service._apply_content_translation(block, None)
    assert block.title == 'Base'

    content_service._apply_content_translation(block, 'en')
    assert block.title == 'Base'

    content_service._apply_content_translation(block, 'ro')
    assert block.title == 'Titlu'
    assert block.body_markdown == 'Corp'

    assert content_service._base_update_requires_translation(
        {'meta': {'hidden': True}},
        prev_meta={'hidden': False},
        next_meta={'hidden': True},
    ) is False
    assert content_service._base_update_requires_translation(
        {'meta': {'headline': 'x'}},
        prev_meta={'hidden': False},
        next_meta={'headline': 'x'},
    ) is True
    assert content_service._base_update_requires_translation(
        {'title': 'Changed'},
        prev_meta=None,
        next_meta=None,
    ) is True


def test_apply_published_and_base_update_field_branches() -> None:
    now = datetime.now(timezone.utc)
    block = SimpleNamespace(
        title='Old',
        body_markdown='Old body',
        status=content_service.ContentStatus.draft,
        published_at=None,
        published_until=None,
        meta={'hidden': False},
        sort_order=1,
        lang='en',
    )

    content_service._apply_published_at_on_publish(block, data={}, published_at=None, now=now)
    assert block.published_at == now

    block.published_at = None
    content_service._apply_published_at_on_publish(block, data={'published_at': True}, published_at=None, now=now)
    assert block.published_at == now

    content_service._apply_base_update_fields(
        block,
        {
            'title': 'New',
            'body_markdown': 'Body',
            'status': content_service.ContentStatus.published,
            'published_until': now + timedelta(minutes=10),
            'meta': {'version': 2},
            'sort_order': 5,
            'lang': 'ro',
        },
        published_at=now,
        published_until=now + timedelta(minutes=10),
        now=now,
    )
    assert block.status == content_service.ContentStatus.published
    assert block.sort_order == 5
    assert block.lang == 'ro'
    assert block.published_until == now + timedelta(minutes=10)


class _SessionForSnapshot:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.refreshed: list[tuple[object, object]] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def refresh(self, obj: object, attribute_names=None) -> None:
        await asyncio.sleep(0)
        self.refreshed.append((obj, attribute_names))

    async def delete(self, obj: object) -> None:
        await asyncio.sleep(0)
        self.deleted.append(obj)


def test_snapshot_parse_and_apply_helpers() -> None:
    assert content_service._parse_snapshot_translation_item(None) is None
    assert content_service._parse_snapshot_translation_item({'lang': '', 'title': 't', 'body_markdown': 'b'}) is None

    parsed = content_service._parse_snapshot_translation_item({'lang': 'ro', 'title': 'Titlu', 'body_markdown': 'Corp'})
    assert parsed == ('ro', 'Titlu', 'Corp')

    existing = {'ro': SimpleNamespace(lang='ro', title='Old', body_markdown='Old body')}
    target_langs: set[str] = set()
    session = _SessionForSnapshot()

    content_service._apply_snapshot_translation(
        session,
        block_id=UUID(int=1),
        existing_by_lang=existing,
        target_langs=target_langs,
        parsed=('ro', 'Nou', 'Corp nou'),
    )
    assert existing['ro'].title == 'Nou'

    content_service._apply_snapshot_translation(
        session,
        block_id=UUID(int=1),
        existing_by_lang=existing,
        target_langs=target_langs,
        parsed=('en', 'Title', 'Body'),
    )
    assert 'en' in target_langs
    assert len(session.added) == 1


@pytest.mark.anyio
async def test_sync_snapshot_translations_deletes_absent_rows() -> None:
    session = _SessionForSnapshot()
    ro = SimpleNamespace(lang='ro', title='Old ro', body_markdown='Body ro')
    en = SimpleNamespace(lang='en', title='Old en', body_markdown='Body en')
    block = SimpleNamespace(id=UUID(int=2), translations=[ro, en])

    await content_service._sync_snapshot_translations(
        session,
        block=block,
        snapshot_translations=[{'lang': 'ro', 'title': 'RO new', 'body_markdown': 'RO body new'}],
    )

    assert ro.title == 'RO new'
    assert en in session.deleted


def test_markdown_parsing_and_link_collectors() -> None:
    assert content_service._parse_markdown_target_span('[x](url)', start=0, text_len=8) == (4, 7, 8)
    assert content_service._parse_markdown_target_span('[x] trailing', start=0, text_len=len('[x] trailing')) == (-1, -1, 3)
    assert content_service._parse_markdown_target_span('[x](missing', start=0, text_len=len('[x](missing')) is None

    urls = content_service._extract_markdown_target_urls('![img](/media/a.png) [go](/pages/about) [mail](mailto:x@y)', image_only=False)
    assert '/pages/about' in urls
    assert all('mailto:' not in value for value in urls)

    block = SimpleNamespace(
        body_markdown='![img](/media/a.png) [about](/pages/about)',
        meta={'blocks': [{'type': 'banner', 'slide': {'image_url': '/media/banner.png', 'cta_url': '/shop/rings'}}]},
        images=[SimpleNamespace(url='/media/from-block.png')],
    )
    refs = content_service._collect_block_link_refs(block)
    kinds = {item[0] for item in refs}
    assert 'image' in kinds
    assert 'link' in kinds


def test_handle_shop_link_issue_branches() -> None:
    issues: list[content_service.ContentLinkCheckIssue] = []

    assert content_service._handle_shop_link_issues(
        issues,
        content_key='page.home',
        kind='link',
        source='markdown',
        field='body_markdown',
        url='/pages/about',
        path='/pages/about',
        query='',
        existing_categories={'rings'},
    ) is False

    assert content_service._handle_shop_link_issues(
        issues,
        content_key='page.home',
        kind='link',
        source='markdown',
        field='body_markdown',
        url='/shop/rings?sub=gold',
        path='/shop/rings',
        query='sub=gold',
        existing_categories={'rings'},
    ) is True
    assert any(item.reason == 'Category not found' for item in issues)


def test_resolve_editable_image_source_branches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(content_service.HTTPException, match='Invalid image URL'):
        content_service._resolve_editable_image_source(SimpleNamespace(url=''))

    jpg = tmp_path / 'sample.jpg'
    jpg.write_bytes(b'jpg')
    gif = tmp_path / 'sample.gif'
    gif.write_bytes(b'gif')
    bmp = tmp_path / 'sample.bmp'
    bmp.write_bytes(b'bmp')

    monkeypatch.setattr(content_service.storage, 'media_url_to_path', lambda url: jpg)
    src, suffix, out_format = content_service._resolve_editable_image_source(SimpleNamespace(url='/media/sample.jpg'))
    assert src == jpg
    assert suffix == '.jpg'
    assert out_format == 'JPEG'

    monkeypatch.setattr(content_service.storage, 'media_url_to_path', lambda url: gif)
    with pytest.raises(content_service.HTTPException, match='GIF editing is not supported'):
        content_service._resolve_editable_image_source(SimpleNamespace(url='/media/sample.gif'))

    monkeypatch.setattr(content_service.storage, 'media_url_to_path', lambda url: bmp)
    with pytest.raises(content_service.HTTPException, match='Unsupported image type'):
        content_service._resolve_editable_image_source(SimpleNamespace(url='/media/sample.bmp'))


