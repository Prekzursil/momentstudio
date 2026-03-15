from __future__ import annotations

from collections.abc import Iterable
import math
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import settings
from app.models.blog import BlogComment, BlogCommentFlag, BlogCommentSubscription
from app.models.content import ContentBlock, ContentStatus
from app.models.user import User, UserRole


BLOG_KEY_PREFIX = "blog."

_MD_CODE_FENCE_RE = re.compile(r"```.*?```", flags=re.DOTALL)
_MD_INLINE_CODE_RE = re.compile(r"`[^`]*`")
_MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_STRIP_PREFIX_RE = re.compile(r"(^|\n)(#{1,6}\s*|>\\s*|[-*]\\s+)")
_MD_MULTI_SPACE_RE = re.compile(r"\s+")
_COMMENT_LINK_RE = re.compile(r"(https?://\S+|www\.\S+)", flags=re.IGNORECASE)

_BLOG_SORT_VALUES = {"newest", "oldest", "most_viewed", "most_commented"}


def _extract_slug(key: str) -> str:
    if not key.startswith(BLOG_KEY_PREFIX):
        return key
    return key[len(BLOG_KEY_PREFIX) :]


def _apply_translation(block: ContentBlock, lang: str | None) -> None:
    if not lang or not getattr(block, "translations", None):
        return
    match = next((t for t in block.translations if t.lang == lang), None)
    if match:
        set_committed_value(block, "title", match.title)
        set_committed_value(block, "body_markdown", match.body_markdown)


def _plain_text_from_markdown(body: str) -> str:
    text = body or ""
    text = _MD_CODE_FENCE_RE.sub(" ", text)
    text = _MD_INLINE_CODE_RE.sub(" ", text)
    text = _MD_IMAGE_RE.sub(r"\\1", text)
    text = _MD_LINK_RE.sub(r"\\1", text)
    text = _MD_STRIP_PREFIX_RE.sub(r"\\1", text)
    text = _MD_MULTI_SPACE_RE.sub(" ", text).strip()
    return text


def _author_display(author: User | None) -> str | None:
    if not author:
        return None
    name = (getattr(author, "name", None) or "").strip()
    username = getattr(author, "username", None)
    tag = getattr(author, "name_tag", None)
    if name and username and tag is not None:
        return f"{name}#{tag} ({username})"
    return name or username or None


def _author_public_name(author: User | None) -> str | None:
    if not author:
        return None
    name = (getattr(author, "name", None) or "").strip()
    username = getattr(author, "username", None)
    return name or username or None


def _author_payload(author: User | None) -> dict | None:
    if not author:
        return None
    return {
        "id": author.id,
        "name": author.name,
        "name_tag": getattr(author, "name_tag", None),
        "username": getattr(author, "username", None),
        "avatar_url": author.avatar_url or author.google_picture_url,
    }


