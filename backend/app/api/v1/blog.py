import base64
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from xml.etree import ElementTree

import sqlalchemy as sa
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import require_admin_section, require_complete_profile, require_verified_email
from app.core.security import create_content_preview_token, decode_content_preview_token
from app.db.session import get_session
from app.models.blog import BlogComment
from app.models.content import ContentBlock
from app.models.user import User, UserRole
from app.schemas.blog import (
    BlogCommentCreate,
    BlogCommentFlagCreate,
    BlogCommentFlagRead,
    BlogCommentAdminListResponse,
    BlogCommentAdminRead,
    BlogCommentHideRequest,
    BlogCommentListResponse,
    BlogCommentRead,
    BlogCommentThreadListResponse,
    BlogCommentThreadRead,
    BlogMyCommentListResponse,
    BlogMyCommentRead,
    BlogPostNeighbors,
    BlogPostListResponse,
    BlogPostRead,
    BlogPreviewTokenResponse,
)
from app.schemas.catalog import PaginationMeta
from app.services import blog as blog_service
from app.services import captcha as captcha_service
from app.services import content as content_service
from app.services import email as email_service
from app.services import notifications as notification_service
from app.services import og_images

router = APIRouter(prefix="/blog", tags=["blog"])

BLOG_VIEW_COOKIE = "blog_viewed"
BLOG_VIEW_COOKIE_TTL_SECONDS = 6 * 60 * 60


def _site_base_url() -> str:
    return str(settings.public_base_url or settings.frontend_origin or "").rstrip("/")


def _site_locale(lang: str) -> str:
    if lang == "ro":
        return "ro-RO"
    if lang == "en":
        return "en-US"
    return "en-US"


def _site_description(lang: str) -> str:
    site_name = str(settings.site_name or "").strip() or "momentstudio"
    if lang == "ro":
        return f"Ultimele articole de pe {site_name}."
    return f"Latest posts from {site_name}."


def _is_probable_bot(user_agent: str) -> bool:
    ua = (user_agent or "").strip().lower()
    if not ua:
        return False
    bot_tokens = (
        "bot",
        "spider",
        "crawl",
        "slurp",
        "facebookexternalhit",
        "twitterbot",
        "petalbot",
        "bingpreview",
        "headless",
    )
    return any(token in ua for token in bot_tokens)


def _decode_view_cookie_payload(value: str) -> list[object]:
    raw = (value or "").strip()
    if not raw:
        return []
    try:
        decoded = base64.urlsafe_b64decode(raw.encode("utf-8")).decode("utf-8")
        data = json.loads(decoded)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _decode_view_cookie_item(item: object) -> tuple[str, int] | None:
    if not isinstance(item, dict):
        return None
    post_id = _normalize_cookie_post_id(item.get("pid"))
    if not post_id:
        return None
    ts = item.get("ts")
    if not isinstance(ts, int):
        try:
            ts = int(ts)
        except Exception:
            return None
    return (post_id, ts)


def _decode_view_cookie(value: str) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for item in _decode_view_cookie_payload(value):
        parsed = _decode_view_cookie_item(item)
        if parsed is None:
            continue
        out.append(parsed)
    return out


def _encode_view_cookie(entries: list[tuple[str, int]]) -> str:
    payload = [{"pid": post_id, "ts": ts} for post_id, ts in entries if post_id and isinstance(ts, int)]
    raw = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _normalize_cookie_post_id(value: object) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    try:
        return str(uuid.UUID(candidate))
    except Exception:
        return ""


def _feed_sort_key(block: ContentBlock) -> tuple[datetime, datetime]:
    min_time = datetime.min.replace(tzinfo=timezone.utc)
    return (
        block.published_at or min_time,
        block.updated_at or min_time,
    )


