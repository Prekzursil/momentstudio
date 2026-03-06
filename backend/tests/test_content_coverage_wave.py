from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.api.v1 import content as content_api
from app.schemas.content import ContentRedirectUpsertRequest


def test_content_access_redirect_and_csv_helper_branches() -> None:
    content_api._require_owner_or_admin(SimpleNamespace(role='owner'))
    content_api._require_owner_or_admin(SimpleNamespace(role='admin'))
    with pytest.raises(HTTPException, match='Only owner/admin'):
        content_api._require_owner_or_admin(SimpleNamespace(role='customer'))

    now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
    window_end = now + timedelta(days=2)
    filters, next_event = content_api._build_scheduling_filters(now, window_end)
    assert len(filters) == 3
    assert 'status' in str(filters[1]).lower()
    assert 'published' in str(next_event).lower()

    block = SimpleNamespace(
        key='page.home',
        title='Home',
        status='published',
        lang='en',
        published_at=now,
        published_until=None,
        updated_at=now,
    )
    scheduling_item = content_api._to_scheduling_item(block)
    assert scheduling_item.key == 'page.home'
    assert scheduling_item.title == 'Home'

    redirect_row = SimpleNamespace(
        id=uuid4(),
        from_key='page.old',
        to_key='page.new',
        created_at=now,
        updated_at=now,
    )
    redirect_payload = content_api._serialize_redirect(redirect_row, target_exists=True, chain_error=None)
    assert redirect_payload.from_key == 'page.old'
    assert redirect_payload.target_exists is True

    assert len(content_api._build_redirect_search_filters('   ')) == 1
    assert content_api._csv_row_value(['a', None], 1) is None
    assert content_api._csv_row_value(['a'], 2) is None
    assert content_api._stripped_csv_row_value(['  value  '], 0) == 'value'
    assert content_api._stripped_csv_row_value([], 0) == ''
    assert content_api._none_if_empty('') is None
    assert content_api._none_if_empty('value') == 'value'

    deep_map = {f'page.{i}': f'page.{i + 1}' for i in range(60)}
    with pytest.raises(HTTPException, match='Redirect chain too deep'):
        content_api._raise_for_redirect_import_chain_errors(deep_map)

    with pytest.raises(HTTPException) as exc_info:
        content_api._raise_for_redirect_import_chain_errors(
            {
                **deep_map,
                'page.loop.a': 'page.loop.b',
                'page.loop.b': 'page.loop.a',
            }
        )
    assert 'Redirect loop detected' in str(exc_info.value.detail)
    assert 'Redirect chain too deep' in str(exc_info.value.detail)


@pytest.mark.anyio
async def test_content_redirect_async_helper_branches() -> None:
    class _Scalars:
        def __init__(self, rows: list[object]) -> None:
            self._rows = rows

        def all(self) -> list[object]:
            return list(self._rows)

    class _Result:
        def __init__(
            self,
            *,
            rows: list[tuple[str, str | None]] | None = None,
            scalars: list[object] | None = None,
        ) -> None:
            self._rows = rows or []
            self._scalars = scalars or []

        def all(self) -> list[tuple[str, str | None]]:
            return list(self._rows)

        def scalars(self) -> _Scalars:
            return _Scalars(self._scalars)

    class _Session:
        def __init__(self, *results: _Result, scalar_values: list[object | None] | None = None) -> None:
            self._results = list(results)
            self._scalar_values = list(scalar_values or [])
            self.added: list[object] = []

        def execute(self, _stmt: object):
            if not self._results:
                raise AssertionError('Unexpected execute() call')
            return asyncio.sleep(0, result=self._results.pop(0))

        def scalar(self, _stmt: object):
            if not self._scalar_values:
                return asyncio.sleep(0, result=None)
            return asyncio.sleep(0, result=self._scalar_values.pop(0))

        def add(self, value: object) -> None:
            self.added.append(value)

    redirect_map = await content_api._load_redirect_map(
        _Session(
            _Result(
                rows=[
                    ('page.a', 'page.b'),
                    ('', 'ignored'),
                    ('page.c', None),
                ]
            )
        )
    )
    assert redirect_map == {'page.a': 'page.b'}

    target_keys = await content_api._load_redirect_target_keys(
        _Session(_Result(scalars=['page.target', 'page.other'])),
        [SimpleNamespace(to_key='page.target'), SimpleNamespace(to_key='page.other')],
    )
    assert target_keys == {'page.target', 'page.other'}
    assert await content_api._load_redirect_target_keys(_Session(), []) == set()

    await content_api._assert_redirect_target_exists(_Session(scalar_values=['page.target']), 'page.target')
    with pytest.raises(HTTPException, match='Redirect target not found'):
        await content_api._assert_redirect_target_exists(_Session(scalar_values=[None]), 'page.missing')

    unchanged = content_api.ContentRedirect(from_key='page.same', to_key='page.target')
    changed = content_api.ContentRedirect(from_key='page.change', to_key='page.old')
    apply_session = _Session(_Result(scalars=[unchanged, changed]))
    created, updated, skipped = await content_api._apply_redirect_import_changes(
        apply_session,
        {
            'page.new': 'page.target',
            'page.same': 'page.target',
            'page.change': 'page.new',
        },
    )
    assert (created, updated, skipped) == (1, 1, 1)
    assert changed.to_key == 'page.new'
    assert any(
        isinstance(value, content_api.ContentRedirect) and value.from_key == 'page.new'
        for value in apply_session.added
    )


