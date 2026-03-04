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
        return '/media/social/local.jpg'

    async def _persist_none(_source: str, _thumb: str) -> None:
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
    assert sameday._to_float('12,5') == 12.5
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
        return [{'lockerId': 'A', 'lat': 44.0, 'lng': 26.0}]

    monkeypatch.setattr(sameday, '_fetch_json_url', _ok)
    rows = asyncio.run(sameday._fetch_template_rows(SimpleNamespace(), 'https://sameday.ro/api?q={q}'))
    assert rows

    async def _fail(_client, _url: str):
        raise RuntimeError('fail')

    monkeypatch.setattr(sameday, '_fetch_json_url', _fail)
    rows_fail = asyncio.run(sameday._fetch_template_rows(SimpleNamespace(), 'https://sameday.ro/api?q={q}'))
    assert rows_fail == []