async def _recent_feed_blocks(session: AsyncSession, lang: str | None) -> list[ContentBlock]:
    blocks, _ = await blog_service.list_published_posts(
        session,
        lang=lang,
        page=1,
        limit=50,
        sort="newest",
    )
    return sorted(blocks, key=_feed_sort_key, reverse=True)[:20]


def _latest_feed_timestamp(blocks: list[ContentBlock]) -> datetime | None:
    if not blocks:
        return None
    now = datetime.now(timezone.utc)
    return max((b.updated_at or b.published_at or now for b in blocks), default=now)


def _create_rss_document(
    *,
    base: str,
    chosen_lang: str,
    blocks: list[ContentBlock],
) -> tuple[ElementTree.Element, ElementTree.Element]:
    ns_atom = "http://www.w3.org/2005/Atom"
    ElementTree.register_namespace("atom", ns_atom)

    rss = ElementTree.Element("rss", {"version": "2.0"})
    channel = ElementTree.SubElement(rss, "channel")
    feed_url = f"{base}/api/v1/blog/rss.xml?lang={chosen_lang}"
    ElementTree.SubElement(
        channel,
        f"{{{ns_atom}}}link",
        {"href": feed_url, "rel": "self", "type": "application/rss+xml"},
    )
    ElementTree.SubElement(channel, "title").text = f"{settings.site_name} Blog"
    ElementTree.SubElement(channel, "link").text = f"{base}/blog?lang={chosen_lang}"
    ElementTree.SubElement(channel, "description").text = _site_description(chosen_lang)
    ElementTree.SubElement(channel, "language").text = _site_locale(chosen_lang)

    latest = _latest_feed_timestamp(blocks)
    if latest:
        ElementTree.SubElement(channel, "lastBuildDate").text = format_datetime(latest)
    return rss, channel


def _append_rss_item(
    *,
    channel: ElementTree.Element,
    base: str,
    chosen_lang: str,
    block: ContentBlock,
    lang: str | None,
) -> None:
    item = ElementTree.SubElement(channel, "item")
    data = blog_service.to_list_item(block, lang=lang)
    slug = str(data.get("slug") or "")
    link = f"{base}/blog/{slug}?lang={chosen_lang}"

    ElementTree.SubElement(item, "title").text = str(data.get("title") or "")
    ElementTree.SubElement(item, "link").text = link
    ElementTree.SubElement(item, "guid").text = link
    if block.published_at:
        ElementTree.SubElement(item, "pubDate").text = format_datetime(block.published_at)
    ElementTree.SubElement(item, "description").text = str(data.get("excerpt") or "")


def _set_json_feed_item_date(item: dict, published: datetime | None) -> None:
    if published:
        item["date_published"] = published.isoformat()


def _set_json_feed_item_authors(item: dict, author_name: object) -> None:
    if author_name:
        item["authors"] = [{"name": author_name}]


def _set_json_feed_item_image(item: dict, image: object) -> None:
    if image:
        item["image"] = image


def _set_json_feed_item_tags(item: dict, tags: object) -> None:
    if tags:
        item["tags"] = tags


def _set_json_feed_item_series(item: dict, series: object) -> None:
    if series:
        item["_series"] = series


def _build_json_feed_item(*, base: str, chosen_lang: str, block: ContentBlock, lang: str | None) -> dict:
    data = blog_service.to_list_item(block, lang=lang)
    slug = str(data.get("slug") or "")
    url = f"{base}/blog/{slug}?lang={chosen_lang}"
    item: dict = {
        "id": url,
        "url": url,
        "title": data.get("title") or "",
        "summary": data.get("excerpt") or "",
    }
    _set_json_feed_item_date(item, block.published_at or block.updated_at)
    _set_json_feed_item_authors(item, data.get("author_name"))
    _set_json_feed_item_image(item, data.get("cover_image_url"))
    _set_json_feed_item_tags(item, data.get("tags") or [])
    _set_json_feed_item_series(item, data.get("series"))
    return item


