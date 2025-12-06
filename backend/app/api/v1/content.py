from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_session, require_admin
from app.schemas.content import (
    ContentAuditRead,
    ContentBlockCreate,
    ContentBlockRead,
    ContentBlockUpdate,
)
from app.services import content as content_service

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    block = await content_service.add_image(session, block, file, actor_id=admin.id)
    return block


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
