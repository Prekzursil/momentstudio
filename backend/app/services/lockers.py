from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Final

import httpx

from app.schemas.shipping import LockerProvider, LockerRead


_OVERPASS_URL: Final[str] = "https://overpass-api.de/api/interpreter"
_CACHE_TTL: Final[timedelta] = timedelta(hours=6)
_UA: Final[str] = "momentstudio/1.0 (+https://momentstudio.ro)"


@dataclass(frozen=True)
class _CacheEntry:
    expires_at: datetime
    items: list[LockerRead]


_cache: dict[str, _CacheEntry] = {}


def _round_coord(value: float) -> float:
    # Cache by ~1km granularity to keep memory bounded.
    return round(float(value), 2)


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Great-circle distance (km).
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return float(2 * r * asin(sqrt(a)))


def _build_query(provider: LockerProvider, *, lat: float, lng: float, radius_m: int) -> str:
    common = f'(around:{radius_m},{lat},{lng})["amenity"="parcel_locker"]'
    if provider == LockerProvider.sameday:
        tag_filters = (
            '["brand"~"easybox",i]',
            '["operator"~"sameday",i]',
        )
    else:
        tag_filters = (
            '["brand"~"fanbox|fan box",i]',
            '["operator"~"fan courier",i]',
        )

    parts: list[str] = []
    for tag in tag_filters:
        parts.extend(
            [
                f"node{common}{tag};",
                f"way{common}{tag};",
                f"relation{common}{tag};",
            ]
        )
    return "[out:json][timeout:25];(" + "".join(parts) + ");out center tags;"


def _format_address(tags: dict[str, str]) -> str | None:
    line = " ".join(
        [
            (tags.get("addr:street") or "").strip(),
            (tags.get("addr:housenumber") or "").strip(),
        ]
    ).strip()
    city = (tags.get("addr:city") or "").strip()
    postcode = (tags.get("addr:postcode") or "").strip()
    parts = [p for p in [line, city, postcode] if p]
    if parts:
        return ", ".join(parts)[:255]
    for key in ("address", "location", "description"):
        value = (tags.get(key) or "").strip()
        if value:
            return value[:255]
    return None


def _format_name(tags: dict[str, str], provider: LockerProvider) -> str:
    for key in ("name", "ref", "official_name"):
        value = (tags.get(key) or "").strip()
        if value:
            return value[:255]
    brand = (tags.get("brand") or "").strip()
    if brand:
        return brand[:255]
    return "Easybox" if provider == LockerProvider.sameday else "FANbox"


def _parse_overpass_json(data: dict, *, provider: LockerProvider, lat: float, lng: float) -> list[LockerRead]:
    items: list[LockerRead] = []
    for el in (data.get("elements") or []):
        el_type = (el.get("type") or "").strip()
        el_id = el.get("id")
        if el_type not in {"node", "way", "relation"} or el_id is None:
            continue
        tags = {str(k): str(v) for k, v in (el.get("tags") or {}).items()}

        lat_val = el.get("lat")
        lng_val = el.get("lon")
        if lat_val is None or lng_val is None:
            center = el.get("center") or {}
            lat_val = center.get("lat")
            lng_val = center.get("lon")
        if lat_val is None or lng_val is None:
            continue

        lat_val_f = float(lat_val)
        lng_val_f = float(lng_val)
        dist = _haversine_km(lat, lng, lat_val_f, lng_val_f)
        items.append(
            LockerRead(
                id=f"osm:{el_type}:{el_id}",
                provider=provider,
                name=_format_name(tags, provider),
                address=_format_address(tags),
                lat=lat_val_f,
                lng=lng_val_f,
                distance_km=dist,
            )
        )

    items.sort(key=lambda x: (x.distance_km or 0.0, x.name))
    return items


async def list_lockers(
    *,
    provider: LockerProvider,
    lat: float,
    lng: float,
    radius_km: float = 10.0,
    limit: int = 60,
    force_refresh: bool = False,
) -> list[LockerRead]:
    now = datetime.now(timezone.utc)
    key = f"{provider}:{_round_coord(lat)}:{_round_coord(lng)}:{int(radius_km)}:{int(limit)}"
    cached = _cache.get(key)
    if not force_refresh and cached and cached.expires_at > now:
        return cached.items

    radius_m = max(1000, min(50_000, int(float(radius_km) * 1000)))
    limit = max(1, min(200, int(limit)))
    query = _build_query(provider, lat=float(lat), lng=float(lng), radius_m=radius_m)

    headers = {"User-Agent": _UA, "Accept": "application/json"}
    timeout = httpx.Timeout(10.0, connect=5.0)

    try:
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            resp = await client.post(_OVERPASS_URL, content=query.encode("utf-8"))
            resp.raise_for_status()
            data = resp.json()
        items = _parse_overpass_json(data, provider=provider, lat=float(lat), lng=float(lng))[:limit]
        _cache[key] = _CacheEntry(expires_at=now + _CACHE_TTL, items=items)
        return items
    except Exception:
        # Fallback to any cached value (even stale) if Overpass is down.
        if cached:
            return cached.items
        raise


def _reset_cache_for_tests() -> None:
    _cache.clear()

