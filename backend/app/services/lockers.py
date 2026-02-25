from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Final

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import SessionLocal
from app.schemas.shipping import LockerProvider, LockerRead
from app.services import sameday_easybox_mirror


_OVERPASS_URL: Final[str] = "https://overpass-api.de/api/interpreter"
_CACHE_TTL: Final[timedelta] = timedelta(hours=6)
_OFFICIAL_CACHE_TTL: Final[timedelta] = timedelta(hours=24)
_AUTH_SAFETY_WINDOW: Final[timedelta] = timedelta(minutes=5)
_UA: Final[str] = "momentstudio/1.0 (+https://momentstudio.ro)"


class LockersNotConfiguredError(RuntimeError):
    pass


@dataclass(frozen=True)
class _CacheEntry:
    expires_at: datetime
    items: list[LockerRead]


@dataclass(frozen=True)
class _AllLockersEntry:
    expires_at: datetime
    items: list["_LockerPoint"]


@dataclass(frozen=True)
class _AuthToken:
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class _LockerPoint:
    id: str
    provider: LockerProvider
    name: str
    address: str | None
    lat: float
    lng: float


_cache: dict[str, _CacheEntry] = {}
_all_lockers: dict[LockerProvider, _AllLockersEntry] = {}
_sameday_auth: _AuthToken | None = None
_fan_auth: _AuthToken | None = None


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


def _sameday_configured() -> bool:
    return bool(settings.sameday_api_base_url and settings.sameday_api_username and settings.sameday_api_password)


def _fan_configured() -> bool:
    return bool(settings.fan_api_base_url and settings.fan_api_username and settings.fan_api_password)


def _sameday_base_url() -> str:
    if not settings.sameday_api_base_url:
        raise LockersNotConfiguredError("Sameday locker API is not configured")
    return settings.sameday_api_base_url.rstrip("/")


def _fan_base_url() -> str:
    return (settings.fan_api_base_url or "https://api.fancourier.ro").rstrip("/")


def _parse_sameday_expire_at(value: object) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return datetime.now(timezone.utc) + timedelta(hours=12)
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc) + timedelta(minutes=10)


def _parse_fan_expires_at(value: object, *, now: datetime) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return now + timedelta(hours=23)
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return now + timedelta(hours=1)


def _cached_sameday_token(now: datetime) -> str | None:
    auth = _sameday_auth
    if not auth:
        return None
    if auth.expires_at - _AUTH_SAFETY_WINDOW <= now:
        return None
    return auth.token


def _require_sameday_credentials() -> tuple[str, str]:
    username = settings.sameday_api_username
    password = settings.sameday_api_password
    if not username or not password:
        raise LockersNotConfiguredError("Sameday locker API is not configured")
    return username, password


def _cache_sameday_auth(data: dict) -> str:
    global _sameday_auth
    token = str((data or {}).get("token") or "").strip()
    if not token:
        raise RuntimeError("Sameday authentication returned an empty token")
    expires_at = _parse_sameday_expire_at((data or {}).get("expire_at"))
    _sameday_auth = _AuthToken(token=token, expires_at=expires_at)
    return token


async def _sameday_get_token() -> str:
    now = datetime.now(timezone.utc)
    cached_token = _cached_sameday_token(now)
    if cached_token is not None:
        return cached_token

    username, password = _require_sameday_credentials()

    headers = {
        "User-Agent": _UA,
        "Accept": "application/json",
        "X-Auth-Username": username,
        "X-Auth-Password": password,
    }
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(base_url=_sameday_base_url(), timeout=timeout, headers=headers) as client:
        resp = await client.post("/api/authenticate", data={"remember_me": "1"})
        resp.raise_for_status()
        data = resp.json()

    return _cache_sameday_auth(data)


