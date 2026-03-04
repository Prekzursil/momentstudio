from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from app.core.config import settings
from app.services import social_thumbnails as social


class _ResponseStub:
    def __init__(self, *, url: str, html: str = '', content: bytes = b'', headers: dict[str, str] | None = None) -> None:
        self.url = url
        self._html = html
        self.content = content
        self.headers = headers or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        if self._html:
            yield self._html.encode('utf-8')


class _ClientStub:
    def __init__(self, *, stream_response: _ResponseStub | None = None, get_response: _ResponseStub | None = None) -> None:
        self._stream_response = stream_response
        self._get_response = get_response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, _method: str, _url: str):
        if self._stream_response is None:
            raise RuntimeError('missing stream response')
        return self._stream_response

    async def get(self, _url: str):
        if self._get_response is None:
            raise RuntimeError('missing get response')
        return self._get_response


def test_meta_parser_assignments_cover_twitter_and_icon() -> None:
    parser = social._MetaImageParser()
    parser.handle_starttag('meta', [('name', 'twitter:image'), ('content', 'https://cdninstagram.com/tw.jpg')])
    parser.handle_starttag('link', [('rel', 'icon shortcut'), ('href', '/favicon.ico')])
    parser.handle_starttag('div', [('class', 'ignored')])

    assert parser.twitter_image == 'https://cdninstagram.com/tw.jpg'
    assert parser.icon == '/favicon.ico'


def test_host_allowlists_cover_empty_local_and_ip_values() -> None:
    assert social._is_allowed_host('') is False
    assert social._is_allowed_host('localhost') is False
    assert social._is_allowed_host('10.0.0.1') is False
    assert social._is_allowed_host('sub.facebook.com') is True

    assert social._is_allowed_thumbnail_host('') is False
    assert social._is_allowed_thumbnail_host('::1') is False
    assert social._is_allowed_thumbnail_host('fbcdn.net') is True


def test_source_normalization_handles_non_host_inputs_and_path_root() -> None:
    assert social._normalize_source_url('relative/path') == 'relative/path'
    assert social._normalized_source_path('/') == '/'
    assert social._normalized_source_path('demo') == '/demo/'


def test_query_filtering_ignores_blank_and_tracking_keys() -> None:
    kept = social._filtered_source_query_items('=x&utm_medium=y&ok=v&FBCLID=z')
    assert kept == [('ok', 'v')]


def test_image_candidate_resolution_and_scheme_guards() -> None:
    assert social._resolve_image_url_candidate('https://fbcdn.net/a.jpg', base_url='https://facebook.com/p') == 'https://fbcdn.net/a.jpg'
    assert social._resolve_image_url_candidate('/a.jpg', base_url='https://facebook.com/page') == 'https://facebook.com/a.jpg'
    assert social._resolve_image_url_candidate('//fbcdn.net/a.jpg', base_url='https://facebook.com/page') == 'https://fbcdn.net/a.jpg'

    assert social._normalize_image_url('mailto:test@example.com', base_url='https://facebook.com') is None
    assert social._normalize_image_url('   ', base_url='https://facebook.com') is None


def test_extract_first_image_and_json_unescape_failure_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(_html: str) -> None:
        raise RuntimeError('parse failed')

    monkeypatch.setattr(social._MetaImageParser, 'feed', _boom)
    assert social._extract_first_image('<meta property="og:image" content="/a.jpg">', base_url='https://facebook.com') is None

    assert social._json_unescape('') == ''
    assert social._json_unescape('not-json-\u0026') == 'not-json-&'


def test_instagram_extract_and_local_url_checks() -> None:
    assert social._extract_instagram_profile_image('<html>none</html>', base_url='https://instagram.com/u') is None

    public_media = f"{settings.frontend_origin.rstrip('/')}/media/social/thumb.jpg"
    assert social._is_local_thumbnail_url(public_media) is True
    assert social._is_local_thumbnail_url('') is False


