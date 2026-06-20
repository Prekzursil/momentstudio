"""Lean-gate unit coverage for ``app.services.social_thumbnails``.

Covers the pure helpers (host allow-lists incl. SSRF guards, URL/image
normalization, meta/Instagram image extraction, JSON unescape, hex-timestamp /
signed-URL detection, local-persist decision, social-URL/handle parsing) and
the async fetch/download/persist/hydrate flow with a stubbed ``httpx`` client
and a temp media root, plus the in-process cache and error fallbacks.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.services import social_thumbnails as st


@pytest.fixture(autouse=True)
def _reset_cache_and_media(monkeypatch, tmp_path):
    st._cache.clear()
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    monkeypatch.setattr(
        settings, "frontend_origin", "https://shop.example.com", raising=False
    )
    monkeypatch.setattr(settings, "upload_image_max_width", 4000, raising=False)
    monkeypatch.setattr(settings, "upload_image_max_height", 4000, raising=False)
    monkeypatch.setattr(settings, "upload_image_max_pixels", 16_000_000, raising=False)
    yield
    st._cache.clear()


# --------------------------------------------------------------------------- #
# host allow-lists                                                             #
# --------------------------------------------------------------------------- #
def test_allowed_hosts() -> None:
    assert st._is_allowed_host("facebook.com") is True
    assert st._is_allowed_host("www.instagram.com") is True
    assert st._is_allowed_host("") is False
    assert st._is_allowed_host("localhost") is False
    assert st._is_allowed_host("127.0.0.1") is False
    assert st._is_allowed_host("8.8.8.8") is False  # valid public IP -> rejected
    assert st._is_allowed_host("evil.com") is False

    assert st._is_allowed_thumbnail_host("scontent.cdninstagram.com") is True
    assert st._is_allowed_thumbnail_host("") is False
    assert st._is_allowed_thumbnail_host("::1") is False
    assert st._is_allowed_thumbnail_host("10.0.0.1") is False
    assert st._is_allowed_thumbnail_host("8.8.8.8") is False
    assert st._is_allowed_thumbnail_host("evil.com") is False


def test_normalize_source_url() -> None:
    out = st._normalize_source_url(
        "https://instagram.com//user//?igsh=x&utm_source=y&keep=1"
    )
    assert "igsh" not in out and "utm_source" not in out and "keep=1" in out
    # No host -> returned as-is (geturl of the unparsed input).
    assert st._normalize_source_url("not a url") == "not a url"
    # Non-default port preserved.
    ported = st._normalize_source_url("https://facebook.com:8443/page")
    assert ":8443" in ported
    # Root path stays "/".
    root = st._normalize_source_url("https://facebook.com")
    assert root.endswith("/")
    # A blank query key is dropped (the empty-key continue branch).
    blanked = st._normalize_source_url("https://facebook.com/page?=v&keep=1")
    assert "keep=1" in blanked


def test_normalize_image_url_variants() -> None:
    base = "https://instagram.com/page/"
    assert st._normalize_image_url("", base_url=base) is None
    assert st._normalize_image_url("data:image/png;base64,x", base_url=base) is None
    assert st._normalize_image_url("javascript:alert(1)", base_url=base) is None
    assert (
        st._normalize_image_url("//cdninstagram.com/a.jpg", base_url=base)
        == "https://cdninstagram.com/a.jpg"
    )
    assert st._normalize_image_url("/rel/a.jpg", base_url=base) == (
        "https://instagram.com/rel/a.jpg"
    )
    assert (
        st._normalize_image_url("https://cdn.example.com/a.jpg", base_url=base)
        == "https://cdn.example.com/a.jpg"
    )
    # A bare relative string with no scheme -> rejected.
    assert st._normalize_image_url("plainstring", base_url=base) is None


def test_meta_image_parser_branches() -> None:
    parser = st._MetaImageParser()
    parser.feed(
        '<meta property="og:image" content="">'  # empty content -> early return
        '<meta name="twitter:image" content="https://cdninstagram.com/tw.jpg">'
        '<link rel="icon" href="https://cdninstagram.com/icon.png">'
    )
    assert parser.og_image is None
    assert parser.twitter_image == "https://cdninstagram.com/tw.jpg"
    assert parser.icon == "https://cdninstagram.com/icon.png"

    # A link with no href is ignored.
    p2 = st._MetaImageParser()
    p2.feed('<link rel="icon">')
    assert p2.icon is None

    # A second icon link does not overwrite the first (already-set branch).
    p3 = st._MetaImageParser()
    p3.feed(
        '<link rel="icon" href="https://cdninstagram.com/one.png">'
        '<link rel="icon" href="https://cdninstagram.com/two.png">'
    )
    assert p3.icon == "https://cdninstagram.com/one.png"


def test_extract_first_image_and_instagram() -> None:
    html = (
        "<html><head>"
        '<meta property="og:image" content="https://cdninstagram.com/og.jpg">'
        "</head></html>"
    )
    assert st._extract_first_image(html, base_url="https://instagram.com/") == (
        "https://cdninstagram.com/og.jpg"
    )
    # No meta -> None.
    assert st._extract_first_image("<html></html>", base_url="https://x/") is None

    # twitter:image used when og:image absent.
    tw_html = '<meta name="twitter:image" content="https://cdninstagram.com/tw.jpg">'
    assert st._extract_first_image(tw_html, base_url="https://instagram.com/") == (
        "https://cdninstagram.com/tw.jpg"
    )

    ig_html = '"profile_pic_url_hd":"https:\\/\\/cdninstagram.com\\/p.jpg"'
    assert (
        st._extract_instagram_profile_image(ig_html, base_url="https://instagram.com/")
        == "https://cdninstagram.com/p.jpg"
    )
    assert (
        st._extract_instagram_profile_image("no match here", base_url="https://x/")
        is None
    )

    # First match normalizes to None (data: URL) -> loop continues to the next.
    ig_mixed = (
        '"profile_pic_url":"data:image/png;base64,zzz"'
        '"profile_pic_url_hd":"https:\\/\\/cdninstagram.com\\/good.jpg"'
    )
    assert (
        st._extract_instagram_profile_image(ig_mixed, base_url="https://instagram.com/")
        == "https://cdninstagram.com/good.jpg"
    )


def test_json_unescape() -> None:
    assert st._json_unescape("a\\/b") == "a/b"
    assert st._json_unescape("") == ""
    # An invalid json escape makes json.loads raise -> manual fallback path.
    assert st._json_unescape("x\\u0026y\\x") == "x&y\\x"


def test_extract_first_image_feed_exception(monkeypatch) -> None:
    class _BoomParser(st._MetaImageParser):
        def feed(self, data):  # type: ignore[override]
            raise RuntimeError("boom")

    monkeypatch.setattr(st, "_MetaImageParser", _BoomParser)
    assert st._extract_first_image("<html>", base_url="https://x/") is None


def test_user_agent_and_local_url() -> None:
    assert st._user_agent_for_host("instagram.com") == st._INSTAGRAM_UA
    assert st._user_agent_for_host("scontent.instagram.com") == st._INSTAGRAM_UA
    assert st._user_agent_for_host("facebook.com") == st._UA
    assert st._user_agent_for_host(None) == st._UA

    assert st._is_local_thumbnail_url("/media/social/x.jpg") is True
    assert (
        st._is_local_thumbnail_url("https://shop.example.com/media/social/x.jpg")
        is True
    )
    assert st._is_local_thumbnail_url("") is False
    assert st._is_local_thumbnail_url("https://cdn/x.jpg") is False


def test_hex_timestamp_and_signed_url() -> None:
    assert st._decode_hex_timestamp(None) is None
    assert st._decode_hex_timestamp("") is None
    assert st._decode_hex_timestamp("zzz") is None
    ts = st._decode_hex_timestamp("60000000")
    assert isinstance(ts, datetime)

    # A url with a near-future "oe" expiry looks signed/expiring.
    soon = format(
        int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp()), "x"
    )
    assert st._looks_signed_or_expiring(f"https://cdn/a.jpg?oe={soon}") is True
    # No expiry param.
    assert st._looks_signed_or_expiring("https://cdn/a.jpg") is False
    # Non-http scheme.
    assert st._looks_signed_or_expiring("ftp://x/a") is False
    assert st._looks_signed_or_expiring("") is False
    # Far-future expiry -> not "expiring".
    far = format(
        int((datetime.now(timezone.utc) + timedelta(days=400)).timestamp()), "x"
    )
    assert st._looks_signed_or_expiring(f"https://cdn/a.jpg?oe={far}") is False


def test_thumbnail_requires_local_persist() -> None:
    assert st.thumbnail_requires_local_persist("") is True
    assert st.thumbnail_requires_local_persist("/media/social/x.jpg") is False
    assert st.thumbnail_requires_local_persist("https://cdn/a.jpg") is True
    # Non-http, non-local, not expiring -> False.
    assert st.thumbnail_requires_local_persist("ftp://x/a") is False


def test_looks_like_social_and_handle() -> None:
    assert st.looks_like_social_url("https://instagram.com/user") is True
    assert st.looks_like_social_url("ftp://x") is False
    assert st.looks_like_social_url("https://evil.com/x") is False

    assert st.try_extract_instagram_handle("https://instagram.com/myhandle") == (
        "myhandle"
    )
    assert st.try_extract_instagram_handle("https://facebook.com/x") is None
    assert st.try_extract_instagram_handle("https://instagram.com/") is None
    assert st.try_extract_instagram_handle("https://instagram.com/p/abc") is None
    assert st.try_extract_instagram_handle("https://instagram.com/!!bad!!") is None


# --------------------------------------------------------------------------- #
# httpx-backed async flow                                                      #
# --------------------------------------------------------------------------- #
class _FakeStreamResp:
    def __init__(self, html: bytes, url: str) -> None:
        self._html = html
        self.url = url

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        yield self._html

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _FakeGetResp:
    def __init__(self, content: bytes, url: str, content_type: str) -> None:
        self.content = content
        self.url = url
        self.headers = {"content-type": content_type}

    def raise_for_status(self) -> None:
        return None


class _FakeClient:
    def __init__(self, *, stream_resp=None, get_resp=None) -> None:
        self._stream_resp = stream_resp
        self._get_resp = get_resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def stream(self, method, url):
        return self._stream_resp

    async def get(self, url):
        return self._get_resp


def _png_bytes() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_fetch_page_thumbnail_candidate(monkeypatch) -> None:
    html = b'<meta property="og:image" content="https://cdninstagram.com/og.jpg">'
    resp = _FakeStreamResp(html, "https://instagram.com/page/")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(stream_resp=resp)
    )
    out = asyncio.run(st._fetch_page_thumbnail_candidate("https://instagram.com/page/"))
    assert out == "https://cdninstagram.com/og.jpg"


def test_fetch_page_thumbnail_instagram_profile_fallback(monkeypatch) -> None:
    html = b'"profile_pic_url":"https:\\/\\/cdninstagram.com\\/p.jpg"'
    resp = _FakeStreamResp(html, "https://instagram.com/user/")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(stream_resp=resp)
    )
    out = asyncio.run(st._fetch_page_thumbnail_candidate("https://instagram.com/user/"))
    assert out == "https://cdninstagram.com/p.jpg"


def test_fetch_page_thumbnail_truncates_large_html(monkeypatch) -> None:
    # A body exceeding the max HTML size triggers the read-loop break.
    class _BigStream(_FakeStreamResp):
        async def aiter_bytes(self):
            yield b'<meta property="og:image" content="https://cdninstagram.com/og.jpg">'
            yield b"x" * (st._MAX_HTML_BYTES + 10)
            yield b"trailing-never-read"

    resp = _BigStream(b"", "https://facebook.com/page/")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(stream_resp=resp)
    )
    out = asyncio.run(st._fetch_page_thumbnail_candidate("https://facebook.com/page/"))
    assert out == "https://cdninstagram.com/og.jpg"


def test_fetch_page_thumbnail_none(monkeypatch) -> None:
    resp = _FakeStreamResp(b"<html></html>", "https://facebook.com/page/")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(stream_resp=resp)
    )
    out = asyncio.run(st._fetch_page_thumbnail_candidate("https://facebook.com/page/"))
    assert out is None


def test_download_thumbnail_bytes(monkeypatch) -> None:
    png = _png_bytes()
    resp = _FakeGetResp(png, "https://cdninstagram.com/a.jpg", "image/png")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(get_resp=resp)
    )
    out = asyncio.run(st._download_thumbnail_bytes("https://cdninstagram.com/a.jpg"))
    assert out == png


def test_download_thumbnail_bytes_guards(monkeypatch) -> None:
    # Bad scheme.
    with pytest.raises(ValueError):
        asyncio.run(st._download_thumbnail_bytes("ftp://x/a.jpg"))
    # Disallowed host.
    with pytest.raises(ValueError):
        asyncio.run(st._download_thumbnail_bytes("https://evil.com/a.jpg"))

    # Redirect to a disallowed host.
    resp = _FakeGetResp(b"x", "https://evil.com/a.jpg", "image/png")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(get_resp=resp)
    )
    with pytest.raises(ValueError):
        asyncio.run(st._download_thumbnail_bytes("https://cdninstagram.com/a.jpg"))

    # Empty body.
    resp = _FakeGetResp(b"", "https://cdninstagram.com/a.jpg", "image/png")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(get_resp=resp)
    )
    with pytest.raises(ValueError):
        asyncio.run(st._download_thumbnail_bytes("https://cdninstagram.com/a.jpg"))

    # Too large.
    big = b"x" * (st._MAX_IMAGE_BYTES + 1)
    resp = _FakeGetResp(big, "https://cdninstagram.com/a.jpg", "image/png")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(get_resp=resp)
    )
    with pytest.raises(ValueError):
        asyncio.run(st._download_thumbnail_bytes("https://cdninstagram.com/a.jpg"))

    # Unsupported content type.
    resp = _FakeGetResp(b"abc", "https://cdninstagram.com/a.jpg", "text/html")
    monkeypatch.setattr(
        st.httpx, "AsyncClient", lambda **kw: _FakeClient(get_resp=resp)
    )
    with pytest.raises(ValueError):
        asyncio.run(st._download_thumbnail_bytes("https://cdninstagram.com/a.jpg"))


def test_persist_thumbnail(monkeypatch) -> None:
    # Already-local thumbnail is returned unchanged.
    assert (
        asyncio.run(st._persist_thumbnail("src", "/media/social/x.jpg"))
        == "/media/social/x.jpg"
    )
    # Empty candidate -> None.
    assert asyncio.run(st._persist_thumbnail("src", "")) is None

    png = _png_bytes()

    async def _fake_download(url):
        return png

    monkeypatch.setattr(st, "_download_thumbnail_bytes", _fake_download)
    out = asyncio.run(
        st._persist_thumbnail(
            "https://instagram.com/user/", "https://cdninstagram.com/a.jpg"
        )
    )
    assert out and out.startswith("/media/social/")


def test_fetch_social_thumbnail_url_full(monkeypatch) -> None:
    # Scheme / host guards.
    with pytest.raises(ValueError):
        asyncio.run(st.fetch_social_thumbnail_url("ftp://x"))
    with pytest.raises(ValueError):
        asyncio.run(st.fetch_social_thumbnail_url("https://"))
    with pytest.raises(ValueError):
        asyncio.run(st.fetch_social_thumbnail_url("https://evil.com/x"))

    async def _fake_candidate(src):
        return "https://cdninstagram.com/a.jpg"

    monkeypatch.setattr(st, "_fetch_page_thumbnail_candidate", _fake_candidate)

    # Remote (no persist) -> returns the remote candidate, then cache hit.
    out = asyncio.run(st.fetch_social_thumbnail_url("https://instagram.com/user/"))
    assert out == "https://cdninstagram.com/a.jpg"
    cached = asyncio.run(st.fetch_social_thumbnail_url("https://instagram.com/user/"))
    assert cached == "https://cdninstagram.com/a.jpg"

    # persist_local with a working persist -> local url.
    async def _fake_persist(src, thumb):
        return "/media/social/abc.jpg"

    monkeypatch.setattr(st, "_persist_thumbnail", _fake_persist)
    out = asyncio.run(
        st.fetch_social_thumbnail_url(
            "https://instagram.com/user2/", persist_local=True, force_refresh=True
        )
    )
    assert out == "/media/social/abc.jpg"

    # persist fails + no remote fallback -> None.
    async def _fail_persist(src, thumb):
        return None

    monkeypatch.setattr(st, "_persist_thumbnail", _fail_persist)
    out = asyncio.run(
        st.fetch_social_thumbnail_url(
            "https://instagram.com/user3/",
            persist_local=True,
            force_refresh=True,
            allow_remote_fallback=False,
        )
    )
    assert out is None


def test_fetch_social_thumbnail_no_candidate_persist(monkeypatch) -> None:
    async def _no_candidate(src):
        return None

    monkeypatch.setattr(st, "_fetch_page_thumbnail_candidate", _no_candidate)
    out = asyncio.run(
        st.fetch_social_thumbnail_url(
            "https://instagram.com/none/", persist_local=True, force_refresh=True
        )
    )
    assert out is None


def test_hydrate_site_social_meta(monkeypatch) -> None:
    # Non-dict -> returned unchanged.
    assert asyncio.run(st.hydrate_site_social_meta(None)) is None

    async def _fake_fetch(source_url, **kwargs):
        if "boom" in source_url:
            raise ValueError("bad")
        return "/media/social/new.jpg"

    monkeypatch.setattr(st, "fetch_social_thumbnail_url", _fake_fetch)

    meta = {
        "instagram_pages": [
            {"url": "https://instagram.com/a", "thumbnail_url": "https://cdn/old.jpg"},
            {"url": "https://instagram.com/boom", "thumbnail_url": "https://cdn/x.jpg"},
            {"url": "", "thumbnail_url": ""},  # skipped (no url)
            {
                "url": "https://instagram.com/local",
                "thumbnail_url": "/media/social/k.jpg",
            },  # no persist needed
            "not-a-dict",
        ],
        "facebook_pages": "not-a-list",
    }
    out = asyncio.run(st.hydrate_site_social_meta(meta))
    assert out["instagram_pages"][0]["thumbnail_url"] == "/media/social/new.jpg"
    # The 'boom' page kept its original thumbnail (fetch raised).
    assert out["instagram_pages"][1]["thumbnail_url"] == "https://cdn/x.jpg"