def test_content_visibility_and_image_tag_helpers() -> None:
    public_block = SimpleNamespace(key='page.about', meta={})
    private_block = SimpleNamespace(key='page.account', meta={'requires_auth': True})
    hidden_block = SimpleNamespace(key='page.secret', meta={'hidden': True})

    assert content_api._requires_auth(private_block) is True
    assert content_api._requires_auth(SimpleNamespace(key='page.any', meta='not-a-dict')) is False
    assert content_api._is_hidden(hidden_block) is True
    assert content_api._is_hidden(SimpleNamespace(key='page.any', meta='not-a-dict')) is False

    assert content_api._normalize_image_tag(' Hero Banner ') == 'hero-banner'
    assert content_api._normalize_image_tag('___tag___') == 'tag'
    assert content_api._normalize_image_tag('') is None
    assert content_api._normalize_image_tag('x' * 70) is None

    tags = content_api._normalize_image_tags(
        [' Hero ', 'hero', 'new tag', 'tag_2', ' ', 'x' * 100] + [f't{i}' for i in range(20)]
    )
    assert tags[0:3] == ['hero', 'new-tag', 'tag_2']
    assert len(tags) == 10

    content_api._validate_public_page_access(public_block, user=None)
    with pytest.raises(HTTPException, match='Content not found'):
        content_api._validate_public_page_access(hidden_block, user=None)
    with pytest.raises(HTTPException, match='Not authenticated'):
        content_api._validate_public_page_access(private_block, user=None)
    content_api._validate_public_page_access(private_block, user=SimpleNamespace(id='user-1'))

    # Non-page keys bypass page-only auth/hidden checks.
    content_api._validate_public_page_access(SimpleNamespace(key='site.footer', meta={'hidden': True}), user=None)


def test_content_redirect_conversion_chain_and_meta_helpers() -> None:
    assert content_api._redirect_key_to_display_value('page.about-us') == '/pages/about-us'
    assert content_api._redirect_key_to_display_value('blog.post') == 'blog.post'
    assert content_api._redirect_display_value_to_key('/pages/About Us') == 'page.about-us'
    assert content_api._redirect_display_value_to_key('pages/contact') == 'page.contact'
    assert content_api._redirect_display_value_to_key('site.home') == 'site.home'

    redirects = {'page.a': 'page.b', 'page.b': 'page.c'}
    assert content_api._redirect_chain_error('page.a', redirects) is None
    assert content_api._redirect_chain_error('page.x', redirects) is None

    loop_redirects = {'page.a': 'page.b', 'page.b': 'page.a'}
    assert content_api._redirect_chain_error('page.a', loop_redirects) == 'loop'
    with pytest.raises(HTTPException, match='Redirect loop detected'):
        content_api._raise_for_redirect_chain_error('loop')

    deep_redirects = {f'page.{i}': f'page.{i + 1}' for i in range(60)}
    assert content_api._redirect_chain_error('page.0', deep_redirects, max_hops=10) == 'too_deep'
    with pytest.raises(HTTPException, match='Redirect chain too deep'):
        content_api._raise_for_redirect_chain_error('too_deep')

    assert content_api._build_pagination_meta(total_items=0, page=1, limit=25) == {
        'total_items': 0,
        'total_pages': 1,
        'page': 1,
        'limit': 25,
    }
    assert content_api._build_pagination_meta(total_items=51, page=2, limit=25)['total_pages'] == 3

    assert content_api._build_redirect_search_filters(None) == []
    assert len(content_api._build_redirect_search_filters('promo')) == 1


