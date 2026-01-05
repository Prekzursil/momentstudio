from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.blog import BlogComment
from app.models.content import ContentBlock, ContentStatus
from app.models.user import User, UserRole


BLOG_KEY_PREFIX = "blog."


def _extract_slug(key: str) -> str:
    if not key.startswith(BLOG_KEY_PREFIX):
        return key
    return key[len(BLOG_KEY_PREFIX) :]


def _apply_translation(block: ContentBlock, lang: str | None) -> None:
    if not lang or not getattr(block, "translations", None):
        return
    match = next((t for t in block.translations if t.lang == lang), None)
    if match:
        block.title = match.title
        block.body_markdown = match.body_markdown


def _excerpt(body: str, max_len: int = 180) -> str:
    cleaned = " ".join((body or "").split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


async def list_published_posts(
    session: AsyncSession,
    *,
    lang: str | None,
    page: int,
    limit: int,
) -> tuple[list[ContentBlock], int]:
    page = max(1, page)
    limit = max(1, min(limit, 50))
    offset = (page - 1) * limit

    filters = (ContentBlock.key.like(f"{BLOG_KEY_PREFIX}%"), ContentBlock.status == ContentStatus.published)

    total = await session.scalar(select(func.count()).select_from(ContentBlock).where(*filters))
    query = (
        select(ContentBlock)
        .options(selectinload(ContentBlock.images))
        .where(*filters)
        .order_by(ContentBlock.published_at.desc().nullslast(), ContentBlock.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if lang:
        query = query.options(selectinload(ContentBlock.translations))

    result = await session.execute(query)
    blocks = list(result.scalars().unique())
    for block in blocks:
        _apply_translation(block, lang)
    return blocks, int(total or 0)


async def get_published_post(
    session: AsyncSession,
    *,
    slug: str,
    lang: str | None,
) -> ContentBlock | None:
    key = f"{BLOG_KEY_PREFIX}{slug}"
    query = (
        select(ContentBlock)
        .options(selectinload(ContentBlock.images))
        .where(ContentBlock.key == key, ContentBlock.status == ContentStatus.published)
    )
    if lang:
        query = query.options(selectinload(ContentBlock.translations))
    result = await session.execute(query)
    block = result.scalar_one_or_none()
    if block:
        _apply_translation(block, lang)
    return block


def to_list_item(block: ContentBlock) -> dict:
    cover = None
    if getattr(block, "images", None):
        first = sorted(block.images, key=lambda img: img.sort_order)[0] if block.images else None
        cover = first.url if first else None
    return {
        "slug": _extract_slug(block.key),
        "title": block.title,
        "excerpt": _excerpt(block.body_markdown),
        "published_at": block.published_at,
        "cover_image_url": cover,
    }


def to_read(block: ContentBlock) -> dict:
    images = sorted(getattr(block, "images", []) or [], key=lambda img: img.sort_order)
    return {
        "slug": _extract_slug(block.key),
        "title": block.title,
        "body_markdown": block.body_markdown,
        "published_at": block.published_at,
        "created_at": block.created_at,
        "updated_at": block.updated_at,
        "images": images,
        "meta": block.meta,
    }


async def list_comments(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    page: int,
    limit: int,
) -> tuple[list[BlogComment], int]:
    page = max(1, page)
    limit = max(1, min(limit, 50))
    offset = (page - 1) * limit

    base = (
        select(BlogComment)
        .options(selectinload(BlogComment.author))
        .where(BlogComment.content_block_id == content_block_id)
    )
    total = await session.scalar(
        select(func.count()).select_from(BlogComment).where(BlogComment.content_block_id == content_block_id)
    )
    result = await session.execute(
        base.order_by(BlogComment.created_at.asc()).limit(limit).offset(offset)
    )
    items = list(result.scalars().unique())
    return items, int(total or 0)


async def create_comment(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    user: User,
    body: str,
    parent_id: UUID | None = None,
) -> BlogComment:
    body = (body or "").strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment body is required")

    parent = None
    if parent_id:
        parent = await session.get(BlogComment, parent_id)
        if not parent or parent.content_block_id != content_block_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent comment")

    comment = BlogComment(
        content_block_id=content_block_id,
        user_id=user.id,
        parent_id=parent.id if parent else None,
        body=body,
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment, attribute_names=["author"])
    return comment


async def soft_delete_comment(
    session: AsyncSession,
    *,
    comment_id: UUID,
    actor: User,
) -> None:
    comment = await session.get(BlogComment, comment_id)
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if actor.role != UserRole.admin and comment.user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    if comment.is_deleted:
        return
    comment.is_deleted = True
    comment.deleted_at = datetime.now(timezone.utc)
    comment.deleted_by = actor.id
    comment.body = ""
    session.add(comment)
    await session.commit()


def to_comment_read(comment: BlogComment) -> dict:
    author = comment.author
    return {
        "id": comment.id,
        "parent_id": comment.parent_id,
        "body": "" if comment.is_deleted else comment.body,
        "is_deleted": comment.is_deleted,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "deleted_at": comment.deleted_at,
        "author": {
            "id": author.id if author else comment.user_id,
            "name": author.name if author else None,
            "avatar_url": (author.avatar_url or author.google_picture_url) if author else None,
        }
    }