def _excerpt(body: str, max_len: int = 180) -> str:
    cleaned = " ".join((body or "").split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _snippet(text: str, max_len: int = 140) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _normalize_tags(raw: object) -> list[str]:
    if raw is None:
        return []
    values: Iterable[str]
    if isinstance(raw, list):
        values = map(str, raw)
    elif isinstance(raw, str):
        values = raw.split(",")
    else:
        return []

    seen: set[str] = set()
    out: list[str] = []
    for raw_value in values:
        value = raw_value.strip()
        key = value.lower()
        if value and key not in seen:
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


def _meta_cover_fit(meta: dict | None) -> str:
    if not meta:
        return "cover"
    raw = meta.get("cover_fit")
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value in {"cover", "contain"}:
            return value
    return "cover"


def _meta_summary_translation(summary_map: dict, lang: str | None) -> str | None:
    if not lang:
        return None
    translated = summary_map.get(lang)
    if not isinstance(translated, str):
        return None
    cleaned = translated.strip()
    return cleaned or None


def _meta_summary_plain(summary_text: str, *, lang: str | None, base_lang: str | None) -> str | None:
    cleaned = summary_text.strip()
    if not cleaned:
        return None
    if lang and base_lang and lang != base_lang:
        return None
    return cleaned


def _meta_summary(meta: dict | None, *, lang: str | None, base_lang: str | None) -> str | None:
    if not meta:
        return None
    value = meta.get("summary")
    if isinstance(value, dict):
        return _meta_summary_translation(value, lang)
    if isinstance(value, str):
        return _meta_summary_plain(value, lang=lang, base_lang=base_lang)
    return None


def _normalize_blog_sort(raw: str | None) -> str:
    value = (raw or "").strip().lower()
    return value if value in _BLOG_SORT_VALUES else "newest"


def _normalize_search_text(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw)
    without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return without_marks.lower()


def _published_block_filters(now: datetime, *, author_id: UUID | None) -> list:
    filters = [
        ContentBlock.key.like(f"{BLOG_KEY_PREFIX}%"),
        ContentBlock.status == ContentStatus.published,
        or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
        or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
    ]
    if author_id:
        filters.append(ContentBlock.author_id == author_id)
    return filters


def _blog_comment_counts_subquery():
    return (
        select(
            BlogComment.content_block_id.label("content_block_id"),
            func.count(BlogComment.id).label("comment_count"),
        )
        .where(
            BlogComment.is_deleted.is_(False),
            BlogComment.is_hidden.is_(False),
        )
        .group_by(BlogComment.content_block_id)
        .subquery()
    )


def _blog_ordering(sort_key: str):
    pinned_flag = ContentBlock.meta["pinned"].as_boolean().is_(True)
    pin_order = ContentBlock.meta["pin_order"].as_integer()
    pinned_rank = case((pinned_flag, 0), else_=1)
    pin_order_rank = case((pinned_flag, func.coalesce(pin_order, 999)), else_=999)
    newest_ordering = [
        pinned_rank.asc(),
        pin_order_rank.asc(),
        ContentBlock.published_at.desc().nullslast(),
        ContentBlock.updated_at.desc(),
    ]
    if sort_key == "oldest":
        return [
            pinned_rank.asc(),
            pin_order_rank.asc(),
            ContentBlock.published_at.asc().nullslast(),
            ContentBlock.updated_at.asc(),
        ], None
    if sort_key == "most_viewed":
        return [
            pinned_rank.asc(),
            pin_order_rank.asc(),
            ContentBlock.view_count.desc(),
            ContentBlock.published_at.desc().nullslast(),
            ContentBlock.updated_at.desc(),
        ], None
    if sort_key != "most_commented":
        return newest_ordering, None
    comment_counts = _blog_comment_counts_subquery()
    return [
        pinned_rank.asc(),
        pin_order_rank.asc(),
        func.coalesce(comment_counts.c.comment_count, 0).desc(),
        ContentBlock.published_at.desc().nullslast(),
        ContentBlock.updated_at.desc(),
    ], comment_counts


def _published_posts_query(filters: list, ordering: list, comment_counts, *, lang: str | None):
    query = (
        select(ContentBlock)
        .options(selectinload(ContentBlock.images), selectinload(ContentBlock.author))
        .where(*filters)
    )
    if comment_counts is not None:
        query = query.outerjoin(comment_counts, comment_counts.c.content_block_id == ContentBlock.id)
    query = query.order_by(*ordering)
    if lang:
        query = query.options(selectinload(ContentBlock.translations))
    return query


async def _fetch_content_blocks(session: AsyncSession, query, *, lang: str | None) -> list[ContentBlock]:
    result = await session.execute(query)
    blocks = list(result.scalars().unique())
    for block in blocks:
        _apply_translation(block, lang)
    return blocks


def _has_search_terms(query_text: str, tag_text: str, series_text: str) -> bool:
    return bool(query_text or tag_text or series_text)


def _block_matches_tag(meta: dict, tag_text: str) -> bool:
    if not tag_text:
        return True
    tags = _normalize_tags(meta.get("tags"))
    return tag_text in {_normalize_search_text(tag) for tag in tags}


def _block_matches_series(meta: dict, series_text: str) -> bool:
    if not series_text:
        return True
    series_value = meta.get("series")
    return isinstance(series_value, str) and series_text == _normalize_search_text(series_value)


def _block_matches_query(block: ContentBlock, query_text: str) -> bool:
    if not query_text:
        return True
    haystack = _normalize_search_text(f"{block.title}\n{_plain_text_from_markdown(block.body_markdown)}")
    return query_text in haystack


def _block_matches_search(block: ContentBlock, *, query_text: str, tag_text: str, series_text: str) -> bool:
    meta = getattr(block, "meta", None) or {}
    return (
        _block_matches_tag(meta, tag_text)
        and _block_matches_series(meta, series_text)
        and _block_matches_query(block, query_text)
    )


def _filter_published_blocks(
    blocks: list[ContentBlock], *, query_text: str, tag_text: str, series_text: str
) -> list[ContentBlock]:
    return [
        block
        for block in blocks
        if _block_matches_search(block, query_text=query_text, tag_text=tag_text, series_text=series_text)
    ]


async def list_published_posts(
    session: AsyncSession,
    *,
    lang: str | None,
    page: int,
    limit: int,
    q: str | None = None,
    tag: str | None = None,
    series: str | None = None,
    sort: str | None = None,
    author_id: UUID | None = None,
) -> tuple[list[ContentBlock], int]:
    now = datetime.now(timezone.utc)
    page = max(1, page)
    limit = max(1, min(limit, 50))
    filters = _published_block_filters(now, author_id=author_id)
    ordering, comment_counts = _blog_ordering(_normalize_blog_sort(sort))
    query_text = _normalize_search_text(q)
    tag_text = _normalize_search_text(tag)
    series_text = _normalize_search_text(series)
    has_search_terms = _has_search_terms(query_text, tag_text, series_text)

    if not has_search_terms:
        offset = (page - 1) * limit
        total = await session.scalar(select(func.count()).select_from(ContentBlock).where(*filters))
        query = _published_posts_query(filters, ordering, comment_counts, lang=lang).limit(limit).offset(offset)
        blocks = await _fetch_content_blocks(session, query, lang=lang)
        return blocks, int(total or 0)

    query = _published_posts_query(filters, ordering, comment_counts, lang=lang)
    blocks = await _fetch_content_blocks(session, query, lang=lang)
    filtered_blocks = _filter_published_blocks(
        blocks,
        query_text=query_text,
        tag_text=tag_text,
        series_text=series_text,
    )
    total = len(filtered_blocks)
    offset = (page - 1) * limit
    page_items = filtered_blocks[offset : offset + limit]
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
        .options(selectinload(ContentBlock.images), selectinload(ContentBlock.author))
        .where(
            ContentBlock.key == key,
            ContentBlock.status == ContentStatus.published,
            or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
            or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
        )
    )
    if lang:
        query = query.options(selectinload(ContentBlock.translations))
    result = await session.execute(query)
    block = result.scalar_one_or_none()
    if block:
        _apply_translation(block, lang)
    return block