def test_content_redirect_import_parsing_helpers() -> None:
    assert content_api._is_blank_redirect_import_row([]) is True
    assert content_api._is_comment_redirect_import_row(['# comment']) is True
    assert content_api._is_header_redirect_import_row(1, ['from', 'to']) is True
    assert content_api._should_skip_redirect_import_row(1, ['from_key', 'to_key']) is True

    missing_cols = content_api._extract_redirect_import_pair(2, ['only-from'])
    assert missing_cols.error == 'Missing columns'

    missing_from = content_api._extract_redirect_import_pair(3, ['', 'to'])
    assert missing_from.error == 'Missing from/to'

    missing_to = content_api._extract_redirect_import_pair(4, ['from', ''])
    assert missing_to.error == 'Missing from/to'

    validated = content_api._validate_redirect_import_pair(5, '/pages/start', '/pages/final')
    assert validated == ('page.start', 'page.final')

    invalid = content_api._validate_redirect_import_pair(6, '/pages/@@@', '/pages/final')
    assert invalid.error == 'Invalid redirect value'

    too_long = content_api._validate_redirect_import_pair(7, 'x' * 121, '/pages/final')
    assert too_long.error == 'Key too long'

    same_keys = content_api._validate_redirect_import_pair(8, '/pages/same', '/pages/same')
    assert same_keys.error == 'from and to must differ'

    parsed = content_api._parse_redirect_import_values(9, ['/pages/one', '/pages/two'])
    assert parsed == ('page.one', 'page.two')
    assert content_api._parse_redirect_import_values(1, ['from', 'to']) is None

    csv_text = '\n'.join(
        [
            'from,to',
            '/pages/a,/pages/b',
            '# comment line,ignored',
            '/pages/b,/pages/c',
            'bad-row',
        ]
    )
    rows, errors = content_api._collect_redirect_import_rows(csv_text)
    assert rows == [(2, 'page.a', 'page.b'), (4, 'page.b', 'page.c')]
    assert len(errors) == 1
    assert errors[0].error == 'Missing columns'

    redirect_map = content_api._build_redirect_map(
        existing_rows=[('page.old', 'page.target')],
        imported_rows=[(2, 'page.old', 'page.new'), (3, 'page.a', 'page.b')],
    )
    assert redirect_map == {'page.old': 'page.new', 'page.a': 'page.b'}

    deduped = content_api._dedupe_redirect_import_rows(
        [(1, 'page.a', 'page.b'), (2, 'page.a', 'page.c'), (3, 'page.x', 'page.y')]
    )
    assert deduped == {'page.a': 'page.c', 'page.x': 'page.y'}

    with pytest.raises(HTTPException, match='Redirect loop detected'):
        content_api._raise_for_redirect_import_chain_errors({'page.a': 'page.b', 'page.b': 'page.a'})


def test_content_datetime_and_filter_helpers() -> None:
    now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
    midnight = content_api._normalize_scheduling_window_start(None, now)
    assert midnight == datetime(2026, 2, 20, 0, 0, tzinfo=timezone.utc)

    naive = datetime(2026, 2, 20, 6, 0)
    normalized = content_api._normalize_scheduling_window_start(naive, now)
    assert normalized == datetime(2026, 2, 20, 6, 0, tzinfo=timezone.utc)

    parsed_from, parsed_to = content_api._parse_optional_datetime_range(
        '2026-02-01T10:00:00',
        '2026-02-02T10:00:00',
    )
    assert parsed_from is not None and parsed_to is not None
    with pytest.raises(HTTPException, match='Invalid date filters'):
        content_api._parse_optional_datetime_range('not-a-date', None)
    with pytest.raises(HTTPException, match='Invalid date range'):
        content_api._parse_optional_datetime_range('2026-02-03T00:00:00', '2026-02-02T00:00:00')

    with pytest.raises(HTTPException, match='Invalid date range'):
        content_api._validate_content_image_date_range(now + timedelta(days=1), now)

    filters, tag_value = content_api._build_content_image_filters(
        key='page.hero',
        q='banner',
        tag=' Summer ',
        created_from=now - timedelta(days=2),
        created_to=now,
    )
    assert tag_value == 'summer'
    assert len(filters) == 5

    filters_no_tag, no_tag_value = content_api._build_content_image_filters(
        key='page.hero',
        q='banner',
        tag=None,
        created_from=now - timedelta(days=2),
        created_to=now,
    )
    assert no_tag_value == ''

    count_query_without_tag = content_api._build_content_image_count_query('')
    count_query_with_tag = content_api._build_content_image_count_query('summer')
    assert 'distinct' not in str(count_query_without_tag).lower()
    assert 'distinct' in str(count_query_with_tag).lower()

    newest = content_api._content_image_order_clauses('newest')
    fallback = content_api._content_image_order_clauses('unknown-sort')
    assert len(newest) == 2
    assert [str(clause) for clause in fallback] == [str(clause) for clause in newest]

    query_without_tag = content_api._build_content_image_query(
        filters=filters_no_tag,
        tag_value='',
        order_clauses=newest,
        offset=0,
        limit=20,
    )
    query_with_tag = content_api._build_content_image_query(
        filters=filters,
        tag_value='summer',
        order_clauses=newest,
        offset=0,
        limit=20,
    )
    assert 'content_image_tags' not in str(query_without_tag).lower()
    assert 'content_image_tags' in str(query_with_tag).lower()

    payload = ContentRedirectUpsertRequest(from_key='/pages/a', to_key='/pages/b')
    assert content_api._parse_redirect_upsert_payload_or_400(payload) == ('page.a', 'page.b')
    with pytest.raises(HTTPException, match='Invalid redirect'):
        content_api._parse_redirect_upsert_payload_or_400(
            ContentRedirectUpsertRequest(from_key='/pages/same', to_key='/pages/same')
        )
