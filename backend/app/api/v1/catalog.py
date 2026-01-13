from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import require_admin, get_current_user_optional, require_complete_profile
from app.db.session import get_session
from app.models.catalog import Category, Product, ProductReview, ProductStatus
from app.models.user import UserRole
from app.schemas.catalog import (
    CategoryCreate,
    CategoryRead,
    CategoryTranslationRead,
    CategoryTranslationUpsert,
    CategoryUpdate,
    CategoryReorderItem,
    ProductCreate,
    ProductRead,
    ProductTranslationRead,
    ProductTranslationUpsert,
    ProductUpdate,
    ProductReviewCreate,
    ProductReviewRead,
    BulkProductUpdateItem,
    ProductListResponse,
    ImportResult,
    FeaturedCollectionCreate,
    FeaturedCollectionRead,
    FeaturedCollectionUpdate,
    ProductFeedItem,
    ProductPriceBounds,
    BackInStockRequestRead,
    BackInStockStatus,
)
from app.services import catalog as catalog_service
from app.services import storage

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    session: AsyncSession = Depends(get_session), lang: str | None = Query(default=None, pattern="^(en|ro)$")
) -> list[Category]:
    query = select(Category).order_by(Category.sort_order, Category.name)
    if lang:
        query = query.options(selectinload(Category.translations))
    result = await session.execute(query)
    categories = list(result.scalars())
    if lang:
        for cat in categories:
            catalog_service.apply_category_translation(cat, lang)
    return categories


