from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import quote_plus

import httpx
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.shipping_locker import (
    ShippingLockerMirror,
    ShippingLockerProvider,
    ShippingLockerSyncRun,
    ShippingLockerSyncStatus,
)
from app.schemas.shipping import LockerCityRead, LockerMirrorSnapshotRead, LockerProvider, LockerRead

logger = logging.getLogger(__name__)

_SAMEDAY_ORIGIN = "https://sameday.ro"
_FETCH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
_CITY_SEEDS = [
    "Bucuresti",
    "Cluj-Napoca",
    "Iasi",
    "Timisoara",
    "Constanta",
    "Craiova",
    "Brasov",
    "Galati",
    "Ploiesti",
    "Oradea",
    "Braila",
    "Arad",
    "Pitesti",
    "Sibiu",
    "Bacau",
    "Targu Mures",
    "Baia Mare",
    "Buzau",
    "Botosani",
    "Satu Mare",
    "Ramnicu Valcea",
    "Suceava",
    "Piatra Neamt",
    "Drobeta Turnu Severin",
    "Focsani",
    "Targoviste",
    "Bistrita",
    "Tulcea",
    "Resita",
    "Slatina",
    "Calarasi",
    "Vaslui",
    "Alba Iulia",
    "Giurgiu",
    "Deva",
    "Hunedoara",
    "Zalau",
    "Sfantu Gheorghe",
    "Miercurea Ciuc",
]
_JSON_ENDPOINT_TEMPLATES = (
    _SAMEDAY_ORIGIN + "/api/easybox/locations?search={q}&limit=1000&type=locker",
    _SAMEDAY_ORIGIN + "/api/easybox/locations?search={q}&limit=1000",
    _SAMEDAY_ORIGIN + "/api/pudo/locations?search={q}&limit=1000&type=locker",
)
_PLAYWRIGHT_SCRIPT = Path(__file__).resolve().parents[3] / "frontend" / "scripts" / "fetch-sameday-lockers.mjs"
_ALLOWED_HOSTS = {"sameday.ro", "www.sameday.ro"}
_SCHEMA_DRIFT_ALERT_CODE = "schema_drift"
_CHALLENGE_STREAK_ALERT_CODE = "challenge_failure_streak"
_LAT_BOUNDS = (-90.0, 90.0)
_LNG_BOUNDS = (-180.0, 180.0)
_PRIMARY_LAT_LNG_KEYS = (
    ("lat", "lng"),
    ("latitude", "longitude"),
    ("latitude", "lon"),
)


@dataclass(slots=True)
class _NormalizedLocker:
    external_id: str
    name: str
    address: str | None
    city: str | None
    county: str | None
    postal_code: str | None
    lat: float
    lng: float
    source_payload_json: str | None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _clean_text(value: Any, *, max_len: int = 255) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    collapsed = re.sub(r"\s+", " ", raw)
    return collapsed[:max_len]


def _to_float(value: Any) -> float | None:
    try:
        if isinstance(value, str):
            value = value.replace(",", ".")
        parsed = float(value)
    except Exception:
        return None
    if not (-90_000_000 <= parsed <= 90_000_000):
        return None
    return parsed