def _build_json_feed(*, base: str, chosen_lang: str, blocks: list[ContentBlock], lang: str | None) -> dict:
    return {
        "version": "https://jsonfeed.org/version/1.1",
        "title": f"{settings.site_name} Blog",
        "home_page_url": f"{base}/blog?lang={chosen_lang}",
        "feed_url": f"{base}/api/v1/blog/feed.json?lang={chosen_lang}",
        "description": _site_description(chosen_lang),
        "language": _site_locale(chosen_lang),
        "items": [_build_json_feed_item(base=base, chosen_lang=chosen_lang, block=block, lang=lang) for block in blocks],
    }


def _view_tracking_decision(
    *,
    post_cookie_id: str,
    cookie_value: str,
    now: int,
) -> tuple[bool, bool]:
    existing = _decode_view_cookie(cookie_value)
    fresh = [(post_id, ts) for post_id, ts in existing if now - ts < BLOG_VIEW_COOKIE_TTL_SECONDS]
    cookie_needs_update = len(fresh) != len(existing)
    seen = any(post_id == post_cookie_id for post_id, _ in fresh)
    should_count_view = not seen
    if should_count_view:
        cookie_needs_update = True
    return should_count_view, cookie_needs_update


def _set_view_cookie(response: Response, *, post_cookie_id: str, now: int) -> None:
    response.set_cookie(
        BLOG_VIEW_COOKIE,
        _encode_view_cookie([(post_cookie_id, now)]),
        httponly=True,
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite.lower(),
        path="/",
        max_age=BLOG_VIEW_COOKIE_TTL_SECONDS,
    )


async def _increment_post_view_count(session: AsyncSession, *, block_id: uuid.UUID) -> None:
    try:
        await session.execute(
            sa.update(ContentBlock)
            .where(ContentBlock.id == block_id)
            .values(
                view_count=ContentBlock.view_count + 1,
                updated_at=ContentBlock.updated_at,
            )
            .execution_options(synchronize_session=False)
        )
        await session.commit()
    except Exception:
        await session.rollback()


def _blog_post_og_etag(*, slug: str, version: int, lang: str | None) -> str:
    return f'W/"blog-og-{slug}-v{version}-{lang or "base"}"'


def _etag_matches(*, if_none_match: str, etag: str) -> bool:
    if if_none_match == "*":
        return False
    normalized_etag = etag[2:] if etag.startswith("W/") else etag
    for raw_candidate in if_none_match.split(","):
        candidate = raw_candidate.strip()
        if not candidate:
            continue
        normalized_candidate = candidate[2:] if candidate.startswith("W/") else candidate
        if normalized_candidate == normalized_etag:
            return True
    return False


def _comment_snippet(body: str) -> str:
    snippet = (body or "").strip()
    return (snippet[:400] + "…") if len(snippet) > 400 else snippet


async def _notify_admins_about_comment(
    *,
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    actor: User,
    post_title: str,
    post_url: str,
    comment_body: str,
) -> None:
    admins = await session.execute(
        sa.select(User).where(User.role.in_([UserRole.admin, UserRole.owner]), User.notify_blog_comments.is_(True))
    )
    for admin in admins.scalars().all():
        if not admin.email or admin.id == actor.id:
            continue
        background_tasks.add_task(
            email_service.send_blog_comment_admin_notification,
            admin.email,
            post_title=post_title,
            post_url=post_url,
            commenter_name=actor.name or actor.email,
            comment_body=comment_body,
            lang=admin.preferred_language,
        )


def _reply_recipient_is_notifiable(recipient: User | None, *, actor_id: uuid.UUID) -> bool:
    if recipient is None:
        return False
    if not recipient.email:
        return False
    if recipient.id == actor_id:
        return False
    if not recipient.notify_blog_comment_replies:
        return False
    return True