async def _load_sameday_lockers() -> list[_LockerPoint]:
    token = await _sameday_get_token()
    headers = {"User-Agent": _UA, "Accept": "application/json", "X-Auth-Token": token}
    timeout = httpx.Timeout(20.0, connect=5.0)

    page = 1
    count_per_page = 200
    items: list[_LockerPoint] = []
    async with httpx.AsyncClient(base_url=_sameday_base_url(), timeout=timeout, headers=headers) as client:
        while True:
            resp = await client.get("/api/client/lockers", params={"page": page, "countPerPage": count_per_page})
            resp.raise_for_status()
            data = resp.json() or {}
            for row in data.get("data") or []:
                try:
                    locker_id = str(row.get("lockerId") or "").strip()
                    lat_val = float(row.get("lat"))
                    lng_val = float(row.get("lng"))
                    name = str(row.get("name") or "").strip()[:255]
                    address = (str(row.get("address") or "").strip() or None)
                    if not locker_id or not name:
                        continue
                except Exception:
                    continue
                items.append(
                    _LockerPoint(
                        id=f"sameday:{locker_id}",
                        provider=LockerProvider.sameday,
                        name=name,
                        address=address[:255] if address else None,
                        lat=lat_val,
                        lng=lng_val,
                    )
                )
            pages = int(data.get("pages") or 1)
            current = int(data.get("currentPage") or page)
            if current >= pages:
                break
            page += 1
    return items


async def _fan_get_token() -> str:
    global _fan_auth
    now = datetime.now(timezone.utc)
    if _fan_auth and _fan_auth.expires_at - _AUTH_SAFETY_WINDOW > now:
        return _fan_auth.token

    if not settings.fan_api_username or not settings.fan_api_password:
        raise LockersNotConfiguredError("FAN Courier locker API is not configured")

    headers = {"User-Agent": _UA, "Accept": "application/json"}
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(base_url=_fan_base_url(), timeout=timeout, headers=headers) as client:
        resp = await client.post("/login", params={"username": settings.fan_api_username, "password": settings.fan_api_password})
        resp.raise_for_status()
        payload = resp.json() or {}

    data = payload.get("data") if isinstance(payload, dict) else None
    data_obj = data if isinstance(data, dict) else (payload if isinstance(payload, dict) else {})
    token = str(data_obj.get("token") or "").strip()
    if not token:
        raise RuntimeError("FAN Courier authentication returned an empty token")
    expires_at = _parse_fan_expires_at(data_obj.get("expiresAt") or data_obj.get("expires_at"), now=now)
    _fan_auth = _AuthToken(token=token, expires_at=expires_at)
    return token


def _format_fan_address(addr: dict) -> str | None:
    street = " ".join([(addr.get("street") or "").strip(), (addr.get("streetNo") or "").strip()]).strip()
    locality = (addr.get("locality") or "").strip()
    county = (addr.get("county") or "").strip()
    parts = [p for p in [street, locality, county] if p]
    if parts:
        return ", ".join(parts)[:255]
    return None


def _coerce_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_fan_locker_core_fields(row: dict) -> tuple[str, float, float, str] | None:
    locker_id = str(row.get("id") or "").strip()
    lat_val = _coerce_float(row.get("latitude"))
    lng_val = _coerce_float(row.get("longitude"))
    name = str(row.get("name") or "").strip()[:255]
    if lat_val is None or lng_val is None:
        return None
    if not locker_id or not name:
        return None
    return locker_id, lat_val, lng_val, name


def _build_fan_locker_point(row: dict) -> _LockerPoint | None:
    core_fields = _parse_fan_locker_core_fields(row)
    if core_fields is None:
        return None
    locker_id, lat_val, lng_val, name = core_fields
    address = _format_fan_address(row.get("address") or {})
    return _LockerPoint(
        id=f"fan:{locker_id}",
        provider=LockerProvider.fan_courier,
        name=name,
        address=address,
        lat=lat_val,
        lng=lng_val,
    )


async def _load_fan_lockers() -> list[_LockerPoint]:
    token = await _fan_get_token()
    headers = {"User-Agent": _UA, "Accept": "application/json", "Authorization": f"Bearer {token}"}
    timeout = httpx.Timeout(20.0, connect=5.0)
    async with httpx.AsyncClient(base_url=_fan_base_url(), timeout=timeout, headers=headers) as client:
        resp = await client.get("/reports/pickup-points", params={"type": "fanbox"})
        resp.raise_for_status()
        data = resp.json() or {}

    items: list[_LockerPoint] = []
    for row in data.get("data") or []:
        point = _build_fan_locker_point(row)
        if point is None:
            continue
        items.append(point)
    return items


