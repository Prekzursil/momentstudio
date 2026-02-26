from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any, Final
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from app.core.config import settings
from app.services import storage


ALLOWED_SOCIAL_DOMAINS: Final[tuple[str, ...]] = (
    "facebook.com",
    "instagram.com",
)
ALLOWED_THUMBNAIL_DOMAINS: Final[tuple[str, ...]] = (
    "facebook.com",
    "fbcdn.net",
    "fbsbx.com",
    "instagram.com",
    "cdninstagram.com",
)
_TRACKING_QUERY_KEYS: Final[set[str]] = {"igsh", "fbclid", "gclid", "mc_cid", "mc_eid"}
_TRACKING_QUERY_PREFIXES: Final[tuple[str, ...]] = ("utm_",)

_MAX_HTML_BYTES: Final[int] = 1_000_000
_MAX_IMAGE_BYTES: Final[int] = 5 * 1024 * 1024
_CACHE_TTL: Final[timedelta] = timedelta(hours=6)
_UA: Final[str] = "momentstudio/1.0 (+https://momentstudio.ro)"
_INSTAGRAM_UA: Final[str] = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
_PERSISTABLE_IMAGE_MIMES: Final[tuple[str, ...]] = ("image/jpeg", "image/png", "image/webp", "image/gif")
_INSTAGRAM_PROFILE_IMAGE_RE: Final[re.Pattern[str]] = re.compile(
    r'"profile_pic_url_hd"\s*:\s*"([^"]+)"|"profile_pic_url"\s*:\s*"([^"]+)"'
)
_SOCIAL_MEDIA_PREFIX: Final[str] = "/media/"


@dataclass(frozen=True)
class _CacheEntry:
    expires_at: datetime
    thumbnail_url: str | None


_cache: dict[str, _CacheEntry] = {}


class _MetaImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.og_image: str | None = None
        self.twitter_image: str | None = None
        self.icon: str | None = None

    def _handle_meta_tag(self, attrs: list[tuple[str, str | None]]) -> None:
        data = {k.lower(): (v or "") for k, v in attrs}
        prop = (data.get("property") or data.get("name") or "").strip().lower()
        content = (data.get("content") or "").strip()
        if not content:
            return
        self._assign_og_image(prop, content)
        self._assign_twitter_image(prop, content)

    def _assign_og_image(self, prop: str, content: str) -> None:
        if prop in {"og:image", "og:image:url"} and not self.og_image:
            self.og_image = content

    def _assign_twitter_image(self, prop: str, content: str) -> None:
        if prop == "twitter:image" and not self.twitter_image:
            self.twitter_image = content

    def _handle_link_tag(self, attrs: list[tuple[str, str | None]]) -> None:
        data = {k.lower(): (v or "") for k, v in attrs}
        rel = (data.get("rel") or "").strip().lower()
        href = (data.get("href") or "").strip()
        if href and "icon" in rel and not self.icon:
            self.icon = href

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "meta":
            self._handle_meta_tag(attrs)
            return
        if tag == "link":
            self._handle_link_tag(attrs)


def _is_allowed_host(host: str) -> bool:
    host = (host or "").strip().lower()
    if not host:
        return False

    # Block obvious SSRF targets.
    if host in {"localhost", "127.0.0.1", "::1"}:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass

    for base in ALLOWED_SOCIAL_DOMAINS:
        if host == base or host.endswith(f".{base}"):
            return True
    return False


def _is_allowed_thumbnail_host(host: str) -> bool:
    host = (host or "").strip().lower()
    if not host:
        return False

    if host in {"localhost", "127.0.0.1", "::1"}:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass

    for base in ALLOWED_THUMBNAIL_DOMAINS:
        if host == base or host.endswith(f".{base}"):
            return True
    return False


