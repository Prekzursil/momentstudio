from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import sameday_easybox_mirror as sameday
from app.services import social_thumbnails as social


def test_social_host_and_query_filters() -> None:
    assert social._is_allowed_host('facebook.com') is True
    assert social._is_allowed_host('www.instagram.com') is True
    assert social._is_allowed_host('127.0.0.1') is False
    assert social._is_allowed_host('example.com') is False

    assert social._is_allowed_thumbnail_host('cdninstagram.com') is True
    assert social._is_allowed_thumbnail_host('::1') is False

    kept = social._filtered_source_query_items('utm_source=x&fbclid=y&foo=bar&igsh=z')
    assert kept == [('foo', 'bar')]


def test_social_thumbnail_helpers_cover_decoding_and_expiry() -> None:
    assert social._json_unescape('\\u0026') == '&'
    assert social._json_unescape('not-json') == 'not-json'

    html = '<script>"profile_pic_url_hd":"https:\\/\\/cdninstagram.com\\/avatar.jpg"</script>'
    assert social._extract_instagram_profile_image(html, base_url='https://instagram.com/u') == 'https://cdninstagram.com/avatar.jpg'

    soon_hex = hex(int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp()))[2:]
    late_hex = hex(int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()))[2:]
    assert social._decode_hex_timestamp(soon_hex) is not None
    assert social._looks_signed_or_expiring(f'https://fbcdn.net/p.jpg?oe={soon_hex}') is True
    assert social._looks_signed_or_expiring(f'https://fbcdn.net/p.jpg?oe={late_hex}') is False

    assert social.thumbnail_requires_local_persist('/media/social/abc.jpg') is False
    assert social.thumbnail_requires_local_persist('https://fbcdn.net/p.jpg') is True


def test_social_cache_and_resolution_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    source = 'https://instagram.com/demo/'
    social._cache[source] = social._CacheEntry(
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        thumbnail_url='/media/social/demo.jpg',
    )
    assert social._cached_thumbnail_if_fresh(source, force_refresh=False) == '/media/social/demo.jpg'
    assert social._cached_thumbnail_if_fresh(source, force_refresh=True) is None

    async def _persist_ok(_source: str, _thumb: str) -> str:
        await asyncio.sleep(0)
        return '/media/social/local.jpg'

    async def _persist_none(_source: str, _thumb: str) -> None:
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(social, '_persist_thumbnail', _persist_ok)
    resolved = asyncio.run(
        social._resolved_thumbnail_url(
            source_url=source,
            thumbnail_url='https://cdninstagram.com/p.jpg',
            persist_local=True,
            allow_remote_fallback=False,
        )
    )
    assert resolved == '/media/social/local.jpg'

    monkeypatch.setattr(social, '_persist_thumbnail', _persist_none)
    fallback = asyncio.run(
        social._resolved_thumbnail_url(
            source_url=source,
            thumbnail_url='https://cdninstagram.com/p.jpg',
            persist_local=True,
            allow_remote_fallback=True,
        )
    )
    assert fallback == 'https://cdninstagram.com/p.jpg'


def test_social_url_handle_parsing() -> None:
    assert social.looks_like_social_url('https://facebook.com/page') is True
    assert social.looks_like_social_url('ftp://facebook.com/page') is False

    assert social.try_extract_instagram_handle('https://instagram.com/my.handle/') == 'my.handle'
    assert social.try_extract_instagram_handle('https://instagram.com/reel/xyz') is None
    assert social.try_extract_instagram_handle('https://example.com/nope') is None


def test_sameday_numeric_and_coordinate_helpers() -> None:
    assert sameday._to_float('12,5') == pytest.approx(12.5)
    assert sameday._to_float('not-a-number') is None
    assert sameday._to_float(100_000_001) is None

    assert sameday._to_lat_lng({'lat': '45.7', 'lng': '26.1'}) == (45.7, 26.1)
    assert sameday._to_lat_lng({'geometry': {'coordinates': [26.1, 45.7]}}) == (45.7, 26.1)
    assert sameday._to_lat_lng({'location': {'latitude': 45.7, 'longitude': 26.1}}) == (45.7, 26.1)
    assert sameday._to_lat_lng({'lat': None, 'lng': None}) is None


