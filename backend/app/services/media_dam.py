from __future__ import annotations

import hashlib
import hmac
import inspect
import json
import mimetypes
import re
import shutil
from collections.abc import Awaitable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, TypeVar, cast
from uuid import UUID, uuid4

import anyio
from PIL import Image
from sqlalchemy import String, and_, delete, func, or_, select
from sqlalchemy.exc import MissingGreenlet
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.core.config import settings
from app.core.redis_client import get_redis, json_loads
from app.models.catalog import Product, ProductImage
from app.models.content import ContentBlock, ContentBlockTranslation, ContentImage
from app.models.media import (
    MediaApprovalEvent,
    MediaAsset,
    MediaAssetI18n,
    MediaAssetStatus,
    MediaAssetTag,
    MediaAssetType,
    MediaCollection,
    MediaCollectionItem,
    MediaJob,
    MediaJobEvent,
    MediaJobStatus,
    MediaJobTag,
    MediaJobTagLink,
    MediaJobType,
    MediaTag,
    MediaUsageEdge,
    MediaVariant,
    MediaVisibility,
)
from app.models.user import UserRole
from app.schemas.media import (
    MediaAssetRead,
    MediaAssetI18nRead,
    MediaAssetUpdateI18nItem,
    MediaAssetUpdateRequest,
    MediaAssetUploadResponse,
    MediaCollectionRead,
    MediaCollectionUpsertRequest,
    MediaJobEventRead,
    MediaJobRead,
    MediaJobTriageStateLiteral,
    MediaTelemetryResponse,
    MediaTelemetryWorkerRead,
    MediaUsageEdgeRead,
    MediaUsageResponse,
    MediaVariantRead,
)
from app.services import content as content_service
from app.services import private_storage
from app.services import storage


QUEUE_KEY = str(getattr(settings, "media_dam_queue_key", "media:jobs:queue") or "media:jobs:queue")
TRASH_RETENTION_DAYS = int(getattr(settings, "media_dam_trash_retention_days", 30) or 30)
HEARTBEAT_PREFIX = str(getattr(settings, "media_dam_worker_heartbeat_prefix", "media:workers:heartbeat") or "media:workers:heartbeat")
RETRY_BACKOFF_SECONDS = (30, 120, 600, 1800)
DEFAULT_MAX_ATTEMPTS = max(1, int(getattr(settings, "media_dam_retry_max_attempts", 5) or 5))
TRIAGE_STATES = {"open", "retrying", "ignored", "resolved"}

PROFILE_DIMENSIONS: dict[str, tuple[int, int]] = {
    "thumb-320": (320, 320),
    "web-640": (640, 640),
    "web-1280": (1280, 1280),
    "social-1200": (1200, 1200),
}

T = TypeVar("T")


@dataclass(slots=True)
class MediaListFilters:
    q: str = ""
    tag: str = ""
    asset_type: str = ""
    status: str = ""
    visibility: str = ""
    created_from: datetime | None = None
    created_to: datetime | None = None
    include_trashed: bool = False
    page: int = 1
    limit: int = 24
    sort: str = "newest"


