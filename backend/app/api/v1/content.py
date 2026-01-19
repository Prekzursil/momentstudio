import httpx
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_session, require_admin
from app.models.content import ContentBlock, ContentBlockVersion, ContentImage
from app.schemas.content import (
    ContentAuditRead,
    ContentBlockCreate,
    ContentBlockRead,
    ContentBlockUpdate,
    ContentImageAssetListResponse,
    ContentImageAssetRead,
    ContentPageListItem,
    ContentBlockVersionListItem,
    ContentBlockVersionRead,
)
from app.schemas.social import SocialThumbnailRequest, SocialThumbnailResponse
from app.services import content as content_service
from app.services import social_thumbnails

router = APIRouter(prefix="/content", tags=["content"])


@router.get("/pages/{slug}", response_model=ContentBlockRead)
async def get_static_page(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ContentBlockRead:
    key = f"page.{slug}"
    block = await content_service.get_published_by_key(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


@router.get("/{key}", response_model=ContentBlockRead)
async def get_content(
    key: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ContentBlockRead:
    block = await content_service.get_published_by_key(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


@router.post("/admin/social/thumbnail", response_model=SocialThumbnailResponse)
async def admin_fetch_social_thumbnail(
    payload: SocialThumbnailRequest,
    _: object = Depends(require_admin),
) -> SocialThumbnailResponse:
    try:
        thumbnail_url = await social_thumbnails.fetch_social_thumbnail_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not fetch thumbnail") from exc
    return SocialThumbnailResponse(thumbnail_url=thumbnail_url)


@router.get("/admin/{key}", response_model=ContentBlockRead)
async def admin_get_content(
    key: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    _: str = Depends(require_admin),
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
    admin=Depends(require_admin),
) -> ContentBlockRead:
    block = await content_service.upsert_block(session, key, payload, actor_id=admin.id)
    return block


@router.post("/admin/{key}", response_model=ContentBlockRead, status_code=status.HTTP_201_CREATED)
async def admin_create_content(
    key: str,
    payload: ContentBlockCreate,
    session: AsyncSession = Depends(get_session),
    admin=Depends(require_admin),
) -> ContentBlockRead:
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
    admin=Depends(require_admin),
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
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=100),
    _: str = Depends(require_admin),
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

    total = await session.scalar(select(func.count()).select_from(ContentImage).join(ContentBlock).where(*filters))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    offset = (page - 1) * limit

    result = await session.execute(
        select(ContentImage, ContentBlock.key)
        .join(ContentBlock)
        .where(*filters)
        .order_by(ContentImage.created_at.desc(), ContentImage.id.desc())
        .offset(offset)
        .limit(limit)
    )
    items: list[ContentImageAssetRead] = []
    for img, block_key in result.all():
        items.append(
            ContentImageAssetRead(
                id=img.id,
                url=img.url,
                alt_text=img.alt_text,
                sort_order=img.sort_order,
                created_at=img.created_at,
                content_key=block_key,
            )
        )
    return ContentImageAssetListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


@router.get("/admin/pages/list", response_model=list[ContentPageListItem])
async def admin_list_pages(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> list[ContentPageListItem]:
    result = await session.execute(select(ContentBlock).where(ContentBlock.key.like("page.%")).order_by(ContentBlock.key))
    items: list[ContentPageListItem] = []
    for block in result.scalars().all():
        slug = block.key.split(".", 1)[1] if "." in block.key else block.key
        items.append(
            ContentPageListItem(
                key=block.key,
                slug=slug,
                title=block.title,
                status=block.status,
                updated_at=block.updated_at,
                published_at=block.published_at,
            )
        )
    return items


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
    _: str = Depends(require_admin),
) -> list[ContentAuditRead]:
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block.audits


@router.get("/admin/{key}/versions", response_model=list[ContentBlockVersionListItem])
async def admin_list_content_versions(
    key: str,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
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
    _: str = Depends(require_admin),
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
    admin=Depends(require_admin),
) -> ContentBlockRead:
    return await content_service.rollback_to_version(session, key=key, version=version, actor_id=admin.id)
