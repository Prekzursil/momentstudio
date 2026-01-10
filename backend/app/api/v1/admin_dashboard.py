from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import require_admin, require_owner
from app.db.session import get_session
from app.models.catalog import Product, ProductAuditLog, Category
from app.models.content import ContentBlock, ContentAuditLog
from app.services import exporter as exporter_service
from app.models.order import Order
from app.models.user import User, RefreshSession, UserRole
from app.models.promo import PromoCode
from app.services import auth as auth_service

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
            "username": u.username,
            "name": u.name,
            "name_tag": u.name_tag,
            "role": u.role,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.get("/users/{user_id}/aliases")
async def admin_user_aliases(
    user_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    usernames = await auth_service.list_username_history(session, user_id)
    display_names = await auth_service.list_display_name_history(session, user_id)
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "name": user.name,
            "name_tag": user.name_tag,
            "role": user.role,
        },
        "usernames": [{"username": row.username, "created_at": row.created_at} for row in usernames],
        "display_names": [
            {"name": row.name, "name_tag": row.name_tag, "created_at": row.created_at} for row in display_names
        ],
    }


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


@router.post("/coupons", status_code=status.HTTP_201_CREATED)
async def admin_create_coupon(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    code = payload.get("code")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="code required")
    currency = payload.get("currency")
    if currency:
        currency = str(currency).strip().upper()
        if currency != "RON":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only RON currency is supported")
    promo = PromoCode(
        code=code,
        percentage_off=payload.get("percentage_off"),
        amount_off=payload.get("amount_off"),
        currency=currency or None,
        expires_at=payload.get("expires_at"),
        max_uses=payload.get("max_uses"),
        active=payload.get("active", True),
    )
    session.add(promo)
    await session.commit()
    return {
        "id": str(promo.id),
        "code": promo.code,
        "percentage_off": float(promo.percentage_off) if promo.percentage_off is not None else None,
        "amount_off": float(promo.amount_off) if promo.amount_off is not None else None,
        "currency": promo.currency,
        "expires_at": promo.expires_at,
        "active": promo.active,
        "times_used": promo.times_used,
        "max_uses": promo.max_uses,
    }


@router.patch("/coupons/{coupon_id}")
async def admin_update_coupon(
    coupon_id: UUID,
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    promo = await session.get(PromoCode, coupon_id)
    if not promo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coupon not found")
    for field in ["percentage_off", "amount_off", "expires_at", "max_uses", "active", "code"]:
        if field in payload:
            setattr(promo, field, payload[field])
    if "currency" in payload:
        currency = payload.get("currency")
        if currency:
            currency = str(currency).strip().upper()
            if currency != "RON":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only RON currency is supported")
            promo.currency = currency
        else:
            promo.currency = None
    session.add(promo)
    await session.flush()
    await session.commit()
    return {
        "id": str(promo.id),
        "code": promo.code,
        "percentage_off": float(promo.percentage_off) if promo.percentage_off is not None else None,
        "amount_off": float(promo.amount_off) if promo.amount_off is not None else None,
        "currency": promo.currency,
        "expires_at": promo.expires_at,
        "active": promo.active,
        "times_used": promo.times_used,
        "max_uses": promo.max_uses,
    }


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
        await session.commit()
    return None


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: UUID,
    payload: dict,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> dict:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner role can only be transferred")
    role = payload.get("role")
    if role not in (UserRole.admin.value, UserRole.customer.value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    user.role = UserRole(role)
    session.add(user)
    await session.flush()
    await session.commit()
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "name": user.name,
        "name_tag": user.name_tag,
        "role": user.role,
        "created_at": user.created_at,
    }


@router.post("/owner/transfer")
async def transfer_owner(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    current_owner: User = Depends(require_owner),
) -> dict:
    identifier = str(payload.get("identifier") or "").strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier is required")

    if "@" in identifier:
        target = await auth_service.get_user_by_email(session, identifier)
    else:
        target = await auth_service.get_user_by_username(session, identifier)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.id == current_owner.id:
        return {"old_owner_id": str(current_owner.id), "new_owner_id": str(target.id)}

    current_owner.role = UserRole.admin
    session.add(current_owner)
    await session.flush()

    target.role = UserRole.owner
    session.add(target)
    await session.commit()
    await session.refresh(target)

    return {
        "old_owner_id": str(current_owner.id),
        "new_owner_id": str(target.id),
        "email": target.email,
        "username": target.username,
        "name": target.name,
        "name_tag": target.name_tag,
        "role": target.role,
    }


@router.get("/maintenance")
async def get_maintenance(_: str = Depends(require_admin)) -> dict:
    return {"enabled": settings.maintenance_mode}


@router.post("/maintenance")
async def set_maintenance(payload: dict, _: str = Depends(require_admin)) -> dict:
    enabled = bool(payload.get("enabled", False))
    settings.maintenance_mode = enabled
    return {"enabled": settings.maintenance_mode}


@router.get("/export")
async def export_data(session: AsyncSession = Depends(get_session), _: str = Depends(require_admin)) -> dict:
    return await exporter_service.export_json(session)


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
