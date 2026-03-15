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
    def _value(key: str) -> str:
        return (tags.get(key) or "").strip()

    line = " ".join([_value("addr:street"), _value("addr:housenumber")]).strip()
    parts = [part for part in [line, _value("addr:city"), _value("addr:postcode")] if part]
    if parts:
        return ", ".join(parts)[:255]
    fallback = next((_value(key) for key in ("address", "location", "description") if _value(key)), "")
    return fallback[:255] if fallback else None


def _format_name(tags: dict[str, str], provider: LockerProvider) -> str:
    for key in ("name", "ref", "official_name"):
        value = (tags.get(key) or "").strip()
        if value:
            return value[:255]
    brand = (tags.get("brand") or "").strip()
    if brand:
        return brand[:255]
    return "Easybox" if provider == LockerProvider.sameday else "FANbox"


def _element_coordinates(element: dict) -> tuple[float, float] | None:
    lat_val = element.get("lat")
    lng_val = element.get("lon")
    if lat_val is None or lng_val is None:
        center_obj = element.get("center")
        center: dict = center_obj if isinstance(center_obj, dict) else {}
        lat_val = center.get("lat")
        lng_val = center.get("lon")
    if lat_val is None or lng_val is None:
        return None
    return float(lat_val), float(lng_val)


def _build_overpass_locker(element: dict, *, provider: LockerProvider, lat: float, lng: float) -> LockerRead | None:
    el_type = (element.get("type") or "").strip()
    el_id = element.get("id")
    if el_type not in {"node", "way", "relation"} or el_id is None:
        return None
    coords = _element_coordinates(element)
    if coords is None:
        return None
    lat_val_f, lng_val_f = coords
    tags = {str(k): str(v) for k, v in (element.get("tags") or {}).items()}
    dist = _haversine_km(lat, lng, lat_val_f, lng_val_f)
    return LockerRead(
        id=f"osm:{el_type}:{el_id}",
        provider=provider,
        name=_format_name(tags, provider),
        address=_format_address(tags),
        lat=lat_val_f,
        lng=lng_val_f,
        distance_km=dist,
    )


def _parse_overpass_json(data: dict, *, provider: LockerProvider, lat: float, lng: float) -> list[LockerRead]:
    items: list[LockerRead] = []
    for element in data.get("elements") or []:
        if not isinstance(element, dict):
            continue
        parsed = _build_overpass_locker(element, provider=provider, lat=lat, lng=lng)
        if parsed is not None:
            items.append(parsed)

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