async def get_post_neighbors(
    session: AsyncSession,
    *,
    slug: str,
    lang: str | None,
) -> tuple[ContentBlock | None, ContentBlock | None]:
    current = await get_published_post(session, slug=slug, lang=None)
    if not current:
        return None, None
    current_ts = current.published_at or current.created_at

    now = datetime.now(timezone.utc)
    sort_ts = func.coalesce(ContentBlock.published_at, ContentBlock.created_at)
    filters = (
        ContentBlock.key.like(f"{BLOG_KEY_PREFIX}%"),
        ContentBlock.status == ContentStatus.published,
        or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
        or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
        ContentBlock.id != current.id,
    )

    options = [selectinload(ContentBlock.images), selectinload(ContentBlock.author)]
    if lang:
        options.append(selectinload(ContentBlock.translations))

    newer_query = (
        select(ContentBlock)
        .options(*options)
        .where(*filters, sort_ts > current_ts)
        .order_by(sort_ts.asc(), ContentBlock.id.asc())
        .limit(1)
    )
    older_query = (
        select(ContentBlock)
        .options(*options)
        .where(*filters, sort_ts < current_ts)
        .order_by(sort_ts.desc(), ContentBlock.id.desc())
        .limit(1)
    )

    newer_res = await session.execute(newer_query)
    older_res = await session.execute(older_query)
    newer = newer_res.scalar_one_or_none()
    older = older_res.scalar_one_or_none()
    if lang:
        if newer:
            _apply_translation(newer, lang)
        if older:
            _apply_translation(older, lang)
    return newer, older