async def _notify_parent_comment_author(
    *,
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    actor: User,
    payload: BlogCommentCreate,
    post_title: str,
    post_url: str,
    comment_body: str,
    slug: str,
) -> None:
    if not payload.parent_id:
        return
    parent = await session.execute(
        sa.select(BlogComment).options(selectinload(BlogComment.author)).where(BlogComment.id == payload.parent_id)
    )
    parent_comment = parent.scalar_one_or_none()
    recipient = parent_comment.author if parent_comment else None
    if not _reply_recipient_is_notifiable(recipient, actor_id=actor.id):
        return
    assert recipient is not None
    background_tasks.add_task(
        email_service.send_blog_comment_reply_notification,
        recipient.email,
        post_title=post_title,
        post_url=post_url,
        replier_name=actor.name or actor.email,
        comment_body=comment_body,
        lang=recipient.preferred_language,
    )
    await notification_service.create_notification(
        session,
        user_id=recipient.id,
        type="blog_reply",
        title=(
            "New reply to your comment"
            if (recipient.preferred_language or "en") != "ro"
            else "Răspuns nou la comentariul tău"
        ),
        body=post_title,
        url=f"/blog/{slug}",
    )


async def _notify_comment_subscribers(
    *,
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    actor: User,
    content_block_id: uuid.UUID,
    post_title: str,
    post_url: str,
    comment_body: str,
) -> None:
    subscribers = await blog_service.list_comment_subscription_recipients(session, content_block_id=content_block_id)
    for subscriber in subscribers:
        if not subscriber.email or subscriber.id == actor.id:
            continue
        background_tasks.add_task(
            email_service.send_blog_comment_subscriber_notification,
            subscriber.email,
            post_title=post_title,
            post_url=post_url,
            commenter_name=actor.name or actor.email,
            comment_body=comment_body,
            lang=subscriber.preferred_language,
        )


async def _dispatch_comment_notifications(
    *,
    session: AsyncSession,
    background_tasks: BackgroundTasks,
    actor: User,
    post: ContentBlock,
    slug: str,
    payload: BlogCommentCreate,
) -> None:
    if not settings.smtp_enabled:
        return
    post_url = f"{settings.frontend_origin.rstrip('/')}/blog/{slug}"
    snippet = _comment_snippet(payload.body)
    await _notify_admins_about_comment(
        session=session,
        background_tasks=background_tasks,
        actor=actor,
        post_title=post.title,
        post_url=post_url,
        comment_body=snippet,
    )
    await _notify_parent_comment_author(
        session=session,
        background_tasks=background_tasks,
        actor=actor,
        payload=payload,
        post_title=post.title,
        post_url=post_url,
        comment_body=snippet,
        slug=slug,
    )
    if payload.parent_id is None:
        await _notify_comment_subscribers(
            session=session,
            background_tasks=background_tasks,
            actor=actor,
            content_block_id=post.id,
            post_title=post.title,
            post_url=post_url,
            comment_body=snippet,
        )


class BlogCommentSubscriptionRequest(BaseModel):
    enabled: bool = True


