import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.blog import BlogCommentCreate, BlogCommentListResponse, BlogCommentRead, BlogPostListResponse, BlogPostRead
from app.schemas.catalog import PaginationMeta
from app.services import blog as blog_service

router = APIRouter(prefix="/blog", tags=["blog"])


@router.get("/posts", response_model=BlogPostListResponse)
async def list_blog_posts(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
) -> BlogPostListResponse:
    blocks, total_items = await blog_service.list_published_posts(session, lang=lang, page=page, limit=limit)
    total_pages = (total_items + limit - 1) // limit if total_items else 1
    return BlogPostListResponse(
        items=[blog_service.to_list_item(b) for b in blocks],
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
    return BlogPostRead.model_validate(blog_service.to_read(block))


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


@router.post("/posts/{slug}/comments", response_model=BlogCommentRead, status_code=status.HTTP_201_CREATED)
async def create_blog_comment(
    slug: str,
    payload: BlogCommentCreate,
    current_user: User = Depends(get_current_user),
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
    return BlogCommentRead.model_validate(blog_service.to_comment_read(comment))


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blog_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await blog_service.soft_delete_comment(session, comment_id=comment_id, actor=current_user)
    return None