@dataclass(slots=True)
class MediaJobListFilters:
    page: int = 1
    limit: int = 24
    status: str = ""
    job_type: str = ""
    asset_id: UUID | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    triage_state: str = ""
    assigned_to_user_id: UUID | None = None
    tag: str = ""
    sla_breached: bool = False
    dead_letter_only: bool = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_tag(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", str(value or "").strip().lower()).strip("-_")
    return cleaned[:64]


def _normalize_job_tag(value: str) -> str:
    return _normalize_tag(value)


def _coerce_triage_state(
    value: str | None,
    *,
    fallback: MediaJobTriageStateLiteral = "open",
) -> MediaJobTriageStateLiteral:
    raw = str(value or "").strip().lower()
    if raw in TRIAGE_STATES:
        return cast(MediaJobTriageStateLiteral, raw)
    return fallback


def _retry_delay_seconds(*, attempt: int, max_attempts: int) -> int | None:
    if attempt >= max_attempts:
        return None
    idx = max(1, int(attempt)) - 1
    if idx < len(RETRY_BACKOFF_SECONDS):
        return RETRY_BACKOFF_SECONDS[idx]
    return RETRY_BACKOFF_SECONDS[-1]


def _guess_asset_type(content_type: str | None, filename: str | None) -> MediaAssetType:
    ctype = str(content_type or "").lower().strip()
    name = str(filename or "").lower()
    if ctype.startswith("image/") or name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg")):
        return MediaAssetType.image
    if ctype.startswith("video/") or name.endswith((".mp4", ".webm", ".mov", ".m4v", ".mkv")):
        return MediaAssetType.video
    return MediaAssetType.document


def _safe_storage_name(filename: str | None) -> str:
    base = Path(filename or "file").name or "file"
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-")
    return base or "file"


def _public_url_from_storage_key(storage_key: str) -> str:
    return f"/media/{storage_key.lstrip('/')}"


def _asset_base_folder(asset_id: UUID) -> str:
    return str(asset_id)


def _public_media_root() -> Path:
    return storage.ensure_media_root(settings.media_root)


def _private_media_root() -> Path:
    return private_storage.ensure_private_root(settings.private_media_root)


def _is_publicly_servable(asset: MediaAsset) -> bool:
    return (
        asset.visibility == MediaVisibility.public
        and asset.status == MediaAssetStatus.approved
        and asset.status != MediaAssetStatus.trashed
    )


def _storage_path_for_key(storage_key: str, *, public_root: bool) -> Path:
    root = _public_media_root() if public_root else _private_media_root()
    return (root / str(storage_key or "").lstrip("/")).resolve()


def _find_existing_storage_path(storage_key: str) -> Path | None:
    rel = str(storage_key or "").lstrip("/")
    if not rel:
        return None
    public_path = _storage_path_for_key(rel, public_root=True)
    if public_path.exists():
        return public_path
    private_path = _storage_path_for_key(rel, public_root=False)
    if private_path.exists():
        return private_path
    return None


def _asset_file_path(asset: MediaAsset) -> Path:
    if asset.storage_key:
        preferred = _storage_path_for_key(asset.storage_key, public_root=_is_publicly_servable(asset))
        if preferred.exists():
            return preferred
        alternate = _storage_path_for_key(asset.storage_key, public_root=not _is_publicly_servable(asset))
        if alternate.exists():
            return alternate
    existing_from_url = _find_existing_storage_path(str(asset.public_url or "").removeprefix("/media/"))
    if existing_from_url is not None:
        return existing_from_url
    expected = _storage_path_for_key(asset.storage_key, public_root=_is_publicly_servable(asset))
    return expected


def _move_asset_file_roots(asset: MediaAsset, *, to_public: bool) -> None:
    if not asset.storage_key:
        return
    source = _find_existing_storage_path(asset.storage_key)
    if source is None:
        return
    destination = _storage_path_for_key(asset.storage_key, public_root=to_public)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source == destination:
        return
    _move_file(source, destination)


def _move_variant_file_roots(asset: MediaAsset, *, to_public: bool) -> None:
    for variant in asset.variants or []:
        if not variant.storage_key:
            continue
        source = _find_existing_storage_path(variant.storage_key)
        if source is None:
            continue
        destination = _storage_path_for_key(variant.storage_key, public_root=to_public)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source == destination:
            continue
        _move_file(source, destination)


def _move_file(source: Path, destination: Path) -> None:
    try:
        source.replace(destination)
    except OSError:
        shutil.move(str(source), str(destination))


def _ensure_asset_storage_placement(asset: MediaAsset) -> None:
    target_public = _is_publicly_servable(asset)
    try:
        _move_asset_file_roots(asset, to_public=target_public)
        _move_variant_file_roots(asset, to_public=target_public)
    except Exception:
        # Read paths should not fail if storage moves are temporarily blocked.
        return


def _sign_preview(asset_id: UUID, *, exp: int, variant_profile: str | None = None) -> str:
    base = f"{asset_id}:{exp}:{(variant_profile or '').strip().lower()}"
    key = str(getattr(settings, "secret_key", "") or "").encode("utf-8")
    return hmac.new(key, base.encode("utf-8"), hashlib.sha256).hexdigest()


def build_preview_url(asset_id: UUID, *, variant_profile: str | None = None, ttl_seconds: int | None = None) -> str:
    ttl = int(ttl_seconds or int(getattr(settings, "media_private_preview_ttl_seconds", 600) or 600))
    ttl = max(30, ttl)
    exp = int(_now().timestamp()) + ttl
    sig = _sign_preview(asset_id, exp=exp, variant_profile=variant_profile)
    base = f"/api/v1/content/admin/media/assets/{asset_id}/preview?exp={exp}&sig={sig}"
    if variant_profile:
        base += f"&variant_profile={variant_profile}"
    return base


def verify_preview_signature(asset_id: UUID, *, exp: int, sig: str, variant_profile: str | None = None) -> bool:
    try:
        exp_ts = int(exp)
    except Exception:
        return False
    if exp_ts < int(_now().timestamp()):
        return False
    expected = _sign_preview(asset_id, exp=exp_ts, variant_profile=variant_profile)
    return hmac.compare_digest(expected, str(sig or ""))

async def create_asset_from_upload(
    session: AsyncSession,
    *,
    file,
    created_by_user_id: UUID | None,
    visibility: MediaVisibility = MediaVisibility.private,
) -> MediaAssetUploadResponse:
    asset_id = uuid4()
    filename = _safe_storage_name(getattr(file, "filename", None))
    asset_type = _guess_asset_type(getattr(file, "content_type", None), filename)
    storage_key = f"originals/{_asset_base_folder(asset_id)}/{filename}"
    temp_url, _ = storage.save_upload(
        file,
        root=settings.media_root,
        filename=filename,
        allowed_content_types=None,
        max_bytes=int(getattr(settings, "admin_upload_max_bytes", 512 * 1024 * 1024)),
        generate_thumbnails=False,
    )
    target_root = _private_media_root()
    target_path = target_root / storage_key
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = storage.media_url_to_path(temp_url)
    if temp_path != target_path:
        _move_file(temp_path, target_path)
    media_url = _public_url_from_storage_key(storage_key)
    asset = MediaAsset(
        id=asset_id,
        asset_type=asset_type,
        status=MediaAssetStatus.draft,
        visibility=visibility,
        source_kind="upload",
        source_ref=None,
        storage_key=storage_key,
        public_url=media_url,
        original_filename=filename,
        mime_type=(getattr(file, "content_type", None) or None),
        created_by_user_id=created_by_user_id,
    )
    session.add(asset)
    await session.flush()
    ingest_job = await enqueue_job(
        session,
        asset_id=asset.id,
        job_type=MediaJobType.ingest,
        payload={"reason": "upload"},
        created_by_user_id=created_by_user_id,
    )
    await session.commit()
    await session.refresh(asset)
    await _maybe_queue_job(ingest_job.id)
    return MediaAssetUploadResponse(asset=asset_to_read(asset), ingest_job_id=ingest_job.id)


async def enqueue_job(
    session: AsyncSession,
    *,
    asset_id: UUID | None,
    job_type: MediaJobType,
    payload: dict[str, Any] | None,
    created_by_user_id: UUID | None,
    max_attempts: int | None = None,
) -> MediaJob:
    attempts = max(1, int(max_attempts or DEFAULT_MAX_ATTEMPTS))
    job = MediaJob(
        id=uuid4(),
        asset_id=asset_id,
        job_type=job_type,
        status=MediaJobStatus.queued,
        payload_json=json.dumps(payload or {}, separators=(",", ":"), ensure_ascii=False),
        progress_pct=0,
        attempt=0,
        max_attempts=attempts,
        triage_state="open",
        created_by_user_id=created_by_user_id,
    )
    session.add(job)
    await session.flush()
    await _record_job_event(
        session,
        job=job,
        actor_user_id=created_by_user_id,
        action="queued",
        meta={"job_type": job.job_type.value, "max_attempts": attempts},
    )
    return job


async def _maybe_queue_job(job_id: UUID) -> None:
    redis = get_redis()
    if redis is None:
        return
    await _await_if_needed(redis.rpush(QUEUE_KEY, str(job_id)))


async def queue_job(job_id: UUID) -> None:
    await _maybe_queue_job(job_id)


async def _await_if_needed(result: Awaitable[T] | T) -> T:
    if inspect.isawaitable(result):
        return await cast(Awaitable[T], result)
    return cast(T, result)


async def _record_job_event(
    session: AsyncSession,
    *,
    job: MediaJob,
    action: str,
    actor_user_id: UUID | None = None,
    note: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    session.add(
        MediaJobEvent(
            job_id=job.id,
            actor_user_id=actor_user_id,
            action=(action or "").strip()[:80] or "event",
            note=(note or "").strip() or None,
            meta_json=(json.dumps(meta, separators=(",", ":"), ensure_ascii=False) if meta else None),
        )
    )
    await session.flush()


async def _apply_job_tag_changes(
    session: AsyncSession,
    *,
    job: MediaJob,
    add_tags: list[str] | None = None,
    remove_tags: list[str] | None = None,
) -> None:
    existing_by_value = {
        rel.tag.value: rel for rel in (job.tags or []) if getattr(rel, "tag", None) and getattr(rel.tag, "value", None)
    }

    remove_values = {_normalize_job_tag(raw) for raw in (remove_tags or [])}
    remove_values = {value for value in remove_values if value}
    for value in remove_values:
        relation = existing_by_value.get(value)
        if relation is not None:
            await session.delete(relation)

    add_values = {_normalize_job_tag(raw) for raw in (add_tags or [])}
    add_values = {value for value in add_values if value}
    for value in add_values:
        if value in existing_by_value:
            continue
        tag = await session.scalar(select(MediaJobTag).where(MediaJobTag.value == value))
        if tag is None:
            tag = MediaJobTag(value=value)
            session.add(tag)
            await session.flush()
        session.add(MediaJobTagLink(job_id=job.id, tag_id=tag.id))
    await session.flush()


async def list_assets(session: AsyncSession, filters: MediaListFilters) -> tuple[list[MediaAsset], dict[str, int]]:
    clauses = []
    if not filters.include_trashed:
        clauses.append(MediaAsset.status != MediaAssetStatus.trashed)
    if filters.q:
        q = f"%{filters.q.strip().lower()}%"
        clauses.append(
            or_(
                func.lower(MediaAsset.original_filename).like(q),
                func.lower(MediaAsset.public_url).like(q),
                func.lower(MediaAsset.storage_key).like(q),
                func.lower(MediaAsset.source_ref).like(q),
                MediaAsset.id.in_(
                    select(MediaAssetI18n.asset_id).where(
                        or_(
                            func.lower(MediaAssetI18n.title).like(q),
                            func.lower(MediaAssetI18n.alt_text).like(q),
                            func.lower(MediaAssetI18n.caption).like(q),
                            func.lower(MediaAssetI18n.description).like(q),
                        )
                    )
                ),
            )
        )
    if filters.asset_type:
        clauses.append(MediaAsset.asset_type == MediaAssetType(filters.asset_type))
    if filters.status:
        clauses.append(MediaAsset.status == MediaAssetStatus(filters.status))
    if filters.visibility:
        clauses.append(MediaAsset.visibility == MediaVisibility(filters.visibility))
    if filters.created_from:
        clauses.append(MediaAsset.created_at >= filters.created_from)
    if filters.created_to:
        clauses.append(MediaAsset.created_at <= filters.created_to)
    if filters.tag:
        normalized_tag = _normalize_tag(filters.tag)
        if normalized_tag:
            clauses.append(
                MediaAsset.id.in_(
                    select(MediaAssetTag.asset_id)
                    .join(MediaTag, MediaTag.id == MediaAssetTag.tag_id)
                    .where(MediaTag.value == normalized_tag)
                )
            )

    stmt = select(MediaAsset).options(
        selectinload(MediaAsset.tags).selectinload(MediaAssetTag.tag),
        selectinload(MediaAsset.i18n),
        selectinload(MediaAsset.variants),
    )
    count_stmt = select(func.count()).select_from(MediaAsset)
    if clauses:
        stmt = stmt.where(and_(*clauses))
        count_stmt = count_stmt.where(and_(*clauses))

    order_map: dict[str, list[ColumnElement[Any]]] = {
        "newest": [MediaAsset.created_at.desc(), MediaAsset.id.desc()],
        "oldest": [MediaAsset.created_at.asc(), MediaAsset.id.asc()],
        "name_asc": [MediaAsset.original_filename.asc().nulls_last(), MediaAsset.created_at.desc()],
        "name_desc": [MediaAsset.original_filename.desc().nulls_last(), MediaAsset.created_at.desc()],
    }
    order = order_map.get(filters.sort, order_map["newest"])
    stmt = stmt.order_by(*order).offset((filters.page - 1) * filters.limit).limit(filters.limit)
    total_items = int((await session.scalar(count_stmt)) or 0)
    total_pages = max(1, (total_items + filters.limit - 1) // filters.limit) if total_items else 1
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows), {"total_items": total_items, "total_pages": total_pages, "page": filters.page, "limit": filters.limit}


async def list_jobs(session: AsyncSession, filters: MediaJobListFilters) -> tuple[list[MediaJob], dict[str, int]]:
    clauses: list[ColumnElement[bool]] = []
    if filters.status:
        clauses.append(MediaJob.status == MediaJobStatus(filters.status))
    if filters.job_type:
        clauses.append(MediaJob.job_type == MediaJobType(filters.job_type))
    if filters.asset_id:
        clauses.append(MediaJob.asset_id == filters.asset_id)
    if filters.created_from:
        clauses.append(MediaJob.created_at >= filters.created_from)
    if filters.created_to:
        clauses.append(MediaJob.created_at <= filters.created_to)
    if filters.triage_state:
        clauses.append(MediaJob.triage_state == _coerce_triage_state(filters.triage_state, fallback="open"))
    if filters.assigned_to_user_id:
        clauses.append(MediaJob.assigned_to_user_id == filters.assigned_to_user_id)
    if filters.dead_letter_only:
        clauses.append(MediaJob.status == MediaJobStatus.dead_letter)
    if filters.sla_breached:
        clauses.append(MediaJob.sla_due_at.is_not(None))
        clauses.append(MediaJob.sla_due_at < _now())
        clauses.append(MediaJob.triage_state != "resolved")
    if filters.tag:
        normalized_tag = _normalize_job_tag(filters.tag)
        if normalized_tag:
            clauses.append(
                MediaJob.id.in_(
                    select(MediaJobTagLink.job_id)
                    .join(MediaJobTag, MediaJobTag.id == MediaJobTagLink.tag_id)
                    .where(MediaJobTag.value == normalized_tag)
                )
            )

    stmt = select(MediaJob).options(selectinload(MediaJob.tags).selectinload(MediaJobTagLink.tag))
    count_stmt = select(func.count()).select_from(MediaJob)
    if clauses:
        stmt = stmt.where(and_(*clauses))
        count_stmt = count_stmt.where(and_(*clauses))

    stmt = stmt.order_by(MediaJob.created_at.desc(), MediaJob.id.desc()).offset((filters.page - 1) * filters.limit).limit(filters.limit)
    total_items = int((await session.scalar(count_stmt)) or 0)
    total_pages = max(1, (total_items + filters.limit - 1) // filters.limit) if total_items else 1
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows), {"total_items": total_items, "total_pages": total_pages, "page": filters.page, "limit": filters.limit}


async def get_telemetry(session: AsyncSession) -> MediaTelemetryResponse:
    redis = get_redis()
    queue_depth = 0
    workers: list[MediaTelemetryWorkerRead] = []
    now = _now()
    prefix = str(getattr(settings, "media_dam_worker_heartbeat_prefix", HEARTBEAT_PREFIX) or HEARTBEAT_PREFIX)

    if redis is not None:
        try:
            queue_depth = int(await _await_if_needed(redis.llen(QUEUE_KEY)) or 0)
        except Exception:
            queue_depth = 0

        try:
            keys = await _await_if_needed(redis.keys(f"{prefix}:*"))
            for key in keys or []:
                raw = await _await_if_needed(redis.get(str(key)))
                if not raw:
                    continue
                payload = json_loads(raw)
                last_seen_raw = payload.get("last_seen_at")
                try:
                    last_seen = datetime.fromisoformat(str(last_seen_raw))
                    if last_seen.tzinfo is None:
                        last_seen = last_seen.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                lag = max(0, int((now - last_seen).total_seconds()))
                workers.append(
                    MediaTelemetryWorkerRead(
                        worker_id=str(payload.get("worker_id") or str(key).split(":")[-1]),
                        hostname=str(payload.get("hostname") or "") or None,
                        pid=int(payload["pid"]) if str(payload.get("pid") or "").isdigit() else None,
                        app_version=str(payload.get("app_version") or "") or None,
                        last_seen_at=last_seen,
                        lag_seconds=lag,
                    )
                )
        except Exception:
            workers = []

    stale_seconds = max(60, int(getattr(settings, "media_dam_processing_stale_seconds", 600) or 600))
    stale_cutoff = now - timedelta(seconds=stale_seconds)
    stale_processing_count = int(
        (await session.scalar(select(func.count()).select_from(MediaJob).where(MediaJob.status == MediaJobStatus.processing, MediaJob.started_at < stale_cutoff)))
        or 0
    )
    dead_letter_count = int(
        (await session.scalar(select(func.count()).select_from(MediaJob).where(MediaJob.status == MediaJobStatus.dead_letter)))
        or 0
    )
    retry_scheduled_count = int(
        (
            await session.scalar(
                select(func.count()).select_from(MediaJob).where(
                    MediaJob.status == MediaJobStatus.failed,
                    MediaJob.next_retry_at.is_not(None),
                )
            )
        )
        or 0
    )
    sla_breached_count = int(
        (
            await session.scalar(
                select(func.count()).select_from(MediaJob).where(
                    MediaJob.sla_due_at.is_not(None),
                    MediaJob.sla_due_at < now,
                    MediaJob.triage_state != "resolved",
                )
            )
        )
        or 0
    )

    oldest_queued_at = await session.scalar(
        select(func.min(MediaJob.created_at)).where(MediaJob.status == MediaJobStatus.queued)
    )
    oldest_queued_age_seconds: int | None = None
    if oldest_queued_at:
        oldest_queued_age_seconds = max(0, int((now - oldest_queued_at).total_seconds()))

    status_counts_rows = (
        await session.execute(select(MediaJob.status, func.count()).group_by(MediaJob.status))
    ).all()
    status_counts = {row[0].value if hasattr(row[0], "value") else str(row[0]): int(row[1] or 0) for row in status_counts_rows}

    type_counts_rows = (
        await session.execute(select(MediaJob.job_type, func.count()).group_by(MediaJob.job_type))
    ).all()
    type_counts = {row[0].value if hasattr(row[0], "value") else str(row[0]): int(row[1] or 0) for row in type_counts_rows}

    completed_rows = (
        await session.execute(
            select(MediaJob.started_at, MediaJob.completed_at)
            .where(
                MediaJob.status == MediaJobStatus.completed,
                MediaJob.started_at.is_not(None),
                MediaJob.completed_at.is_not(None),
                MediaJob.completed_at >= now - timedelta(hours=24),
            )
            .order_by(MediaJob.completed_at.desc())
            .limit(200)
        )
    ).all()
    processing_seconds: list[int] = []
    for started_at, completed_at in completed_rows:
        if not started_at or not completed_at:
            continue
        processing_seconds.append(max(0, int((completed_at - started_at).total_seconds())))
    avg_processing_seconds = int(sum(processing_seconds) / len(processing_seconds)) if processing_seconds else None

    workers.sort(key=lambda row: row.last_seen_at, reverse=True)
    return MediaTelemetryResponse(
        queue_depth=queue_depth,
        online_workers=len(workers),
        workers=workers,
        stale_processing_count=stale_processing_count,
        dead_letter_count=dead_letter_count,
        sla_breached_count=sla_breached_count,
        retry_scheduled_count=retry_scheduled_count,
        oldest_queued_age_seconds=oldest_queued_age_seconds,
        avg_processing_seconds=avg_processing_seconds,
        status_counts=status_counts,
        type_counts=type_counts,
    )

def asset_to_read(asset: MediaAsset) -> MediaAssetRead:
    _ensure_asset_storage_placement(asset)
    tags = sorted({tag_rel.tag.value for tag_rel in (asset.tags or []) if getattr(tag_rel, "tag", None)})
    i18n: list[MediaAssetI18nRead] = []
    for i18n_row in sorted(asset.i18n or [], key=lambda x: x.lang):
        lang = cast(Literal["en", "ro"], i18n_row.lang if i18n_row.lang in {"en", "ro"} else "en")
        i18n.append(
            MediaAssetI18nRead(
                lang=lang,
                title=i18n_row.title,
                alt_text=i18n_row.alt_text,
                caption=i18n_row.caption,
                description=i18n_row.description,
            )
        )
    variants: list[MediaVariantRead] = []
    for variant_row in sorted(asset.variants or [], key=lambda x: x.profile):
        variants.append(
            MediaVariantRead(
                id=variant_row.id,
                profile=variant_row.profile,
                format=variant_row.format,
                width=variant_row.width,
                height=variant_row.height,
                public_url=variant_row.public_url,
                size_bytes=variant_row.size_bytes,
                created_at=variant_row.created_at,
            )
        )
    preview_url = asset.public_url if _is_publicly_servable(asset) else build_preview_url(asset.id)
    return MediaAssetRead(
        id=asset.id,
        asset_type=asset.asset_type.value,
        status=asset.status.value,
        visibility=asset.visibility.value,
        source_kind=asset.source_kind,
        source_ref=asset.source_ref,
        storage_key=asset.storage_key,
        public_url=asset.public_url,
        preview_url=preview_url,
        original_filename=asset.original_filename,
        mime_type=asset.mime_type,
        size_bytes=asset.size_bytes,
        width=asset.width,
        height=asset.height,
        duration_ms=asset.duration_ms,
        page_count=asset.page_count,
        checksum_sha256=asset.checksum_sha256,
        perceptual_hash=asset.perceptual_hash,
        dedupe_group=asset.dedupe_group,
        rights_license=asset.rights_license,
        rights_owner=asset.rights_owner,
        rights_notes=asset.rights_notes,
        approved_at=asset.approved_at,
        trashed_at=asset.trashed_at,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        tags=tags,
        i18n=i18n,
        variants=variants,
    )


async def get_asset_or_404(session: AsyncSession, asset_id: UUID) -> MediaAsset:
    asset = await session.scalar(
        select(MediaAsset)
        .options(
            selectinload(MediaAsset.tags).selectinload(MediaAssetTag.tag),
            selectinload(MediaAsset.i18n),
            selectinload(MediaAsset.variants),
        )
        .where(MediaAsset.id == asset_id)
    )
    if not asset:
        raise ValueError("Asset not found")
    return asset


async def apply_asset_update(session: AsyncSession, asset: MediaAsset, payload: MediaAssetUpdateRequest) -> None:
    before_public = _is_publicly_servable(asset)
    if payload.status:
        asset.status = MediaAssetStatus(payload.status)
    if payload.visibility:
        asset.visibility = MediaVisibility(payload.visibility)
    if payload.rights_license is not None:
        asset.rights_license = (payload.rights_license or "").strip() or None
    if payload.rights_owner is not None:
        asset.rights_owner = (payload.rights_owner or "").strip() or None
    if payload.rights_notes is not None:
        asset.rights_notes = (payload.rights_notes or "").strip() or None
    session.add(asset)

    if payload.tags is not None:
        await _replace_asset_tags(session, asset, payload.tags)
    if payload.i18n is not None:
        await _replace_asset_i18n(session, asset, payload.i18n)

    after_public = _is_publicly_servable(asset)
    if before_public != after_public:
        _move_asset_file_roots(asset, to_public=after_public)
        _move_variant_file_roots(asset, to_public=after_public)


async def _replace_asset_i18n(session: AsyncSession, asset: MediaAsset, entries: list[MediaAssetUpdateI18nItem]) -> None:
    by_lang = {row.lang: row for row in (asset.i18n or [])}
    seen_langs: set[str] = set()
    for row in entries:
        lang = row.lang
        if lang in seen_langs:
            continue
        seen_langs.add(lang)
        current = by_lang.get(lang)
        if current is None:
            current = MediaAssetI18n(asset_id=asset.id, lang=lang)
            session.add(current)
        current.title = (row.title or "").strip() or None
        current.alt_text = (row.alt_text or "").strip() or None
        current.caption = (row.caption or "").strip() or None
        current.description = (row.description or "").strip() or None


async def _replace_asset_tags(session: AsyncSession, asset: MediaAsset, tags: list[str]) -> None:
    normalized = []
    seen = set()
    for raw in tags or []:
        value = _normalize_tag(raw)
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
        if len(normalized) >= 30:
            break

    existing = {rel.tag.value: rel for rel in (asset.tags or []) if getattr(rel, "tag", None)}
    keep = set(normalized)
    for value, relation in existing.items():
        if value not in keep:
            await session.delete(relation)

    for value in normalized:
        if value in existing:
            continue
        tag = await session.scalar(select(MediaTag).where(MediaTag.value == value))
        if tag is None:
            tag = MediaTag(value=value)
            session.add(tag)
            await session.flush()
        session.add(MediaAssetTag(asset_id=asset.id, tag_id=tag.id))


async def change_status(
    session: AsyncSession,
    *,
    asset: MediaAsset,
    to_status: MediaAssetStatus,
    actor_id: UUID | None,
    note: str | None = None,
    set_approved_actor: bool = False,
) -> MediaAsset:
    from_status = asset.status
    before_public = _is_publicly_servable(asset)
    asset.status = to_status
    if to_status == MediaAssetStatus.approved:
        asset.approved_at = _now()
        if set_approved_actor:
            asset.approved_by_user_id = actor_id
    if to_status != MediaAssetStatus.trashed:
        asset.trashed_at = None
    after_public = _is_publicly_servable(asset)
    if before_public != after_public:
        _move_asset_file_roots(asset, to_public=after_public)
        _move_variant_file_roots(asset, to_public=after_public)
    session.add(asset)
    session.add(
        MediaApprovalEvent(
            asset_id=asset.id,
            from_status=from_status,
            to_status=to_status,
            actor_user_id=actor_id,
            note=(note or "").strip() or None,
        )
    )
    await session.commit()
    await session.refresh(asset)
    return asset


async def soft_delete_asset(session: AsyncSession, asset: MediaAsset, actor_id: UUID | None) -> MediaAsset:
    prev_status = asset.status
    asset.status = MediaAssetStatus.trashed
    asset.trashed_at = _now()
    trash_key = f"trash/{asset.id}/{Path(asset.storage_key).name}"
    try:
        old_path = _asset_file_path(asset)
        new_path = _private_media_root() / trash_key
        new_path.parent.mkdir(parents=True, exist_ok=True)
        if old_path.exists():
            _move_file(old_path, new_path)
            asset.storage_key = trash_key
            asset.public_url = _public_url_from_storage_key(trash_key)
    except Exception:
        pass
    _move_variant_file_roots(asset, to_public=False)
    session.add(asset)
    session.add(
        MediaApprovalEvent(
            asset_id=asset.id,
            from_status=prev_status,
            to_status=MediaAssetStatus.trashed,
            actor_user_id=actor_id,
            note="soft_delete",
        )
    )
    await session.commit()
    await session.refresh(asset)
    return asset


async def restore_asset(session: AsyncSession, asset: MediaAsset, actor_id: UUID | None) -> MediaAsset:
    if asset.status != MediaAssetStatus.trashed:
        return asset
    prev_status = asset.status
    restore_key = f"originals/{asset.id}/{Path(asset.storage_key).name}"
    try:
        old_path = _asset_file_path(asset)
        new_path = _private_media_root() / restore_key
        new_path.parent.mkdir(parents=True, exist_ok=True)
        if old_path.exists():
            _move_file(old_path, new_path)
            asset.storage_key = restore_key
            asset.public_url = _public_url_from_storage_key(restore_key)
    except Exception:
        pass
    asset.status = MediaAssetStatus.draft
    asset.trashed_at = None
    _move_variant_file_roots(asset, to_public=False)
    session.add(asset)
    session.add(
        MediaApprovalEvent(
            asset_id=asset.id,
            from_status=prev_status,
            to_status=MediaAssetStatus.draft,
            actor_user_id=actor_id,
            note="restore",
        )
    )
    await session.commit()
    await session.refresh(asset)
    return asset


async def purge_asset(session: AsyncSession, asset: MediaAsset) -> None:
    paths: list[Path] = []
    try:
        path = _find_existing_storage_path(asset.storage_key)
        if path is not None:
            paths.append(path)
    except Exception:
        pass
    for variant in asset.variants or []:
        try:
            path = _find_existing_storage_path(variant.storage_key)
            if path is not None:
                paths.append(path)
        except Exception:
            continue
    for p in paths:
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass
    await session.delete(asset)
    await session.commit()


async def purge_expired_trash(session: AsyncSession) -> int:
    cutoff = _now() - timedelta(days=TRASH_RETENTION_DAYS)
    rows = (
        await session.execute(
            select(MediaAsset).where(MediaAsset.status == MediaAssetStatus.trashed, MediaAsset.trashed_at < cutoff)
        )
    ).scalars().all()
    count = 0
    for asset in rows:
        await purge_asset(session, asset)
        count += 1
    return count


async def rebuild_usage_edges(
    session: AsyncSession,
    asset: MediaAsset,
    *,
    commit: bool = True,
) -> MediaUsageResponse:
    await session.execute(delete(MediaUsageEdge).where(MediaUsageEdge.asset_id == asset.id))
    now = _now()
    refs = await _collect_usage_refs(session, asset)
    seen: set[tuple[str, str, str | None, str, str | None]] = set()
    for source_type, source_key, source_id, field_path, lang in refs:
        key = (source_type, source_key, source_id, field_path, lang)
        if key in seen:
            continue
        seen.add(key)
        session.add(
            MediaUsageEdge(
                asset_id=asset.id,
                source_type=source_type,
                source_key=source_key,
                source_id=source_id,
                field_path=field_path,
                lang=lang,
                last_seen_at=now,
            )
        )
    if commit:
        await session.commit()
    else:
        await session.flush()
    rows = (
        await session.execute(select(MediaUsageEdge).where(MediaUsageEdge.asset_id == asset.id).order_by(MediaUsageEdge.source_key.asc()))
    ).scalars().all()
    return MediaUsageResponse(
        asset_id=asset.id,
        public_url=asset.public_url,
        items=[
            MediaUsageEdgeRead(
                source_type=row.source_type,
                source_key=row.source_key,
                source_id=row.source_id,
                field_path=row.field_path,
                lang=row.lang,
                last_seen_at=row.last_seen_at,
            )
            for row in rows
        ],
    )


async def _collect_usage_refs(
    session: AsyncSession,
    asset: MediaAsset,
) -> list[tuple[str, str, str | None, str, str | None]]:
    refs: list[tuple[str, str, str | None, str, str | None]] = []
    urls = [asset.public_url]
    for url in urls:
        keys = await content_service.get_asset_usage_keys(session, url=url)
        refs.extend([("content_block", key, None, "auto_scan", None) for key in keys])

        content_rows = (
            await session.execute(
                select(ContentImage.id, ContentBlock.key)
                .join(ContentBlock, ContentBlock.id == ContentImage.content_block_id)
                .where(ContentImage.url == url)
            )
        ).all()
        for image_id, block_key in content_rows:
            refs.append(("content_image", block_key, str(image_id), "content_images.url", None))

        product_rows = (
            await session.execute(
                select(ProductImage.id, Product.slug)
                .join(Product, Product.id == ProductImage.product_id)
                .where(ProductImage.url == url, ProductImage.is_deleted.is_(False))
            )
        ).all()
        for image_id, slug in product_rows:
            refs.append(("product_image", slug, str(image_id), "product_images.url", None))

        like = f"%{url}%"
        tr_rows = (
            await session.execute(
                select(ContentBlock.key, ContentBlockTranslation.lang)
                .join(ContentBlock, ContentBlock.id == ContentBlockTranslation.content_block_id)
                .where(ContentBlockTranslation.body_markdown.ilike(like))
            )
        ).all()
        for block_key, lang in tr_rows:
            refs.append(("content_translation", block_key, None, "translations.body_markdown", str(lang or "")))

        social_rows = (
            await session.execute(
                select(ContentBlock.key)
                .where(
                    ContentBlock.key == "site.social",
                    or_(
                        ContentBlock.body_markdown.ilike(like),
                        func.cast(ContentBlock.meta, String).ilike(like),
                    ),
                )
            )
        ).all()
        for (block_key,) in social_rows:
            refs.append(("site_social", block_key, None, "site.social", None))

    return refs


def _sha256_for_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _detect_image_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as img:
            w, h = img.size
            return int(w), int(h)
    except Exception:
        return None, None


async def process_job_inline(session: AsyncSession, job: MediaJob) -> MediaJob:
    job.status = MediaJobStatus.processing
    job.triage_state = "retrying" if job.attempt > 0 else _coerce_triage_state(job.triage_state, fallback="open")
    job.started_at = _now()
    job.attempt = int(job.attempt or 0) + 1
    job.next_retry_at = None
    session.add(job)
    await session.flush()
    await _record_job_event(session, job=job, action="processing_started", meta={"attempt": int(job.attempt or 0)})
    try:
        if job.job_type == MediaJobType.ingest:
            await _process_ingest_job(session, job)
        elif job.job_type == MediaJobType.variant:
            await _process_variant_job(session, job)
        elif job.job_type == MediaJobType.edit:
            await _process_edit_job(session, job)
        elif job.job_type == MediaJobType.ai_tag:
            await _process_ai_tag_job(session, job)
        elif job.job_type == MediaJobType.duplicate_scan:
            await _process_duplicate_scan_job(session, job)
        elif job.job_type == MediaJobType.usage_reconcile:
            await _process_usage_reconcile_job(session, job)
        job.status = MediaJobStatus.completed
        job.progress_pct = 100
        job.completed_at = _now()
        job.next_retry_at = None
        job.dead_lettered_at = None
        job.last_error_at = None
        job.triage_state = "resolved"
        job.error_code = None
        job.error_message = None
        await _record_job_event(
            session,
            job=job,
            action="completed",
            meta={"attempt": int(job.attempt or 0), "job_type": job.job_type.value},
        )
    except Exception as exc:
        now = _now()
        delay = _retry_delay_seconds(attempt=int(job.attempt or 0), max_attempts=max(1, int(job.max_attempts or DEFAULT_MAX_ATTEMPTS)))
        job.last_error_at = now
        job.error_code = "processing_failed"
        job.error_message = str(exc)
        job.completed_at = now
        if delay is None:
            job.status = MediaJobStatus.dead_letter
            job.dead_lettered_at = now
            job.next_retry_at = None
            job.triage_state = "open"
            await _record_job_event(
                session,
                job=job,
                action="dead_lettered",
                note=str(exc),
                meta={"attempt": int(job.attempt or 0), "max_attempts": int(job.max_attempts or DEFAULT_MAX_ATTEMPTS)},
            )
        else:
            job.status = MediaJobStatus.failed
            job.next_retry_at = now + timedelta(seconds=delay)
            job.triage_state = "retrying"
            await _record_job_event(
                session,
                job=job,
                action="retry_scheduled",
                note=str(exc),
                meta={
                    "attempt": int(job.attempt or 0),
                    "max_attempts": int(job.max_attempts or DEFAULT_MAX_ATTEMPTS),
                    "retry_in_seconds": int(delay),
                },
            )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


def _job_payload(job: MediaJob) -> dict[str, Any]:
    try:
        return json.loads(job.payload_json or "{}")
    except Exception:
        return {}


async def _process_ingest_job(session: AsyncSession, job: MediaJob) -> None:
    if not job.asset_id:
        return
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == job.asset_id))
    if asset is None:
        return
    path = _asset_file_path(asset)
    if not path.exists():
        raise FileNotFoundError(f"Missing media file for {asset.public_url}")
    checksum = await anyio.to_thread.run_sync(_sha256_for_path, path)
    stat = path.stat()
    guessed_mime, _ = mimetypes.guess_type(path.as_posix())
    width, height = await anyio.to_thread.run_sync(_detect_image_dimensions, path)
    asset.checksum_sha256 = checksum
    asset.dedupe_group = checksum[:16]
    asset.size_bytes = int(stat.st_size)
    asset.mime_type = guessed_mime or asset.mime_type
    if asset.asset_type == MediaAssetType.image:
        asset.width = width
        asset.height = height
    session.add(asset)