def test_sameday_row_normalization_and_hash_fallback() -> None:
    row = {
        'lockerId': 'LOCK-1',
        'name': ' Easybox 1 ',
        'address': ' Street 1 ',
        'city': 'Bucuresti',
        'county': 'B',
        'postalCode': '010101',
        'lat': 44.43,
        'lng': 26.1,
    }
    normalized = sameday._normalize_row(row)
    assert normalized is not None
    assert normalized.external_id == 'LOCK-1'
    assert normalized.name == 'Easybox 1'

    assert len(sameday._payload_hash({'a': 1})) == 64
    assert len(sameday._payload_hash(object())) == 64


class _DummyResponse:
    def __init__(self, *, status_code: int = 200, headers: dict[str, str] | None = None, text: str = '{}') -> None:
        self.status_code = status_code
        self.headers = headers or {'content-type': 'application/json'}
        self.text = text

    def json(self):
        return {'ok': True}


class _DummyClient:
    def __init__(self, response: _DummyResponse) -> None:
        self._response = response

    async def get(self, _url: str):
        await asyncio.sleep(0)
        return self._response


def test_sameday_fetch_json_url_validation_errors() -> None:
    with pytest.raises(RuntimeError, match='Cloudflare challenge'):
        asyncio.run(
            sameday._fetch_json_url(
                _DummyClient(_DummyResponse(headers={'cf-mitigated': 'challenge'})),
                'https://sameday.ro/api',
            )
        )

    with pytest.raises(RuntimeError, match='404'):
        asyncio.run(
            sameday._fetch_json_url(
                _DummyClient(_DummyResponse(status_code=404, text='not-found')),
                'https://sameday.ro/api',
            )
        )


def test_sameday_parse_playwright_payload() -> None:
    payload, source = sameday._parse_playwright_payload(b'{"source_url":"https://sameday.ro","payload":{"items":[]}}')
    assert source == 'https://sameday.ro'
    assert payload == {'items': []}

    with pytest.raises(RuntimeError, match='invalid JSON'):
        sameday._parse_playwright_payload(b'{bad-json')

    with pytest.raises(RuntimeError, match='payload is empty'):
        sameday._parse_playwright_payload(b'{"source_url":"https://sameday.ro","payload":null}')


def test_sameday_fetch_template_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ok(_client, _url: str):
        await asyncio.sleep(0)
        return [{'lockerId': 'A', 'lat': 44.0, 'lng': 26.0}]

    monkeypatch.setattr(sameday, '_fetch_json_url', _ok)
    rows = asyncio.run(sameday._fetch_template_rows(SimpleNamespace(), 'https://sameday.ro/api?q={q}'))
    assert rows

    async def _fail(_client, _url: str):
        await asyncio.sleep(0)
        raise RuntimeError('fail')

    monkeypatch.setattr(sameday, '_fetch_json_url', _fail)
    rows_fail = asyncio.run(sameday._fetch_template_rows(SimpleNamespace(), 'https://sameday.ro/api?q={q}'))
    assert rows_fail == []
class _StreamResponse:
    def __init__(self, *, url: str, html: str = '', content: bytes = b'', headers: dict[str, str] | None = None) -> None:
        self.url = url
        self._html = html
        self.content = content
        self.headers = headers or {}

    async def __aenter__(self):
        await asyncio.sleep(0)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await asyncio.sleep(0)
        return False

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        await asyncio.sleep(0)
        if self._html:
            yield self._html.encode('utf-8')


class _AsyncClientStub:
    def __init__(self, *, stream_response: _StreamResponse | None = None, get_response: _StreamResponse | None = None) -> None:
        self._stream_response = stream_response
        self._get_response = get_response

    async def __aenter__(self):
        await asyncio.sleep(0)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await asyncio.sleep(0)
        return False

    def stream(self, _method: str, _url: str):
        if self._stream_response is None:
            raise RuntimeError('missing stream response')
        return self._stream_response

    async def get(self, _url: str):
        await asyncio.sleep(0)
        if self._get_response is None:
            raise RuntimeError('missing get response')
        return self._get_response