def test_signed_url_and_timestamp_helpers_cover_invalid_paths() -> None:
    assert social._decode_hex_timestamp(None) is None
    assert social._decode_hex_timestamp('invalid-hex') is None

    assert social._looks_signed_or_expiring('') is False
    assert social._looks_signed_or_expiring('ftp://fbcdn.net/a.jpg?oe=abcd') is False
    assert social._looks_signed_or_expiring('https://fbcdn.net/a.jpg') is False

    soon = hex(int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp()))[2:]
    assert social._looks_signed_or_expiring(f'https://fbcdn.net/a.jpg?oe={soon}') is True


def test_thumbnail_requires_local_persist_branches() -> None:
    assert social.thumbnail_requires_local_persist(None) is True
    assert social.thumbnail_requires_local_persist('/media/social/ok.jpg') is False
    assert social.thumbnail_requires_local_persist('https://fbcdn.net/a.jpg') is True


def test_fetch_page_thumbnail_candidate_instagram_profile_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    html = '<html><body>profile only</body></html>'
    stream_resp = _ResponseStub(url='https://instagram.com/demo', html=html)
    monkeypatch.setattr(social.httpx, 'AsyncClient', lambda **kwargs: _ClientStub(stream_response=stream_resp))
    monkeypatch.setattr(social, '_extract_first_image', lambda _html, base_url: None)
    monkeypatch.setattr(social, '_extract_instagram_profile_image', lambda _html, base_url: 'https://cdninstagram.com/p.jpg')

    thumb = asyncio.run(social._fetch_page_thumbnail_candidate('https://instagram.com/demo'))
    assert thumb == 'https://cdninstagram.com/p.jpg'


def test_validated_thumbnail_request_url_and_response_guards() -> None:
    with pytest.raises(ValueError, match='http'):
        social._validated_thumbnail_request_url('ftp://fbcdn.net/a.jpg')
    with pytest.raises(ValueError, match='allowed'):
        social._validated_thumbnail_request_url('https://example.com/a.jpg')

    with pytest.raises(ValueError, match='redirect host'):
        social._assert_thumbnail_response_host(SimpleNamespace(url='https://example.com/a.jpg'))


def test_validated_thumbnail_body_error_paths() -> None:
    with pytest.raises(ValueError, match='empty'):
        social._validated_thumbnail_body(SimpleNamespace(content=b'', headers={}))

    with pytest.raises(ValueError, match='too large'):
        social._validated_thumbnail_body(SimpleNamespace(content=b'x' * (5 * 1024 * 1024 + 1), headers={}))

    with pytest.raises(ValueError, match='Unsupported'):
        social._validated_thumbnail_body(SimpleNamespace(content=b'img', headers={'content-type': 'text/plain'}))


def test_persist_thumbnail_and_resolved_thumbnail_url_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert asyncio.run(social._persist_thumbnail('https://facebook.com/p', '')) is None
    assert asyncio.run(social._persist_thumbnail('https://facebook.com/p', '/media/social/existing.jpg')) == '/media/social/existing.jpg'

    monkeypatch.setattr(social, '_download_thumbnail_bytes', lambda _url: asyncio.sleep(0, result=b'img-bytes'))
    monkeypatch.setattr(social.storage, 'save_image_bytes', lambda blob, **kwargs: f"/media/{kwargs['relative_path']}.jpg" if blob else None)
    persisted = asyncio.run(social._persist_thumbnail('https://facebook.com/p', 'https://fbcdn.net/new.jpg'))
    assert persisted is not None and persisted.startswith('/media/social/')

    assert asyncio.run(
        social._resolved_thumbnail_url(
            source_url='https://facebook.com/p',
            thumbnail_url='https://fbcdn.net/new.jpg',
            persist_local=False,
            allow_remote_fallback=False,
        )
    ) == 'https://fbcdn.net/new.jpg'

    monkeypatch.setattr(social, '_persist_thumbnail', lambda _src, _thumb: asyncio.sleep(0, result=None))
    assert asyncio.run(
        social._resolved_thumbnail_url(
            source_url='https://facebook.com/p',
            thumbnail_url='https://fbcdn.net/new.jpg',
            persist_local=True,
            allow_remote_fallback=False,
        )
    ) is None