async def _process_variant_job(session: AsyncSession, job: MediaJob) -> None:
    payload = _job_payload(job)
    profile = str(payload.get("profile") or "web-1280")
    if not job.asset_id:
        return
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == job.asset_id))
    if asset is None or asset.asset_type != MediaAssetType.image:
        return
    src_path = _asset_file_path(asset)
    if not src_path.exists():
        raise FileNotFoundError(f"Missing media file for {asset.public_url}")
    dimensions = PROFILE_DIMENSIONS.get(profile, PROFILE_DIMENSIONS["web-1280"])
    variant_key = f"variants/{asset.id}/{profile}.jpg"
    variant_path = _storage_path_for_key(variant_key, public_root=_is_publicly_servable(asset))
    variant_path.parent.mkdir(parents=True, exist_ok=True)

    def _render_variant() -> tuple[int, int]:
        with Image.open(src_path) as img:
            out = img.convert("RGB")
            out.thumbnail(dimensions)
            out.save(variant_path, format="JPEG", optimize=True, quality=86)
            return out.size

    width, height = await anyio.to_thread.run_sync(_render_variant)
    row = await session.scalar(
        select(MediaVariant).where(MediaVariant.asset_id == asset.id, MediaVariant.profile == profile)
    )
    if row is None:
        row = MediaVariant(
            asset_id=asset.id,
            profile=profile,
            format="jpeg",
            storage_key=variant_key,
            public_url=_public_url_from_storage_key(variant_key),
        )
    row.width = int(width)
    row.height = int(height)
    row.size_bytes = int(variant_path.stat().st_size) if variant_path.exists() else None
    session.add(row)