def test_social_source_normalization_and_candidate_helpers() -> None:
    normalized = social._normalize_source_url('https://facebook.com//demo///?utm_source=x&foo=bar&fbclid=a')
    assert normalized == 'https://facebook.com/demo/?foo=bar'

    assert social._normalized_source_path('demo') == '/demo/'
    assert social._normalized_netloc(host='facebook.com', scheme='https', port=443) == 'facebook.com'
    assert social._normalized_netloc(host='facebook.com', scheme='https', port=444) == 'facebook.com:444'

    assert social._normalize_image_url('data:image/png;base64,aaa', base_url='https://facebook.com') is None
    assert social._normalize_image_url('javascript:alert(1)', base_url='https://facebook.com') is None
    assert social._normalize_image_url('//cdninstagram.com/a.jpg', base_url='https://instagram.com/user') == 'https://cdninstagram.com/a.jpg'
    assert social._normalize_image_url('/a.jpg', base_url='https://facebook.com/page') == 'https://facebook.com/a.jpg'


def test_social_fetch_page_thumbnail_candidate_and_download_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    html = '<meta property="og:image" content="/thumb.jpg">'
    stream_resp = _StreamResponse(url='https://facebook.com/page', html=html)

    monkeypatch.setattr(
        social.httpx,
        'AsyncClient',
        lambda **kwargs: _AsyncClientStub(stream_response=stream_resp),
    )

    thumb = asyncio.run(social._fetch_page_thumbnail_candidate('https://facebook.com/page'))
    assert thumb == 'https://facebook.com/thumb.jpg'

    image_resp = _StreamResponse(
        url='https://cdninstagram.com/thumb.jpg',
        content=b'img-bytes',
        headers={'content-type': 'image/jpeg'},
    )
    monkeypatch.setattr(
        social.httpx,
        'AsyncClient',
        lambda **kwargs: _AsyncClientStub(get_response=image_resp),
    )
    body = asyncio.run(social._download_thumbnail_bytes('https://cdninstagram.com/thumb.jpg'))
    assert body == b'img-bytes'

    bad_redirect = _StreamResponse(url='https://example.com/redirect.jpg', content=b'img', headers={'content-type': 'image/jpeg'})
    monkeypatch.setattr(
        social.httpx,
        'AsyncClient',
        lambda **kwargs: _AsyncClientStub(get_response=bad_redirect),
    )
    with pytest.raises(ValueError, match='redirect host'):
        asyncio.run(social._download_thumbnail_bytes('https://cdninstagram.com/thumb.jpg'))


def test_social_persist_and_hydration_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(social, '_download_thumbnail_bytes', lambda _url: asyncio.sleep(0, result=b'png-bytes'))
    monkeypatch.setattr(
        social.storage,
        'save_image_bytes',
        lambda blob, **kwargs: f"/media/{kwargs['relative_path']}.jpg" if blob else None,
    )

    local = asyncio.run(social._persist_thumbnail('https://facebook.com/page', 'https://fbcdn.net/thumb.jpg'))
    assert local and local.startswith('/media/social/')

    assert asyncio.run(social._persist_thumbnail('https://facebook.com/page', '')) is None
    assert asyncio.run(social._persist_thumbnail('https://facebook.com/page', '/media/social/existing.jpg')) == '/media/social/existing.jpg'

    monkeypatch.setattr(social, 'fetch_social_thumbnail_url', lambda *args, **kwargs: asyncio.sleep(0, result='/media/social/new.jpg'))
    meta = {
        'instagram_pages': [{'url': 'https://instagram.com/demo', 'thumbnail_url': 'https://fbcdn.net/t.jpg'}],
        'facebook_pages': [{'url': 'https://facebook.com/demo', 'thumbnail_url': ''}],
    }
    hydrated = asyncio.run(social.hydrate_site_social_meta(meta))
    assert hydrated is not None
    assert hydrated['instagram_pages'][0]['thumbnail_url'] == '/media/social/new.jpg'
    assert hydrated['facebook_pages'][0]['thumbnail_url'] == '/media/social/new.jpg'