def _is_valid_coordinate_pair(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return False
    return _LAT_BOUNDS[0] <= lat <= _LAT_BOUNDS[1] and _LNG_BOUNDS[0] <= lng <= _LNG_BOUNDS[1]


def _extract_lat_lng(mapping: dict[str, Any], lat_key: str, lng_key: str) -> tuple[float | None, float | None]:
    return _to_float(mapping.get(lat_key)), _to_float(mapping.get(lng_key))


def _extract_location_lat_lng(location: Any) -> tuple[float | None, float | None]:
    if not isinstance(location, dict):
        return None, None
    lat = _to_float(location.get("lat") or location.get("latitude"))
    lng = _to_float(location.get("lng") or location.get("lon") or location.get("longitude"))
    return lat, lng


def _to_lat_lng(candidate: dict[str, Any]) -> tuple[float, float] | None:
    for lat_key, lng_key in _PRIMARY_LAT_LNG_KEYS:
        lat, lng = _extract_lat_lng(candidate, lat_key, lng_key)
        if lat is not None and lng is not None and _is_valid_coordinate_pair(lat, lng):
            return lat, lng

    geometry = candidate.get("geometry")
    if isinstance(geometry, dict):
        coords = geometry.get("coordinates")
        if isinstance(coords, (list, tuple)) and len(coords) >= 2:
            lng = _to_float(coords[0])
            lat = _to_float(coords[1])
            if lat is not None and lng is not None and _is_valid_coordinate_pair(lat, lng):
                return lat, lng

    lat, lng = _extract_location_lat_lng(candidate.get("location"))
    if lat is not None and lng is not None and _is_valid_coordinate_pair(lat, lng):
        return lat, lng

    return None


def _collect_candidate_rows(payload: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def _walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                if isinstance(item, dict):
                    rows.append(item)
                else:
                    _walk(item)
            return
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"features", "items", "data", "rows", "locations", "lockers", "result", "results"}:
                    _walk(value)
                elif isinstance(value, (dict, list)):
                    _walk(value)

    _walk(payload)
    return rows


def _first_present_value(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalized_text(mapping: dict[str, Any], keys: tuple[str, ...], *, max_len: int) -> str | None:
    return _clean_text(_first_present_value(mapping, keys), max_len=max_len)


def _normalized_external_id(source: dict[str, Any], *, name: str | None, lat: float, lng: float) -> str:
    external_id = _normalized_text(
        source,
        ("lockerId", "locker_id", "external_id", "id", "locationId", "location_id"),
        max_len=128,
    )
    if external_id:
        return external_id
    return hashlib.sha1(f"{name or ''}|{lat:.6f}|{lng:.6f}".encode("utf-8")).hexdigest()[:40]


def _row_payload_json(row: dict[str, Any]) -> str | None:
    try:
        payload_json = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return None
    if len(payload_json) > 12000:
        return payload_json[:12000]
    return payload_json


def _normalize_row(row: dict[str, Any]) -> _NormalizedLocker | None:
    props = row.get("properties")
    source = props if isinstance(props, dict) else row
    lat_lng = _to_lat_lng(source) or _to_lat_lng(row)
    if lat_lng is None:
        return None
    lat, lng = lat_lng

    name = _normalized_text(source, ("name", "lockerName", "title", "label"), max_len=255)
    external_id = _normalized_external_id(source, name=name, lat=lat, lng=lng)
    address = _normalized_text(source, ("address", "fullAddress", "street", "addressLine"), max_len=255)
    city = _normalized_text(source, ("city", "locality", "town", "municipality"), max_len=120)
    county = _normalized_text(source, ("county", "region", "state", "judet"), max_len=120)
    postal_code = _normalized_text(source, ("postalCode", "postcode", "zip"), max_len=32)
    if not name:
        name = f"Easybox {external_id[:8]}"

    payload_json = _row_payload_json(row)

    return _NormalizedLocker(
        external_id=external_id,
        name=name,
        address=address,
        city=city,
        county=county,
        postal_code=postal_code,
        lat=float(lat),
        lng=float(lng),
        source_payload_json=payload_json,
    )


def _dedupe_lockers(items: list[_NormalizedLocker]) -> list[_NormalizedLocker]:
    deduped: dict[str, _NormalizedLocker] = {}
    for item in items:
        deduped[item.external_id] = item
    return list(deduped.values())


def _payload_hash(payload: Any) -> str:
    try:
        raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        raw = str(payload)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _fetch_json_url(client: httpx.AsyncClient, url: str) -> Any:
    resp = await client.get(url)
    if str(resp.headers.get("cf-mitigated") or "").strip().lower() == "challenge":
        raise RuntimeError("Cloudflare challenge")
    if resp.status_code >= 400:
        raise RuntimeError(f"{resp.status_code} from {url}")
    content_type = str(resp.headers.get("content-type") or "").lower()
    text = resp.text
    if "application/json" in content_type:
        return resp.json()
    try:
        return json.loads(text)
    except Exception as exc:
        raise RuntimeError(f"Non-JSON response from {url}") from exc


def _payload_candidates(payload: Any) -> list[dict[str, Any]]:
    candidates = _collect_candidate_rows(payload)
    if not candidates and isinstance(payload, list):
        candidates = [item for item in payload if isinstance(item, dict)]
    return candidates


async def _fetch_template_rows(client: httpx.AsyncClient, template: str) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    success_count = 0
    for city in _CITY_SEEDS:
        url = template.format(q=quote_plus(city))
        try:
            payload = await _fetch_json_url(client, url)
        except Exception:
            continue
        candidates = _payload_candidates(payload)
        if not candidates:
            continue
        success_count += 1
        collected.extend(candidates)
    return collected if success_count > 0 else []


async def _fetch_via_known_endpoints(timeout_seconds: int) -> tuple[Any, str]:
    headers = {"User-Agent": _FETCH_UA, "Accept": "application/json,text/plain,*/*", "Referer": _SAMEDAY_ORIGIN}
    timeout = httpx.Timeout(float(timeout_seconds), connect=min(10.0, float(timeout_seconds)))
    async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
        for template in _JSON_ENDPOINT_TEMPLATES:
            collected = await _fetch_template_rows(client, template)
            if collected:
                source = template.format(q="{city}")
                return collected, source
    raise RuntimeError("No known Sameday public endpoint yielded locker JSON")


def _parse_playwright_payload(stdout_data: bytes) -> tuple[Any, str]:
    try:
        payload = json.loads(stdout_data.decode("utf-8", errors="ignore"))
    except Exception as exc:
        raise RuntimeError("Playwright fetch returned invalid JSON") from exc
    source_url = str((payload or {}).get("source_url") or "").strip() or "playwright"
    data = (payload or {}).get("payload")
    if data is None:
        raise RuntimeError("Playwright fetch payload is empty")
    return data, source_url


async def _fetch_via_playwright(timeout_seconds: int) -> tuple[Any, str]:
    if not _PLAYWRIGHT_SCRIPT.exists():
        raise RuntimeError(f"Playwright script missing: {_PLAYWRIGHT_SCRIPT}")
    if not bool(getattr(settings, "sameday_mirror_playwright_enabled", True)):
        raise RuntimeError("Playwright fallback disabled")

    proc = await asyncio.create_subprocess_exec(
        "node",
        str(_PLAYWRIGHT_SCRIPT),
        "--timeout",
        str(max(10, int(timeout_seconds))),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=max(20, int(timeout_seconds) + 20))
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("Playwright fetch timed out")
    if proc.returncode != 0:
        raise RuntimeError((err.decode("utf-8", errors="ignore") or "Playwright fetch failed").strip())
    return _parse_playwright_payload(out)


async def _fetch_raw_payload() -> tuple[Any, str]:
    timeout_seconds = max(5, int(getattr(settings, "sameday_mirror_fetch_timeout_seconds", 30) or 30))
    try:
        return await _fetch_via_known_endpoints(timeout_seconds)
    except Exception as direct_exc:
        logger.warning("sameday_easybox_direct_fetch_failed", extra={"error": str(direct_exc)})
    return await _fetch_via_playwright(timeout_seconds)


async def _normalize_payload(payload: Any) -> list[_NormalizedLocker]:
    rows = _collect_candidate_rows(payload)
    if not rows and isinstance(payload, list):
        rows = [item for item in payload if isinstance(item, dict)]
    normalized: list[_NormalizedLocker] = []
    for row in rows:
        item = _normalize_row(row)
        if item is None:
            continue
        normalized.append(item)
    unique = _dedupe_lockers(normalized)
    cap = max(1, int(getattr(settings, "sameday_mirror_max_lockers", 20000) or 20000))
    return unique[:cap]


def _candidate_rows(payload: Any) -> list[dict[str, Any]]:
    return _payload_candidates(payload)


def _schema_signature_from_rows(rows: list[dict[str, Any]]) -> str | None:
    if not rows:
        return None
    shape_count: Counter[str] = Counter()
    for row in rows[:5000]:
        keys = sorted(str(key) for key in row.keys())
        props = row.get("properties")
        if isinstance(props, dict):
            keys.extend(f"properties.{str(key)}" for key in sorted(props.keys()))
        shape_count["|".join(keys)] += 1
    payload = [{"shape": shape, "count": int(count)} for shape, count in sorted(shape_count.items())]
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()
    return digest[:40]


def _classify_failure(error: Exception) -> tuple[str, bool]:
    message = str(error or "").strip().lower()
    failure_rules = (
        (("cloudflare challenge", "cf-mitigated"), "cloudflare_challenge", True),
        (("captcha",), "captcha_challenge", True),
        (("non-json response",), "non_json", False),
        (("no locker rows found", "empty payload"), "empty_payload", False),
        (("from https://", "from http://"), "upstream_http", False),
    )
    for markers, code, challenge in failure_rules:
        if any(marker in message for marker in markers):
            return code, challenge
    return "unknown", False


async def _get_previous_success(session: AsyncSession) -> ShippingLockerSyncRun | None:
    return await session.scalar(
        select(ShippingLockerSyncRun)
        .where(
            ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday,
            ShippingLockerSyncRun.status == ShippingLockerSyncStatus.success,
        )
        .order_by(desc(ShippingLockerSyncRun.started_at))
        .limit(1)
    )


def _schema_signature_changed(prev_signature: str | None, current_signature: str | None) -> bool:
    if not prev_signature:
        return False
    if not current_signature:
        return False
    return prev_signature != current_signature


def _ratio_drop_alert(previous_ratio: float, current_ratio: float) -> bool:
    ratio_drop_threshold = max(0.0, float(getattr(settings, "sameday_mirror_schema_drift_ratio_drop", 0.20) or 0.20))
    min_ratio_threshold = max(0.0, float(getattr(settings, "sameday_mirror_schema_drift_min_ratio", 0.80) or 0.80))
    ratio_drop = previous_ratio - current_ratio
    if ratio_drop < ratio_drop_threshold:
        return False
    return current_ratio < min_ratio_threshold


def _detect_schema_drift(
    *,
    previous_success: ShippingLockerSyncRun | None,
    schema_signature: str | None,
    normalization_ratio: float,
) -> bool:
    if previous_success is None:
        return False
    prev_signature = str(previous_success.schema_signature or "").strip() or None
    prev_ratio = float(previous_success.normalization_ratio or 0.0)
    current_ratio = float(normalization_ratio)
    if _schema_signature_changed(prev_signature, schema_signature):
        return True
    return _ratio_drop_alert(prev_ratio, current_ratio)


async def _get_challenge_failure_streak(session: AsyncSession) -> int:
    recent_runs = (
        (
            await session.execute(
                select(ShippingLockerSyncRun)
                .where(ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday)
                .order_by(desc(ShippingLockerSyncRun.started_at))
                .limit(50)
            )
        )
        .scalars()
        .all()
    )
    streak = 0
    for run in recent_runs:
        if run.status != ShippingLockerSyncStatus.failed:
            break
        if not bool(run.challenge_failure):
            break
        streak += 1
    return streak


def _create_snapshot_row(item: _NormalizedLocker, *, now: datetime) -> ShippingLockerMirror:
    return ShippingLockerMirror(
        provider=ShippingLockerProvider.sameday,
        external_id=item.external_id,
        name=item.name,
        address=item.address,
        city=item.city,
        county=item.county,
        postal_code=item.postal_code,
        lat=item.lat,
        lng=item.lng,
        is_active=True,
        source_payload_json=item.source_payload_json,
        first_seen_at=now,
        last_seen_at=now,
    )


def _row_needs_update(row: ShippingLockerMirror, item: _NormalizedLocker) -> bool:
    changed_pairs = (
        (row.name, item.name),
        (row.address, item.address),
        (row.city, item.city),
        (row.county, item.county),
        (row.postal_code, item.postal_code),
        (float(row.lat), float(item.lat)),
        (float(row.lng), float(item.lng)),
        (row.source_payload_json, item.source_payload_json),
        (bool(row.is_active), True),
    )
    return any(current != expected for current, expected in changed_pairs)


def _apply_snapshot_item(row: ShippingLockerMirror, item: _NormalizedLocker, *, now: datetime) -> None:
    row.name = item.name
    row.address = item.address
    row.city = item.city
    row.county = item.county
    row.postal_code = item.postal_code
    row.lat = item.lat
    row.lng = item.lng
    row.source_payload_json = item.source_payload_json
    row.is_active = True
    row.last_seen_at = now


def _deactivate_missing_snapshot_rows(
    session: AsyncSession,
    existing_rows: Sequence[ShippingLockerMirror],
    *,
    seen_ids: set[str],
    now: datetime,
) -> int:
    deactivated = 0
    for row in existing_rows:
        if row.external_id in seen_ids:
            continue
        if not row.is_active:
            continue
        row.is_active = False
        row.last_seen_at = now
        session.add(row)
        deactivated += 1
    return deactivated


def _build_canary_alerts(
    *,
    schema_drift_detected: bool,
    challenge_failure_streak: int,
) -> tuple[list[str], list[str]]:
    codes: list[str] = []
    messages: list[str] = []
    if schema_drift_detected:
        codes.append(_SCHEMA_DRIFT_ALERT_CODE)
        messages.append("Sameday payload schema drift detected. Verify parser compatibility before next sync.")
    threshold = max(
        1,
        int(getattr(settings, "sameday_mirror_challenge_failure_alert_streak", 3) or 3),
    )
    if challenge_failure_streak >= threshold:
        codes.append(_CHALLENGE_STREAK_ALERT_CODE)
        messages.append(
            f"Sameday crawl has {challenge_failure_streak} consecutive Cloudflare/captcha challenge failures."
        )
    return codes, messages


async def _upsert_snapshot(session: AsyncSession, items: list[_NormalizedLocker], *, now: datetime) -> tuple[int, int]:
    existing_rows = (
        (
            await session.execute(
                select(ShippingLockerMirror).where(ShippingLockerMirror.provider == ShippingLockerProvider.sameday)
            )
        )
        .scalars()
        .all()
    )
    existing_by_external_id = {row.external_id: row for row in existing_rows}
    seen_ids: set[str] = set()
    upserted = 0

    for item in items:
        seen_ids.add(item.external_id)
        row = existing_by_external_id.get(item.external_id)
        if row is None:
            session.add(_create_snapshot_row(item, now=now))
            upserted += 1
            continue

        changed = _row_needs_update(row, item)
        _apply_snapshot_item(row, item, now=now)
        session.add(row)
        if changed:
            upserted += 1

    deactivated = _deactivate_missing_snapshot_rows(session, existing_rows, seen_ids=seen_ids, now=now)
    return upserted, deactivated


async def _mark_sync_success(
    session: AsyncSession,
    run: ShippingLockerSyncRun,
    *,
    trigger: str,
    payload: Any,
    source_url: str,
    candidate_count: int,
    normalized_items: list[_NormalizedLocker],
    normalization_ratio: float,
    schema_signature: str | None,
    schema_drift_detected: bool,
    upserted_count: int,
    deactivated_count: int,
    finished_at: datetime,
) -> ShippingLockerSyncRun:
    run.status = ShippingLockerSyncStatus.success
    run.finished_at = finished_at
    run.candidate_count = candidate_count
    run.normalized_count = int(len(normalized_items))
    run.normalization_ratio = normalization_ratio
    run.schema_signature = schema_signature
    run.schema_drift_detected = schema_drift_detected
    run.failure_kind = None
    run.challenge_failure = False
    run.fetched_count = len(normalized_items)
    run.upserted_count = upserted_count
    run.deactivated_count = deactivated_count
    run.error_message = None
    run.source_url_used = str(source_url or "").strip()[:512] or None
    run.payload_hash = _payload_hash(payload)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    logger.info(
        "sameday_easybox_sync_success",
        extra={
            "trigger": trigger,
            "fetched_count": int(run.fetched_count),
            "candidate_count": int(run.candidate_count or 0),
            "normalization_ratio": float(run.normalization_ratio or 0.0),
            "schema_drift_detected": bool(run.schema_drift_detected),
            "upserted_count": int(run.upserted_count),
            "deactivated_count": int(run.deactivated_count),
        },
    )
    return run


async def _mark_sync_failure(
    session: AsyncSession,
    run: ShippingLockerSyncRun,
    *,
    trigger: str,
    error: Exception,
    finished_at: datetime,
) -> ShippingLockerSyncRun:
    failure_kind, challenge_failure = _classify_failure(error)
    run.status = ShippingLockerSyncStatus.failed
    run.finished_at = finished_at
    run.failure_kind = failure_kind
    run.challenge_failure = challenge_failure
    run.schema_drift_detected = False
    run.error_message = str(error)[:4000]
    session.add(run)
    await session.commit()
    await session.refresh(run)
    logger.warning(
        "sameday_easybox_sync_failed",
        extra={
            "trigger": trigger,
            "error": str(error),
            "failure_kind": failure_kind,
            "challenge_failure": challenge_failure,
        },
    )
    return run


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return float(2 * r * asin(sqrt(a)))


def _row_to_locker_read(row: ShippingLockerMirror, *, lat: float, lng: float) -> LockerRead:
    address = _clean_text(" · ".join(filter(None, [row.address, row.city])))
    return LockerRead(
        id=f"sameday:{row.external_id}",
        provider=LockerProvider.sameday,
        name=row.name,
        address=address,
        lat=float(row.lat),
        lng=float(row.lng),
        distance_km=_haversine_km(lat, lng, float(row.lat), float(row.lng)),
    )


async def sync_now(session: AsyncSession, *, trigger: str) -> ShippingLockerSyncRun:
    run = ShippingLockerSyncRun(
        provider=ShippingLockerProvider.sameday,
        status=ShippingLockerSyncStatus.running,
        started_at=_now(),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    try:
        previous_success = await _get_previous_success(session)
        payload, source_url = await _fetch_raw_payload()
        candidate_rows = _candidate_rows(payload)
        normalized_items = await _normalize_payload(payload)
        if not normalized_items:
            raise RuntimeError("No locker rows found in upstream payload")
        now = _now()
        candidate_count = int(len(candidate_rows))
        normalized_count = int(len(normalized_items))
        normalization_ratio = float(normalized_count / max(1, candidate_count))
        schema_signature = _schema_signature_from_rows(candidate_rows)
        schema_drift_detected = _detect_schema_drift(
            previous_success=previous_success,
            schema_signature=schema_signature,
            normalization_ratio=normalization_ratio,
        )
        upserted_count, deactivated_count = await _upsert_snapshot(session, normalized_items, now=now)
        return await _mark_sync_success(
            session,
            run,
            trigger=trigger,
            payload=payload,
            source_url=source_url,
            candidate_count=candidate_count,
            normalized_items=normalized_items,
            normalization_ratio=normalization_ratio,
            schema_signature=schema_signature,
            schema_drift_detected=schema_drift_detected,
            upserted_count=upserted_count,
            deactivated_count=deactivated_count,
            finished_at=now,
        )
    except Exception as exc:
        return await _mark_sync_failure(session, run, trigger=trigger, error=exc, finished_at=_now())


async def list_sync_runs(session: AsyncSession, *, page: int, limit: int) -> tuple[list[ShippingLockerSyncRun], int]:
    safe_page = max(1, int(page or 1))
    safe_limit = max(1, min(100, int(limit or 20)))
    total = int(
        (
            await session.scalar(
                select(func.count())
                .select_from(ShippingLockerSyncRun)
                .where(ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday)
            )
        )
        or 0
    )
    rows = (
        (
            await session.execute(
                select(ShippingLockerSyncRun)
                .where(ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday)
                .order_by(desc(ShippingLockerSyncRun.started_at))
                .offset((safe_page - 1) * safe_limit)
                .limit(safe_limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows), total


async def _count_active_lockers(session: AsyncSession) -> int:
    return int(
        (
            await session.scalar(
                select(func.count())
                .select_from(ShippingLockerMirror)
                .where(
                    ShippingLockerMirror.provider == ShippingLockerProvider.sameday,
                    ShippingLockerMirror.is_active.is_(True),
                )
            )
        )
        or 0
    )


async def _latest_run_by_status(
    session: AsyncSession,
    *,
    status: ShippingLockerSyncStatus | None = None,
    schema_drift_only: bool = False,
) -> ShippingLockerSyncRun | None:
    stmt = select(ShippingLockerSyncRun).where(ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday)
    if status is not None:
        stmt = stmt.where(ShippingLockerSyncRun.status == status)
    if schema_drift_only:
        stmt = stmt.where(ShippingLockerSyncRun.schema_drift_detected.is_(True))
    stmt = stmt.order_by(desc(ShippingLockerSyncRun.started_at)).limit(1)
    return await session.scalar(stmt)


def _compute_snapshot_staleness(last_success: ShippingLockerSyncRun | None) -> tuple[bool, int | None, datetime | None]:
    stale_after = max(60, int(getattr(settings, "sameday_mirror_stale_after_seconds", 2592000) or 2592000))
    finished_at = _as_utc(last_success.finished_at) if last_success else None
    if finished_at is None:
        return True, None, None
    age_seconds = max(0, int((_now() - finished_at).total_seconds()))
    return age_seconds > stale_after, age_seconds, finished_at


async def get_snapshot_status(session: AsyncSession) -> LockerMirrorSnapshotRead:
    total_lockers = await _count_active_lockers(session)
    last_success = await _latest_run_by_status(session, status=ShippingLockerSyncStatus.success)
    latest_failed = await _latest_run_by_status(session, status=ShippingLockerSyncStatus.failed)
    latest_run = await _latest_run_by_status(session)
    latest_schema_drift = await _latest_run_by_status(session, schema_drift_only=True)
    challenge_failure_streak = await _get_challenge_failure_streak(session)
    schema_drift_detected = bool(latest_run and latest_run.schema_drift_detected)
    canary_alert_codes, canary_alert_messages = _build_canary_alerts(
        schema_drift_detected=schema_drift_detected,
        challenge_failure_streak=challenge_failure_streak,
    )
    stale, age_seconds, finished_at = _compute_snapshot_staleness(last_success)
    return LockerMirrorSnapshotRead(
        provider=LockerProvider.sameday,
        total_lockers=total_lockers,
        last_success_at=finished_at,
        last_error=(latest_failed.error_message if latest_failed else None),
        stale=stale,
        stale_age_seconds=age_seconds,
        challenge_failure_streak=challenge_failure_streak,
        schema_drift_detected=schema_drift_detected,
        last_schema_drift_at=_as_utc(latest_schema_drift.started_at) if latest_schema_drift else None,
        canary_alert_codes=canary_alert_codes,
        canary_alert_messages=canary_alert_messages,
    )


async def get_latest_run(session: AsyncSession) -> ShippingLockerSyncRun | None:
    return await session.scalar(
        select(ShippingLockerSyncRun)
        .where(ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday)
        .order_by(desc(ShippingLockerSyncRun.started_at))
        .limit(1)
    )


async def should_run_scheduled_sync(session: AsyncSession) -> bool:
    if not bool(getattr(settings, "sameday_mirror_enabled", True)):
        return False
    interval = max(300, int(getattr(settings, "sameday_mirror_sync_interval_seconds", 2592000) or 2592000))
    latest_success = await session.scalar(
        select(ShippingLockerSyncRun)
        .where(
            ShippingLockerSyncRun.provider == ShippingLockerProvider.sameday,
            ShippingLockerSyncRun.status == ShippingLockerSyncStatus.success,
        )
        .order_by(desc(ShippingLockerSyncRun.finished_at))
        .limit(1)
    )
    finished_at = _as_utc(latest_success.finished_at) if latest_success else None
    if finished_at is None:
        return True
    return (_now() - finished_at).total_seconds() >= interval


def _update_city_bucket(
    grouped: dict[str, dict[str, Any]],
    *,
    city: Any,
    county: Any,
    lat: Any,
    lng: Any,
    normalized_query: str,
) -> None:
    city_name = _clean_text(city, max_len=120)
    if not city_name:
        return
    if normalized_query and normalized_query not in city_name.lower():
        return

    key = city_name.lower()
    bucket = grouped.get(key)
    if bucket is None:
        bucket = {
            "city": city_name,
            "counties": Counter(),
            "lat_sum": 0.0,
            "lng_sum": 0.0,
            "count": 0,
        }
        grouped[key] = bucket

    county_name = _clean_text(county, max_len=120)
    if county_name:
        bucket["counties"][county_name] += 1
    bucket["lat_sum"] += float(lat)
    bucket["lng_sum"] += float(lng)
    bucket["count"] += 1


def _bucket_to_city_read(item: dict[str, Any]) -> LockerCityRead:
    county = item["counties"].most_common(1)[0][0] if item["counties"] else None
    city = str(item["city"])
    display_name = f"{city}, {county}" if county else city
    count = max(1, int(item["count"]))
    return LockerCityRead(
        provider=LockerProvider.sameday,
        city=city,
        county=county,
        display_name=display_name,
        lat=float(item["lat_sum"] / count),
        lng=float(item["lng_sum"] / count),
        locker_count=int(item["count"]),
    )


async def list_city_suggestions(session: AsyncSession, *, q: str, limit: int) -> list[LockerCityRead]:
    stmt = (
        select(
            ShippingLockerMirror.city,
            ShippingLockerMirror.county,
            ShippingLockerMirror.lat,
            ShippingLockerMirror.lng,
        )
        .where(
            ShippingLockerMirror.provider == ShippingLockerProvider.sameday,
            ShippingLockerMirror.is_active.is_(True),
            ShippingLockerMirror.city.is_not(None),
            ShippingLockerMirror.city != "",
        )
        .limit(5000)
    )
    rows = (await session.execute(stmt)).all()
    normalized_query = (q or "").strip().lower()

    grouped: dict[str, dict[str, Any]] = {}
    for city, county, lat, lng in rows:
        _update_city_bucket(
            grouped,
            city=city,
            county=county,
            lat=lat,
            lng=lng,
            normalized_query=normalized_query,
        )

    ordered = sorted(
        grouped.values(),
        key=lambda item: (-int(item["count"]), str(item["city"]).lower()),
    )[: max(1, min(50, int(limit or 8)))]
    return [_bucket_to_city_read(item) for item in ordered]


async def _has_any_active_lockers(session: AsyncSession) -> bool:
    return bool(
        (
            await session.scalar(
                select(func.count())
                .select_from(ShippingLockerMirror)
                .where(
                    ShippingLockerMirror.provider == ShippingLockerProvider.sameday,
                    ShippingLockerMirror.is_active.is_(True),
                )
            )
        )
        or 0
    )


async def list_nearby_lockers(
    session: AsyncSession,
    *,
    lat: float,
    lng: float,
    radius_km: float,
    limit: int,
) -> list[LockerRead]:
    safe_radius = max(1.0, min(50.0, float(radius_km)))
    safe_limit = max(1, min(200, int(limit)))

    lat_delta = safe_radius / 111.0
    cos_lat = max(0.1, abs(cos(radians(lat))))
    lng_delta = safe_radius / (111.0 * cos_lat)

    rows = (
        (
            await session.execute(
                select(ShippingLockerMirror)
                .where(
                    ShippingLockerMirror.provider == ShippingLockerProvider.sameday,
                    ShippingLockerMirror.is_active.is_(True),
                    ShippingLockerMirror.lat >= (lat - lat_delta),
                    ShippingLockerMirror.lat <= (lat + lat_delta),
                    ShippingLockerMirror.lng >= (lng - lng_delta),
                    ShippingLockerMirror.lng <= (lng + lng_delta),
                )
                .limit(5000)
            )
        )
        .scalars()
        .all()
    )
    candidates = [_row_to_locker_read(row, lat=lat, lng=lng) for row in rows]
    filtered = [item for item in candidates if (item.distance_km or 0.0) <= safe_radius]
    filtered.sort(key=lambda item: (item.distance_km or 0.0, item.name.lower()))
    if filtered:
        return filtered[:safe_limit]

    # No nearby points in bounding box. Return empty for normal behavior only when we have data at all.
    if await _has_any_active_lockers(session):
        return []
    raise RuntimeError("Sameday locker mirror is not initialized")


def validate_fetch_hosts() -> None:
    # Guardrail kept explicit because this fetch pipeline is intentionally scraping public endpoints.
    for host in _ALLOWED_HOSTS:
        if not host or "." not in host:
            raise RuntimeError("Invalid allowed host configuration for Sameday mirror")
