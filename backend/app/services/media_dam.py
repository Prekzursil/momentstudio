from __future__ import annotations

import hashlib
import json
import mimetypes
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import anyio
from PIL import Image
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.redis_client import get_redis
from app.models.content import ContentBlock
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
    MediaJobStatus,
    MediaJobType,
    MediaTag,
    MediaUsageEdge,
    MediaVariant,
    MediaVisibility,
)
from app.models.user import UserRole
from app.schemas.media import (
    MediaAssetRead,
    MediaAssetUpdateRequest,
    MediaAssetUploadResponse,
    MediaAssetUpdateI18nItem,
    MediaCollectionRead,
    MediaCollectionUpsertRequest,
    MediaJobRead,
    MediaUsageEdgeRead,
    MediaUsageResponse,
    MediaVariantRead,
)
from app.services import content as content_service
from app.services import storage


QUEUE_KEY = str(getattr(settings, "media_dam_queue_key", "media:jobs:queue") or "media:jobs:queue")
TRASH_RETENTION_DAYS = int(getattr(settings, "media_dam_trash_retention_days", 30) or 30)

PROFILE_DIMENSIONS: dict[str, tuple[int, int]] = {
    "thumb-320": (320, 320),
    "web-640": (640, 640),
    "web-1280": (1280, 1280),
    "social-1200": (1200, 1200),
}


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


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_tag(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", str(value or "").strip().lower()).strip("-_")
    return cleaned[:64]


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
    media_root = storage.ensure_media_root(settings.media_root)
    target_path = media_root / storage_key
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = storage.media_url_to_path(temp_url)
    if temp_path != target_path:
        temp_path.replace(target_path)
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
) -> MediaJob:
    job = MediaJob(
        id=uuid4(),
        asset_id=asset_id,
        job_type=job_type,
        status=MediaJobStatus.queued,
        payload_json=json.dumps(payload or {}, separators=(",", ":"), ensure_ascii=False),
        progress_pct=0,
        attempt=0,
        created_by_user_id=created_by_user_id,
    )
    session.add(job)
    await session.flush()
    return job


async def _maybe_queue_job(job_id: UUID) -> None:
    redis = get_redis()
    if redis is None:
        return
    await redis.rpush(QUEUE_KEY, str(job_id))


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

    order_map = {
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
    return rows, {"total_items": total_items, "total_pages": total_pages, "page": filters.page, "limit": filters.limit}


def asset_to_read(asset: MediaAsset) -> MediaAssetRead:
    tags = sorted({tag_rel.tag.value for tag_rel in (asset.tags or []) if getattr(tag_rel, "tag", None)})
    i18n = []
    for row in sorted(asset.i18n or [], key=lambda x: x.lang):
        i18n.append(
            {
                "lang": row.lang,
                "title": row.title,
                "alt_text": row.alt_text,
                "caption": row.caption,
                "description": row.description,
            }
        )
    variants = []
    for row in sorted(asset.variants or [], key=lambda x: x.profile):
        variants.append(
            MediaVariantRead(
                id=row.id,
                profile=row.profile,
                format=row.format,
                width=row.width,
                height=row.height,
                public_url=row.public_url,
                size_bytes=row.size_bytes,
                created_at=row.created_at,
            )
        )
    return MediaAssetRead(
        id=asset.id,
        asset_type=asset.asset_type.value,
        status=asset.status.value,
        visibility=asset.visibility.value,
        source_kind=asset.source_kind,
        source_ref=asset.source_ref,
        storage_key=asset.storage_key,
        public_url=asset.public_url,
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
    asset.status = to_status
    if to_status == MediaAssetStatus.approved:
        asset.approved_at = _now()
        if set_approved_actor:
            asset.approved_by_user_id = actor_id
    if to_status != MediaAssetStatus.trashed:
        asset.trashed_at = None
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
        old_path = storage.media_url_to_path(asset.public_url)
        new_path = storage.ensure_media_root() / trash_key
        new_path.parent.mkdir(parents=True, exist_ok=True)
        if old_path.exists():
            old_path.replace(new_path)
            asset.storage_key = trash_key
            asset.public_url = _public_url_from_storage_key(trash_key)
    except Exception:
        pass
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
        old_path = storage.media_url_to_path(asset.public_url)
        new_path = storage.ensure_media_root() / restore_key
        new_path.parent.mkdir(parents=True, exist_ok=True)
        if old_path.exists():
            old_path.replace(new_path)
            asset.storage_key = restore_key
            asset.public_url = _public_url_from_storage_key(restore_key)
    except Exception:
        pass
    asset.status = MediaAssetStatus.draft
    asset.trashed_at = None
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
        paths.append(storage.media_url_to_path(asset.public_url))
    except Exception:
        pass
    for variant in asset.variants or []:
        try:
            paths.append(storage.media_url_to_path(variant.public_url))
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


async def rebuild_usage_edges(session: AsyncSession, asset: MediaAsset) -> MediaUsageResponse:
    await session.execute(delete(MediaUsageEdge).where(MediaUsageEdge.asset_id == asset.id))
    keys = await content_service.get_asset_usage_keys(session, url=asset.public_url)
    now = _now()
    for key in keys:
        session.add(
            MediaUsageEdge(
                asset_id=asset.id,
                source_type="content_block",
                source_key=key,
                source_id=None,
                field_path="auto_scan",
                lang=None,
                last_seen_at=now,
            )
        )
    await session.commit()
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
    job.started_at = _now()
    job.attempt = int(job.attempt or 0) + 1
    session.add(job)
    await session.flush()
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
        job.status = MediaJobStatus.completed
        job.progress_pct = 100
        job.completed_at = _now()
        job.error_code = None
        job.error_message = None
    except Exception as exc:
        job.status = MediaJobStatus.failed
        job.error_code = "processing_failed"
        job.error_message = str(exc)
        job.completed_at = _now()
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
    path = storage.media_url_to_path(asset.public_url)
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
    src_path = storage.media_url_to_path(asset.public_url)
    if not src_path.exists():
        raise FileNotFoundError(f"Missing media file for {asset.public_url}")
    dimensions = PROFILE_DIMENSIONS.get(profile, PROFILE_DIMENSIONS["web-1280"])
    variant_key = f"variants/{asset.id}/{profile}.jpg"
    variant_path = storage.ensure_media_root() / variant_key
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
    src_path = storage.media_url_to_path(asset.public_url)
    if not src_path.exists():
        raise FileNotFoundError(f"Missing media file for {asset.public_url}")

    rotate_cw = int(payload.get("rotate_cw") or 0)
    crop_w = payload.get("crop_aspect_w")
    crop_h = payload.get("crop_aspect_h")
    max_w = payload.get("resize_max_width")
    max_h = payload.get("resize_max_height")
    edited_key = f"variants/{asset.id}/edit-{job.id}.jpg"
    edited_path = storage.ensure_media_root() / edited_key
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


async def get_job_or_404(session: AsyncSession, job_id: UUID) -> MediaJob:
    row = await session.scalar(select(MediaJob).where(MediaJob.id == job_id))
    if row is None:
        raise ValueError("Job not found")
    return row


def job_to_read(job: MediaJob) -> MediaJobRead:
    return MediaJobRead(
        id=job.id,
        asset_id=job.asset_id,
        job_type=job.job_type.value,
        status=job.status.value,
        progress_pct=job.progress_pct,
        attempt=job.attempt,
        error_code=job.error_code,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
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