def _sorted_block_images(block: ContentBlock) -> list:
    return sorted(getattr(block, "images", []) or [], key=lambda img: img.sort_order)


def _cover_image_by_url(images: list, cover_url: str | None):
    if not cover_url:
        return None
    return next((img for img in images if img.url == cover_url), None)


def _resolve_cover(images: list, meta: dict) -> tuple[str | None, object | None]:
    cover_url = _meta_cover_image_url(meta)
    if not cover_url and images:
        cover_url = images[0].url
    return cover_url, _cover_image_by_url(images, cover_url)


def _cover_focal_pair(cover_image: object | None) -> tuple[float | None, float | None]:
    if not cover_image:
        return None, None
    return getattr(cover_image, "focal_x", None), getattr(cover_image, "focal_y", None)


def _meta_reading_time_minutes(meta: dict, body_markdown: str) -> int | None:
    override_minutes = _coerce_positive_int(meta.get("reading_time_minutes") or meta.get("reading_time"))
    return override_minutes or _compute_reading_time_minutes(body_markdown)


def _meta_series(meta: dict) -> str | None:
    series = meta.get("series")
    if not isinstance(series, str):
        return None
    cleaned = series.strip()
    return cleaned or None


def _meta_summary_or_excerpt(meta: dict, *, block: ContentBlock, lang: str | None) -> str:
    summary = _meta_summary(meta, lang=lang, base_lang=getattr(block, "lang", None))
    if summary:
        return summary
    return _excerpt(_plain_text_from_markdown(block.body_markdown))


def to_list_item(block: ContentBlock, *, lang: str | None = None) -> dict:
    meta = getattr(block, "meta", None) or {}
    images = _sorted_block_images(block)
    cover, cover_image = _resolve_cover(images, meta)
    cover_focal_x, cover_focal_y = _cover_focal_pair(cover_image)
    reading_time_minutes = _meta_reading_time_minutes(meta, block.body_markdown)
    excerpt = _meta_summary_or_excerpt(meta, block=block, lang=lang)
    author_name = _author_public_name(getattr(block, "author", None))
    return {
        "slug": _extract_slug(block.key),
        "title": block.title,
        "excerpt": excerpt,
        "published_at": block.published_at,
        "cover_image_url": cover,
        "cover_focal_x": cover_focal_x,
        "cover_focal_y": cover_focal_y,
        "cover_fit": _meta_cover_fit(meta),
        "tags": _normalize_tags(meta.get("tags")),
        "series": _meta_series(meta),
        "author_name": author_name,
        "reading_time_minutes": reading_time_minutes,
    }


def to_read(block: ContentBlock, *, lang: str | None = None) -> dict:
    meta = getattr(block, "meta", None) or {}
    images = _sorted_block_images(block)
    cover, cover_image = _resolve_cover(images, meta)
    cover_focal_x, cover_focal_y = _cover_focal_pair(cover_image)
    reading_time_minutes = _meta_reading_time_minutes(meta, block.body_markdown)
    summary = _meta_summary(meta, lang=lang, base_lang=getattr(block, "lang", None))
    author = getattr(block, "author", None)
    author_name = _author_public_name(author)
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
        "cover_focal_x": cover_focal_x,
        "cover_focal_y": cover_focal_y,
        "cover_fit": _meta_cover_fit(meta),
        "tags": _normalize_tags(meta.get("tags")),
        "series": _meta_series(meta),
        "author_name": author_name,
        "author": _author_payload(author),
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


def _normalize_page_limit(page: int, limit: int) -> tuple[int, int, int]:
    safe_page = max(1, page)
    safe_limit = max(1, min(limit, 50))
    return safe_page, safe_limit, (safe_page - 1) * safe_limit


