import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria
from fastapi import HTTPException, status

from app.models.wishlist import WishlistItem
from app.models.catalog import Product, ProductImage, ProductStatus


async def list_wishlist(session: AsyncSession, user_id: uuid.UUID):
    result = await session.execute(
        select(WishlistItem)
        .options(
            selectinload(WishlistItem.product).selectinload(Product.images),
            with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True),
        )
        .where(WishlistItem.user_id == user_id)
    )
    items = result.scalars().all()
    return [item.product for item in items if item.product and not item.product.is_deleted]


async def add_to_wishlist(session: AsyncSession, user_id: uuid.UUID, product_id: uuid.UUID) -> Product:
    product = await session.get(Product, product_id)
    if not product or product.is_deleted or product.status != ProductStatus.published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    existing = await session.execute(
        select(WishlistItem).where(WishlistItem.user_id == user_id, WishlistItem.product_id == product_id)
    )
    if existing.scalar_one_or_none():
        return product
    item = WishlistItem(user_id=user_id, product_id=product_id)
    session.add(item)
    await session.commit()
    return product


async def remove_from_wishlist(session: AsyncSession, user_id: uuid.UUID, product_id: uuid.UUID) -> None:
    result = await session.execute(
        select(WishlistItem).where(WishlistItem.user_id == user_id, WishlistItem.product_id == product_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        return
    await session.delete(item)
    await session.commit()