@router.get("/products", response_model=ProductListResponse)
async def list_products(
    session: AsyncSession = Depends(get_session),
    category_slug: str | None = Query(default=None),
    is_featured: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    min_price: float | None = Query(default=None, ge=0),
    max_price: float | None = Query(default=None, ge=0),
    tags: list[str] | None = Query(default=None),
    sort: str | None = Query(default=None, description="newest|price_asc|price_desc|name_asc|name_desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> ProductListResponse:
    offset = (page - 1) * limit
    min_bound, max_bound, currency = await catalog_service.get_product_price_bounds(
        session,
        category_slug=category_slug,
        is_featured=is_featured,
        search=search,
        tags=tags,
    )
    items, total_items = await catalog_service.list_products_with_filters(
        session, category_slug, is_featured, search, min_price, max_price, tags, sort, limit, offset, lang=lang
    )
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    return ProductListResponse(
        items=items,
        meta={"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit},
        bounds=ProductPriceBounds(min_price=min_bound, max_price=max_bound, currency=currency),
    )


@router.get("/products/price-bounds", response_model=ProductPriceBounds)
async def get_product_price_bounds(
    session: AsyncSession = Depends(get_session),
    category_slug: str | None = Query(default=None),
    is_featured: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
) -> ProductPriceBounds:
    min_price, max_price, currency = await catalog_service.get_product_price_bounds(
        session,
        category_slug=category_slug,
        is_featured=is_featured,
        search=search,
        tags=tags,
    )
    return ProductPriceBounds(min_price=min_price, max_price=max_price, currency=currency)


@router.get("/products/feed", response_model=list[ProductFeedItem])
async def product_feed(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> list[ProductFeedItem]:
    return await catalog_service.get_product_feed(session, lang=lang)


@router.get("/products/feed.csv", response_class=StreamingResponse)
async def product_feed_csv(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
):
    content = await catalog_service.get_product_feed_csv(session, lang=lang)
    headers = {"Content-Disposition": 'attachment; filename="product_feed.csv"'}
    return StreamingResponse(iter([content]), media_type="text/csv", headers=headers)


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


@router.get("/categories/{slug}/translations", response_model=list[CategoryTranslationRead])
async def list_category_translations(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> list[CategoryTranslationRead]:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    translations = await catalog_service.list_category_translations(session, category)
    return [CategoryTranslationRead.model_validate(t) for t in translations]


@router.put("/categories/{slug}/translations/{lang}", response_model=CategoryTranslationRead)
async def upsert_category_translation(
    slug: str,
    lang: str = Path(..., pattern="^(en|ro)$"),
    payload: CategoryTranslationUpsert = ...,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> CategoryTranslationRead:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    updated = await catalog_service.upsert_category_translation(session, category=category, lang=lang, payload=payload)
    return CategoryTranslationRead.model_validate(updated)


@router.delete("/categories/{slug}/translations/{lang}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category_translation(
    slug: str,
    lang: str = Path(..., pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> None:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await catalog_service.delete_category_translation(session, category=category, lang=lang)
    return None


@router.delete("/categories/{slug}", response_model=CategoryRead)
async def delete_category(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Category:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await session.delete(category)
    await session.commit()
    return category


@router.post("/categories/reorder", response_model=list[CategoryRead])
async def reorder_categories(
    payload: list[CategoryReorderItem],
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> list[CategoryRead]:
    updated = await catalog_service.reorder_categories(session, payload)
    return updated


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin),
) -> Product:
    return await catalog_service.create_product(session, payload, user_id=current_user.id)


@router.patch("/products/{slug}", response_model=ProductRead)
async def update_product(
    slug: str,
    payload: ProductUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await catalog_service.update_product(session, product, payload, user_id=current_user.id)


@router.get("/products/{slug}/translations", response_model=list[ProductTranslationRead])
async def list_product_translations(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> list[ProductTranslationRead]:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    translations = await catalog_service.list_product_translations(session, product)
    return [ProductTranslationRead.model_validate(t) for t in translations]


@router.put("/products/{slug}/translations/{lang}", response_model=ProductTranslationRead)
async def upsert_product_translation(
    slug: str,
    lang: str = Path(..., pattern="^(en|ro)$"),
    payload: ProductTranslationUpsert = ...,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> ProductTranslationRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    updated = await catalog_service.upsert_product_translation(session, product=product, lang=lang, payload=payload)
    return ProductTranslationRead.model_validate(updated)


@router.delete("/products/{slug}/translations/{lang}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_translation(
    slug: str,
    lang: str = Path(..., pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> None:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.delete_product_translation(session, product=product, lang=lang)
    return None


@router.delete("/products/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_product(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin),
) -> None:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.soft_delete_product(session, product, user_id=current_user.id)
    return None


@router.post("/products/{slug}/images", response_model=ProductRead)
async def upload_product_image(
    slug: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    path, filename = storage.save_upload(
        file,
        allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif"),
        max_bytes=5 * 1024 * 1024,
        generate_thumbnails=True,
    )
    await catalog_service.add_product_image_from_path(
        session, product, url=path, alt_text=filename, sort_order=len(product.images) + 1
    )
    await session.refresh(product)
    return product


@router.post("/products/bulk-update", response_model=list[ProductRead])
async def bulk_update_products(
    payload: list[BulkProductUpdateItem],
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin),
) -> list[Product]:
    updated = await catalog_service.bulk_update_products(session, payload, user_id=current_user.id)
    return updated


@router.get("/collections/featured", response_model=list[FeaturedCollectionRead])
async def list_featured_collections(session: AsyncSession = Depends(get_session)) -> list[FeaturedCollectionRead]:
    collections = await catalog_service.list_featured_collections(session)
    return [FeaturedCollectionRead.model_validate(c) for c in collections]


@router.post("/collections/featured", response_model=FeaturedCollectionRead, status_code=status.HTTP_201_CREATED)
async def create_featured_collection(
    payload: FeaturedCollectionCreate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> FeaturedCollectionRead:
    created = await catalog_service.create_featured_collection(session, payload)
    return FeaturedCollectionRead.model_validate(created)


@router.patch("/collections/featured/{slug}", response_model=FeaturedCollectionRead)
async def update_featured_collection(
    slug: str,
    payload: FeaturedCollectionUpdate,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> FeaturedCollectionRead:
    collection = await catalog_service.get_featured_collection_by_slug(session, slug)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    updated = await catalog_service.update_featured_collection(session, collection, payload)
    return FeaturedCollectionRead.model_validate(updated)


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


@router.get("/products/recently-viewed", response_model=list[ProductRead])
async def recently_viewed_products(
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Query(default=None, description="Client session identifier for guests"),
    limit: int = Query(default=5, ge=1, le=20),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    current_user=Depends(get_current_user_optional),
) -> list[Product]:
    products = await catalog_service.get_recently_viewed(
        session, getattr(current_user, "id", None) if current_user else None, session_id, limit
    )
    if lang:
        for p in products:
            catalog_service.apply_product_translation(p, lang)
    return products


@router.get("/products/export", response_class=StreamingResponse)
async def export_products_csv(
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
):
    content = await catalog_service.export_products_csv(session)
    headers = {"Content-Disposition": 'attachment; filename="products.csv"'}
    return StreamingResponse(iter([content]), media_type="text/csv", headers=headers)


@router.post("/products/import", response_model=ImportResult)
async def import_products_csv(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> ImportResult:
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file required")
    raw = await file.read()
    try:
        content = raw.decode()
    except UnicodeDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to decode CSV")
    result = await catalog_service.import_products_csv(session, content, dry_run=dry_run)
    return ImportResult(**result)


@router.get("/products/{slug}", response_model=ProductRead)
async def get_product(
    slug: str,
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Query(default=None, description="Client session identifier for recently viewed tracking"),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    current_user=Depends(get_current_user_optional),
) -> Product:
    product_options = [selectinload(Product.images)]
    if lang:
        product_options.append(selectinload(Product.translations))
        product_options.append(selectinload(Product.category).selectinload(Category.translations))
    else:
        product_options.append(selectinload(Product.category))
    product = await catalog_service.get_product_by_slug(
        session, slug, options=product_options, follow_history=True, lang=lang
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) in (UserRole.admin, UserRole.owner)
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if product.is_active and product.status == ProductStatus.published:
        await catalog_service.record_recently_viewed(
            session, product, getattr(current_user, "id", None) if current_user else None, session_id
        )
    return product


@router.get("/products/{slug}/back-in-stock", response_model=BackInStockStatus)
async def get_back_in_stock_status(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> BackInStockStatus:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) in (UserRole.admin, UserRole.owner)
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    request = await catalog_service.get_active_back_in_stock_request(session, user_id=current_user.id, product_id=product.id)
    return BackInStockStatus(
        in_stock=not catalog_service.is_out_of_stock(product),
        request=BackInStockRequestRead.model_validate(request) if request else None,
    )


@router.post("/products/{slug}/back-in-stock", response_model=BackInStockRequestRead)
async def request_back_in_stock(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> BackInStockRequestRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) in (UserRole.admin, UserRole.owner)
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    record = await catalog_service.create_back_in_stock_request(session, user_id=current_user.id, product=product)
    return BackInStockRequestRead.model_validate(record)


@router.delete("/products/{slug}/back-in-stock", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_back_in_stock(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> None:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) in (UserRole.admin, UserRole.owner)
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.cancel_back_in_stock_request(session, user_id=current_user.id, product_id=product.id)
    return None


@router.delete("/products/{slug}/images/{image_id}", response_model=ProductRead)
async def delete_product_image(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    await catalog_service.delete_product_image(session, product, str(image_id), user_id=current_user.id)
    await session.refresh(product)
    return product


@router.patch("/products/{slug}/images/{image_id}/sort", response_model=ProductRead)
async def reorder_product_image(
    slug: str,
    image_id: UUID,
    sort_order: int = Query(..., ge=0),
    session: AsyncSession = Depends(get_session),
    _: str = Depends(require_admin),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    updated = await catalog_service.update_product_image_sort(session, product, str(image_id), sort_order)
    return updated


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
    is_admin = current_user is not None and getattr(current_user, "role", None) in (UserRole.admin, UserRole.owner)
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
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
async def related_products(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> list[Product]:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) in (UserRole.admin, UserRole.owner)
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    related = await catalog_service.get_related_products(session, product, limit=4)
    return related