@router.get("/posts", response_model=BlogPostListResponse)
async def list_blog_posts(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    q: str | None = Query(default=None, max_length=200),
    tag: str | None = Query(default=None, max_length=50),
    series: str | None = Query(default=None, max_length=80),
    author_id: uuid.UUID | None = Query(default=None),
    sort: str = Query(default="newest", pattern="^(newest|oldest|most_viewed|most_commented)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
) -> BlogPostListResponse:
    blocks, total_items = await blog_service.list_published_posts(
        session,
        lang=lang,
        page=page,
        limit=limit,
        q=q,
        tag=tag,
        series=series,
        sort=sort,
        author_id=author_id,
    )
    total_pages = (total_items + limit - 1) // limit if total_items else 1
    return BlogPostListResponse(
        items=[blog_service.to_list_item(b, lang=lang) for b in blocks],
        meta=PaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.get("/rss.xml", response_class=Response)
async def blog_rss_feed(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> Response:
    base = _site_base_url()
    chosen_lang = lang or settings.default_locale or "en"
    blocks = await _recent_feed_blocks(session, lang)
    rss, channel = _create_rss_document(base=base, chosen_lang=chosen_lang, blocks=blocks)
    for block in blocks:
        _append_rss_item(
            channel=channel,
            base=base,
            chosen_lang=chosen_lang,
            block=block,
            lang=lang,
        )

    payload = ElementTree.tostring(rss, encoding="utf-8", xml_declaration=True)
    return Response(content=payload, media_type="application/rss+xml; charset=utf-8")


@router.get("/feed.json", response_class=Response)
async def blog_json_feed(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> Response:
    base = _site_base_url()
    chosen_lang = lang or settings.default_locale or "en"
    blocks = await _recent_feed_blocks(session, lang)
    feed = _build_json_feed(
        base=base,
        chosen_lang=chosen_lang,
        blocks=blocks,
        lang=lang,
    )
    return Response(content=json.dumps(feed, ensure_ascii=False), media_type="application/feed+json; charset=utf-8")


@router.get("/posts/{slug}", response_model=BlogPostRead)
async def get_blog_post(
    slug: str,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> BlogPostRead:
    block = await blog_service.get_published_post(session, slug=slug, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    payload = blog_service.to_read(block, lang=lang)
    should_count_view = False
    ua = request.headers.get("user-agent") or ""
    post_cookie_id = _normalize_cookie_post_id(block.id)
    if post_cookie_id and not _is_probable_bot(ua):
        now = int(time.time())
        should_count_view, cookie_needs_update = _view_tracking_decision(
            post_cookie_id=post_cookie_id,
            cookie_value=request.cookies.get(BLOG_VIEW_COOKIE) or "",
            now=now,
        )
        if cookie_needs_update:
            _set_view_cookie(response, post_cookie_id=post_cookie_id, now=now)

    if should_count_view:
        await _increment_post_view_count(session, block_id=block.id)
    return BlogPostRead.model_validate(payload)


@router.get("/posts/{slug}/neighbors", response_model=BlogPostNeighbors)
async def get_blog_post_neighbors(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> BlogPostNeighbors:
    block = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    previous_post, next_post = await blog_service.get_post_neighbors(session, slug=slug, lang=lang)
    return BlogPostNeighbors(
        previous=blog_service.to_list_item(previous_post, lang=lang) if previous_post else None,
        next=blog_service.to_list_item(next_post, lang=lang) if next_post else None,
    )


@router.get("/posts/{slug}/preview", response_model=BlogPostRead)
async def preview_blog_post(
    slug: str,
    token: str = Query(..., min_length=1, description="Preview token"),
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> BlogPostRead:
    key = decode_content_preview_token(token)
    expected_key = f"blog.{slug}"
    if not key or key != expected_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid preview token")
    block = await content_service.get_block_by_key(session, expected_key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return BlogPostRead.model_validate(blog_service.to_read(block, lang=lang))


@router.post("/posts/{slug}/preview-token", response_model=BlogPreviewTokenResponse)
async def create_blog_preview_token(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    expires_minutes: int = Query(default=60, ge=5, le=7 * 24 * 60),
    _: User = Depends(require_admin_section("content")),
) -> BlogPreviewTokenResponse:
    key = f"blog.{slug}"
    block = await content_service.get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    token = create_content_preview_token(content_key=key, expires_at=expires_at)

    chosen_lang = lang or (block.lang if getattr(block, "lang", None) in ("en", "ro") else "en") or "en"
    url = f"{settings.frontend_origin.rstrip('/')}/blog/{slug}?preview={token}&lang={chosen_lang}"
    return BlogPreviewTokenResponse(token=token, expires_at=expires_at, url=url)


@router.get("/posts/{slug}/og.png", response_class=Response)
async def blog_post_og_image(
    slug: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> Response:
    block = await blog_service.get_published_post(session, slug=slug, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    etag = _blog_post_og_etag(slug=slug, version=block.version, lang=lang)
    cache_control = "public, max-age=3600"
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and _etag_matches(if_none_match=if_none_match, etag=etag):
        return Response(
            status_code=status.HTTP_304_NOT_MODIFIED,
            headers={"ETag": etag, "Cache-Control": cache_control},
        )

    data = blog_service.to_read(block, lang=lang)
    png = og_images.render_blog_post_og(title=str(data.get("title") or ""), subtitle=data.get("summary") or None)
    return Response(content=png, media_type="image/png", headers={"ETag": etag, "Cache-Control": cache_control})


@router.get("/posts/{slug}/og-preview.png", response_class=Response)
async def blog_post_og_preview_image(
    slug: str,
    token: str = Query(..., min_length=1, description="Preview token"),
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> Response:
    key = decode_content_preview_token(token)
    expected_key = f"blog.{slug}"
    if not key or key != expected_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid preview token")
    block = await content_service.get_block_by_key(session, expected_key, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    data = blog_service.to_read(block, lang=lang)
    png = og_images.render_blog_post_og(title=str(data.get("title") or ""), subtitle=data.get("summary") or None)
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.get("/posts/{slug}/comments", response_model=BlogCommentListResponse)
async def list_blog_comments(
    slug: str,
    session: AsyncSession = Depends(get_session),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
) -> BlogCommentListResponse:
    post = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    comments, total_items = await blog_service.list_comments(
        session, content_block_id=post.id, page=page, limit=limit
    )
    total_pages = (total_items + limit - 1) // limit if total_items else 1
    return BlogCommentListResponse(
        items=[BlogCommentRead.model_validate(blog_service.to_comment_read(c)) for c in comments],
        meta=PaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.get("/posts/{slug}/comment-threads", response_model=BlogCommentThreadListResponse)
async def list_blog_comment_threads(
    slug: str,
    session: AsyncSession = Depends(get_session),
    sort: str = Query(default="newest", pattern="^(newest|oldest|top)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
) -> BlogCommentThreadListResponse:
    post = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    threads, total_threads, total_comments = await blog_service.list_comment_threads(
        session, content_block_id=post.id, page=page, limit=limit, sort=sort
    )
    total_pages = (total_threads + limit - 1) // limit if total_threads else 1
    return BlogCommentThreadListResponse(
        items=[
            BlogCommentThreadRead(
                root=BlogCommentRead.model_validate(blog_service.to_comment_read(root)),
                replies=[BlogCommentRead.model_validate(blog_service.to_comment_read(r)) for r in replies],
            )
            for root, replies in threads
        ],
        meta=PaginationMeta(total_items=total_threads, total_pages=total_pages, page=page, limit=limit),
        total_comments=total_comments,
    )


@router.get("/posts/{slug}/comment-subscription")
async def get_blog_comment_subscription(
    slug: str,
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> dict:
    post = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    enabled = await blog_service.is_comment_subscription_enabled(session, content_block_id=post.id, user_id=current_user.id)
    return {"enabled": enabled}


@router.put("/posts/{slug}/comment-subscription")
async def set_blog_comment_subscription(
    slug: str,
    payload: BlogCommentSubscriptionRequest,
    current_user: User = Depends(require_verified_email),
    session: AsyncSession = Depends(get_session),
) -> dict:
    post = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    enabled = await blog_service.set_comment_subscription(
        session, content_block_id=post.id, user_id=current_user.id, enabled=bool(payload.enabled)
    )
    return {"enabled": enabled}


@router.get("/me/comments", response_model=BlogMyCommentListResponse)
async def list_my_blog_comments(
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
) -> BlogMyCommentListResponse:
    items, total_items = await blog_service.list_user_comments(
        session, user_id=current_user.id, lang=lang, page=page, limit=limit
    )
    total_pages = (total_items + limit - 1) // limit if total_items else 1
    return BlogMyCommentListResponse(
        items=[BlogMyCommentRead.model_validate(item) for item in items],
        meta=PaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.post("/posts/{slug}/comments", response_model=BlogCommentRead, status_code=status.HTTP_201_CREATED)
async def create_blog_comment(
    slug: str,
    payload: BlogCommentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> BlogCommentRead:
    post = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    await captcha_service.verify(payload.captcha_token, remote_ip=request.client.host if request.client else None)
    comment = await blog_service.create_comment(
        session,
        content_block_id=post.id,
        user=current_user,
        body=payload.body,
        parent_id=payload.parent_id,
    )
    await _dispatch_comment_notifications(
        session=session,
        background_tasks=background_tasks,
        actor=current_user,
        post=post,
        slug=slug,
        payload=payload,
    )
    return BlogCommentRead.model_validate(blog_service.to_comment_read(comment))


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blog_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> None:
    await blog_service.soft_delete_comment(session, comment_id=comment_id, actor=current_user)
    return None


@router.post("/comments/{comment_id}/flag", response_model=BlogCommentFlagRead, status_code=status.HTTP_201_CREATED)
async def flag_blog_comment(
    comment_id: uuid.UUID,
    payload: BlogCommentFlagCreate,
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> BlogCommentFlagRead:
    flag = await blog_service.flag_comment(session, comment_id=comment_id, actor=current_user, reason=payload.reason)
    return BlogCommentFlagRead.model_validate(blog_service.to_flag_read(flag))


@router.get("/admin/comments/flagged", response_model=BlogCommentAdminListResponse)
async def list_flagged_blog_comments(
    _: User = Depends(require_admin_section("content")),
    session: AsyncSession = Depends(get_session),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
) -> BlogCommentAdminListResponse:
    items, total_items = await blog_service.list_flagged_comments(session, page=page, limit=limit)
    total_pages = (total_items + limit - 1) // limit if total_items else 1
    return BlogCommentAdminListResponse(
        items=[BlogCommentAdminRead.model_validate(item) for item in items],
        meta=PaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.post("/admin/comments/{comment_id}/hide", response_model=BlogCommentAdminRead)
async def hide_blog_comment(
    comment_id: uuid.UUID,
    payload: BlogCommentHideRequest,
    admin_user: User = Depends(require_admin_section("content")),
    session: AsyncSession = Depends(get_session),
) -> BlogCommentAdminRead:
    comment = await blog_service.set_comment_hidden(
        session, comment_id=comment_id, actor=admin_user, hidden=True, reason=payload.reason
    )
    post_key = await session.scalar(sa.select(ContentBlock.key).where(ContentBlock.id == comment.content_block_id))
    return BlogCommentAdminRead.model_validate(blog_service.to_comment_admin_read(comment, post_key=str(post_key or "")))


@router.post("/admin/comments/{comment_id}/unhide", response_model=BlogCommentAdminRead)
async def unhide_blog_comment(
    comment_id: uuid.UUID,
    admin_user: User = Depends(require_admin_section("content")),
    session: AsyncSession = Depends(get_session),
) -> BlogCommentAdminRead:
    comment = await blog_service.set_comment_hidden(session, comment_id=comment_id, actor=admin_user, hidden=False)
    post_key = await session.scalar(sa.select(ContentBlock.key).where(ContentBlock.id == comment.content_block_id))
    return BlogCommentAdminRead.model_validate(blog_service.to_comment_admin_read(comment, post_key=str(post_key or "")))


@router.post("/admin/comments/{comment_id}/resolve-flags", response_model=dict[str, int])
async def resolve_blog_comment_flags(
    comment_id: uuid.UUID,
    admin_user: User = Depends(require_admin_section("content")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    resolved = await blog_service.resolve_comment_flags(session, comment_id=comment_id, actor=admin_user)
    return {"resolved": resolved}