def _list_comment_threads_query(content_block_id: UUID, *, sort: str):
    roots = (
        select(BlogComment)
        .options(selectinload(BlogComment.author))
        .where(BlogComment.content_block_id == content_block_id, BlogComment.parent_id.is_(None))
    )
    cleaned_sort = (sort or "").strip().lower()
    if cleaned_sort == "oldest":
        return roots.order_by(BlogComment.created_at.asc(), BlogComment.id.asc())
    if cleaned_sort != "top":
        return roots.order_by(BlogComment.created_at.desc(), BlogComment.id.desc())
    reply_counts = (
        select(BlogComment.parent_id.label("parent_id"), func.count().label("reply_count"))
        .where(
            BlogComment.content_block_id == content_block_id,
            BlogComment.parent_id.isnot(None),
            BlogComment.is_deleted.is_(False),
            BlogComment.is_hidden.is_(False),
        )
        .group_by(BlogComment.parent_id)
        .subquery()
    )
    return roots.outerjoin(reply_counts, BlogComment.id == reply_counts.c.parent_id).order_by(
        func.coalesce(reply_counts.c.reply_count, 0).desc(),
        BlogComment.created_at.desc(),
        BlogComment.id.desc(),
    )


async def _replies_by_parent(
    session: AsyncSession, *, content_block_id: UUID, root_ids: list[UUID]
) -> dict[UUID, list[BlogComment]]:
    replies: dict[UUID, list[BlogComment]] = {cid: [] for cid in root_ids}
    if not root_ids:
        return replies
    replies_result = await session.execute(
        select(BlogComment)
        .options(selectinload(BlogComment.author))
        .where(
            BlogComment.content_block_id == content_block_id,
            BlogComment.parent_id.in_(root_ids),
        )
        .order_by(BlogComment.created_at.asc(), BlogComment.id.asc())
    )
    for reply in replies_result.scalars().unique():
        if reply.parent_id:
            replies.setdefault(reply.parent_id, []).append(reply)
    return replies


async def list_comment_threads(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    page: int,
    limit: int,
    sort: str = "newest",
) -> tuple[list[tuple[BlogComment, list[BlogComment]]], int, int]:
    _, limit, offset = _normalize_page_limit(page, limit)

    total_threads = await session.scalar(
        select(func.count())
        .select_from(BlogComment)
        .where(BlogComment.content_block_id == content_block_id, BlogComment.parent_id.is_(None))
    )
    total_comments = await session.scalar(
        select(func.count()).select_from(BlogComment).where(BlogComment.content_block_id == content_block_id)
    )

    roots = _list_comment_threads_query(content_block_id, sort=sort)
    roots_result = await session.execute(roots.limit(limit).offset(offset))
    root_comments = list(roots_result.scalars().unique())
    root_ids = [c.id for c in root_comments]
    replies_by_parent = await _replies_by_parent(session, content_block_id=content_block_id, root_ids=root_ids)
    threads = [(root, replies_by_parent.get(root.id, [])) for root in root_comments]
    return threads, int(total_threads or 0), int(total_comments or 0)


