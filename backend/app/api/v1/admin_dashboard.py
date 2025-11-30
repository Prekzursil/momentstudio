from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin
from app.db.session import get_session
from app.models.catalog import Product, ProductAuditLog, Category
from app.models.content import ContentBlock, ContentAuditLog
from app.models.order import Order, OrderStatus
from app.models.user import User, RefreshSession
from app.models.promo import PromoCode

router = APIRouter(prefix="/admin/dashboard", tags=["admin"])


@router.get("/summary")
async def admin_summary(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    products_total = await session.scalar(select(func.count()).select_from(Product).where(Product.is_deleted.is_(False)))
    orders_total = await session.scalar(select(func.count()).select_from(Order))
    users_total = await session.scalar(select(func.count()).select_from(User))

    low_stock = await session.scalar(
        select(func.count())
        .select_from(Product)
        .where(Product.stock_quantity < 5, Product.is_deleted.is_(False), Product.is_active.is_(True))
    )

    since = datetime.now(timezone.utc) - timedelta(days=30)
    sales_30d = await session.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.created_at >= since)
    )
    orders_30d = await session.scalar(select(func.count()).select_from(Order).where(Order.created_at >= since))

    return {
        "products": products_total or 0,
        "orders": orders_total or 0,
        "users": users_total or 0,
        "low_stock": low_stock or 0,
        "sales_30d": float(sales_30d or 0),
        "orders_30d": orders_30d or 0,
    }


@router.get("/products")
async def admin_products(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    stmt = (
        select(Product, Category.name)
        .join(Category, Product.category_id == Category.id)
        .where(Product.is_deleted.is_(False))
        .order_by(Product.updated_at.desc())
        .limit(20)
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {
            "id": str(prod.id),
            "slug": prod.slug,
            "name": prod.name,
            "price": float(prod.base_price),
            "currency": prod.currency,
            "status": prod.status,
            "category": cat_name,
            "stock_quantity": prod.stock_quantity,
        }
        for prod, cat_name in rows
    ]


@router.get("/orders")
async def admin_orders(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    stmt = (
        select(Order, User.email)
        .join(User, Order.user_id == User.id, isouter=True)
        .order_by(Order.created_at.desc())
        .limit(20)
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {
            "id": str(order.id),
            "status": order.status,
            "total_amount": float(order.total_amount),
            "currency": order.currency,
            "created_at": order.created_at,
            "customer": email or "guest",
        }
        for order, email in rows
    ]


@router.get("/users")
async def admin_users(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    result = await session.execute(select(User).order_by(User.created_at.desc()).limit(20))
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.get("/content")
async def admin_content(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    result = await session.execute(select(ContentBlock).order_by(ContentBlock.updated_at.desc()).limit(20))
    blocks = result.scalars().all()
    return [
        {
            "id": str(b.id),
            "key": b.key,
            "title": b.title,
            "updated_at": b.updated_at,
            "version": b.version,
        }
        for b in blocks
    ]


@router.get("/coupons")
async def admin_coupons(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    result = await session.execute(select(PromoCode).order_by(PromoCode.created_at.desc()).limit(20))
    promos = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "percentage_off": float(p.percentage_off) if p.percentage_off is not None else None,
            "amount_off": float(p.amount_off) if p.amount_off is not None else None,
            "currency": p.currency,
            "expires_at": p.expires_at,
            "active": p.active,
            "times_used": p.times_used,
            "max_uses": p.max_uses,
        }
        for p in promos
    ]


@router.get("/audit")
async def admin_audit(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> dict:
    product_audit_stmt = (
        select(ProductAuditLog)
        .options()
        .order_by(ProductAuditLog.created_at.desc())
        .limit(20)
    )
    content_audit_stmt = select(ContentAuditLog).order_by(ContentAuditLog.created_at.desc()).limit(20)
    prod_logs = (await session.execute(product_audit_stmt)).scalars().all()
    content_logs = (await session.execute(content_audit_stmt)).scalars().all()
    return {
        "products": [
            {
                "id": str(log.id),
                "product_id": str(log.product_id),
                "action": log.action,
                "user_id": str(log.user_id) if log.user_id else None,
                "created_at": log.created_at,
            }
            for log in prod_logs
        ],
        "content": [
            {
                "id": str(log.id),
                "block_id": str(log.content_block_id),
                "action": log.action,
                "version": log.version,
                "user_id": str(log.user_id) if log.user_id else None,
                "created_at": log.created_at,
            }
            for log in content_logs
        ],
    }


@router.post("/sessions/{user_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_sessions(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> None:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    result = await session.execute(select(RefreshSession).where(RefreshSession.user_id == user_id, RefreshSession.revoked.is_(False)))
    sessions = result.scalars().all()
    for s in sessions:
        s.revoked = True
        s.revoked_reason = "admin-forced"
    if sessions:
        session.add_all(sessions)
        await session.flush()
    return None


@router.get("/low-stock")
async def low_stock_products(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> list[dict]:
    stmt = (
        select(Product)
        .where(Product.stock_quantity < 5, Product.is_deleted.is_(False), Product.is_active.is_(True))
        .order_by(Product.stock_quantity.asc())
        .limit(20)
    )
    products = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "stock_quantity": p.stock_quantity,
            "sku": p.sku,
            "slug": p.slug,
        }
        for p in products
    ]
