from __future__ import annotations

import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import security
from app.core.config import settings
from app.models.blog import BlogComment
from app.models.content import ContentBlock
from app.models.order import Order, OrderItem
from app.models.user import RefreshSession, User, UserSecondaryEmail
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


def _deleted_username(user_id: Any) -> str:
    try:
        suffix = str(getattr(user_id, "hex", "") or "").strip()
    except Exception:
        suffix = ""
    suffix = suffix or secrets.token_hex(16)
    return f"deleted-{suffix[:22]}"


async def process_due_account_deletions(session: AsyncSession, *, limit: int = 200) -> int:
    now = datetime.now(timezone.utc)
    limit_clean = max(1, min(int(limit or 0), 2000))
    rows = (
        (
            await session.execute(
                sa.select(User)
                .where(
                    User.deleted_at.is_(None),
                    User.deletion_scheduled_for.is_not(None),
                    User.deletion_scheduled_for <= now,
                )
                .order_by(User.deletion_scheduled_for.asc())
                .limit(limit_clean)
            )
        )
        .scalars()
        .all()
    )
    deleted = 0
    for user in rows:
        await execute_account_deletion(session, user)
        deleted += 1
    return deleted


async def execute_account_deletion(session: AsyncSession, user: User) -> None:
    if getattr(user, "deleted_at", None) is not None:
        return

    now = datetime.now(timezone.utc)
    user.deleted_at = now
    user.deletion_requested_at = _ensure_utc(getattr(user, "deletion_requested_at", None)) or now
    user.deletion_scheduled_for = _ensure_utc(getattr(user, "deletion_scheduled_for", None)) or now

    user.email = f"deleted+{user.id}@example.invalid"
    user.username = _deleted_username(user.id)
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
    await session.execute(sa.delete(UserSecondaryEmail).where(UserSecondaryEmail.user_id == user.id))
    await session.execute(
        sa.update(RefreshSession)
        .where(RefreshSession.user_id == user.id, RefreshSession.revoked.is_(False))
        .values(revoked=True, revoked_reason="account_deleted")
    )
    await session.commit()


def _is_profile_complete(user: User) -> bool:
    required_strings = [
        user.name,
        user.username,
        getattr(user, "first_name", None),
        getattr(user, "last_name", None),
        getattr(user, "phone", None),
    ]
    if not all((value or "").strip() for value in required_strings):
        return False
    return bool(getattr(user, "date_of_birth", None))


async def cleanup_incomplete_google_accounts(session: AsyncSession, *, max_age_hours: int = 24 * 30) -> int:
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


_last_incomplete_google_cleanup_at: datetime | None = None


async def maybe_cleanup_incomplete_google_accounts(session: AsyncSession) -> int:
    """Opportunistically clean abandoned incomplete Google signups.

    Runs at most once per 24h per process and uses a fixed 30-day grace period.
    """
    global _last_incomplete_google_cleanup_at
    now = datetime.now(timezone.utc)
    if _last_incomplete_google_cleanup_at and now - _last_incomplete_google_cleanup_at < timedelta(hours=24):
        return 0
    _last_incomplete_google_cleanup_at = now
    return await cleanup_incomplete_google_accounts(session, max_age_hours=24 * 30)


async def export_user_data(session: AsyncSession, user: User) -> dict[str, Any]:
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
        "exported_at": _iso_or_none(datetime.now(timezone.utc)),
        "app": {"name": settings.app_name, "version": settings.app_version},
        "user": _export_user_profile(user),
        "orders": _export_orders(orders),
        "wishlist": _export_wishlist(wishlist_items),
        "comments": _export_comments(comment_rows),
    }


def _iso_or_none(dt: datetime | None) -> str | None:
    value = _ensure_utc(dt)
    return value.isoformat() if value else None


def _export_user_profile(user: User) -> dict[str, Any]:
    return {
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
        "created_at": _iso_or_none(user.created_at),
        "updated_at": _iso_or_none(user.updated_at),
    }


def _export_orders(orders: Sequence[Order]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for order in orders:
        payload.append(
            {
                "id": str(order.id),
                "reference_code": order.reference_code,
                "status": order.status.value,
                "currency": order.currency,
                "tax_amount": float(order.tax_amount),
                "shipping_amount": float(order.shipping_amount),
                "total_amount": float(order.total_amount),
                "tracking_number": order.tracking_number,
                "created_at": _iso_or_none(order.created_at),
                "updated_at": _iso_or_none(order.updated_at),
                "items": _export_order_items(order.items),
            }
        )
    return payload


def _export_order_items(items: list[OrderItem]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "product_id": str(item.product_id),
            "product_slug": item.product.slug if item.product else None,
            "product_name": item.product.name if item.product else None,
            "quantity": item.quantity,
            "unit_price": float(item.unit_price),
            "subtotal": float(item.subtotal),
        }
        for item in items
    ]


def _export_wishlist(items: Sequence[WishlistItem]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "product_id": str(item.product_id),
            "product_slug": item.product.slug if item.product else None,
            "product_name": item.product.name if item.product else None,
            "created_at": _iso_or_none(item.created_at),
        }
        for item in items
    ]


def _comment_status(comment: BlogComment) -> str:
    if comment.is_deleted:
        return "deleted"
    if comment.is_hidden:
        return "hidden"
    return "posted"


def _comment_body(comment: BlogComment) -> str:
    if comment.is_deleted or comment.is_hidden:
        return ""
    return comment.body


def _comment_post_slug(post_key: Any) -> str:
    as_text = str(post_key)
    if as_text.startswith("blog."):
        return as_text.split("blog.", 1)[-1]
    return as_text


def _export_comments(comment_rows: Sequence[Any]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for comment, post_key, post_title in comment_rows:
        payload.append(
            {
                "id": str(comment.id),
                "post_slug": _comment_post_slug(post_key),
                "post_title": post_title,
                "parent_id": str(comment.parent_id) if comment.parent_id else None,
                "status": _comment_status(comment),
                "created_at": _iso_or_none(comment.created_at),
                "updated_at": _iso_or_none(comment.updated_at),
                "body": _comment_body(comment),
            }
        )
    return payload
