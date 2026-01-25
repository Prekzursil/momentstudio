import httpx
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Query, Response
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_session, require_admin_section
from app.models.content import ContentBlock, ContentBlockVersion, ContentImage, ContentRedirect, ContentImageTag
from app.models.user import User
from app.schemas.content import (
    ContentAuditRead,
    ContentBlockCreate,
    ContentBlockRead,
    ContentBlockUpdate,
    ContentImageAssetListResponse,
    ContentImageAssetRead,
    ContentPageListItem,
    ContentPageRenameRequest,
    ContentPageRenameResponse,
    ContentRedirectListResponse,
    ContentRedirectRead,
    ContentBlockVersionListItem,
    ContentBlockVersionRead,
    ContentImageTagsUpdate,
    ContentLinkCheckResponse,
)
from app.schemas.social import SocialThumbnailRequest, SocialThumbnailResponse
from app.services import content as content_service
from app.services import social_thumbnails

router = APIRouter(prefix="/content", tags=["content"])


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


@router.get("/pages/{slug}", response_model=ContentBlockRead)
async def get_static_page(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ContentBlockRead:
    slug_value = content_service.slugify_page_slug(slug)
    if not slug_value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    key = f"page.{slug_value}"
    block = await content_service.get_published_by_key_following_redirects(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


@router.get("/{key}", response_model=ContentBlockRead)
async def get_content(
    key: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ContentBlockRead:
    block = await content_service.get_published_by_key_following_redirects(session, key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


@router.post("/admin/social/thumbnail", response_model=SocialThumbnailResponse)
async def admin_fetch_social_thumbnail(
    payload: SocialThumbnailRequest,
    _: User = Depends(require_admin_section("content")),
) -> SocialThumbnailResponse:
    try:
        thumbnail_url = await social_thumbnails.fetch_social_thumbnail_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not fetch thumbnail") from exc
    return SocialThumbnailResponse(thumbnail_url=thumbnail_url)


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

    items: list[ContentRedirectRead] = []
    for r in redirects:
        items.append(
            ContentRedirectRead(
                id=r.id,
                from_key=r.from_key,
                to_key=r.to_key,
                created_at=r.created_at,
                updated_at=r.updated_at,
                target_exists=r.to_key in existing_targets,
            )
        )

    return ContentRedirectListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
    )


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

    count_query = select(func.count()).select_from(ContentImage).join(ContentBlock)
    if tag_value:
        count_query = select(func.count(func.distinct(ContentImage.id))).select_from(ContentImage).join(ContentBlock).join(
            ContentImageTag
        )
    total = await session.scalar(count_query.where(*filters))
    total_items = int(total or 0)
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    offset = (page - 1) * limit

    query = (
        select(ContentImage, ContentBlock.key)
        .join(ContentBlock)
        .where(*filters)
        .order_by(ContentImage.created_at.desc(), ContentImage.id.desc())
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
                url=img.url,
                alt_text=img.alt_text,
                sort_order=img.sort_order,
                created_at=img.created_at,
                content_key=block_key,
                tags=tag_map.get(img.id, []),
            )
        )
    return ContentImageAssetListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
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
        url=image.url,
        alt_text=image.alt_text,
        sort_order=image.sort_order,
        created_at=image.created_at,
        content_key=content_key,
        tags=tags,
    )


@router.get("/admin/tools/link-check", response_model=ContentLinkCheckResponse)
async def admin_link_check(
    key: str = Query(..., description="Content key to check"),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
) -> ContentLinkCheckResponse:
    issues = await content_service.check_content_links(session, key=key)
    return ContentLinkCheckResponse(issues=issues)


@router.get("/admin/pages/list", response_model=list[ContentPageListItem])
async def admin_list_pages(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("content")),
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
                published_until=block.published_until,
            )
        )
    return items


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