def _normalize_source_url(raw_url: str) -> str:
    parsed = urlparse((raw_url or "").strip())
    scheme = parsed.scheme.lower() if parsed.scheme else "https"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return parsed.geturl()

    normalized_path = _normalized_source_path(parsed.path)
    normalized_query = urlencode(_filtered_source_query_items(parsed.query), doseq=True)
    netloc = _normalized_netloc(host=host, scheme=scheme, port=parsed.port)

    return urlunparse((scheme, netloc, normalized_path, "", normalized_query, ""))


def _normalized_source_path(path: str) -> str:
    normalized_path = re.sub(r"/{2,}", "/", path or "/")
    if not normalized_path.startswith("/"):
        normalized_path = f"/{normalized_path}"
    if normalized_path != "/":
        return normalized_path.rstrip("/") + "/"
    return normalized_path


def _filtered_source_query_items(query: str) -> list[tuple[str, str]]:
    kept_query: list[tuple[str, str]] = []
    for key, value in parse_qsl(query, keep_blank_values=True):
        normalized_key = (key or "").strip()
        if not normalized_key:
            continue
        lowered = normalized_key.lower()
        if lowered in _TRACKING_QUERY_KEYS:
            continue
        if any(lowered.startswith(prefix) for prefix in _TRACKING_QUERY_PREFIXES):
            continue
        kept_query.append((normalized_key, value))
    return kept_query


def _normalized_netloc(*, host: str, scheme: str, port: int | None) -> str:
    if port and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        return f"{host}:{port}"
    return host


def _uses_supported_http_scheme(url: str) -> bool:
    return urlparse(url).scheme in {"http", "https"}


def _is_rejected_image_url_candidate(candidate: str) -> bool:
    lowered = candidate.lower()
    return lowered.startswith("data:") or lowered.startswith("javascript:")


def _resolve_image_url_candidate(candidate: str, *, base_url: str) -> str:
    if candidate.startswith("//"):
        parsed = urlparse(base_url)
        return f"{parsed.scheme}:{candidate}"
    if candidate.startswith("/"):
        return urljoin(base_url, candidate)
    return candidate


def _normalize_image_url(raw: str, *, base_url: str) -> str | None:
    candidate = (raw or "").strip().strip('"')
    if not candidate:
        return None
    if _is_rejected_image_url_candidate(candidate):
        return None
    normalized = _resolve_image_url_candidate(candidate, base_url=base_url)
    if not _uses_supported_http_scheme(normalized):
        return None
    return normalized


def _extract_first_image(html: str, *, base_url: str) -> str | None:
    parser = _MetaImageParser()
    try:
        parser.feed(html)
    except Exception:
        return None
    for raw in (parser.og_image, parser.twitter_image, parser.icon):
        normalized = _normalize_image_url(raw or "", base_url=base_url)
        if normalized:
            return normalized
    return None