async def _list_user_comments_rows(
    session: AsyncSession, *, user_id: UUID, limit: int, offset: int
) -> list[BlogComment]:
    result = await session.execute(
        select(BlogComment)
        .options(
            selectinload(BlogComment.post).selectinload(ContentBlock.translations),
            selectinload(BlogComment.parent).selectinload(BlogComment.author),
            selectinload(BlogComment.author),
        )
        .where(BlogComment.user_id == user_id)
        .order_by(BlogComment.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().unique())


def _apply_user_comment_post_translations(comments: list[BlogComment], *, lang: str | None) -> None:
    if not lang:
        return
    seen_posts: set[UUID] = set()
    for comment in comments:
        post = getattr(comment, "post", None)
        if not post or post.id in seen_posts:
            continue
        seen_posts.add(post.id)
        _apply_translation(post, lang)


async def _user_comment_reply_context(
    session: AsyncSession, *, comment_ids: list[UUID]
) -> tuple[dict[UUID, int], dict[UUID, BlogComment]]:
    reply_counts: dict[UUID, int] = {}
    last_replies: dict[UUID, BlogComment] = {}
    if not comment_ids:
        return reply_counts, last_replies

    counts_rows = await session.execute(
        select(BlogComment.parent_id, func.count().label("cnt"))
        .where(
            BlogComment.parent_id.in_(comment_ids),
            BlogComment.is_deleted.is_(False),
            BlogComment.is_hidden.is_(False),
        )
        .group_by(BlogComment.parent_id)
    )
    for parent_id, count in counts_rows.all():
        if parent_id:
            reply_counts[parent_id] = int(count or 0)

    reply_rows = await session.execute(
        select(BlogComment)
        .options(selectinload(BlogComment.author))
        .where(
            BlogComment.parent_id.in_(comment_ids),
            BlogComment.is_deleted.is_(False),
            BlogComment.is_hidden.is_(False),
        )
        .order_by(BlogComment.created_at.desc())
    )
    for reply_comment in reply_rows.scalars().unique():
        parent_id = reply_comment.parent_id
        if parent_id and parent_id not in last_replies:
            last_replies[parent_id] = reply_comment
    return reply_counts, last_replies


def _masked_comment_body(comment: BlogComment) -> str:
    if comment.is_deleted or comment.is_hidden:
        return ""
    return comment.body


def _comment_status(comment: BlogComment) -> str:
    if comment.is_deleted:
        return "deleted"
    if comment.is_hidden:
        return "hidden"
    return "posted"


def _parent_comment_context(comment: BlogComment) -> dict | None:
    parent = getattr(comment, "parent", None)
    if not parent:
        return None
    parent_body = _masked_comment_body(parent)
    author = getattr(parent, "author", None)
    return {
        "id": parent.id,
        "author_name": _author_display(author),
        "snippet": _snippet(parent_body),
    }


def _last_reply_context(reply_comment: BlogComment | None) -> dict | None:
    if not reply_comment:
        return None
    author = getattr(reply_comment, "author", None)
    return {
        "id": reply_comment.id,
        "author_name": _author_display(author),
        "snippet": _snippet(reply_comment.body),
        "created_at": reply_comment.created_at,
    }


def _user_comment_item(
    comment: BlogComment,
    *,
    reply_counts: dict[UUID, int],
    last_replies: dict[UUID, BlogComment],
) -> dict:
    post = getattr(comment, "post", None)
    post_key = getattr(post, "key", "") if post else ""
    post_title = getattr(post, "title", "") if post else ""
    return {
        "id": comment.id,
        "post_slug": _extract_slug(post_key),
        "post_title": post_title,
        "parent_id": comment.parent_id,
        "body": _masked_comment_body(comment),
        "status": _comment_status(comment),
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "reply_count": reply_counts.get(comment.id, 0),
        "parent": _parent_comment_context(comment),
        "last_reply": _last_reply_context(last_replies.get(comment.id)),
    }


async def list_user_comments(
    session: AsyncSession,
    *,
    user_id: UUID,
    lang: str | None,
    page: int,
    limit: int,
) -> tuple[list[dict], int]:
    _, limit, offset = _normalize_page_limit(page, limit)

    total = await session.scalar(select(func.count()).select_from(BlogComment).where(BlogComment.user_id == user_id))
    comments = await _list_user_comments_rows(session, user_id=user_id, limit=limit, offset=offset)
    _apply_user_comment_post_translations(comments, lang=lang)
    comment_ids = [c.id for c in comments]
    reply_counts, last_replies = await _user_comment_reply_context(session, comment_ids=comment_ids)
    items = [
        _user_comment_item(comment, reply_counts=reply_counts, last_replies=last_replies)
        for comment in comments
    ]
    return items, int(total or 0)


def _clean_comment_body(body: str) -> str:
    cleaned = (body or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment body is required")
    return cleaned


async def _comment_parent(
    session: AsyncSession, *, parent_id: UUID | None, content_block_id: UUID
) -> BlogComment | None:
    if not parent_id:
        return None
    parent = await session.get(BlogComment, parent_id)
    if not parent or parent.content_block_id != content_block_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent comment")
    return parent


def _enforce_comment_link_limit(body: str) -> None:
    max_links = int(settings.blog_comments_max_links or 0)
    if max_links < 0:
        return
    if len(_COMMENT_LINK_RE.findall(body)) <= max_links:
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many links in comment")


async def _enforce_comment_rate_limit(session: AsyncSession, *, user: User) -> None:
    if getattr(user, "role", None) in (UserRole.admin, UserRole.owner):
        return
    limit_count = int(settings.blog_comments_rate_limit_count or 0)
    window_seconds = int(settings.blog_comments_rate_limit_window_seconds or 0)
    if limit_count <= 0 or window_seconds <= 0:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    recent = await session.scalar(
        select(func.count())
        .select_from(BlogComment)
        .where(
            BlogComment.user_id == user.id,
            BlogComment.created_at >= cutoff,
        )
    )
    if int(recent or 0) < limit_count:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many comments. Please wait a moment and try again.",
    )


async def create_comment(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    user: User,
    body: str,
    parent_id: UUID | None = None,
) -> BlogComment:
    body = _clean_comment_body(body)
    parent = await _comment_parent(session, parent_id=parent_id, content_block_id=content_block_id)
    _enforce_comment_link_limit(body)
    await _enforce_comment_rate_limit(session, user=user)

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
    if actor.role not in (UserRole.admin, UserRole.owner) and comment.user_id != actor.id:
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
    body = comment.body
    if comment.is_deleted or comment.is_hidden:
        body = ""

    if author:
        author_id = author.id
        author_name = author.name
        author_name_tag = getattr(author, "name_tag", None)
        author_username = getattr(author, "username", None)
        author_avatar_url = author.avatar_url or author.google_picture_url
    else:
        author_id = comment.user_id
        author_name = None
        author_name_tag = None
        author_username = None
        author_avatar_url = None

    return {
        "id": comment.id,
        "parent_id": comment.parent_id,
        "body": body,
        "is_deleted": comment.is_deleted,
        "is_hidden": comment.is_hidden,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "deleted_at": comment.deleted_at,
        "hidden_at": comment.hidden_at,
        "author": {
            "id": author_id,
            "name": author_name,
            "name_tag": author_name_tag,
            "username": author_username,
            "avatar_url": author_avatar_url,
        }
    }


def to_flag_read(flag: BlogCommentFlag) -> dict:
    return {
        "id": flag.id,
        "user_id": flag.user_id,
        "reason": flag.reason,
        "created_at": flag.created_at,
    }


def _comment_admin_author(comment: BlogComment) -> dict:
    author = comment.author
    if not author:
        return {
            "id": comment.user_id,
            "name": None,
            "name_tag": None,
            "username": None,
            "avatar_url": None,
        }
    return {
        "id": author.id,
        "name": author.name,
        "name_tag": getattr(author, "name_tag", None),
        "username": getattr(author, "username", None),
        "avatar_url": author.avatar_url or author.google_picture_url,
    }


def _comment_admin_body(comment: BlogComment) -> str:
    if comment.is_deleted:
        return ""
    return comment.body


def _comment_admin_flags(flags: list[BlogCommentFlag] | None) -> list[dict]:
    return [to_flag_read(flag) for flag in (flags or [])]


def to_comment_admin_read(
    comment: BlogComment,
    *,
    post_key: str,
    flags: list[BlogCommentFlag] | None = None,
    flag_count: int = 0,
) -> dict:
    return {
        "id": comment.id,
        "content_block_id": comment.content_block_id,
        "post_slug": _extract_slug(post_key),
        "parent_id": comment.parent_id,
        "body": _comment_admin_body(comment),
        "is_deleted": comment.is_deleted,
        "deleted_at": comment.deleted_at,
        "deleted_by": comment.deleted_by,
        "is_hidden": comment.is_hidden,
        "hidden_at": comment.hidden_at,
        "hidden_by": comment.hidden_by,
        "hidden_reason": comment.hidden_reason,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "author": _comment_admin_author(comment),
        "flag_count": int(flag_count or 0),
        "flags": _comment_admin_flags(flags),
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
    _, limit, offset = _normalize_page_limit(page, limit)
    summary = _list_flagged_comments_summary()
    total = await session.scalar(select(func.count()).select_from(summary))
    rows = await _list_flagged_comment_rows(session, summary=summary, limit=limit, offset=offset)
    if not rows:
        return [], int(total or 0)
    flags_by_comment = await _flags_by_comment_id(session, rows=rows)
    out = _flagged_comment_items(rows, flags_by_comment=flags_by_comment)
    return out, int(total or 0)


def _list_flagged_comments_summary():
    return (
        select(
            BlogCommentFlag.comment_id.label("comment_id"),
            func.count().label("flag_count"),
            func.max(BlogCommentFlag.created_at).label("last_flagged_at"),
        )
        .where(BlogCommentFlag.resolved_at.is_(None))
        .group_by(BlogCommentFlag.comment_id)
        .subquery()
    )


async def _list_flagged_comment_rows(
    session: AsyncSession, *, summary, limit: int, offset: int
) -> list[tuple[BlogComment, str, int]]:
    rows = await session.execute(
        select(BlogComment, ContentBlock.key, summary.c.flag_count)
        .join(summary, summary.c.comment_id == BlogComment.id)
        .join(ContentBlock, ContentBlock.id == BlogComment.content_block_id)
        .options(selectinload(BlogComment.author))
        .order_by(summary.c.last_flagged_at.desc().nullslast())
        .limit(limit)
        .offset(offset)
    )
    return [(comment, str(post_key), int(flag_count or 0)) for comment, post_key, flag_count in rows.all()]


async def _flags_by_comment_id(
    session: AsyncSession, *, rows: list[tuple[BlogComment, str, int]]
) -> dict[UUID, list[BlogCommentFlag]]:
    comment_ids = [comment.id for comment, _, _ in rows]
    flag_rows = await session.execute(
        select(BlogCommentFlag)
        .where(BlogCommentFlag.comment_id.in_(comment_ids), BlogCommentFlag.resolved_at.is_(None))
        .order_by(BlogCommentFlag.created_at.desc())
    )
    flags_by_comment: dict[UUID, list[BlogCommentFlag]] = {}
    for flag in flag_rows.scalars().all():
        flags_by_comment.setdefault(flag.comment_id, []).append(flag)
    return flags_by_comment


def _flagged_comment_items(
    rows: list[tuple[BlogComment, str, int]],
    *,
    flags_by_comment: dict[UUID, list[BlogCommentFlag]],
) -> list[dict]:
    return [
        to_comment_admin_read(
            comment,
            post_key=str(post_key),
            flag_count=int(flag_count or 0),
            flags=flags_by_comment.get(comment.id, []),
        )
        for comment, post_key, flag_count in rows
    ]


async def set_comment_hidden(
    session: AsyncSession,
    *,
    comment_id: UUID,
    actor: User,
    hidden: bool,
    reason: str | None = None,
) -> BlogComment:
    if actor.role not in (UserRole.admin, UserRole.owner):
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
    if actor.role not in (UserRole.admin, UserRole.owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    now = datetime.now(timezone.utc)
    result = await session.execute(
        update(BlogCommentFlag)
        .where(BlogCommentFlag.comment_id == comment_id, BlogCommentFlag.resolved_at.is_(None))
        .values(resolved_at=now, resolved_by=actor.id)
    )
    await session.commit()
    return int(getattr(result, "rowcount", 0) or 0)


async def list_comment_subscription_recipients(
    session: AsyncSession,
    *,
    content_block_id: UUID,
) -> list[User]:
    result = await session.execute(
        select(User)
        .join(BlogCommentSubscription, BlogCommentSubscription.user_id == User.id)
        .where(
            BlogCommentSubscription.content_block_id == content_block_id,
            BlogCommentSubscription.unsubscribed_at.is_(None),
            User.email.isnot(None),
            User.email_verified.is_(True),
        )
    )
    return list(result.scalars().unique())


async def is_comment_subscription_enabled(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    user_id: UUID,
) -> bool:
    row = await session.scalar(
        select(BlogCommentSubscription).where(
            BlogCommentSubscription.content_block_id == content_block_id,
            BlogCommentSubscription.user_id == user_id,
        )
    )
    return bool(row and row.unsubscribed_at is None)


async def set_comment_subscription(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    user_id: UUID,
    enabled: bool,
) -> bool:
    existing = await session.scalar(
        select(BlogCommentSubscription).where(
            BlogCommentSubscription.content_block_id == content_block_id,
            BlogCommentSubscription.user_id == user_id,
        )
    )
    now = datetime.now(timezone.utc)
    if enabled:
        if existing:
            if existing.unsubscribed_at is None:
                return True
            existing.unsubscribed_at = None
            session.add(existing)
            await session.commit()
            return True
        session.add(
            BlogCommentSubscription(
                content_block_id=content_block_id,
                user_id=user_id,
                created_at=now,
                unsubscribed_at=None,
            )
        )
        await session.commit()
        return True

    if existing and existing.unsubscribed_at is None:
        existing.unsubscribed_at = now
        session.add(existing)
        await session.commit()
    return False
