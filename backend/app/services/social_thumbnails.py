from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Final
from urllib.parse import urljoin, urlparse

import httpx


ALLOWED_SOCIAL_DOMAINS: Final[tuple[str, ...]] = (
    "facebook.com",
    "instagram.com",
)

_MAX_HTML_BYTES: Final[int] = 1_000_000
_CACHE_TTL: Final[timedelta] = timedelta(hours=6)
_UA: Final[str] = "momentstudio/1.0 (+https://momentstudio.ro)"
_INSTAGRAM_UA: Final[str] = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


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

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "meta":
            data = {k.lower(): (v or "") for k, v in attrs}
            prop = (data.get("property") or data.get("name") or "").strip().lower()
            content = (data.get("content") or "").strip()
            if not content:
                return
            if prop in {"og:image", "og:image:url"} and not self.og_image:
                self.og_image = content
            if prop == "twitter:image" and not self.twitter_image:
                self.twitter_image = content
            return

        if tag == "link":
            data = {k.lower(): (v or "") for k, v in attrs}
            rel = (data.get("rel") or "").strip().lower()
            href = (data.get("href") or "").strip()
            if not href:
                return
            if "icon" in rel and not self.icon:
                self.icon = href


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


def _normalize_image_url(raw: str, *, base_url: str) -> str | None:
    candidate = (raw or "").strip().strip('"')
    if not candidate:
        return None
    if candidate.startswith("//"):
        parsed = urlparse(base_url)
        return f"{parsed.scheme}:{candidate}"
    if candidate.startswith("/"):
        return urljoin(base_url, candidate)
    return candidate


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


def _user_agent_for_host(host: str | None) -> str:
    host_clean = (host or "").strip().lower()
    if host_clean == "instagram.com" or host_clean.endswith(".instagram.com"):
        return _INSTAGRAM_UA
    return _UA


async def fetch_social_thumbnail_url(url: str) -> str | None:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must start with http:// or https://")
    if not parsed.netloc:
        raise ValueError("URL host is required")
    if not _is_allowed_host(parsed.hostname or ""):
        raise ValueError("Only Facebook/Instagram URLs are allowed")

    now = datetime.now(timezone.utc)
    cached = _cache.get(parsed.geturl())
    if cached and cached.expires_at > now:
        return cached.thumbnail_url

    headers = {"User-Agent": _user_agent_for_host(parsed.hostname), "Accept": "text/html,application/xhtml+xml"}
    timeout = httpx.Timeout(8.0, connect=5.0)

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=headers) as client:
        async with client.stream("GET", parsed.geturl()) as resp:
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

    _cache[parsed.geturl()] = _CacheEntry(expires_at=now + _CACHE_TTL, thumbnail_url=thumb)
    return thumb


def looks_like_social_url(url: str) -> bool:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        return False
    return _is_allowed_host(parsed.hostname or "")


_HANDLE_RE: Final[re.Pattern[str]] = re.compile(r"https?://(?:www\.)?instagram\.com/(?P<handle>[A-Za-z0-9._-]{2,30})/?")


def try_extract_instagram_handle(url: str) -> str | None:
    match = _HANDLE_RE.match((url or "").strip())
    if not match:
        return None
    handle = (match.group("handle") or "").strip()
    return handle or None