def _json_unescape(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        return json.loads(f'"{raw}"')
    except Exception:
        return raw.replace("\\/", "/").replace("\\u0026", "&")


def _extract_instagram_profile_image(html: str, *, base_url: str) -> str | None:
    for match in _INSTAGRAM_PROFILE_IMAGE_RE.finditer(html):
        candidate = _json_unescape((match.group(1) or match.group(2) or "").strip())
        normalized = _normalize_image_url(candidate, base_url=base_url)
        if normalized:
            return normalized
    return None


def _user_agent_for_host(host: str | None) -> str:
    host_clean = (host or "").strip().lower()
    if host_clean == "instagram.com" or host_clean.endswith(".instagram.com"):
        return _INSTAGRAM_UA
    return _UA


def _is_local_thumbnail_url(url: str | None) -> bool:
    value = (url or "").strip()
    if not value:
        return False
    if value.startswith(_SOCIAL_MEDIA_PREFIX):
        return True
    public_media_prefix = f"{settings.frontend_origin.rstrip('/')}{_SOCIAL_MEDIA_PREFIX}"
    return value.startswith(public_media_prefix)


def _decode_hex_timestamp(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromtimestamp(int(raw, 16), tz=timezone.utc)
    except Exception:
        return None


def _looks_signed_or_expiring(url: str | None) -> bool:
    raw = (url or "").strip()
    if not raw:
        return False
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        return False
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    expires_at = _decode_hex_timestamp(query.get("oe"))
    if expires_at is None:
        return False
    return expires_at <= (datetime.now(timezone.utc) + timedelta(days=7))


def thumbnail_requires_local_persist(url: str | None) -> bool:
    value = (url or "").strip()
    if not value:
        return True
    if _is_local_thumbnail_url(value):
        return False
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"}:
        return True
    return _looks_signed_or_expiring(value)


async def _fetch_page_thumbnail_candidate(source_url: str) -> str | None:
    parsed = urlparse(source_url)
    headers = {"User-Agent": _user_agent_for_host(parsed.hostname), "Accept": "text/html,application/xhtml+xml"}
    timeout = httpx.Timeout(8.0, connect=5.0)

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=headers) as client:
        async with client.stream("GET", source_url) as resp:
            resp.raise_for_status()
            chunks: list[bytes] = []
            total = 0
            async for part in resp.aiter_bytes():
                chunks.append(part)
                total += len(part)
                if total >= _MAX_HTML_BYTES:
                    break
            html = b"".join(chunks).decode("utf-8", errors="ignore")
            base_url = str(resp.url)

    thumb = _extract_first_image(html, base_url=base_url)
    if thumb:
        return thumb
    if parsed.hostname and (parsed.hostname == "instagram.com" or parsed.hostname.endswith(".instagram.com")):
        return _extract_instagram_profile_image(html, base_url=base_url)
    return None


async def _download_thumbnail_bytes(url: str) -> bytes:
    parsed = _validated_thumbnail_request_url(url)

    timeout = httpx.Timeout(8.0, connect=5.0)
    headers = {"User-Agent": _UA, "Accept": "image/*"}
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=headers) as client:
        resp = await client.get(parsed.geturl())
        resp.raise_for_status()
    _assert_thumbnail_response_host(resp)
    return _validated_thumbnail_body(resp)


def _validated_thumbnail_request_url(url: str) -> Any:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Thumbnail URL must use http(s)")
    if not _is_allowed_thumbnail_host(parsed.hostname or ""):
        raise ValueError("Thumbnail host is not allowed")
    return parsed


def _assert_thumbnail_response_host(response: httpx.Response) -> None:
    final = urlparse(str(response.url))
    if not _is_allowed_thumbnail_host(final.hostname or ""):
        raise ValueError("Thumbnail redirect host is not allowed")


def _validated_thumbnail_body(response: httpx.Response) -> bytes:
    body = bytes(response.content or b"")
    if not body:
        raise ValueError("Thumbnail image is empty")
    if len(body) > _MAX_IMAGE_BYTES:
        raise ValueError("Thumbnail image too large")

    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in _PERSISTABLE_IMAGE_MIMES:
        raise ValueError("Unsupported thumbnail content type")
    return body


async def _persist_thumbnail(source_url: str, thumbnail_url: str) -> str | None:
    candidate = (thumbnail_url or "").strip()
    if not candidate:
        return None
    if _is_local_thumbnail_url(candidate):
        return candidate

    image_bytes = await _download_thumbnail_bytes(candidate)
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()
    relative = f"social/{digest}"
    return storage.save_image_bytes(
        image_bytes,
        relative_path=relative,
        max_bytes=_MAX_IMAGE_BYTES,
        allowed_content_types=_PERSISTABLE_IMAGE_MIMES,
    )


