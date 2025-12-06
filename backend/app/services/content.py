from datetime import datetime, timezone
from uuid import UUID
import re

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.content import (
    ContentAuditLog,
    ContentBlock,
    ContentBlockVersion,
    ContentBlockTranslation,
    ContentImage,
    ContentStatus,
)
from app.schemas.content import ContentBlockCreate, ContentBlockUpdate
from app.services import storage


def _apply_content_translation(block: ContentBlock, lang: str | None) -> None:
    if not lang or not getattr(block, "translations", None):
        return
    match = next((t for t in block.translations if t.lang == lang), None)
    if match:
        block.title = match.title
        block.body_markdown = match.body_markdown


async def get_published_by_key(session: AsyncSession, key: str, lang: str | None = None) -> ContentBlock | None:
    options = [
        selectinload(ContentBlock.images),
        selectinload(ContentBlock.audits),
    ]
    if lang:
        options.append(selectinload(ContentBlock.translations))
    result = await session.execute(
        select(ContentBlock).options(*options).where(ContentBlock.key == key, ContentBlock.status == ContentStatus.published)
    )
    block = result.scalar_one_or_none()
    if block:
        _apply_content_translation(block, lang)
    return block


async def get_block_by_key(session: AsyncSession, key: str, lang: str | None = None) -> ContentBlock | None:
    options = [
        selectinload(ContentBlock.images),
        selectinload(ContentBlock.audits),
    ]
    if lang:
        options.append(selectinload(ContentBlock.translations))
    result = await session.execute(select(ContentBlock).options(*options).where(ContentBlock.key == key))
    block = result.scalar_one_or_none()
    if block:
        _apply_content_translation(block, lang)
    return block


async def upsert_block(
    session: AsyncSession, key: str, payload: ContentBlockUpdate | ContentBlockCreate, actor_id: UUID | None = None
) -> ContentBlock:
    block = await get_block_by_key(session, key)
    now = datetime.now(timezone.utc)
    data = payload.model_dump(exclude_unset=True)
    if "body_markdown" in data and data["body_markdown"] is not None:
        _sanitize_markdown(data["body_markdown"])
    lang = data.get("lang")
    if not block:
        block = ContentBlock(
            key=key,
            title=data.get("title") or "",
            body_markdown=data.get("body_markdown") or "",
            status=data.get("status") or ContentStatus.draft,
            version=1,
            published_at=now if data.get("status") == ContentStatus.published else None,
            meta=data.get("meta"),
            sort_order=data.get("sort_order", 0),
            lang=lang,
        )
        session.add(block)
        await session.flush()
        version_row = ContentBlockVersion(
            content_block_id=block.id,
            version=block.version,
            title=block.title,
            body_markdown=block.body_markdown,
            status=block.status,
        )
        audit = ContentAuditLog(content_block_id=block.id, action="created", version=block.version, user_id=actor_id)
        session.add_all([version_row, audit])
        await session.commit()
        await session.refresh(block)
        return block

    if not data:
        return block
    # If lang is provided, upsert translation instead of touching the base content
    if lang:
        await session.refresh(block, attribute_names=["translations"])
        translation = next((t for t in block.translations if t.lang == lang), None)
        if translation:
            if "title" in data and data["title"] is not None:
                translation.title = data["title"]
            if "body_markdown" in data and data["body_markdown"] is not None:
                translation.body_markdown = data["body_markdown"]
        else:
            translation = ContentBlockTranslation(
                content_block_id=block.id,
                lang=lang,
                title=data.get("title") or block.title,
                body_markdown=data.get("body_markdown") or block.body_markdown,
            )
            session.add(translation)
        audit = ContentAuditLog(content_block_id=block.id, action=f"translated:{lang}", version=block.version, user_id=actor_id)
        session.add(audit)
        await session.commit()
        await session.refresh(block)
        _apply_content_translation(block, lang)
        return block

    block.version += 1
    if "title" in data:
        block.title = data["title"] or block.title
    if "body_markdown" in data and data["body_markdown"] is not None:
        block.body_markdown = data["body_markdown"]
    if "status" in data and data["status"] is not None:
        block.status = data["status"]
        if block.status == ContentStatus.published:
            block.published_at = now
    if "meta" in data:
        block.meta = data["meta"]
    if "sort_order" in data and data["sort_order"] is not None:
        block.sort_order = data["sort_order"]
    if "lang" in data and data["lang"] is not None:
        block.lang = data["lang"]
    session.add(block)
    version_row = ContentBlockVersion(
        content_block_id=block.id,
        version=block.version,
        title=block.title,
        body_markdown=block.body_markdown,
        status=block.status,
    )
    audit = ContentAuditLog(content_block_id=block.id, action="updated", version=block.version, user_id=actor_id)
    session.add_all([version_row, audit])
    await session.commit()
    await session.refresh(block)
    return block


async def add_image(session: AsyncSession, block: ContentBlock, file, actor_id: UUID | None = None) -> ContentBlock:
    path, filename = storage.save_upload(
        file, allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif"), max_bytes=5 * 1024 * 1024
    )
    next_sort = (max([img.sort_order for img in block.images], default=0) or 0) + 1
    image = ContentImage(content_block_id=block.id, url=path, alt_text=filename, sort_order=next_sort)
    audit = ContentAuditLog(content_block_id=block.id, action="image_upload", version=block.version, user_id=actor_id)
    session.add_all([image, audit])
    await session.commit()
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


def _sanitize_markdown(body: str) -> None:
    lower = body.lower()
    forbidden = ["<script", "<iframe", "<object", "<embed", "javascript:"]
    if any(tok in lower for tok in forbidden):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed markup")
    if re.search(r"on\w+=", lower):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed event handlers")
