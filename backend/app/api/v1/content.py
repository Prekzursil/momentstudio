import csv
import httpx
from datetime import datetime, timedelta, timezone
from io import StringIO
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select, func, or_, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user_optional, get_session, require_admin_section
from app.core.security import create_content_preview_token, decode_content_preview_token
from app.models.content import ContentBlock, ContentBlockVersion, ContentImage, ContentRedirect, ContentImageTag, ContentStatus
from app.models.media import MediaAssetStatus, MediaJobType
from app.models.user import User
from app.models.user import UserRole
from app.schemas.content import (
    ContentAuditRead,
    ContentBlockCreate,
    ContentBlockRead,
    ContentBlockUpdate,
    ContentImageAssetUpdate,
    ContentImageAssetListResponse,
    ContentImageAssetRead,
    ContentImageAssetUsageResponse,
    ContentImageEditRequest,
    ContentImageFocalPointUpdate,
    ContentPreviewTokenResponse,
    ContentPageListItem,
    ContentPageRenameRequest,
    ContentPageRenameResponse,
    ContentRedirectListResponse,
    ContentRedirectRead,
    ContentRedirectImportResult,
    ContentRedirectImportError,
    ContentRedirectUpsertRequest,
    ContentBlockVersionListItem,
    ContentBlockVersionRead,
    ContentSchedulingItem,
    ContentSchedulingListResponse,
    ContentImageTagsUpdate,
    ContentLinkCheckResponse,
    ContentLinkCheckPreviewRequest,
    ContentTranslationStatusUpdate,
    ContentFindReplacePreviewRequest,
    ContentFindReplaceApplyRequest,
    ContentFindReplacePreviewResponse,
    ContentFindReplaceApplyResponse,
    HomePreviewResponse,
    SitemapPreviewResponse,
    StructuredDataValidationResponse,
)
from app.schemas.media import (
    MediaApproveRequest,
    MediaAssetListResponse,
    MediaAssetRead,
    MediaAssetUpdateRequest,
    MediaCollectionItemsRequest,
    MediaCollectionRead,
    MediaCollectionUpsertRequest,
    MediaEditRequest,
    MediaFinalizeRequest,
    MediaJobRead,
    MediaJobEventsResponse,
    MediaJobListResponse,
    MediaJobRetryBulkRequest,
    MediaRetryPolicyListResponse,
    MediaRetryPolicyHistoryResponse,
    MediaRetryPolicyPresetsResponse,
    MediaRetryPolicyRead,
    MediaRetryPolicyEventRead,
    MediaRetryPolicyRollbackRequest,
    MediaRetryPolicyUpdateRequest,
    MediaRejectRequest,
    MediaTelemetryResponse,
    MediaJobTriageUpdateRequest,
    MediaUsageResponse,
    MediaVariantRequest,
)
from app.services import step_up as step_up_service
from app.schemas.social import SocialThumbnailRequest, SocialThumbnailResponse
from app.services import content as content_service
from app.services import media_dam
from app.services import sitemap as sitemap_service
from app.services import structured_data as structured_data_service
from app.services import social_thumbnails

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger(__name__)


def _requires_auth(block: ContentBlock) -> bool:
    meta = getattr(block, "meta", None) or {}
    return bool(meta.get("requires_auth")) if isinstance(meta, dict) else False


def _is_hidden(block: ContentBlock) -> bool:
    meta = getattr(block, "meta", None) or {}
    return bool(meta.get("hidden")) if isinstance(meta, dict) else False


def _normalize_image_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in tags or []:
        value = str(raw or "").strip().lower()
        if not value:
            continue
        value = value.replace(" ", "-")
        value = "".join(ch for ch in value if ch.isalnum() or ch in ("-", "_"))
        value = value.strip("-_")
        if not value or len(value) > 64:
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
        if len(normalized) >= 10:
            break
    return normalized