async def _process_edit_job(session: AsyncSession, job: MediaJob) -> None:
    payload = _job_payload(job)
    if not job.asset_id:
        return
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == job.asset_id))
    if asset is None or asset.asset_type != MediaAssetType.image:
        return
    src_path = _asset_file_path(asset)
    if not src_path.exists():
        raise FileNotFoundError(f"Missing media file for {asset.public_url}")

    rotate_cw = int(payload.get("rotate_cw") or 0)
    crop_w = payload.get("crop_aspect_w")
    crop_h = payload.get("crop_aspect_h")
    max_w = payload.get("resize_max_width")
    max_h = payload.get("resize_max_height")
    edited_key = f"variants/{asset.id}/edit-{job.id}.jpg"
    edited_path = _storage_path_for_key(edited_key, public_root=_is_publicly_servable(asset))
    edited_path.parent.mkdir(parents=True, exist_ok=True)

    def _render_edit() -> tuple[int, int]:
        with Image.open(src_path) as img:
            out = img.convert("RGB")
            if rotate_cw in (90, 180, 270):
                out = out.rotate(-rotate_cw, expand=True)
            if crop_w and crop_h:
                iw, ih = out.size
                target_ratio = float(crop_w) / float(crop_h)
                current_ratio = float(iw) / float(ih) if ih else target_ratio
                if current_ratio > target_ratio:
                    new_w = int(ih * target_ratio)
                    left = max(0, (iw - new_w) // 2)
                    out = out.crop((left, 0, left + new_w, ih))
                elif current_ratio < target_ratio:
                    new_h = int(iw / target_ratio)
                    top = max(0, (ih - new_h) // 2)
                    out = out.crop((0, top, iw, top + new_h))
            if max_w or max_h:
                out.thumbnail((int(max_w or 12000), int(max_h or 12000)))
            out.save(edited_path, format="JPEG", optimize=True, quality=88)
            return out.size

    width, height = await anyio.to_thread.run_sync(_render_edit)
    row = MediaVariant(
        asset_id=asset.id,
        profile=f"edit-{job.id}",
        format="jpeg",
        width=int(width),
        height=int(height),
        storage_key=edited_key,
        public_url=_public_url_from_storage_key(edited_key),
        size_bytes=int(edited_path.stat().st_size) if edited_path.exists() else None,
    )
    session.add(row)


async def _process_ai_tag_job(session: AsyncSession, job: MediaJob) -> None:
    if not job.asset_id:
        return
    asset = await session.scalar(
        select(MediaAsset).options(selectinload(MediaAsset.tags).selectinload(MediaAssetTag.tag)).where(MediaAsset.id == job.asset_id)
    )
    if asset is None:
        return
    auto_tags = set()
    filename = str(asset.original_filename or "").lower()
    for token in re.split(r"[^a-z0-9]+", filename):
        if len(token) >= 3:
            auto_tags.add(token[:32])
    if asset.width and asset.height:
        auto_tags.add("landscape" if asset.width >= asset.height else "portrait")
    await _replace_asset_tags(session, asset, sorted({*(tag.tag.value for tag in (asset.tags or []) if tag.tag), *auto_tags}))


async def _process_duplicate_scan_job(session: AsyncSession, job: MediaJob) -> None:
    if not job.asset_id:
        return
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == job.asset_id))
    if not asset or not asset.checksum_sha256:
        return
    rows = (
        await session.execute(
            select(MediaAsset).where(
                MediaAsset.id != asset.id,
                MediaAsset.checksum_sha256 == asset.checksum_sha256,
            )
        )
    ).scalars().all()
    group = asset.checksum_sha256[:16]
    asset.dedupe_group = group
    session.add(asset)
    for row in rows:
        row.dedupe_group = group
        session.add(row)


