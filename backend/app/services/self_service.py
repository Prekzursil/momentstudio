from __future__ import annotations

import secrets
from datetime import datetime, timezone, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import security
from app.core.config import settings
from app.models.blog import BlogComment
from app.models.content import ContentBlock
from app.models.order import Order, OrderItem
from app.models.user import RefreshSession, User
from app.models.wishlist import WishlistItem


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if not dt:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_deletion_due(user: User, *, now: datetime | None = None) -> bool:
    scheduled = _ensure_utc(getattr(user, "deletion_scheduled_for", None))
    if not scheduled:
        return False
    now_utc = _ensure_utc(now) or datetime.now(timezone.utc)
    return scheduled <= now_utc


async def execute_account_deletion(session: AsyncSession, user: User) -> None:
    if getattr(user, "deleted_at", None) is not None:
        return

    now = datetime.now(timezone.utc)
    user.deleted_at = now
    user.deletion_requested_at = _ensure_utc(getattr(user, "deletion_requested_at", None)) or now
    user.deletion_scheduled_for = _ensure_utc(getattr(user, "deletion_scheduled_for", None)) or now

    user.email = f"deleted+{user.id}@example.invalid"
    user.name = None
    user.first_name = None
    user.middle_name = None
    user.last_name = None
    user.date_of_birth = None
    user.phone = None
    user.avatar_url = None
    user.email_verified = False
    user.notify_blog_comments = False
    user.notify_blog_comment_replies = False
    user.notify_marketing = False
    user.google_sub = None
    user.google_email = None
    user.google_picture_url = None
    user.stripe_customer_id = None
    user.hashed_password = security.hash_password(secrets.token_urlsafe(32))

    session.add(user)
    await session.execute(
        sa.update(RefreshSession)
        .where(RefreshSession.user_id == user.id, RefreshSession.revoked.is_(False))
        .values(revoked=True, revoked_reason="account_deleted")
    )
    await session.commit()


def _is_profile_complete(user: User) -> bool:
    return bool(
        (user.name or "").strip()
        and (user.username or "").strip()
        and (getattr(user, "first_name", None) or "").strip()
        and (getattr(user, "last_name", None) or "").strip()
        and getattr(user, "date_of_birth", None)
        and (getattr(user, "phone", None) or "").strip()
    )


async def cleanup_incomplete_google_accounts(session: AsyncSession, *, max_age_hours: int = 168) -> int:
    """Soft-delete Google-created accounts that never completed required profile fields.

    This is intended as an optional maintenance task to reduce abandoned/incomplete records.
    """
    threshold = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    rows = (
        await session.execute(
            sa.select(User).where(
                User.google_sub.is_not(None),
                User.deleted_at.is_(None),
                User.created_at < threshold,
            )
        )
    ).scalars().all()

    deleted = 0
    for user in rows:
        if _is_profile_complete(user):
            continue
        await execute_account_deletion(session, user)
        deleted += 1
    return deleted


async def export_user_data(session: AsyncSession, user: User) -> dict[str, Any]:
    def iso(dt: datetime | None) -> str | None:
        value = _ensure_utc(dt)
        return value.isoformat() if value else None

    orders = (
        (
            await session.execute(
                sa.select(Order)
                .options(selectinload(Order.items).selectinload(OrderItem.product))
                .where(Order.user_id == user.id)
                .order_by(Order.created_at.desc())
            )
        )
        .scalars()
        .unique()
        .all()
    )

    wishlist_items = (
        (
            await session.execute(
                sa.select(WishlistItem)
                .options(selectinload(WishlistItem.product))
                .where(WishlistItem.user_id == user.id)
                .order_by(WishlistItem.created_at.desc())
            )
        )
        .scalars()
        .unique()
        .all()
    )

    comment_rows = (
        await session.execute(
            sa.select(BlogComment, ContentBlock.key, ContentBlock.title)
            .join(ContentBlock, ContentBlock.id == BlogComment.content_block_id)
            .where(BlogComment.user_id == user.id)
            .order_by(BlogComment.created_at.desc())
            .limit(2000)
        )
    ).all()

    return {
        "exported_at": iso(datetime.now(timezone.utc)),
        "app": {"name": settings.app_name, "version": settings.app_version},
        "user": {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "name": user.name,
            "first_name": getattr(user, "first_name", None),
            "middle_name": getattr(user, "middle_name", None),
            "last_name": getattr(user, "last_name", None),
            "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else None,
            "phone": user.phone,
            "avatar_url": user.avatar_url,
            "preferred_language": user.preferred_language,
            "email_verified": user.email_verified,
            "role": user.role.value,
            "created_at": iso(user.created_at),
            "updated_at": iso(user.updated_at),
        },
        "orders": [
            {
                "id": str(o.id),
                "reference_code": o.reference_code,
                "status": o.status.value,
                "currency": o.currency,
                "tax_amount": float(o.tax_amount),
                "shipping_amount": float(o.shipping_amount),
                "total_amount": float(o.total_amount),
                "tracking_number": o.tracking_number,
                "created_at": iso(o.created_at),
                "updated_at": iso(o.updated_at),
                "items": [
                    {
                        "id": str(oi.id),
                        "product_id": str(oi.product_id),
                        "product_slug": oi.product.slug if oi.product else None,
                        "product_name": oi.product.name if oi.product else None,
                        "quantity": oi.quantity,
                        "unit_price": float(oi.unit_price),
                        "subtotal": float(oi.subtotal),
                    }
                    for oi in o.items
                ],
            }
            for o in orders
        ],
        "wishlist": [
            {
                "id": str(item.id),
                "product_id": str(item.product_id),
                "product_slug": item.product.slug if item.product else None,
                "product_name": item.product.name if item.product else None,
                "created_at": iso(item.created_at),
            }
            for item in wishlist_items
        ],
        "comments": [
            {
                "id": str(c.id),
                "post_slug": str(post_key).split("blog.", 1)[-1] if str(post_key).startswith("blog.") else str(post_key),
                "post_title": post_title,
                "parent_id": str(c.parent_id) if c.parent_id else None,
                "status": "deleted" if c.is_deleted else "hidden" if c.is_hidden else "posted",
                "created_at": iso(c.created_at),
                "updated_at": iso(c.updated_at),
                "body": "" if c.is_deleted or c.is_hidden else c.body,
            }
            for c, post_key, post_title in comment_rows
        ],
    }