def test_fetch_social_thumbnail_url_cache_and_source_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match='Only Facebook/Instagram'):
        social._validated_social_source_url('https://example.com/page')

    source = 'https://facebook.com/demo/'
    normalized = social._validated_social_source_url(source)
    social._cache[normalized] = social._CacheEntry(
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        thumbnail_url='/media/social/cached.jpg',
    )
    assert asyncio.run(social.fetch_social_thumbnail_url(source)) == '/media/social/cached.jpg'

    social._cache[normalized] = social._CacheEntry(
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        thumbnail_url='/media/social/expired.jpg',
    )
    monkeypatch.setattr(social, '_fetch_page_thumbnail_candidate', lambda _url: asyncio.sleep(0, result='https://fbcdn.net/new.jpg'))
    monkeypatch.setattr(social, '_resolved_thumbnail_url', lambda **kwargs: asyncio.sleep(0, result='/media/social/new.jpg'))
    assert asyncio.run(social.fetch_social_thumbnail_url(source, force_refresh=True, persist_local=True)) == '/media/social/new.jpg'


def test_hydrate_meta_and_refresh_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    assert asyncio.run(social.hydrate_site_social_meta(None)) is None

    meta = {
        'instagram_pages': [{'url': 'https://instagram.com/demo', 'thumbnail_url': ''}],
        'facebook_pages': [{'url': '', 'thumbnail_url': ''}, 'bad-entry'],
    }
    monkeypatch.setattr(social, '_refreshed_social_thumbnail', lambda _url: asyncio.sleep(0, result='/media/social/new.jpg'))
    hydrated = asyncio.run(social.hydrate_site_social_meta(meta))
    assert hydrated is not None
    assert hydrated['instagram_pages'][0]['thumbnail_url'] == '/media/social/new.jpg'

    page = {'url': 'https://facebook.com/demo', 'thumbnail_url': '/media/social/ok.jpg'}
    assert social._needs_thumbnail_refresh(page) is False
    assert social._page_source_url({'url': '  https://facebook.com/demo '}) == 'https://facebook.com/demo'
    assert social._page_source_url({}) is None
    assert social._page_source_url('not-a-dict') is None


def test_refreshed_social_thumbnail_handles_httpx_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(social, 'fetch_social_thumbnail_url', lambda *args, **kwargs: asyncio.sleep(0, result='/media/social/ok.jpg'))
    assert asyncio.run(social._refreshed_social_thumbnail('https://facebook.com/p')) == '/media/social/ok.jpg'

    async def _raise_value(*_args, **_kwargs):
        raise ValueError('bad')

    async def _raise_http(*_args, **_kwargs):
        raise httpx.HTTPError('http fail')

    monkeypatch.setattr(social, 'fetch_social_thumbnail_url', _raise_value)
    assert asyncio.run(social._refreshed_social_thumbnail('https://facebook.com/p')) is None

    monkeypatch.setattr(social, 'fetch_social_thumbnail_url', _raise_http)
    assert asyncio.run(social._refreshed_social_thumbnail('https://facebook.com/p')) is None


def test_social_url_and_instagram_handle_helpers() -> None:
    assert social.looks_like_social_url('https://facebook.com/page') is True
    assert social.looks_like_social_url('http://localhost/page') is False
    assert social.looks_like_social_url('ftp://facebook.com/page') is False

    assert social._is_instagram_profile_host('instagram.com') is True
    assert social._is_instagram_profile_host('www.instagram.com') is True
    assert social._is_instagram_profile_host('api.instagram.com') is False

    assert social._first_path_segment('/demo/path') == 'demo'
    assert social._first_path_segment('////') is None

    assert social._is_reserved_instagram_segment('reel') is True
    assert social._is_reserved_instagram_segment('profile') is False

    assert social.try_extract_instagram_handle('https://instagram.com/demo_user') == 'demo_user'
    assert social.try_extract_instagram_handle('https://instagram.com/reel/demo') is None
    assert social.try_extract_instagram_handle('https://instagram.com/x') is None
    assert social.try_extract_instagram_handle('https://instagram.com/invalid*chars') is None