async def _get_all_lockers(provider: LockerProvider) -> list[_LockerPoint]:
    now = datetime.now(timezone.utc)
    cached = _all_lockers.get(provider)
    if cached and cached.expires_at > now:
        return cached.items

    try:
        if provider == LockerProvider.sameday:
            if not _sameday_configured():
                raise LockersNotConfiguredError("Sameday locker API is not configured")
            items = await _load_sameday_lockers()
        else:
            if not _fan_configured():
                raise LockersNotConfiguredError("FAN Courier locker API is not configured")
            items = await _load_fan_lockers()

        _all_lockers[provider] = _AllLockersEntry(expires_at=now + _OFFICIAL_CACHE_TTL, items=items)
        return items
    except Exception:
        # If refresh fails, return any stale cache instead of hard failing.
        if cached:
            return cached.items
        raise


def _select_nearby_lockers(
    points: list[_LockerPoint], *, lat: float, lng: float, radius_km: float, limit: int, provider: LockerProvider
) -> list[LockerRead]:
    radius = max(1.0, min(50.0, float(radius_km)))
    cap = max(1, min(200, int(limit)))
    nearby: list[LockerRead] = []
    for p in points:
        dist = _haversine_km(lat, lng, p.lat, p.lng)
        if dist > radius:
            continue
        nearby.append(
            LockerRead(
                id=p.id,
                provider=provider,
                name=p.name,
                address=p.address,
                lat=p.lat,
                lng=p.lng,
                distance_km=dist,
            )
        )
    nearby.sort(key=lambda x: (x.distance_km or 0.0, x.name))
    return nearby[:cap]


async def list_lockers(
    *,
    provider: LockerProvider,
    lat: float,
    lng: float,
    radius_km: float = 10.0,
    limit: int = 60,
    force_refresh: bool = False,
    session: AsyncSession | None = None,
) -> list[LockerRead]:
    now = datetime.now(timezone.utc)
    source = (
        "mirror"
        if provider == LockerProvider.sameday and bool(getattr(settings, "sameday_mirror_enabled", True))
        else (
            "official"
            if (
                (provider == LockerProvider.sameday and _sameday_configured())
                or (provider == LockerProvider.fan_courier and _fan_configured())
            )
            else "overpass"
        )
    )
    key = f"{provider}:{source}:{_round_coord(lat)}:{_round_coord(lng)}:{int(radius_km)}:{int(limit)}"
    cached = _cache.get(key)
    if not force_refresh and cached and cached.expires_at > now:
        return cached.items

    try:
        if source == "mirror":
            async def _query(mirror_session: AsyncSession) -> list[LockerRead]:
                try:
                    return await sameday_easybox_mirror.list_nearby_lockers(
                        mirror_session,
                        lat=float(lat),
                        lng=float(lng),
                        radius_km=radius_km,
                        limit=limit,
                    )
                except RuntimeError as exc:
                    raise LockersNotConfiguredError(str(exc)) from exc

            if session is not None:
                items = await _query(session)
            else:
                async with SessionLocal() as mirror_session:
                    items = await _query(mirror_session)
            _cache[key] = _CacheEntry(expires_at=now + _CACHE_TTL, items=items)
            return items

        if source == "official":
            points = await _get_all_lockers(provider)
            items = _select_nearby_lockers(points, lat=float(lat), lng=float(lng), radius_km=radius_km, limit=limit, provider=provider)
            _cache[key] = _CacheEntry(expires_at=now + _CACHE_TTL, items=items)
            return items

        if not settings.lockers_use_overpass_fallback:
            raise LockersNotConfiguredError("Locker API is not configured")

        radius_m = max(1000, min(50_000, int(float(radius_km) * 1000)))
        limit = max(1, min(200, int(limit)))
        query = _build_query(provider, lat=float(lat), lng=float(lng), radius_m=radius_m)

        headers = {"User-Agent": _UA, "Accept": "application/json"}
        timeout = httpx.Timeout(10.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            resp = await client.post(_OVERPASS_URL, content=query.encode("utf-8"))
            resp.raise_for_status()
            data = resp.json()
        items = _parse_overpass_json(data, provider=provider, lat=float(lat), lng=float(lng))[:limit]
        _cache[key] = _CacheEntry(expires_at=now + _CACHE_TTL, items=items)
        return items
    except Exception:
        # Fallback to any cached value (even stale) if the upstream is down.
        if cached:
            return cached.items
        raise


def _reset_cache_for_tests() -> None:
    _cache.clear()
    _all_lockers.clear()
    global _sameday_auth, _fan_auth
    _sameday_auth = None
    _fan_auth = None
