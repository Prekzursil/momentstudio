import uuid
from datetime import datetime, timedelta, timezone

import sqlalchemy as sa
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import require_admin_section, require_complete_profile
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
    BlogMyCommentListResponse,
    BlogMyCommentRead,
    BlogPostListResponse,
    BlogPostRead,
    BlogPreviewTokenResponse,
)
from app.schemas.catalog import PaginationMeta
from app.services import blog as blog_service
from app.services import content as content_service
from app.services import email as email_service
from app.services import notifications as notification_service
from app.services import og_images

router = APIRouter(prefix="/blog", tags=["blog"])


@router.get("/posts", response_model=BlogPostListResponse)
async def list_blog_posts(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    q: str | None = Query(default=None, max_length=200),
    tag: str | None = Query(default=None, max_length=50),
    series: str | None = Query(default=None, max_length=80),
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
    )
    total_pages = (total_items + limit - 1) // limit if total_items else 1
    return BlogPostListResponse(
        items=[blog_service.to_list_item(b, lang=lang) for b in blocks],
        meta=PaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.get("/posts/{slug}", response_model=BlogPostRead)
async def get_blog_post(
    slug: str,
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> BlogPostRead:
    block = await blog_service.get_published_post(session, slug=slug, lang=lang)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    try:
        await session.execute(
            sa.update(ContentBlock)
            .where(ContentBlock.id == block.id)
            .values(view_count=ContentBlock.view_count + 1)
        )
        await session.commit()
    except Exception:
        await session.rollback()
    return BlogPostRead.model_validate(blog_service.to_read(block, lang=lang))


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

    etag = f'W/"blog-og-{slug}-v{block.version}-{lang or "base"}"'
    cache_control = "public, max-age=3600"
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match != "*":
        normalized_etag = etag[2:] if etag.startswith("W/") else etag
        for raw_candidate in if_none_match.split(","):
            candidate = raw_candidate.strip()
            if not candidate:
                continue
            normalized_candidate = candidate[2:] if candidate.startswith("W/") else candidate
            if normalized_candidate == normalized_etag:
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
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
) -> BlogCommentRead:
    post = await blog_service.get_published_post(session, slug=slug, lang=None)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    comment = await blog_service.create_comment(
        session,
        content_block_id=post.id,
        user=current_user,
        body=payload.body,
        parent_id=payload.parent_id,
    )
    if settings.smtp_enabled:
        post_url = f"{settings.frontend_origin.rstrip('/')}/blog/{slug}"
        snippet = (payload.body or "").strip()
        snippet = (snippet[:400] + "…") if len(snippet) > 400 else snippet

        admins = await session.execute(
            sa.select(User).where(User.role.in_([UserRole.admin, UserRole.owner]), User.notify_blog_comments.is_(True))
        )
        for admin in admins.scalars().all():
            if not admin.email:
                continue
            if admin.id == current_user.id:
                continue
            background_tasks.add_task(
                email_service.send_blog_comment_admin_notification,
                admin.email,
                post_title=post.title,
                post_url=post_url,
                commenter_name=current_user.name or current_user.email,
                comment_body=snippet,
                lang=admin.preferred_language,
            )

        if payload.parent_id:
            parent = await session.execute(
                sa.select(BlogComment)
                .options(selectinload(BlogComment.author))
                .where(BlogComment.id == payload.parent_id)
            )
            parent_comment = parent.scalar_one_or_none()
            recipient = parent_comment.author if parent_comment else None
            if (
                recipient
                and recipient.email
                and recipient.id != current_user.id
                and recipient.notify_blog_comment_replies
            ):
                background_tasks.add_task(
                    email_service.send_blog_comment_reply_notification,
                    recipient.email,
                    post_title=post.title,
                    post_url=post_url,
                    replier_name=current_user.name or current_user.email,
                    comment_body=snippet,
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
                    body=post.title,
                    url=f"/blog/{slug}",
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