def _require_owner_or_admin(user: User, *, detail: str = "Only owner/admin can perform this action") -> None:
    if user.role not in (UserRole.owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _redirect_key_to_display_value(key: str) -> str:
    value = (key or "").strip()
    if value.startswith("page."):
        slug = value.split(".", 1)[1] if "." in value else ""
        return f"/pages/{slug}"
    return value


def _redirect_display_value_to_key(value: str) -> str:
    raw = (value or "").strip()
    if raw.startswith("/"):
        raw = raw[1:]
    if raw.startswith("pages/"):
        slug = raw.split("/", 1)[1] if "/" in raw else ""
        slug_norm = content_service.slugify_page_slug(slug)
        return f"page.{slug_norm}" if slug_norm else ""
    return (value or "").strip()


def _redirect_chain_error(from_key: str, redirects: dict[str, str], *, max_hops: int = 50) -> str | None:
    current = (from_key or "").strip()
    if not current:
        return None
    seen: set[str] = set()
    for _ in range(max_hops):
        if current in seen:
            return "loop"
        seen.add(current)
        nxt = redirects.get(current)
        if not nxt:
            return None
        current = nxt
    return "too_deep"


def _parse_optional_datetime_range(
    created_from: str | None,
    created_to: str | None,
) -> tuple[datetime | None, datetime | None]:
    parsed_from = None
    parsed_to = None
    try:
        if created_from:
            parsed_from = datetime.fromisoformat(created_from)
        if created_to:
            parsed_to = datetime.fromisoformat(created_to)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid date filters") from exc
    if parsed_from and parsed_to and parsed_from > parsed_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid date range")
    return parsed_from, parsed_to


def _validate_public_page_access(block: ContentBlock, user: User | None) -> None:
    block_key = getattr(block, "key", "")
    if not block_key.startswith("page."):
        return
    if _is_hidden(block):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    if _requires_auth(block) and not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


async def _serialize_content_block(block: ContentBlock) -> ContentBlockRead:
    if getattr(block, "key", "") != "site.social":
        return block
    hydrated_meta = await social_thumbnails.hydrate_site_social_meta(block.meta if isinstance(block.meta, dict) else None)
    out = ContentBlockRead.model_validate(block)
    out.meta = hydrated_meta
    return out


async def _list_media_assets_or_400(
    session: AsyncSession,
    *,
    q: str,
    tag: str,
    asset_type: str,
    status_filter: str,
    visibility: str,
    include_trashed: bool,
    created_from: datetime | None,
    created_to: datetime | None,
    page: int,
    limit: int,
    sort: str,
) -> tuple[list, dict]:
    try:
        return await media_dam.list_assets(
            session,
            media_dam.MediaListFilters(
                q=q,
                tag=tag,
                asset_type=asset_type,
                status=status_filter,
                visibility=visibility,
                include_trashed=include_trashed,
                created_from=created_from,
                created_to=created_to,
                page=page,
                limit=limit,
                sort=sort,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


async def _list_media_jobs_or_400(
    session: AsyncSession,
    *,
    page: int,
    limit: int,
    status_filter: str,
    job_type: str,
    asset_id: UUID | None,
    triage_state: str,
    assigned_to_user_id: UUID | None,
    tag: str,
    sla_breached: bool,
    dead_letter_only: bool,
    created_from: datetime | None,
    created_to: datetime | None,
) -> tuple[list, dict]:
    try:
        return await media_dam.list_jobs(
            session,
            media_dam.MediaJobListFilters(
                page=page,
                limit=limit,
                status=status_filter,
                job_type=job_type,
                asset_id=asset_id,
                triage_state=triage_state,
                assigned_to_user_id=assigned_to_user_id,
                tag=tag,
                sla_breached=sla_breached,
                dead_letter_only=dead_letter_only,
                created_from=created_from,
                created_to=created_to,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/pages/{slug}", response_model=ContentBlockRead)
async def get_static_page(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    user: User | None = Depends(get_current_user_optional),
) -> ContentBlockRead:
    slug_value = content_service.slugify_page_slug(slug)
    if not slug_value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    key = f"page.{slug_value}"
    block = await content_service.get_published_by_key_following_redirects(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    if getattr(block, "key", "").startswith("page.") and _is_hidden(block):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    if _requires_auth(block) and not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return block


@router.get("/pages/{slug}/preview", response_model=ContentBlockRead)
async def preview_static_page(
    slug: str,
    response: Response,
    token: str = Query(..., min_length=1, description="Preview token"),
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    user: User | None = Depends(get_current_user_optional),
) -> ContentBlockRead:
    key = decode_content_preview_token(token)
    slug_value = content_service.slugify_page_slug(slug)
    expected_key = f"page.{slug_value}" if slug_value else ""
    if not key or not expected_key or key != expected_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid preview token")
    response.headers["Cache-Control"] = "private, no-store"
    block = await content_service.get_block_by_key(session, expected_key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    if _requires_auth(block) and not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return block


@router.post("/pages/{slug}/preview-token", response_model=ContentPreviewTokenResponse)
async def create_page_preview_token(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    expires_minutes: int = Query(default=60, ge=5, le=7 * 24 * 60),
    _: User = Depends(require_admin_section("content")),
) -> ContentPreviewTokenResponse:
    slug_value = content_service.slugify_page_slug(slug)
    if not slug_value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    key = f"page.{slug_value}"
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    token = create_content_preview_token(content_key=key, expires_at=expires_at)

    chosen_lang = lang or (block.lang if getattr(block, "lang", None) in ("en", "ro") else "en") or "en"
    url = f"{settings.frontend_origin.rstrip('/')}/pages/{slug_value}?preview={token}&lang={chosen_lang}"
    return ContentPreviewTokenResponse(token=token, expires_at=expires_at, url=url)


@router.get("/{key}", response_model=ContentBlockRead)
async def get_content(
    key: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    user: User | None = Depends(get_current_user_optional),
) -> ContentBlockRead:
    block = await content_service.get_published_by_key_following_redirects(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    _validate_public_page_access(block, user)
    return await _serialize_content_block(block)


@router.get("/home/preview", response_model=HomePreviewResponse)
async def preview_home(
    response: Response,
    token: str = Query(..., min_length=1, description="Preview token"),
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> HomePreviewResponse:
    key = decode_content_preview_token(token)
    if not key or key != "home.sections":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid preview token")
    response.headers["Cache-Control"] = "private, no-store"

    sections = await content_service.get_block_by_key(session, "home.sections", lang=lang)
    if not sections:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")

    story = await content_service.get_block_by_key(session, "home.story", lang=lang)
    return HomePreviewResponse(sections=sections, story=story)


@router.post("/home/preview-token", response_model=ContentPreviewTokenResponse)
async def create_home_preview_token(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    expires_minutes: int = Query(default=60, ge=5, le=7 * 24 * 60),
    _: User = Depends(require_admin_section("content")),
) -> ContentPreviewTokenResponse:
    block = await content_service.get_block_by_key(session, "home.sections")
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    token = create_content_preview_token(content_key="home.sections", expires_at=expires_at)

    chosen_lang = lang or (block.lang if getattr(block, "lang", None) in ("en", "ro") else "en") or "en"
    url = f"{settings.frontend_origin.rstrip('/')}/?preview={token}&lang={chosen_lang}"
    return ContentPreviewTokenResponse(token=token, expires_at=expires_at, url=url)


@router.post("/admin/social/thumbnail", response_model=SocialThumbnailResponse)
async def admin_fetch_social_thumbnail(
    payload: SocialThumbnailRequest,
    _: User = Depends(require_admin_section("content")),
) -> SocialThumbnailResponse:
    try:
        thumbnail_url = await social_thumbnails.fetch_social_thumbnail_url(
            payload.url,
            persist_local=True,
            force_refresh=True,
            allow_remote_fallback=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not fetch thumbnail") from exc
    if not thumbnail_url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not persist thumbnail")
    return SocialThumbnailResponse(thumbnail_url=thumbnail_url)


@router.get("/admin/scheduling", response_model=ContentSchedulingListResponse)
async def admin_list_scheduling(
    session: AsyncSession = Depends(get_session),
    window_days: int = Query(default=90, ge=1, le=365),
    window_start: datetime | None = Query(default=None, description="ISO datetime (optional)"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_admin_section("content")),
) -> ContentSchedulingListResponse:
    now = datetime.now(timezone.utc)
    start = window_start
    if start is None:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    start = start.astimezone(timezone.utc)
    window_end = start + timedelta(days=window_days)

    key_filter = or_(
        ContentBlock.key.like("page.%"),
        ContentBlock.key.like("blog.%"),
        ContentBlock.key.like("site.%"),
    )

    publish_filter = and_(
        ContentBlock.published_at.is_not(None),
        ContentBlock.published_at >= now,
        ContentBlock.published_at < window_end,
    )
    unpublish_filter = and_(
        ContentBlock.published_until.is_not(None),
        ContentBlock.published_until >= now,
        ContentBlock.published_until < window_end,
    )

    filters = [
        key_filter,
        ContentBlock.status == ContentStatus.published,
        or_(publish_filter, unpublish_filter),
    ]

    publish_event = case((publish_filter, ContentBlock.published_at), else_=None)
    unpublish_event = case((unpublish_filter, ContentBlock.published_until), else_=None)
    next_event = case(
        (publish_event.is_(None), unpublish_event),
        (unpublish_event.is_(None), publish_event),
        (publish_event <= unpublish_event, publish_event),
        else_=unpublish_event,
    )

    total = await session.scalar(select(func.count()).select_from(ContentBlock).where(*filters))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    offset = (page - 1) * limit

    result = await session.execute(
        select(ContentBlock)
        .where(*filters)
        .order_by(next_event.asc(), ContentBlock.key.asc())
        .offset(offset)
        .limit(limit)
    )
    blocks = list(result.scalars().all())

    items = [
        ContentSchedulingItem(
            key=b.key,
            title=b.title,
            status=b.status,
            lang=b.lang,
            published_at=b.published_at,
            published_until=b.published_until,
            updated_at=b.updated_at,
        )
        for b in blocks
    ]

    return ContentSchedulingListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


@router.get("/admin/redirects", response_model=ContentRedirectListResponse)
async def admin_list_redirects(
    session: AsyncSession = Depends(get_session),
    q: str | None = Query(default=None, description="Search from/to key"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    _: User = Depends(require_admin_section("content")),
) -> ContentRedirectListResponse:
    filters = []
    if q:
        needle = f"%{q.strip()}%"
        filters.append(or_(ContentRedirect.from_key.ilike(needle), ContentRedirect.to_key.ilike(needle)))

    total = await session.scalar(select(func.count()).select_from(ContentRedirect).where(*filters))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    offset = (page - 1) * limit

    result = await session.execute(
        select(ContentRedirect)
        .where(*filters)
        .order_by(ContentRedirect.created_at.desc(), ContentRedirect.id.desc())
        .offset(offset)
        .limit(limit)
    )
    redirects = list(result.scalars().all())

    to_keys = {r.to_key for r in redirects}
    existing_targets: set[str] = set()
    if to_keys:
        existing_targets = set(
            (await session.execute(select(ContentBlock.key).where(ContentBlock.key.in_(to_keys)))).scalars().all()
        )

    redirect_map_rows = (await session.execute(select(ContentRedirect.from_key, ContentRedirect.to_key))).all()
    redirect_map = {from_key: to_key for from_key, to_key in redirect_map_rows if from_key and to_key}

    items: list[ContentRedirectRead] = []
    for r in redirects:
        chain_error = _redirect_chain_error(r.from_key, redirect_map)
        items.append(
            ContentRedirectRead(
                id=r.id,
                from_key=r.from_key,
                to_key=r.to_key,
                created_at=r.created_at,
                updated_at=r.updated_at,
                target_exists=r.to_key in existing_targets,
                chain_error=chain_error,
            )
        )

    return ContentRedirectListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


@router.post("/admin/redirects", response_model=ContentRedirectRead)
async def admin_upsert_redirect(
    payload: ContentRedirectUpsertRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentRedirectRead:
    from_key_raw = (payload.from_key or "").strip()
    to_key_raw = (payload.to_key or "").strip()
    from_key = _redirect_display_value_to_key(from_key_raw)
    to_key = _redirect_display_value_to_key(to_key_raw)
    if not from_key or not to_key or from_key == to_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect")

    target = await session.scalar(select(ContentBlock.key).where(ContentBlock.key == to_key))
    if not target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Redirect target not found")

    redirect_map_rows = (await session.execute(select(ContentRedirect.from_key, ContentRedirect.to_key))).all()
    redirect_map = {fk: tk for fk, tk in redirect_map_rows if fk and tk}
    redirect_map[from_key] = to_key
    chain_error = _redirect_chain_error(from_key, redirect_map)
    if chain_error == "loop":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Redirect loop detected")
    if chain_error == "too_deep":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Redirect chain too deep")

    existing = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == from_key))
    if existing:
        existing.to_key = to_key
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return ContentRedirectRead(
            id=existing.id,
            from_key=existing.from_key,
            to_key=existing.to_key,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
            target_exists=True,
            chain_error=None,
        )

    redirect = ContentRedirect(from_key=from_key, to_key=to_key)
    session.add(redirect)
    await session.commit()
    await session.refresh(redirect)
    return ContentRedirectRead(
        id=redirect.id,
        from_key=redirect.from_key,
        to_key=redirect.to_key,
        created_at=redirect.created_at,
        updated_at=redirect.updated_at,
        target_exists=True,
        chain_error=None,
    )


@router.get("/admin/redirects/export")
async def admin_export_redirects(
    request: Request,
    session: AsyncSession = Depends(get_session),
    q: str | None = Query(default=None, description="Search from/to key"),
    admin: User = Depends(require_admin_section("content")),
) -> Response:
    step_up_service.require_step_up(request, admin)
    filters = []
    if q:
        needle = f"%{q.strip()}%"
        filters.append(or_(ContentRedirect.from_key.ilike(needle), ContentRedirect.to_key.ilike(needle)))

    result = await session.execute(
        select(ContentRedirect.from_key, ContentRedirect.to_key).where(*filters).order_by(ContentRedirect.from_key)
    )
    rows = result.all()

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["from", "to", "from_key", "to_key"])
    for from_key, to_key in rows:
        writer.writerow(
            [
                _redirect_key_to_display_value(from_key),
                _redirect_key_to_display_value(to_key),
                from_key,
                to_key,
            ]
        )

    filename = "content-redirects.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/redirects/import", response_model=ContentRedirectImportResult)
async def admin_import_redirects(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentRedirectImportResult:
    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")

    rows: list[tuple[int, str, str]] = []
    errors: list[ContentRedirectImportError] = []

    reader = csv.reader(StringIO(text))
    line = 0
    for row in reader:
        line += 1
        if not row or all(not str(cell or "").strip() for cell in row):
            continue
        if row and str(row[0] or "").lstrip().startswith("#"):
            continue
        if line == 1 and len(row) >= 2:
            first = str(row[0] or "").strip().lower()
            second = str(row[1] or "").strip().lower()
            if first in {"from", "from_key"} and second in {"to", "to_key"}:
                continue
        if len(row) < 2:
            errors.append(ContentRedirectImportError(line=line, from_value=row[0] if row else None, error="Missing columns"))
            continue
        from_value = str(row[0] or "").strip()
        to_value = str(row[1] or "").strip()
        if not from_value or not to_value:
            errors.append(ContentRedirectImportError(line=line, from_value=from_value or None, to_value=to_value or None, error="Missing from/to"))
            continue
        from_key = _redirect_display_value_to_key(from_value)
        to_key = _redirect_display_value_to_key(to_value)
        if not from_key or not to_key:
            errors.append(ContentRedirectImportError(line=line, from_value=from_value, to_value=to_value, error="Invalid redirect value"))
            continue
        if len(from_key) > 120 or len(to_key) > 120:
            errors.append(ContentRedirectImportError(line=line, from_value=from_value, to_value=to_value, error="Key too long"))
            continue
        if from_key == to_key:
            errors.append(ContentRedirectImportError(line=line, from_value=from_value, to_value=to_value, error="from and to must differ"))
            continue
        rows.append((line, from_key, to_key))

    if not rows:
        return ContentRedirectImportResult(created=0, updated=0, skipped=0, errors=errors)

    existing_rows = (await session.execute(select(ContentRedirect.from_key, ContentRedirect.to_key))).all()
    redirect_map = {from_key: to_key for from_key, to_key in existing_rows if from_key and to_key}
    for _, from_key, to_key in rows:
        redirect_map[from_key] = to_key

    loop_keys: set[str] = set()
    too_deep_keys: set[str] = set()
    for from_key in redirect_map.keys():
        err = _redirect_chain_error(from_key, redirect_map)
        if err == "loop":
            loop_keys.add(from_key)
        elif err == "too_deep":
            too_deep_keys.add(from_key)
    if loop_keys or too_deep_keys:
        details: list[str] = []
        if loop_keys:
            sample = ", ".join(sorted(loop_keys)[:5])
            details.append(f"Redirect loop detected (e.g. {sample})")
        if too_deep_keys:
            sample = ", ".join(sorted(too_deep_keys)[:5])
            details.append(f"Redirect chain too deep (e.g. {sample})")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(details))

    created = 0
    updated = 0
    skipped = 0

    unique_rows: dict[str, tuple[int, str]] = {}
    for line_no, from_key, to_key in rows:
        unique_rows[from_key] = (line_no, to_key)

    existing = (
        await session.execute(select(ContentRedirect).where(ContentRedirect.from_key.in_(list(unique_rows.keys()))))
    ).scalars().all()
    existing_by_key = {r.from_key: r for r in existing}

    for from_key, (_, to_key) in unique_rows.items():
        row = existing_by_key.get(from_key)
        if row:
            if row.to_key == to_key:
                skipped += 1
                continue
            row.to_key = to_key
            session.add(row)
            updated += 1
            continue
        session.add(ContentRedirect(from_key=from_key, to_key=to_key))
        created += 1

    await session.commit()
    return ContentRedirectImportResult(created=created, updated=updated, skipped=skipped, errors=errors)


@router.get("/admin/seo/sitemap-preview", response_model=SitemapPreviewResponse)
async def admin_sitemap_preview(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> SitemapPreviewResponse:
    by_lang = await sitemap_service.build_sitemap_urls(session)
    return SitemapPreviewResponse(by_lang=by_lang)


@router.get("/admin/seo/structured-data/validate", response_model=StructuredDataValidationResponse)
async def admin_validate_structured_data(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> StructuredDataValidationResponse:
    payload = await structured_data_service.validate_structured_data(session)
    return StructuredDataValidationResponse(**payload)


@router.delete("/admin/redirects/{redirect_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_redirect(
    redirect_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> Response:
    redirect = await session.scalar(select(ContentRedirect).where(ContentRedirect.id == redirect_id))
    if not redirect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Redirect not found")
    await session.delete(redirect)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/{key}", response_model=ContentBlockRead)
async def admin_get_content(
    key: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    _: User = Depends(require_admin_section("content")),
) -> ContentBlockRead:
    block = await content_service.get_block_by_key(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


@router.patch("/admin/{key}", response_model=ContentBlockRead)
async def admin_update_content(
    key: str,
    payload: ContentBlockUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentBlockRead:
    block = await content_service.upsert_block(session, key, payload, actor_id=admin.id)
    return block


@router.delete("/admin/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_content(
    key: str,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> Response:
    if not (key or "").startswith("blog."):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only blog posts can be deleted")
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    await session.delete(block)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/{key}", response_model=ContentBlockRead, status_code=status.HTTP_201_CREATED)
async def admin_create_content(
    key: str,
    payload: ContentBlockCreate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentBlockRead:
    content_service.validate_page_key_for_create(key)
    existing = await content_service.get_block_by_key(session, key)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content key exists")
    block = await content_service.upsert_block(session, key, payload, actor_id=admin.id)
    return block


@router.post("/admin/{key}/images", response_model=ContentBlockRead)
async def admin_upload_content_image(
    key: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ContentBlockRead:
    block = await content_service.get_block_by_key(session, key, lang=lang)
    if not block:
        # Allow uploads to implicitly create the content bucket for convenience (admin-only).
        create_payload = ContentBlockCreate(
            title=key,
            body_markdown="Asset bucket",
            status="draft",
            lang=lang,
            meta={},
        )
        block = await content_service.upsert_block(session, key, create_payload, actor_id=admin.id)
    block = await content_service.add_image(session, block, file, actor_id=admin.id)
    return block


@router.get("/admin/assets/images", response_model=ContentImageAssetListResponse)
async def admin_list_content_images(
    session: AsyncSession = Depends(get_session),
    key: str | None = Query(default=None, description="Filter by content block key"),
    q: str | None = Query(default=None, description="Search content key, URL, or alt text"),
    tag: str | None = Query(default=None, description="Filter by tag"),
    sort: str = Query(default="newest", pattern="^(newest|oldest|key_asc|key_desc)$"),
    created_from: datetime | None = Query(default=None, description="Filter images created at or after this ISO datetime"),
    created_to: datetime | None = Query(default=None, description="Filter images created at or before this ISO datetime"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=100),
    _: User = Depends(require_admin_section("content")),
) -> ContentImageAssetListResponse:
    filters = []
    if key:
        filters.append(ContentBlock.key == key)
    if q:
        needle = f"%{q.strip()}%"
        filters.append(
            or_(
                ContentBlock.key.ilike(needle),
                ContentImage.url.ilike(needle),
                ContentImage.alt_text.ilike(needle),
            )
        )
    tag_value = (tag or "").strip().lower()
    if tag_value:
        filters.append(ContentImageTag.tag == tag_value)
    if created_from:
        filters.append(ContentImage.created_at >= created_from)
    if created_to:
        filters.append(ContentImage.created_at <= created_to)
    if created_from and created_to and created_from > created_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid date range")

    count_query = select(func.count()).select_from(ContentImage).join(ContentBlock)
    if tag_value:
        count_query = select(func.count(func.distinct(ContentImage.id))).select_from(ContentImage).join(ContentBlock).join(
            ContentImageTag
        )
    total = await session.scalar(count_query.where(*filters))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    offset = (page - 1) * limit

    order_map = {
        "newest": [ContentImage.created_at.desc(), ContentImage.id.desc()],
        "oldest": [ContentImage.created_at.asc(), ContentImage.id.asc()],
        "key_asc": [ContentBlock.key.asc(), ContentImage.created_at.desc(), ContentImage.id.desc()],
        "key_desc": [ContentBlock.key.desc(), ContentImage.created_at.desc(), ContentImage.id.desc()],
    }
    order_clauses = order_map.get(sort, order_map["newest"])

    query = (
        select(ContentImage, ContentBlock.key)
        .join(ContentBlock)
        .where(*filters)
        .order_by(*order_clauses)
        .offset(offset)
        .limit(limit)
    )
    if tag_value:
        query = query.join(ContentImageTag)
    result = await session.execute(query)
    rows = result.all()
    image_ids = [img.id for img, _ in rows]
    tag_map: dict[UUID, list[str]] = {}
    if image_ids:
        tag_rows = await session.execute(
            select(ContentImageTag.content_image_id, ContentImageTag.tag).where(ContentImageTag.content_image_id.in_(image_ids))
        )
        for image_id, tag_value_row in tag_rows.all():
            tag_map.setdefault(image_id, []).append(tag_value_row)
        for image_id in list(tag_map.keys()):
            tag_map[image_id] = sorted(set(tag_map[image_id]))
    items: list[ContentImageAssetRead] = []
    for img, block_key in rows:
        items.append(
            ContentImageAssetRead(
                id=img.id,
                root_image_id=getattr(img, "root_image_id", None),
                source_image_id=getattr(img, "source_image_id", None),
                url=img.url,
                alt_text=img.alt_text,
                sort_order=img.sort_order,
                focal_x=getattr(img, "focal_x", 50),
                focal_y=getattr(img, "focal_y", 50),
                created_at=img.created_at,
                content_key=block_key,
                tags=tag_map.get(img.id, []),
            )
        )
    return ContentImageAssetListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


@router.patch("/admin/assets/images/{image_id}", response_model=ContentImageAssetRead)
async def admin_update_content_image(
    image_id: UUID,
    payload: ContentImageAssetUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentImageAssetRead:
    image = await session.scalar(select(ContentImage).where(ContentImage.id == image_id))
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    next_alt = (payload.alt_text or "").strip()
    image.alt_text = next_alt or None
    session.add(image)
    await session.commit()

    tags = (
        await session.execute(select(ContentImageTag.tag).where(ContentImageTag.content_image_id == image_id))
    ).scalars().all()
    tags_sorted = sorted(set(tags))

    content_key = ""
    if getattr(image, "content_block_id", None):
        content_key = (await session.scalar(select(ContentBlock.key).where(ContentBlock.id == image.content_block_id))) or ""

    return ContentImageAssetRead(
        id=image.id,
        root_image_id=getattr(image, "root_image_id", None),
        source_image_id=getattr(image, "source_image_id", None),
        url=image.url,
        alt_text=image.alt_text,
        sort_order=image.sort_order,
        focal_x=getattr(image, "focal_x", 50),
        focal_y=getattr(image, "focal_y", 50),
        created_at=image.created_at,
        content_key=content_key,
        tags=tags_sorted,
    )


@router.patch("/admin/assets/images/{image_id}/tags", response_model=ContentImageAssetRead)
async def admin_update_content_image_tags(
    image_id: UUID,
    payload: ContentImageTagsUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentImageAssetRead:
    image = await session.scalar(select(ContentImage).where(ContentImage.id == image_id))
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    tags = _normalize_image_tags(payload.tags)

    existing = (
        await session.execute(select(ContentImageTag).where(ContentImageTag.content_image_id == image_id))
    ).scalars().all()
    existing_by_value = {t.tag: t for t in existing}

    want = set(tags)
    have = set(existing_by_value.keys())

    for value in have - want:
        await session.delete(existing_by_value[value])

    for value in want - have:
        session.add(ContentImageTag(content_image_id=image_id, tag=value))

    await session.commit()

    content_key = ""
    if getattr(image, "content_block_id", None):
        content_key = (
            await session.scalar(select(ContentBlock.key).where(ContentBlock.id == image.content_block_id))
        ) or ""

    return ContentImageAssetRead(
        id=image.id,
        root_image_id=getattr(image, "root_image_id", None),
        source_image_id=getattr(image, "source_image_id", None),
        url=image.url,
        alt_text=image.alt_text,
        sort_order=image.sort_order,
        focal_x=getattr(image, "focal_x", 50),
        focal_y=getattr(image, "focal_y", 50),
        created_at=image.created_at,
        content_key=content_key,
        tags=tags,
    )


@router.patch("/admin/assets/images/{image_id}/focal", response_model=ContentImageAssetRead)
async def admin_update_content_image_focal_point(
    image_id: UUID,
    payload: ContentImageFocalPointUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentImageAssetRead:
    image = await session.scalar(select(ContentImage).where(ContentImage.id == image_id))
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    image.focal_x = int(payload.focal_x)
    image.focal_y = int(payload.focal_y)
    session.add(image)
    await session.commit()

    tags = (
        await session.execute(select(ContentImageTag.tag).where(ContentImageTag.content_image_id == image_id))
    ).scalars().all()
    tags_sorted = sorted(set(tags))

    content_key = ""
    if getattr(image, "content_block_id", None):
        content_key = (await session.scalar(select(ContentBlock.key).where(ContentBlock.id == image.content_block_id))) or ""

    return ContentImageAssetRead(
        id=image.id,
        root_image_id=getattr(image, "root_image_id", None),
        source_image_id=getattr(image, "source_image_id", None),
        url=image.url,
        alt_text=image.alt_text,
        sort_order=image.sort_order,
        focal_x=getattr(image, "focal_x", 50),
        focal_y=getattr(image, "focal_y", 50),
        created_at=image.created_at,
        content_key=content_key,
        tags=tags_sorted,
    )


@router.post("/admin/assets/images/{image_id}/edit", response_model=ContentImageAssetRead, status_code=status.HTTP_201_CREATED)
async def admin_edit_content_image(
    image_id: UUID,
    payload: ContentImageEditRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentImageAssetRead:
    image = await session.scalar(select(ContentImage).where(ContentImage.id == image_id))
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    edited = await content_service.edit_image_asset(session, image=image, payload=payload, actor_id=admin.id)

    tags = (
        await session.execute(select(ContentImageTag.tag).where(ContentImageTag.content_image_id == edited.id))
    ).scalars().all()
    tags_sorted = sorted(set(tags))

    content_key = ""
    if getattr(edited, "content_block_id", None):
        content_key = (await session.scalar(select(ContentBlock.key).where(ContentBlock.id == edited.content_block_id))) or ""

    return ContentImageAssetRead(
        id=edited.id,
        root_image_id=getattr(edited, "root_image_id", None),
        source_image_id=getattr(edited, "source_image_id", None),
        url=edited.url,
        alt_text=edited.alt_text,
        sort_order=edited.sort_order,
        focal_x=getattr(edited, "focal_x", 50),
        focal_y=getattr(edited, "focal_y", 50),
        created_at=edited.created_at,
        content_key=content_key,
        tags=tags_sorted,
    )


@router.get("/admin/assets/images/{image_id}/usage", response_model=ContentImageAssetUsageResponse)
async def admin_get_content_image_usage(
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentImageAssetUsageResponse:
    image = await session.scalar(select(ContentImage).where(ContentImage.id == image_id))
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    content_key = ""
    if getattr(image, "content_block_id", None):
        content_key = (await session.scalar(select(ContentBlock.key).where(ContentBlock.id == image.content_block_id))) or ""

    url = (getattr(image, "url", None) or "").strip()
    keys = await content_service.get_asset_usage_keys(session, url=url)

    return ContentImageAssetUsageResponse(
        image_id=image.id,
        url=url,
        stored_in_key=content_key or None,
        keys=keys,
    )


@router.delete("/admin/assets/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_content_image(
    image_id: UUID,
    delete_versions: bool = Query(default=False, description="Delete original and edited versions (if any)"),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> Response:
    image = await session.scalar(select(ContentImage).where(ContentImage.id == image_id))
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    await content_service.delete_image_asset(session, image=image, actor_id=admin.id, delete_versions=delete_versions)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/media/assets", response_model=MediaAssetListResponse)
async def admin_list_media_assets(
    q: str = Query(default=""),
    tag: str = Query(default=""),
    asset_type: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    visibility: str = Query(default=""),
    include_trashed: bool = Query(default=False),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=200),
    sort: str = Query(default="newest"),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaAssetListResponse:
    parsed_from, parsed_to = _parse_optional_datetime_range(created_from, created_to)
    rows, meta = await _list_media_assets_or_400(
        session,
        q=q,
        tag=tag,
        asset_type=asset_type,
        status_filter=status_filter,
        visibility=visibility,
        include_trashed=include_trashed,
        created_from=parsed_from,
        created_to=parsed_to,
        page=page,
        limit=limit,
        sort=sort,
    )
    return MediaAssetListResponse(items=[media_dam.asset_to_read(row) for row in rows], meta=meta)


@router.post("/admin/media/assets/upload", response_model=MediaAssetRead, status_code=status.HTTP_201_CREATED)
async def admin_upload_media_asset(
    file: UploadFile = File(...),
    visibility: str = Query(default="private"),
    auto_finalize: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaAssetRead:
    result = await media_dam.create_asset_from_upload(
        session,
        file=file,
        created_by_user_id=admin.id,
        visibility=media_dam.coerce_visibility(visibility),
    )
    if result.ingest_job_id and auto_finalize:
        try:
            job = await media_dam.get_job_or_404(session, result.ingest_job_id)
            await media_dam.process_job_inline(session, job)
            asset = await media_dam.get_asset_or_404(session, result.asset.id)
            return media_dam.asset_to_read(asset)
        except ValueError as exc:
            logger.debug(
                "content_media_auto_finalize_failed",
                extra={"asset_id": str(result.asset.id), "job_id": str(result.ingest_job_id)},
                exc_info=exc,
            )
    return result.asset


@router.post("/admin/media/assets/{asset_id}/finalize", response_model=MediaJobRead)
async def admin_finalize_media_asset(
    asset_id: UUID,
    payload: MediaFinalizeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    try:
        await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    queued_jobs = []

    ingest_job = await media_dam.enqueue_job(
        session,
        asset_id=asset_id,
        job_type=MediaJobType.ingest,
        payload={"reason": "manual_finalize"},
        created_by_user_id=admin.id,
    )
    queued_jobs.append(ingest_job)
    if payload.run_ai_tagging:
        ai_tag_job = await media_dam.enqueue_job(
            session,
            asset_id=asset_id,
            job_type=MediaJobType.ai_tag,
            payload={"reason": "finalize"},
            created_by_user_id=admin.id,
        )
        queued_jobs.append(ai_tag_job)
    if payload.run_duplicate_scan:
        duplicate_scan_job = await media_dam.enqueue_job(
            session,
            asset_id=asset_id,
            job_type=MediaJobType.duplicate_scan,
            payload={"reason": "finalize"},
            created_by_user_id=admin.id,
        )
        queued_jobs.append(duplicate_scan_job)
    await session.commit()
    for job in queued_jobs:
        await media_dam.queue_job(job.id)
    if media_dam.get_redis() is None:
        background_tasks.add_task(_run_media_job_in_background, ingest_job.id)
    return media_dam.job_to_read(ingest_job)


async def _run_media_job_in_background(job_id: UUID) -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        try:
            job = await media_dam.get_job_or_404(session, job_id)
            await media_dam.process_job_inline(session, job)
        except Exception as exc:
            logger.debug("content_media_background_job_failed", extra={"job_id": str(job_id)}, exc_info=exc)
            return


@router.patch("/admin/media/assets/{asset_id}", response_model=MediaAssetRead)
async def admin_update_media_asset(
    asset_id: UUID,
    payload: MediaAssetUpdateRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaAssetRead:
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    await media_dam.apply_asset_update(session, asset, payload)
    await session.commit()
    refreshed = await media_dam.get_asset_or_404(session, asset_id)
    return media_dam.asset_to_read(refreshed)


@router.post("/admin/media/assets/{asset_id}/approve", response_model=MediaAssetRead)
async def admin_approve_media_asset(
    asset_id: UUID,
    payload: MediaApproveRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaAssetRead:
    _require_owner_or_admin(admin, detail="Only owner/admin can approve assets")
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    updated = await media_dam.change_status(
        session,
        asset=asset,
        to_status=MediaAssetStatus.approved,
        actor_id=admin.id,
        note=payload.note,
        set_approved_actor=True,
    )
    return media_dam.asset_to_read(updated)


@router.post("/admin/media/assets/{asset_id}/reject", response_model=MediaAssetRead)
async def admin_reject_media_asset(
    asset_id: UUID,
    payload: MediaRejectRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaAssetRead:
    _require_owner_or_admin(admin, detail="Only owner/admin can reject assets")
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    updated = await media_dam.change_status(
        session,
        asset=asset,
        to_status=MediaAssetStatus.rejected,
        actor_id=admin.id,
        note=payload.note,
    )
    return media_dam.asset_to_read(updated)


@router.delete("/admin/media/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_soft_delete_media_asset(
    asset_id: UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> Response:
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    await media_dam.soft_delete_asset(session, asset, admin.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/media/assets/{asset_id}/restore", response_model=MediaAssetRead)
async def admin_restore_media_asset(
    asset_id: UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaAssetRead:
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    restored = await media_dam.restore_asset(session, asset, admin.id)
    return media_dam.asset_to_read(restored)


@router.post("/admin/media/assets/{asset_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
async def admin_purge_media_asset(
    asset_id: UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> Response:
    _require_owner_or_admin(admin, detail="Only owner/admin can purge assets")
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    await media_dam.purge_asset(session, asset)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/media/assets/{asset_id}/usage", response_model=MediaUsageResponse)
async def admin_media_asset_usage(
    asset_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaUsageResponse:
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return await media_dam.rebuild_usage_edges(session, asset)


@router.get("/admin/media/assets/{asset_id}/preview")
async def admin_media_asset_preview(
    asset_id: UUID,
    exp: int = Query(..., description="Unix expiry timestamp"),
    sig: str = Query(..., min_length=16, description="HMAC signature"),
    variant_profile: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> Response:
    try:
        asset = await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    if not media_dam.verify_preview_signature(asset.id, exp=exp, sig=sig, variant_profile=variant_profile):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid media preview signature")

    try:
        path = media_dam.resolve_asset_preview_path(asset, variant_profile=variant_profile)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file missing")

    return FileResponse(path, headers={"Cache-Control": "private, no-store"})


@router.post("/admin/media/assets/{asset_id}/variants", response_model=MediaJobRead)
async def admin_media_asset_variants(
    asset_id: UUID,
    payload: MediaVariantRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    try:
        await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    job = await media_dam.enqueue_job(
        session,
        asset_id=asset_id,
        job_type=MediaJobType.variant,
        payload={"profile": payload.profile},
        created_by_user_id=admin.id,
    )
    await session.commit()
    await media_dam.process_job_inline(session, job)
    return media_dam.job_to_read(job)


@router.post("/admin/media/assets/{asset_id}/edit", response_model=MediaJobRead)
async def admin_media_asset_edit(
    asset_id: UUID,
    payload: MediaEditRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    try:
        await media_dam.get_asset_or_404(session, asset_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    job = await media_dam.enqueue_job(
        session,
        asset_id=asset_id,
        job_type=MediaJobType.edit,
        payload=payload.model_dump(exclude_none=True),
        created_by_user_id=admin.id,
    )
    await session.commit()
    await media_dam.process_job_inline(session, job)
    return media_dam.job_to_read(job)


@router.get("/admin/media/jobs", response_model=MediaJobListResponse)
async def admin_list_media_jobs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=200),
    status_filter: str = Query(default="", alias="status"),
    job_type: str = Query(default=""),
    asset_id: UUID | None = Query(default=None),
    triage_state: str = Query(default=""),
    assigned_to_user_id: UUID | None = Query(default=None),
    tag: str = Query(default=""),
    sla_breached: bool = Query(default=False),
    dead_letter_only: bool = Query(default=False),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaJobListResponse:
    parsed_from, parsed_to = _parse_optional_datetime_range(created_from, created_to)
    rows, meta = await _list_media_jobs_or_400(
        session,
        page=page,
        limit=limit,
        status_filter=status_filter,
        job_type=job_type,
        asset_id=asset_id,
        triage_state=triage_state,
        assigned_to_user_id=assigned_to_user_id,
        tag=tag,
        sla_breached=sla_breached,
        dead_letter_only=dead_letter_only,
        created_from=parsed_from,
        created_to=parsed_to,
    )
    return MediaJobListResponse(items=[media_dam.job_to_read(row) for row in rows], meta=meta)


@router.get("/admin/media/telemetry", response_model=MediaTelemetryResponse)
async def admin_media_telemetry(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaTelemetryResponse:
    return await media_dam.get_telemetry(session)


@router.get("/admin/media/retry-policies", response_model=MediaRetryPolicyListResponse)
async def admin_media_retry_policies(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyListResponse:
    items = await media_dam.list_retry_policies(session)
    return MediaRetryPolicyListResponse(items=items)


@router.get("/admin/media/retry-policies/history", response_model=MediaRetryPolicyHistoryResponse)
async def admin_media_retry_policy_history(
    job_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyHistoryResponse:
    try:
        items, meta = await media_dam.list_retry_policy_history(
            session,
            job_type=job_type,
            page=page,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return MediaRetryPolicyHistoryResponse(items=items, meta=meta)


@router.get("/admin/media/retry-policies/{job_type}/presets", response_model=MediaRetryPolicyPresetsResponse)
async def admin_media_retry_policy_presets(
    job_type: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyPresetsResponse:
    try:
        return await media_dam.get_retry_policy_presets(session, job_type=job_type)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.patch("/admin/media/retry-policies/{job_type}", response_model=MediaRetryPolicyRead)
async def admin_update_media_retry_policy(
    job_type: str,
    payload: MediaRetryPolicyUpdateRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyRead:
    _require_owner_or_admin(admin, detail="Only owner/admin can update retry policies")
    try:
        return await media_dam.upsert_retry_policy(
            session,
            job_type=job_type,
            payload=payload,
            updated_by_user_id=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/admin/media/retry-policies/{job_type}/rollback", response_model=MediaRetryPolicyRead)
async def admin_rollback_media_retry_policy(
    job_type: str,
    payload: MediaRetryPolicyRollbackRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyRead:
    _require_owner_or_admin(admin, detail="Only owner/admin can rollback retry policies")
    try:
        return await media_dam.rollback_retry_policy(
            session,
            job_type=job_type,
            payload=payload,
            actor_user_id=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/admin/media/retry-policies/{job_type}/mark-known-good", response_model=MediaRetryPolicyEventRead)
async def admin_mark_media_retry_policy_known_good(
    job_type: str,
    note: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyEventRead:
    _require_owner_or_admin(admin, detail="Only owner/admin can update known-good retry policies")
    try:
        return await media_dam.mark_retry_policy_known_good(
            session,
            job_type=job_type,
            actor_user_id=admin.id,
            note=note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/admin/media/retry-policies/{job_type}/reset", response_model=MediaRetryPolicyRead)
async def admin_reset_media_retry_policy(
    job_type: str,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyRead:
    _require_owner_or_admin(admin, detail="Only owner/admin can reset retry policies")
    try:
        return await media_dam.reset_retry_policy(session, job_type=job_type, updated_by_user_id=admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/admin/media/retry-policies/reset-all", response_model=MediaRetryPolicyListResponse)
async def admin_reset_all_media_retry_policies(
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaRetryPolicyListResponse:
    _require_owner_or_admin(admin, detail="Only owner/admin can reset retry policies")
    items = await media_dam.reset_all_retry_policies(session, updated_by_user_id=admin.id)
    return MediaRetryPolicyListResponse(items=items)


@router.post("/admin/media/usage/reconcile", response_model=MediaJobRead)
async def admin_media_usage_reconcile(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    limit = max(1, int(getattr(settings, "media_usage_reconcile_batch_size", 200) or 200))
    job = await media_dam.enqueue_job(
        session,
        asset_id=None,
        job_type=MediaJobType.usage_reconcile,
        payload={"limit": limit, "reason": "manual_reconcile"},
        created_by_user_id=admin.id,
    )
    await session.commit()
    await media_dam.queue_job(job.id)
    if media_dam.get_redis() is None:
        background_tasks.add_task(_run_media_job_in_background, job.id)
    return media_dam.job_to_read(job)


@router.get("/admin/media/jobs/{job_id}", response_model=MediaJobRead)
async def admin_get_media_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    try:
        job = await media_dam.get_job_or_404(session, job_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return media_dam.job_to_read(job)


@router.post("/admin/media/jobs/{job_id}/retry", response_model=MediaJobRead)
async def admin_retry_media_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    try:
        job = await media_dam.get_job_or_404(session, job_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    retried = await media_dam.manual_retry_job(session, job=job, actor_user_id=admin.id)
    return media_dam.job_to_read(retried)


@router.post("/admin/media/jobs/retry-bulk", response_model=MediaJobListResponse)
async def admin_retry_media_jobs_bulk(
    payload: MediaJobRetryBulkRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobListResponse:
    rows = await media_dam.bulk_retry_jobs(session, job_ids=payload.job_ids, actor_user_id=admin.id)
    return MediaJobListResponse(
        items=[media_dam.job_to_read(row) for row in rows],
        meta={"total_items": len(rows), "total_pages": 1, "page": 1, "limit": len(rows)},
    )


@router.patch("/admin/media/jobs/{job_id}/triage", response_model=MediaJobRead)
async def admin_update_media_job_triage(
    job_id: UUID,
    payload: MediaJobTriageUpdateRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaJobRead:
    try:
        job = await media_dam.get_job_or_404(session, job_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    updated = await media_dam.update_job_triage(
        session,
        job=job,
        actor_user_id=admin.id,
        triage_state=payload.triage_state,
        assigned_to_user_id=payload.assigned_to_user_id,
        clear_assignee=payload.clear_assignee,
        sla_due_at=payload.sla_due_at,
        clear_sla_due_at=payload.clear_sla_due_at,
        incident_url=payload.incident_url,
        clear_incident_url=payload.clear_incident_url,
        add_tags=payload.add_tags,
        remove_tags=payload.remove_tags,
        note=payload.note,
    )
    return media_dam.job_to_read(updated)


@router.get("/admin/media/jobs/{job_id}/events", response_model=MediaJobEventsResponse)
async def admin_list_media_job_events(
    job_id: UUID,
    limit: int = Query(default=200, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> MediaJobEventsResponse:
    try:
        await media_dam.get_job_or_404(session, job_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    rows = await media_dam.list_job_events(session, job_id=job_id, limit=limit)
    return MediaJobEventsResponse(items=[media_dam.job_event_to_read(row) for row in rows])


@router.get("/admin/media/collections", response_model=list[MediaCollectionRead])
async def admin_list_media_collections(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> list[MediaCollectionRead]:
    return await media_dam.list_collections(session)


@router.post("/admin/media/collections", response_model=MediaCollectionRead, status_code=status.HTTP_201_CREATED)
async def admin_create_media_collection(
    payload: MediaCollectionUpsertRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaCollectionRead:
    return await media_dam.upsert_collection(session, collection_id=None, payload=payload, actor_id=admin.id)


@router.patch("/admin/media/collections/{collection_id}", response_model=MediaCollectionRead)
async def admin_update_media_collection(
    collection_id: UUID,
    payload: MediaCollectionUpsertRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> MediaCollectionRead:
    return await media_dam.upsert_collection(session, collection_id=collection_id, payload=payload, actor_id=admin.id)


@router.post("/admin/media/collections/{collection_id}/items", status_code=status.HTTP_204_NO_CONTENT)
async def admin_update_media_collection_items(
    collection_id: UUID,
    payload: MediaCollectionItemsRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> Response:
    await media_dam.replace_collection_items(session, collection_id=collection_id, asset_ids=payload.asset_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/tools/link-check", response_model=ContentLinkCheckResponse)
async def admin_link_check(
    key: str = Query(..., description="Content key to check"),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentLinkCheckResponse:
    issues = await content_service.check_content_links(session, key=key)
    return ContentLinkCheckResponse(issues=issues)


@router.post("/admin/tools/link-check/preview", response_model=ContentLinkCheckResponse)
async def admin_link_check_preview(
    payload: ContentLinkCheckPreviewRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentLinkCheckResponse:
    issues = await content_service.check_content_links_preview(
        session,
        key=payload.key,
        body_markdown=payload.body_markdown,
        meta=payload.meta,
        images=payload.images,
    )
    return ContentLinkCheckResponse(issues=issues)


@router.post("/admin/tools/find-replace/preview", response_model=ContentFindReplacePreviewResponse)
async def admin_find_replace_preview(
    payload: ContentFindReplacePreviewRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentFindReplacePreviewResponse:
    items, total_items, total_matches, truncated = await content_service.preview_find_replace(
        session,
        find=payload.find,
        replace=payload.replace,
        key_prefix=payload.key_prefix,
        case_sensitive=payload.case_sensitive,
        limit=payload.limit,
    )
    return ContentFindReplacePreviewResponse(
        items=items,
        total_items=total_items,
        total_matches=total_matches,
        truncated=truncated,
    )


@router.post("/admin/tools/find-replace/apply", response_model=ContentFindReplaceApplyResponse)
async def admin_find_replace_apply(
    payload: ContentFindReplaceApplyRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentFindReplaceApplyResponse:
    updated_blocks, updated_translations, total_replacements, errors = await content_service.apply_find_replace(
        session,
        find=payload.find,
        replace=payload.replace,
        key_prefix=payload.key_prefix,
        case_sensitive=payload.case_sensitive,
        actor_id=admin.id,
    )
    return ContentFindReplaceApplyResponse(
        updated_blocks=updated_blocks,
        updated_translations=updated_translations,
        total_replacements=total_replacements,
        errors=errors,
    )


@router.get("/admin/pages/list", response_model=list[ContentPageListItem])
async def admin_list_pages(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> list[ContentPageListItem]:
    result = await session.execute(select(ContentBlock).where(ContentBlock.key.like("page.%")).order_by(ContentBlock.key))
    items: list[ContentPageListItem] = []
    for block in result.scalars().all():
        slug = block.key.split(".", 1)[1] if "." in block.key else block.key
        meta = block.meta or {}
        hidden = bool(meta.get("hidden")) if isinstance(meta, dict) else False
        items.append(
            ContentPageListItem(
                key=block.key,
                slug=slug,
                title=block.title,
                status=block.status,
                hidden=hidden,
                updated_at=block.updated_at,
                published_at=block.published_at,
                published_until=block.published_until,
                needs_translation_en=getattr(block, "needs_translation_en", False),
                needs_translation_ro=getattr(block, "needs_translation_ro", False),
            )
        )
    return items


@router.patch("/admin/{key}/translation-status", response_model=ContentBlockRead)
async def admin_update_translation_status(
    key: str,
    payload: ContentTranslationStatusUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentBlockRead:
    block = await content_service.set_translation_status(session, key=key, payload=payload, actor_id=admin.id)
    return block


@router.post("/admin/pages/{slug}/rename", response_model=ContentPageRenameResponse)
async def admin_rename_page(
    slug: str,
    payload: ContentPageRenameRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentPageRenameResponse:
    old_slug, new_slug, old_key, new_key = await content_service.rename_page_slug(
        session,
        old_slug=slug,
        new_slug=payload.new_slug,
        actor_id=admin.id,
    )
    return ContentPageRenameResponse(old_slug=old_slug, new_slug=new_slug, old_key=old_key, new_key=new_key)


@router.get("/admin/{key}/preview", response_model=ContentBlockRead)
async def admin_preview_content(
    key: str,
    token: str = Query(default="", description="Preview token"),
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ContentBlockRead:
    if token != settings.content_preview_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid preview token")
    block = await content_service.get_block_by_key(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


@router.get("/admin/{key}/audit", response_model=list[ContentAuditRead])
async def admin_list_content_audit(
    key: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> list[ContentAuditRead]:
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block.audits


@router.get("/admin/{key}/versions", response_model=list[ContentBlockVersionListItem])
async def admin_list_content_versions(
    key: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> list[ContentBlockVersionListItem]:
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    result = await session.execute(
        select(ContentBlockVersion)
        .where(ContentBlockVersion.content_block_id == block.id)
        .order_by(ContentBlockVersion.version.desc())
    )
    return list(result.scalars().all())


@router.get("/admin/{key}/versions/{version}", response_model=ContentBlockVersionRead)
async def admin_get_content_version(
    key: str,
    version: int,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentBlockVersionRead:
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    result = await session.execute(
        select(ContentBlockVersion).where(
            ContentBlockVersion.content_block_id == block.id, ContentBlockVersion.version == version
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return row


@router.post("/admin/{key}/versions/{version}/rollback", response_model=ContentBlockRead)
async def admin_rollback_content_version(
    key: str,
    version: int,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("content")),
) -> ContentBlockRead:
    return await content_service.rollback_to_version(session, key=key, version=version, actor_id=admin.id)