async def fetch_social_thumbnail_url(
    url: str,
    *,
    persist_local: bool = False,
    force_refresh: bool = False,
    allow_remote_fallback: bool = True,
) -> str | None:
    normalized_source_url = _validated_social_source_url(url)
    cached = _cached_thumbnail_if_fresh(normalized_source_url, force_refresh=force_refresh)
    if cached is not None:
        return cached

    thumb = await _fetch_page_thumbnail_candidate(normalized_source_url)
    resolved = await _resolved_thumbnail_url(
        source_url=normalized_source_url,
        thumbnail_url=thumb,
        persist_local=persist_local,
        allow_remote_fallback=allow_remote_fallback,
    )
    _cache[normalized_source_url] = _CacheEntry(
        expires_at=datetime.now(timezone.utc) + _CACHE_TTL,
        thumbnail_url=resolved,
    )
    return resolved


def _validated_social_source_url(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must start with http:// or https://")
    if not parsed.netloc:
        raise ValueError("URL host is required")
    if not _is_allowed_host(parsed.hostname or ""):
        raise ValueError("Only Facebook/Instagram URLs are allowed")
    return _normalize_source_url(parsed.geturl())


def _cached_thumbnail_if_fresh(source_url: str, *, force_refresh: bool) -> str | None:
    if force_refresh:
        return None
    now = datetime.now(timezone.utc)
    cached = _cache.get(source_url)
    if not cached or cached.expires_at <= now:
        return None
    return cached.thumbnail_url


async def _resolved_thumbnail_url(
    *,
    source_url: str,
    thumbnail_url: str | None,
    persist_local: bool,
    allow_remote_fallback: bool,
) -> str | None:
    if not persist_local:
        return thumbnail_url
    local = await _persist_thumbnail(source_url, thumbnail_url or "") if thumbnail_url else None
    if local:
        return local
    if allow_remote_fallback:
        return thumbnail_url
    return None


async def hydrate_site_social_meta(meta: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(meta, dict):
        return meta

    hydrated = deepcopy(meta)
    for list_key in ("instagram_pages", "facebook_pages"):
        pages = hydrated.get(list_key)
        if not isinstance(pages, list):
            continue
        await _hydrate_social_pages(pages)
    return hydrated


async def _hydrate_social_pages(pages: list[Any]) -> None:
    for page in pages:
        source_url = _page_source_url(page)
        if source_url is None:
            continue
        if not _needs_thumbnail_refresh(page):
            continue
        refreshed = await _refreshed_social_thumbnail(source_url)
        if refreshed:
            page["thumbnail_url"] = refreshed


def _page_source_url(page: Any) -> str | None:
    if not isinstance(page, dict):
        return None
    source_url = str(page.get("url") or "").strip()
    if not source_url:
        return None
    return source_url


def _needs_thumbnail_refresh(page: Any) -> bool:
    current_thumb = str(page.get("thumbnail_url") or "").strip() or None
    return thumbnail_requires_local_persist(current_thumb)


async def _refreshed_social_thumbnail(source_url: str) -> str | None:
    try:
        return await fetch_social_thumbnail_url(
            source_url,
            persist_local=True,
            force_refresh=False,
            allow_remote_fallback=False,
        )
    except (ValueError, httpx.HTTPError):
        return None


def looks_like_social_url(url: str) -> bool:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        return False
    return _is_allowed_host(parsed.hostname or "")


def _is_instagram_profile_host(host: str | None) -> bool:
    normalized = (host or "").strip().lower()
    return normalized in {"instagram.com", "www.instagram.com"}


def _first_path_segment(path: str) -> str | None:
    for segment in path.split("/"):
        if segment:
            return segment.strip()
    return None


def _is_reserved_instagram_segment(segment: str) -> bool:
    return segment.lower() in {"p", "reel", "stories", "explore", "accounts", "direct"}


def try_extract_instagram_handle(url: str) -> str | None:
    parsed = urlparse((url or "").strip())
    if not _is_instagram_profile_host(parsed.hostname):
        return None
    head = _first_path_segment(parsed.path)
    if not head:
        return None
    if _is_reserved_instagram_segment(head):
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]{2,30}", head):
        return None
    return head
