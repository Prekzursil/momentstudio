from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import re

from app.models.content import ContentBlock, ContentBlockVersion, ContentStatus, ContentImage
from app.schemas.content import ContentBlockCreate, ContentBlockUpdate
from app.services import storage


async def get_published_by_key(session: AsyncSession, key: str) -> ContentBlock | None:
    result = await session.execute(
        select(ContentBlock).where(ContentBlock.key == key, ContentBlock.status == ContentStatus.published)
    )
    return result.scalar_one_or_none()


async def get_block_by_key(session: AsyncSession, key: str) -> ContentBlock | None:
    result = await session.execute(select(ContentBlock).where(ContentBlock.key == key))
    return result.scalar_one_or_none()


async def upsert_block(session: AsyncSession, key: str, payload: ContentBlockUpdate | ContentBlockCreate) -> ContentBlock:
    block = await get_block_by_key(session, key)
    now = datetime.now(timezone.utc)
    data = payload.model_dump(exclude_unset=True)
    if "body_markdown" in data and data["body_markdown"] is not None:
        _sanitize_markdown(data["body_markdown"])
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
        session.add(version_row)
        await session.commit()
        await session.refresh(block)
        return block

    if not data:
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
    session.add(block)
    version_row = ContentBlockVersion(
        content_block_id=block.id,
        version=block.version,
        title=block.title,
        body_markdown=block.body_markdown,
        status=block.status,
    )
    session.add(version_row)
    await session.commit()
    await session.refresh(block)
    return block


async def add_image(session: AsyncSession, block: ContentBlock, file) -> ContentBlock:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")
    path, filename = storage.save_upload(file)
    next_sort = (max([img.sort_order for img in block.images], default=0) or 0) + 1
    image = ContentImage(content_block_id=block.id, url=path, alt_text=filename, sort_order=next_sort)
    session.add(image)
    await session.commit()
    await session.refresh(block, attribute_names=["images"])
    return block


def _sanitize_markdown(body: str) -> None:
    lower = body.lower()
    forbidden = ["<script", "<iframe", "<object", "<embed", "javascript:"]
    if any(tok in lower for tok in forbidden):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed markup")
    if re.search(r"on\w+=", lower):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed event handlers")
