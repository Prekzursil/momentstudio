from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import require_admin, get_current_user_optional
from app.db.session import get_session
from app.models.catalog import Category, Product, Tag, ProductReview
from app.schemas.catalog import (
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    ProductReviewCreate,
    ProductReviewRead,
    BulkProductUpdateItem,
)
from app.services import catalog as catalog_service
from app.services import storage

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
    search: str | None = Query(default=None),
    min_price: float | None = Query(default=None, ge=0),
    max_price: float | None = Query(default=None, ge=0),
    tags: list[str] | None = Query(default=None),
    sort: str | None = Query(default=None, description="newest|price_asc|price_desc|name_asc|name_desc"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[Product]:
    query = select(Product).options(
        selectinload(Product.images),
        selectinload(Product.category),
        selectinload(Product.tags),
    )
    query = query.where(Product.is_deleted.is_(False))
    if category_slug:
        query = query.join(Category).where(Category.slug == category_slug)
    if is_featured is not None:
        query = query.where(Product.is_featured == is_featured)
    if search:
        like = f"%{search.lower()}%"
        query = query.where(
            (Product.name.ilike(like)) | (Product.short_description.ilike(like)) | (Product.long_description.ilike(like))
        )
    if min_price is not None:
        query = query.where(Product.base_price >= min_price)
    if max_price is not None:
        query = query.where(Product.base_price <= max_price)
    if tags:
        query = query.join(Product.tags).where(Tag.slug.in_(tags))
    if sort == "price_asc":
        query = query.order_by(Product.base_price.asc())
    elif sort == "price_desc":
        query = query.order_by(Product.base_price.desc())
    elif sort == "name_asc":
        query = query.order_by(Product.name.asc())
    elif sort == "name_desc":
        query = query.order_by(Product.name.desc())
    else:
        query = query.order_by(Product.created_at.desc())
    result = await session.execute(query.limit(limit).offset(offset))
    return list(result.scalars().unique())


@router.get("/products/{slug}", response_model=ProductRead)
async def get_product(slug: str, session: AsyncSession = Depends(get_session)) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
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


@router.delete("/products/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_product(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> None:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.soft_delete_product(session, product)
    return None


@router.post("/products/{slug}/images", response_model=ProductRead)
async def upload_product_image(
    slug: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")
    if file.size and file.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    path, filename = storage.save_upload(file)
    await catalog_service.add_product_image_from_path(
        session, product, url=path, alt_text=filename, sort_order=len(product.images) + 1
    )
    await session.refresh(product)
    return product


@router.post("/products/bulk-update", response_model=list[ProductRead])
async def bulk_update_products(
    payload: list[BulkProductUpdateItem],
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> list[Product]:
    updated = await catalog_service.bulk_update_products(session, payload)
    return updated


@router.post("/products/{slug}/duplicate", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def duplicate_product(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category), selectinload(Product.options)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    clone = await catalog_service.duplicate_product(session, product)
    return clone


@router.delete("/products/{slug}/images/{image_id}", response_model=ProductRead)
async def delete_product_image(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    await catalog_service.delete_product_image(session, product, image_id)
    await session.refresh(product)
    return product


@router.post("/products/{slug}/reviews", response_model=ProductReviewRead, status_code=status.HTTP_201_CREATED)
async def create_review(
    slug: str,
    payload: ProductReviewCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> ProductReviewRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    review = await catalog_service.add_review(session, product, payload, getattr(current_user, "id", None) if current_user else None)
    return review


@router.post("/products/{slug}/reviews/{review_id}/approve", response_model=ProductReviewRead)
async def approve_review(
    slug: str,
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> ProductReviewRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    result = await session.execute(
        select(ProductReview).where(ProductReview.id == review_id, ProductReview.product_id == product.id)
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    review = await catalog_service.approve_review(session, review)
    return review


@router.get("/products/{slug}/related", response_model=list[ProductRead])
async def related_products(slug: str, session: AsyncSession = Depends(get_session)) -> list[Product]:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    related = await catalog_service.get_related_products(session, product, limit=4)
    return related