async def _process_usage_reconcile_job(session: AsyncSession, job: MediaJob) -> None:
    payload = _job_payload(job)
    limit = int(payload.get("limit") or int(getattr(settings, "media_usage_reconcile_batch_size", 200) or 200))
    limit = max(1, min(limit, 5000))

    stmt = (
        select(MediaAsset)
        .options(
            selectinload(MediaAsset.tags).selectinload(MediaAssetTag.tag),
            selectinload(MediaAsset.i18n),
            selectinload(MediaAsset.variants),
        )
        .order_by(MediaAsset.updated_at.desc(), MediaAsset.id.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()
    total = len(rows) or 1
    for idx, asset in enumerate(rows, start=1):
        await rebuild_usage_edges(session, asset, commit=False)
        job.progress_pct = int(min(99, round((idx / total) * 100)))
        session.add(job)
        await session.flush()
    job.progress_pct = 100
    session.add(job)


async def enqueue_due_retries(session: AsyncSession, *, limit: int = 50) -> list[UUID]:
    now = _now()
    stmt = (
        select(MediaJob)
        .where(
            MediaJob.status == MediaJobStatus.failed,
            MediaJob.next_retry_at.is_not(None),
            MediaJob.next_retry_at <= now,
            MediaJob.attempt < MediaJob.max_attempts,
        )
        .order_by(MediaJob.next_retry_at.asc(), MediaJob.created_at.asc())
        .limit(max(1, min(int(limit or 50), 500)))
    )
    rows = (await session.execute(stmt)).scalars().all()
    queued_ids: list[UUID] = []
    for job in rows:
        job.status = MediaJobStatus.queued
        job.progress_pct = 0
        job.started_at = None
        job.completed_at = None
        job.next_retry_at = None
        job.triage_state = "retrying"
        session.add(job)
        await _record_job_event(
            session,
            job=job,
            action="retry_enqueued",
            meta={"attempt": int(job.attempt or 0), "max_attempts": int(job.max_attempts or DEFAULT_MAX_ATTEMPTS)},
        )
        queued_ids.append(job.id)
    await session.commit()
    for job_id in queued_ids:
        await _maybe_queue_job(job_id)
    return queued_ids


async def manual_retry_job(
    session: AsyncSession,
    *,
    job: MediaJob,
    actor_user_id: UUID | None = None,
) -> MediaJob:
    job.status = MediaJobStatus.queued
    job.progress_pct = 0
    job.error_code = None
    job.error_message = None
    job.next_retry_at = None
    job.started_at = None
    job.completed_at = None
    job.dead_lettered_at = None
    if job.triage_state in {"open", "ignored", "resolved"}:
        job.triage_state = "retrying"
    session.add(job)
    await _record_job_event(
        session,
        job=job,
        actor_user_id=actor_user_id,
        action="manual_retry",
        meta={"attempt": int(job.attempt or 0), "max_attempts": int(job.max_attempts or DEFAULT_MAX_ATTEMPTS)},
    )
    await session.commit()
    await _maybe_queue_job(job.id)
    await session.refresh(job)
    return job


async def bulk_retry_jobs(
    session: AsyncSession,
    *,
    job_ids: list[UUID],
    actor_user_id: UUID | None = None,
) -> list[MediaJob]:
    if not job_ids:
        return []
    rows = (
        await session.execute(
            select(MediaJob).where(MediaJob.id.in_(job_ids)).options(selectinload(MediaJob.tags).selectinload(MediaJobTagLink.tag))
        )
    ).scalars().all()
    retried: list[MediaJob] = []
    for job in rows:
        if job.status == MediaJobStatus.processing:
            continue
        if int(job.attempt or 0) >= int(job.max_attempts or DEFAULT_MAX_ATTEMPTS) and job.status != MediaJobStatus.dead_letter:
            continue
        job.status = MediaJobStatus.queued
        job.progress_pct = 0
        job.error_code = None
        job.error_message = None
        job.next_retry_at = None
        job.started_at = None
        job.completed_at = None
        job.dead_lettered_at = None
        if job.triage_state in {"open", "ignored", "resolved"}:
            job.triage_state = "retrying"
        session.add(job)
        await _record_job_event(
            session,
            job=job,
            actor_user_id=actor_user_id,
            action="bulk_retry",
            meta={"attempt": int(job.attempt or 0), "max_attempts": int(job.max_attempts or DEFAULT_MAX_ATTEMPTS)},
        )
        retried.append(job)
    await session.commit()
    for row in retried:
        await _maybe_queue_job(row.id)
    for row in retried:
        await session.refresh(row)
    return retried


async def update_job_triage(
    session: AsyncSession,
    *,
    job: MediaJob,
    actor_user_id: UUID | None,
    triage_state: str | None = None,
    assigned_to_user_id: UUID | None = None,
    clear_assignee: bool = False,
    sla_due_at: datetime | None = None,
    clear_sla_due_at: bool = False,
    incident_url: str | None = None,
    clear_incident_url: bool = False,
    add_tags: list[str] | None = None,
    remove_tags: list[str] | None = None,
    note: str | None = None,
) -> MediaJob:
    meta: dict[str, Any] = {}
    if triage_state:
        current_triage = _coerce_triage_state(job.triage_state, fallback="open")
        job.triage_state = _coerce_triage_state(triage_state, fallback=current_triage)
        meta["triage_state"] = job.triage_state
    if clear_assignee:
        job.assigned_to_user_id = None
        meta["assigned_to_user_id"] = None
    elif assigned_to_user_id is not None:
        job.assigned_to_user_id = assigned_to_user_id
        meta["assigned_to_user_id"] = str(assigned_to_user_id)
    if clear_sla_due_at:
        job.sla_due_at = None
        meta["sla_due_at"] = None
    elif sla_due_at is not None:
        job.sla_due_at = sla_due_at
        meta["sla_due_at"] = sla_due_at.isoformat()
    if clear_incident_url:
        job.incident_url = None
        meta["incident_url"] = None
    elif incident_url is not None:
        cleaned = (incident_url or "").strip()
        job.incident_url = cleaned or None
        meta["incident_url"] = job.incident_url

    await _apply_job_tag_changes(session, job=job, add_tags=add_tags or [], remove_tags=remove_tags or [])
    session.add(job)
    await _record_job_event(
        session,
        job=job,
        actor_user_id=actor_user_id,
        action="triage_updated",
        note=note,
        meta=meta | {"add_tags": add_tags or [], "remove_tags": remove_tags or []},
    )
    await session.commit()
    await session.refresh(job)
    return job


async def list_job_events(session: AsyncSession, *, job_id: UUID, limit: int = 200) -> list[MediaJobEvent]:
    stmt = (
        select(MediaJobEvent)
        .where(MediaJobEvent.job_id == job_id)
        .order_by(MediaJobEvent.created_at.desc(), MediaJobEvent.id.desc())
        .limit(max(1, min(int(limit or 200), 500)))
    )
    return list((await session.execute(stmt)).scalars().all())


async def get_job_or_404(session: AsyncSession, job_id: UUID) -> MediaJob:
    row = await session.scalar(
        select(MediaJob)
        .options(selectinload(MediaJob.tags).selectinload(MediaJobTagLink.tag))
        .where(MediaJob.id == job_id)
    )
    if row is None:
        raise ValueError("Job not found")
    return row


def resolve_asset_preview_path(asset: MediaAsset, *, variant_profile: str | None = None) -> Path:
    if variant_profile:
        variant = next((row for row in (asset.variants or []) if row.profile == variant_profile), None)
        if variant is None:
            raise ValueError("Variant not found")
        path = _find_existing_storage_path(variant.storage_key)
        if path is None:
            raise FileNotFoundError("Variant file missing")
        return path
    path = _asset_file_path(asset)
    if not path.exists():
        raise FileNotFoundError("Asset file missing")
    return path


def job_to_read(job: MediaJob) -> MediaJobRead:
    try:
        raw_tags = job.tags or []
    except MissingGreenlet:
        raw_tags = []
    except Exception:
        raw_tags = []
    tags = sorted({rel.tag.value for rel in raw_tags if getattr(rel, "tag", None) and rel.tag.value})
    return MediaJobRead(
        id=job.id,
        asset_id=job.asset_id,
        job_type=job.job_type.value,
        status=job.status.value,
        progress_pct=job.progress_pct,
        attempt=job.attempt,
        max_attempts=int(job.max_attempts or DEFAULT_MAX_ATTEMPTS),
        next_retry_at=job.next_retry_at,
        last_error_at=job.last_error_at,
        dead_lettered_at=job.dead_lettered_at,
        triage_state=_coerce_triage_state(job.triage_state, fallback="open"),
        assigned_to_user_id=job.assigned_to_user_id,
        sla_due_at=job.sla_due_at,
        incident_url=job.incident_url,
        tags=tags,
        error_code=job.error_code,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def job_event_to_read(event: MediaJobEvent) -> MediaJobEventRead:
    return MediaJobEventRead(
        id=event.id,
        job_id=event.job_id,
        actor_user_id=event.actor_user_id,
        action=event.action,
        note=event.note,
        meta_json=event.meta_json,
        created_at=event.created_at,
    )


async def list_collections(session: AsyncSession) -> list[MediaCollectionRead]:
    rows = (
        await session.execute(
            select(MediaCollection, func.count(MediaCollectionItem.id))
            .outerjoin(MediaCollectionItem, MediaCollectionItem.collection_id == MediaCollection.id)
            .group_by(MediaCollection.id)
            .order_by(MediaCollection.name.asc())
        )
    ).all()
    out: list[MediaCollectionRead] = []
    for collection, count in rows:
        out.append(
            MediaCollectionRead(
                id=collection.id,
                name=collection.name,
                slug=collection.slug,
                visibility=collection.visibility.value,  # type: ignore[arg-type]
                created_at=collection.created_at,
                updated_at=collection.updated_at,
                item_count=int(count or 0),
            )
        )
    return out


async def upsert_collection(
    session: AsyncSession,
    *,
    collection_id: UUID | None,
    payload: MediaCollectionUpsertRequest,
    actor_id: UUID | None,
) -> MediaCollectionRead:
    row = None
    if collection_id:
        row = await session.scalar(select(MediaCollection).where(MediaCollection.id == collection_id))
    if row is None:
        row = MediaCollection(id=uuid4(), created_by_user_id=actor_id)
    row.name = payload.name.strip()
    row.slug = payload.slug.strip().lower()
    row.visibility = MediaVisibility(payload.visibility)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    count = int(
        (
            await session.scalar(
                select(func.count()).select_from(MediaCollectionItem).where(MediaCollectionItem.collection_id == row.id)
            )
        )
        or 0
    )
    return MediaCollectionRead(
        id=row.id,
        name=row.name,
        slug=row.slug,
        visibility=row.visibility.value,  # type: ignore[arg-type]
        created_at=row.created_at,
        updated_at=row.updated_at,
        item_count=count,
    )


async def replace_collection_items(session: AsyncSession, *, collection_id: UUID, asset_ids: list[UUID]) -> None:
    await session.execute(delete(MediaCollectionItem).where(MediaCollectionItem.collection_id == collection_id))
    for idx, asset_id in enumerate(asset_ids, start=1):
        session.add(MediaCollectionItem(collection_id=collection_id, asset_id=asset_id, sort_order=idx))
    await session.commit()


def can_approve_or_purge(role: UserRole | str) -> bool:
    role_value = role.value if isinstance(role, UserRole) else str(role)
    return role_value in {UserRole.owner.value, UserRole.admin.value}


def coerce_visibility(raw: str | None, fallback: MediaVisibility = MediaVisibility.private) -> MediaVisibility:
    value = (raw or "").strip().lower()
    if value in {"public", "private"}:
        return MediaVisibility(value)  # type: ignore[arg-type]
    return fallback


async def ensure_public_asset(session: AsyncSession, asset_id: UUID) -> MediaAsset | None:
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == asset_id))
    if asset is None:
        return None
    if asset.visibility != MediaVisibility.public:
        return None
    if asset.status not in {MediaAssetStatus.approved, MediaAssetStatus.archived, MediaAssetStatus.draft}:
        return None
    return asset
