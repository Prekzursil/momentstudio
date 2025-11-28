from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, require_admin
from app.db.session import get_session
from app.models.catalog import Category, Product
from app.schemas.catalog import (
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
)
from app.services import catalog as catalog_service

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(session: AsyncSession = Depends(get_session)) -> list[Category]:
    result = await session.execute(select(Category).order_by(Category.name))
    return list(result.scalars())


@router.get("/products", response_model=list[ProductRead])
async def list_products(
    session: AsyncSession = Depends(get_session),
    category_slug: str | None = Query(default=None),
    is_featured: bool | None = Query(default=None),
) -> list[Product]:
    query = select(Product).options(selectinload(Product.images), selectinload(Product.category))
    if category_slug:
        query = query.join(Category).where(Category.slug == category_slug)
    if is_featured is not None:
        query = query.where(Product.is_featured == is_featured)
    result = await session.execute(query.order_by(Product.created_at.desc()))
    return list(result.scalars().unique())


@router.get("/products/{slug}", response_model=ProductRead)
async def get_product(slug: str, session: AsyncSession = Depends(get_session)) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


# Admin endpoints


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Category:
    return await catalog_service.create_category(session, payload)


@router.patch("/categories/{slug}", response_model=CategoryRead)
async def update_category(
    slug: str,
    payload: CategoryUpdate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Category:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return await catalog_service.update_category(session, category, payload)


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    return await catalog_service.create_product(session, payload)


@router.patch("/products/{slug}", response_model=ProductRead)
async def update_product(
    slug: str,
    payload: ProductUpdate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await catalog_service.update_product(session, product, payload)