def _sameday_coord(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if not isinstance(value, (int, float, str)):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _sameday_row_identity(row: dict) -> tuple[str, str] | None:
    locker_id = str(row.get("lockerId") or "").strip()
    name = str(row.get("name") or "").strip()[:255]
    if not locker_id or not name:
        return None
    return locker_id, name


def _sameday_row_coordinates(row: dict) -> tuple[float, float] | None:
    lat_val = _sameday_coord(row.get("lat"))
    lng_val = _sameday_coord(row.get("lng"))
    if lat_val is None or lng_val is None:
        return None
    return lat_val, lng_val


def _parse_sameday_row(row: object) -> _LockerPoint | None:
    if not isinstance(row, dict):
        return None
    identity = _sameday_row_identity(row)
    coordinates = _sameday_row_coordinates(row)
    if identity is None or coordinates is None:
        return None
    locker_id, name = identity
    lat_val, lng_val = coordinates
    address = (str(row.get("address") or "").strip() or None)
    return _LockerPoint(
        id=f"sameday:{locker_id}",
        provider=LockerProvider.sameday,
        name=name,
        address=address[:255] if address else None,
        lat=lat_val,
        lng=lng_val,
    )


def _next_sameday_page(data: dict, *, current_page: int) -> int | None:
    pages = int(data.get("pages") or 1)
    current = int(data.get("currentPage") or current_page)
    if current >= pages:
        return None
    return current_page + 1


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
                parsed = _parse_sameday_row(row)
                if parsed is not None:
                    items.append(parsed)
            next_page = _next_sameday_page(data, current_page=page)
            if next_page is None:
                break
            page = next_page
    return items


def _cached_fan_token(now: datetime) -> str | None:
    if _fan_auth and _fan_auth.expires_at - _AUTH_SAFETY_WINDOW > now:
        return _fan_auth.token
    return None


def _fan_credentials() -> tuple[str, str]:
    username = settings.fan_api_username
    password = settings.fan_api_password
    if not username or not password:
        raise LockersNotConfiguredError("FAN Courier locker API is not configured")
    return username, password


def _extract_fan_token_data(payload: object) -> dict:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


async def _fan_get_token() -> str:
    global _fan_auth
    now = datetime.now(timezone.utc)
    cached_token = _cached_fan_token(now)
    if cached_token:
        return cached_token
    username, password = _fan_credentials()

    headers = {"User-Agent": _UA, "Accept": "application/json"}
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(base_url=_fan_base_url(), timeout=timeout, headers=headers) as client:
        resp = await client.post("/login", params={"username": username, "password": password})
        resp.raise_for_status()
        payload = resp.json() or {}

    data_obj = _extract_fan_token_data(payload)
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


def _locker_source(provider: LockerProvider) -> str:
    mirror_enabled = bool(getattr(settings, "sameday_mirror_enabled", True))
    if provider == LockerProvider.sameday and mirror_enabled:
        return "mirror"
    has_official = (provider == LockerProvider.sameday and _sameday_configured()) or (
        provider == LockerProvider.fan_courier and _fan_configured()
    )
    return "official" if has_official else "overpass"


def _locker_cache_key(provider: LockerProvider, source: str, *, lat: float, lng: float, radius_km: float, limit: int) -> str:
    return f"{provider}:{source}:{_round_coord(lat)}:{_round_coord(lng)}:{int(radius_km)}:{int(limit)}"


async def _query_mirror_lockers(
    *,
    lat: float,
    lng: float,
    radius_km: float,
    limit: int,
    session: AsyncSession | None,
) -> list[LockerRead]:
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
        return await _query(session)
    async with SessionLocal() as mirror_session:
        return await _query(mirror_session)


async def _query_official_lockers(
    *,
    provider: LockerProvider,
    lat: float,
    lng: float,
    radius_km: float,
    limit: int,
) -> list[LockerRead]:
    points = await _get_all_lockers(provider)
    return _select_nearby_lockers(points, lat=float(lat), lng=float(lng), radius_km=radius_km, limit=limit, provider=provider)


async def _query_overpass_lockers(
    *,
    provider: LockerProvider,
    lat: float,
    lng: float,
    radius_km: float,
    limit: int,
) -> list[LockerRead]:
    if not settings.lockers_use_overpass_fallback:
        raise LockersNotConfiguredError("Locker API is not configured")
    radius_m = max(1000, min(50_000, int(float(radius_km) * 1000)))
    resolved_limit = max(1, min(200, int(limit)))
    query = _build_query(provider, lat=float(lat), lng=float(lng), radius_m=radius_m)
    headers = {"User-Agent": _UA, "Accept": "application/json"}
    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        resp = await client.post(_OVERPASS_URL, content=query.encode("utf-8"))
        resp.raise_for_status()
        data = resp.json()
    return _parse_overpass_json(data, provider=provider, lat=float(lat), lng=float(lng))[:resolved_limit]


async def _query_source_lockers(
    source: str,
    *,
    provider: LockerProvider,
    lat: float,
    lng: float,
    radius_km: float,
    limit: int,
    session: AsyncSession | None,
) -> list[LockerRead]:
    if source == "mirror":
        return await _query_mirror_lockers(lat=lat, lng=lng, radius_km=radius_km, limit=limit, session=session)
    if source == "official":
        return await _query_official_lockers(provider=provider, lat=lat, lng=lng, radius_km=radius_km, limit=limit)
    return await _query_overpass_lockers(provider=provider, lat=lat, lng=lng, radius_km=radius_km, limit=limit)


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
    source = _locker_source(provider)
    key = _locker_cache_key(provider, source, lat=lat, lng=lng, radius_km=radius_km, limit=limit)
    cached = _cache.get(key)
    if not force_refresh and cached and cached.expires_at > now:
        return cached.items

    try:
        items = await _query_source_lockers(
            source,
            provider=provider,
            lat=lat,
            lng=lng,
            radius_km=radius_km,
            limit=limit,
            session=session,
        )
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
