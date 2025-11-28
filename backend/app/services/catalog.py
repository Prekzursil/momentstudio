from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.catalog import Category, Product, ProductImage
from app.schemas.catalog import (
    CategoryCreate,
    CategoryUpdate,
    ProductCreate,
    ProductImageCreate,
    ProductUpdate,
)


async def get_category_by_slug(session: AsyncSession, slug: str) -> Category | None:
    result = await session.execute(select(Category).where(Category.slug == slug))
    return result.scalar_one_or_none()


async def get_product_by_slug(
    session: AsyncSession, slug: str, options: list | None = None
) -> Product | None:
    query = select(Product)
    if options:
        for opt in options:
            query = query.options(opt)
    result = await session.execute(query.where(Product.slug == slug))
    return result.scalar_one_or_none()


async def create_category(session: AsyncSession, payload: CategoryCreate) -> Category:
    existing = await get_category_by_slug(session, payload.slug)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category slug already exists")
    category = Category(**payload.model_dump())
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


async def update_category(session: AsyncSession, category: Category, payload: CategoryUpdate) -> Category:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


async def create_product(session: AsyncSession, payload: ProductCreate) -> Product:
    existing = await get_product_by_slug(session, payload.slug)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product slug already exists")

    images_payload = payload.images or []
    product_data = payload.model_dump(exclude={"images"})
    product = Product(**product_data)
    product.images = [ProductImage(**img.model_dump()) for img in images_payload]
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


async def update_product(session: AsyncSession, product: Product, payload: ProductUpdate) -> Product:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


async def add_product_image(session: AsyncSession, product: Product, payload: ProductImageCreate) -> ProductImage:
    image = ProductImage(product=product, **payload.model_dump())
    session.add(image)
    await session.commit()
    await session.refresh(image)
    return image
