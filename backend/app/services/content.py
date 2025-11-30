from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.content import ContentBlock, ContentBlockVersion, ContentStatus
from app.schemas.content import ContentBlockCreate, ContentBlockUpdate


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
    if not block:
        data = payload.model_dump()
        block = ContentBlock(
            key=key,
            title=data.get("title") or "",
            body_markdown=data.get("body_markdown") or "",
            status=data.get("status") or ContentStatus.draft,
            version=1,
            published_at=now if data.get("status") == ContentStatus.published else None,
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

    data = payload.model_dump(exclude_unset=True)
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
