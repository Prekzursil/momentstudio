from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.blog import BlogComment, BlogCommentFlag
from app.models.content import ContentBlock, ContentStatus
from app.models.user import User, UserRole


BLOG_KEY_PREFIX = "blog."

_MD_CODE_FENCE_RE = re.compile(r"```.*?```", flags=re.DOTALL)
_MD_INLINE_CODE_RE = re.compile(r"`[^`]*`")
_MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_STRIP_PREFIX_RE = re.compile(r"(^|\n)(#{1,6}\s*|>\\s*|[-*]\\s+)")
_MD_MULTI_SPACE_RE = re.compile(r"\s+")


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


def _plain_text_from_markdown(body: str) -> str:
    text = body or ""
    text = _MD_CODE_FENCE_RE.sub(" ", text)
    text = _MD_INLINE_CODE_RE.sub(" ", text)
    text = _MD_IMAGE_RE.sub(r"\\1", text)
    text = _MD_LINK_RE.sub(r"\\1", text)
    text = _MD_STRIP_PREFIX_RE.sub(r"\\1", text)
    text = _MD_MULTI_SPACE_RE.sub(" ", text).strip()
    return text


def _excerpt(body: str, max_len: int = 180) -> str:
    cleaned = " ".join((body or "").split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _normalize_tags(raw: object) -> list[str]:
    if raw is None:
        return []
    values: list[str]
    if isinstance(raw, list):
        values = [str(v).strip() for v in raw]
    elif isinstance(raw, str):
        values = [v.strip() for v in raw.split(",")]
    else:
        return []

    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def _coerce_positive_int(raw: object) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    if isinstance(raw, str):
        stripped = raw.strip()
        if stripped.isdigit():
            value = int(stripped)
            return value if value > 0 else None
    return None


def _compute_reading_time_minutes(body: str) -> int | None:
    text = _plain_text_from_markdown(body)
    words = len([w for w in text.split(" ") if w])
    if words == 0:
        return None
    return max(1, math.ceil(words / 200))


def _meta_cover_image_url(meta: dict | None) -> str | None:
    if not meta:
        return None
    for key in ("cover_image_url", "cover_image"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _meta_summary(meta: dict | None, *, lang: str | None, base_lang: str | None) -> str | None:
    if not meta:
        return None
    value = meta.get("summary")
    if isinstance(value, dict):
        if lang:
            tr = value.get(lang)
            if isinstance(tr, str) and tr.strip():
                return tr.strip()
        return None
    if isinstance(value, str) and value.strip():
        if lang and base_lang and lang != base_lang:
            return None
        return value.strip()
    return None


async def list_published_posts(
    session: AsyncSession,
    *,
    lang: str | None,
    page: int,
    limit: int,
    q: str | None = None,
    tag: str | None = None,
) -> tuple[list[ContentBlock], int]:
    now = datetime.now(timezone.utc)
    page = max(1, page)
    limit = max(1, min(limit, 50))

    filters = (
        ContentBlock.key.like(f"{BLOG_KEY_PREFIX}%"),
        ContentBlock.status == ContentStatus.published,
        or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
    )
    query_text = (q or "").strip().lower()
    tag_text = (tag or "").strip().lower()

    if not query_text and not tag_text:
        offset = (page - 1) * limit
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

    query = (
        select(ContentBlock)
        .options(selectinload(ContentBlock.images))
        .where(*filters)
        .order_by(ContentBlock.published_at.desc().nullslast(), ContentBlock.updated_at.desc())
    )
    if lang:
        query = query.options(selectinload(ContentBlock.translations))

    result = await session.execute(query)
    blocks = list(result.scalars().unique())
    for block in blocks:
        _apply_translation(block, lang)

    if query_text or tag_text:
        filtered: list[ContentBlock] = []
        for block in blocks:
            meta = getattr(block, "meta", None) or {}
            if tag_text:
                tags = _normalize_tags(meta.get("tags"))
                if tag_text not in {t.lower() for t in tags}:
                    continue
            if query_text:
                haystack = f"{block.title}\n{_plain_text_from_markdown(block.body_markdown)}".lower()
                if query_text not in haystack:
                    continue
            filtered.append(block)
        blocks = filtered

    total = len(blocks)
    offset = (page - 1) * limit
    page_items = blocks[offset : offset + limit]
    return page_items, total


async def get_published_post(
    session: AsyncSession,
    *,
    slug: str,
    lang: str | None,
) -> ContentBlock | None:
    now = datetime.now(timezone.utc)
    key = f"{BLOG_KEY_PREFIX}{slug}"
    query = (
        select(ContentBlock)
        .options(selectinload(ContentBlock.images))
        .where(
            ContentBlock.key == key,
            ContentBlock.status == ContentStatus.published,
            or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
        )
    )
    if lang:
        query = query.options(selectinload(ContentBlock.translations))
    result = await session.execute(query)
    block = result.scalar_one_or_none()
    if block:
        _apply_translation(block, lang)
    return block


def to_list_item(block: ContentBlock, *, lang: str | None = None) -> dict:
    meta = getattr(block, "meta", None) or {}
    cover = _meta_cover_image_url(meta)
    if not cover and getattr(block, "images", None):
        first = sorted(block.images, key=lambda img: img.sort_order)[0] if block.images else None
        cover = first.url if first else None

    override_minutes = _coerce_positive_int(meta.get("reading_time_minutes") or meta.get("reading_time"))
    reading_time_minutes = override_minutes or _compute_reading_time_minutes(block.body_markdown)
    summary = _meta_summary(meta, lang=lang, base_lang=getattr(block, "lang", None))
    excerpt = summary or _excerpt(_plain_text_from_markdown(block.body_markdown))
    return {
        "slug": _extract_slug(block.key),
        "title": block.title,
        "excerpt": excerpt,
        "published_at": block.published_at,
        "cover_image_url": cover,
        "tags": _normalize_tags(meta.get("tags")),
        "reading_time_minutes": reading_time_minutes,
    }


def to_read(block: ContentBlock, *, lang: str | None = None) -> dict:
    images = sorted(getattr(block, "images", []) or [], key=lambda img: img.sort_order)
    meta = getattr(block, "meta", None) or {}
    cover = _meta_cover_image_url(meta) or (images[0].url if images else None)
    override_minutes = _coerce_positive_int(meta.get("reading_time_minutes") or meta.get("reading_time"))
    reading_time_minutes = override_minutes or _compute_reading_time_minutes(block.body_markdown)
    summary = _meta_summary(meta, lang=lang, base_lang=getattr(block, "lang", None))
    return {
        "slug": _extract_slug(block.key),
        "title": block.title,
        "body_markdown": block.body_markdown,
        "published_at": block.published_at,
        "created_at": block.created_at,
        "updated_at": block.updated_at,
        "images": images,
        "meta": block.meta,
        "summary": summary,
        "cover_image_url": cover,
        "tags": _normalize_tags(meta.get("tags")),
        "reading_time_minutes": reading_time_minutes,
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
        "body": "" if comment.is_deleted or comment.is_hidden else comment.body,
        "is_deleted": comment.is_deleted,
        "is_hidden": comment.is_hidden,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "deleted_at": comment.deleted_at,
        "hidden_at": comment.hidden_at,
        "author": {
            "id": author.id if author else comment.user_id,
            "name": author.name if author else None,
            "avatar_url": (author.avatar_url or author.google_picture_url) if author else None,
        }
    }


def to_flag_read(flag: BlogCommentFlag) -> dict:
    return {
        "id": flag.id,
        "user_id": flag.user_id,
        "reason": flag.reason,
        "created_at": flag.created_at,
    }


def to_comment_admin_read(
    comment: BlogComment,
    *,
    post_key: str,
    flags: list[BlogCommentFlag] | None = None,
    flag_count: int = 0,
) -> dict:
    author = comment.author
    return {
        "id": comment.id,
        "content_block_id": comment.content_block_id,
        "post_slug": _extract_slug(post_key),
        "parent_id": comment.parent_id,
        "body": "" if comment.is_deleted else comment.body,
        "is_deleted": comment.is_deleted,
        "deleted_at": comment.deleted_at,
        "deleted_by": comment.deleted_by,
        "is_hidden": comment.is_hidden,
        "hidden_at": comment.hidden_at,
        "hidden_by": comment.hidden_by,
        "hidden_reason": comment.hidden_reason,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "author": {
            "id": author.id if author else comment.user_id,
            "name": author.name if author else None,
            "avatar_url": (author.avatar_url or author.google_picture_url) if author else None,
        },
        "flag_count": int(flag_count or 0),
        "flags": [to_flag_read(f) for f in (flags or [])],
    }


async def flag_comment(
    session: AsyncSession,
    *,
    comment_id: UUID,
    actor: User,
    reason: str | None = None,
) -> BlogCommentFlag:
    comment = await session.get(BlogComment, comment_id)
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot flag your own comment")

    existing = await session.scalar(
        select(BlogCommentFlag).where(BlogCommentFlag.comment_id == comment_id, BlogCommentFlag.user_id == actor.id)
    )
    if existing:
        return existing

    cleaned_reason = (reason or "").strip() or None
    flag = BlogCommentFlag(comment_id=comment_id, user_id=actor.id, reason=cleaned_reason)
    session.add(flag)
    await session.commit()
    await session.refresh(flag)
    return flag


async def list_flagged_comments(
    session: AsyncSession,
    *,
    page: int,
    limit: int,
) -> tuple[list[dict], int]:
    page = max(1, page)
    limit = max(1, min(limit, 50))
    offset = (page - 1) * limit

    summary = (
        select(
            BlogCommentFlag.comment_id.label("comment_id"),
            func.count().label("flag_count"),
            func.max(BlogCommentFlag.created_at).label("last_flagged_at"),
        )
        .where(BlogCommentFlag.resolved_at.is_(None))
        .group_by(BlogCommentFlag.comment_id)
        .subquery()
    )

    total = await session.scalar(select(func.count()).select_from(summary))
    rows = await session.execute(
        select(BlogComment, ContentBlock.key, summary.c.flag_count)
        .join(summary, summary.c.comment_id == BlogComment.id)
        .join(ContentBlock, ContentBlock.id == BlogComment.content_block_id)
        .options(selectinload(BlogComment.author))
        .order_by(summary.c.last_flagged_at.desc().nullslast())
        .limit(limit)
        .offset(offset)
    )
    items = list(rows.all())
    if not items:
        return [], int(total or 0)

    comment_ids = [c.id for c, _, _ in items]
    flag_rows = await session.execute(
        select(BlogCommentFlag)
        .where(BlogCommentFlag.comment_id.in_(comment_ids), BlogCommentFlag.resolved_at.is_(None))
        .order_by(BlogCommentFlag.created_at.desc())
    )
    flags_by_comment: dict[UUID, list[BlogCommentFlag]] = {}
    for flag in flag_rows.scalars().all():
        flags_by_comment.setdefault(flag.comment_id, []).append(flag)

    out: list[dict] = []
    for comment, post_key, flag_count in items:
        out.append(
            to_comment_admin_read(
                comment,
                post_key=str(post_key),
                flag_count=int(flag_count or 0),
                flags=flags_by_comment.get(comment.id, []),
            )
        )
    return out, int(total or 0)


async def set_comment_hidden(
    session: AsyncSession,
    *,
    comment_id: UUID,
    actor: User,
    hidden: bool,
    reason: str | None = None,
) -> BlogComment:
    if actor.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    comment = await session.get(BlogComment, comment_id)
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    if hidden:
        comment.is_hidden = True
        comment.hidden_at = datetime.now(timezone.utc)
        comment.hidden_by = actor.id
        comment.hidden_reason = (reason or "").strip() or None
    else:
        comment.is_hidden = False
        comment.hidden_at = None
        comment.hidden_by = None
        comment.hidden_reason = None

    session.add(comment)
    await session.execute(
        update(BlogCommentFlag)
        .where(BlogCommentFlag.comment_id == comment_id, BlogCommentFlag.resolved_at.is_(None))
        .values(resolved_at=datetime.now(timezone.utc), resolved_by=actor.id)
    )
    await session.commit()
    loaded = await session.execute(
        select(BlogComment).options(selectinload(BlogComment.author)).where(BlogComment.id == comment_id)
    )
    return loaded.scalar_one()


async def resolve_comment_flags(session: AsyncSession, *, comment_id: UUID, actor: User) -> int:
    if actor.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(BlogCommentFlag)
        .where(BlogCommentFlag.comment_id == comment_id, BlogCommentFlag.resolved_at.is_(None))
        .values(resolved_at=now, resolved_by=actor.id)
    )
    await session.commit()
    return int(result.rowcount or 0)
