import json
from functools import partial
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import (
    get_current_user_optional,
    require_admin_section,
    require_complete_profile,
)
from app.db.session import get_session
from app.models.catalog import (
    Category,
    Product,
    ProductAuditLog,
    ProductImage,
    ProductReview,
    ProductStatus,
    ProductRelationshipType,
)
from app.models.user import User, UserRole
from app.schemas.catalog import (
    CategoryCreate,
    CategoryRead,
    CategoryTranslationRead,
    CategoryTranslationUpsert,
    CategoryUpdate,
    CategoryReorderItem,
    CategoryDeletePreview,
    CategoryMergePreview,
    CategoryMergeRequest,
    CategoryMergeResult,
    ProductCreate,
    ProductRead,
    ProductReadBrief,
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
    ProductImageTranslationRead,
    ProductImageTranslationUpsert,
    ProductImageOptimizationStats,
    ProductVariantMatrixUpdate,
    ProductVariantRead,
    ProductRelationshipsRead,
    ProductRelationshipsUpdate,
)
from app.schemas.catalog_admin import AdminDeletedProductImage, AdminProductAuditEntry
from app.services import audit_chain as audit_chain_service
from app.services import catalog as catalog_service
from app.services import storage
from app.services import step_up as step_up_service

router = APIRouter(prefix="/catalog", tags=["catalog"])

_CSV_IMPORT_MAX_BYTES = 25 * 1024 * 1024


async def _read_upload_csv_bytes(file: UploadFile, *, max_bytes: int = _CSV_IMPORT_MAX_BYTES) -> bytes:
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file too large")
    return raw


def _normalize_sale_filter(category_slug: str | None, on_sale: bool | None) -> tuple[str | None, bool | None]:
    if category_slug == "sale" and on_sale is None:
        return None, True
    return category_slug, on_sale


def _is_catalog_staff(user: User | None) -> bool:
    return user is not None and user.role in {UserRole.admin, UserRole.owner, UserRole.content}


def _build_product_list_payload(items: list[Product]) -> list[ProductRead]:
    payload_items: list[ProductRead] = []
    for item in items:
        model = ProductRead.model_validate(item)
        if not catalog_service.is_sale_active(item):
            model.sale_price = None
        payload_items.append(model)
    return payload_items


def _build_product_list_meta(total_items: int, page: int, limit: int) -> dict[str, int]:
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    return {"total_items": total_items, "total_pages": total_pages, "page": page, "limit": limit}


async def _fetch_product_listing_data(
    session: AsyncSession,
    *,
    category_slug: str | None,
    on_sale: bool | None,
    is_featured: bool | None,
    include_unpublished: bool,
    search: str | None,
    min_price: float | None,
    max_price: float | None,
    tags: list[str] | None,
    sort: str | None,
    limit: int,
    offset: int,
    lang: str | None,
):
    min_bound, max_bound, currency = await catalog_service.get_product_price_bounds(
        session,
        category_slug=category_slug,
        on_sale=on_sale,
        is_featured=is_featured,
        search=search,
        tags=tags,
        include_unpublished=include_unpublished,
    )
    items, total_items = await catalog_service.list_products_with_filters(
        session,
        category_slug,
        on_sale,
        is_featured,
        search,
        min_price,
        max_price,
        tags,
        sort,
        limit,
        offset,
        lang=lang,
        include_unpublished=include_unpublished,
    )
    return items, total_items, ProductPriceBounds(min_price=min_bound, max_price=max_bound, currency=currency)


def _build_product_query_options(lang: str | None):
    image_loader = selectinload(Product.images)
    if lang:
        image_loader = image_loader.selectinload(ProductImage.translations)
        return [
            image_loader,
            selectinload(Product.translations),
            selectinload(Product.category).selectinload(Category.translations),
        ]
    return [image_loader, selectinload(Product.category)]


def _is_catalog_admin_viewer(user: User | None) -> bool:
    return user is not None and getattr(user, "role", None) != UserRole.customer


def _is_product_publicly_visible(product: Product) -> bool:
    return product.is_active and product.status == ProductStatus.published


def _product_is_missing(product: Product | None) -> bool:
    return product is None or product.is_deleted


def _should_hide_product_from_view(product: Product, *, is_admin: bool) -> bool:
    return not is_admin and not _is_product_publicly_visible(product)


def _recently_viewed_user_id(user: User | None):
    return getattr(user, "id", None) if user else None


def _should_hide_sale_price(product: Product, *, is_admin: bool) -> bool:
    return not is_admin and not catalog_service.is_sale_active(product)


def _raise_product_not_found() -> None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    include_hidden: bool = Query(default=False),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[Category]:
    is_staff = current_user is not None and current_user.role in {UserRole.admin, UserRole.owner, UserRole.content}
    query = select(Category).order_by(Category.sort_order, Category.name)
    if not (include_hidden and is_staff):
        query = query.where(Category.is_visible.is_(True))
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
    on_sale: bool | None = Query(default=None),
    is_featured: bool | None = Query(default=None),
    include_unpublished: bool = Query(default=False),
    search: str | None = Query(default=None),
    min_price: float | None = Query(default=None, ge=0),
    max_price: float | None = Query(default=None, ge=0),
    tags: list[str] | None = Query(default=None),
    sort: str | None = Query(default=None, description="recommended|newest|price_asc|price_desc|name_asc|name_desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    current_user: User | None = Depends(get_current_user_optional),
) -> ProductListResponse:
    category_slug, on_sale = _normalize_sale_filter(category_slug, on_sale)
    include_unpublished = bool(include_unpublished and _is_catalog_staff(current_user))

    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    offset = (page - 1) * limit
    items, total_items, bounds = await _fetch_product_listing_data(
        session,
        category_slug=category_slug,
        on_sale=on_sale,
        is_featured=is_featured,
        include_unpublished=include_unpublished,
        search=search,
        min_price=min_price,
        max_price=max_price,
        tags=tags,
        sort=sort,
        limit=limit,
        offset=offset,
        lang=lang,
    )
    payload_items = _build_product_list_payload(items)
    return ProductListResponse(
        items=payload_items,
        meta=_build_product_list_meta(total_items, page, limit),
        bounds=bounds,
    )


@router.get("/products/price-bounds", response_model=ProductPriceBounds)
async def get_product_price_bounds(
    session: AsyncSession = Depends(get_session),
    category_slug: str | None = Query(default=None),
    on_sale: bool | None = Query(default=None),
    is_featured: bool | None = Query(default=None),
    include_unpublished: bool = Query(default=False),
    search: str | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
    current_user: User | None = Depends(get_current_user_optional),
) -> ProductPriceBounds:
    if category_slug == "sale" and on_sale is None:
        on_sale = True
        category_slug = None

    is_staff = current_user is not None and current_user.role in {UserRole.admin, UserRole.owner, UserRole.content}
    include_unpublished = bool(include_unpublished and is_staff)

    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    min_price, max_price, currency = await catalog_service.get_product_price_bounds(
        session,
        category_slug=category_slug,
        on_sale=on_sale,
        is_featured=is_featured,
        search=search,
        tags=tags,
        include_unpublished=include_unpublished,
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
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Category:
    created = await catalog_service.create_category(session, payload)
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.create",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "slug": created.slug, "category_id": str(created.id)},
        )
        await session.commit()
    return created


@router.patch("/categories/{slug}", response_model=CategoryRead)
async def update_category(
    slug: str,
    payload: CategoryUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Category:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    updated = await catalog_service.update_category(session, category, payload)
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.update",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "slug": slug, "patch": payload.model_dump(exclude_unset=True)},
        )
        await session.commit()
    return updated


@router.get("/categories/{slug}/translations", response_model=list[CategoryTranslationRead])
async def list_category_translations(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
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
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> CategoryTranslationRead:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    updated = await catalog_service.upsert_category_translation(session, category=category, lang=lang, payload=payload)
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.translation_upsert",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "slug": slug, "lang": lang},
        )
        await session.commit()
    return CategoryTranslationRead.model_validate(updated)


@router.delete("/categories/{slug}/translations/{lang}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category_translation(
    slug: str,
    lang: str = Path(..., pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> None:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await catalog_service.delete_category_translation(session, category=category, lang=lang)
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.translation_delete",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "slug": slug, "lang": lang},
        )
        await session.commit()
    return None


@router.delete("/categories/{slug}", response_model=CategoryRead)
async def delete_category(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Category:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await session.delete(category)
    await session.commit()
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.delete",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "slug": slug, "category_id": str(category.id)},
        )
        await session.commit()
    return category


@router.post("/categories/reorder", response_model=list[CategoryRead])
async def reorder_categories(
    payload: list[CategoryReorderItem],
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> list[CategoryRead]:
    updated = await catalog_service.reorder_categories(session, payload)
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.reorder",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "count": len(payload)},
        )
        await session.commit()
    return updated


@router.get("/categories/export", response_class=StreamingResponse)
async def export_categories_csv(
    request: Request,
    template: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("products")),
):
    step_up_service.require_step_up(request, admin)
    content = await catalog_service.export_categories_csv(session, template=template)
    filename = "categories_template.csv" if template else "categories.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(iter([content]), media_type="text/csv", headers=headers)


@router.post("/categories/import", response_model=ImportResult)
async def import_categories_csv(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> ImportResult:
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file required")
    raw = await _read_upload_csv_bytes(file)
    try:
        content = raw.decode()
    except UnicodeDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to decode CSV")
    result = await catalog_service.import_categories_csv(session, content, dry_run=dry_run)
    return ImportResult(**result)


@router.post("/categories/{slug}/images/{kind}", response_model=CategoryRead)
async def upload_category_image(
    slug: str,
    kind: str = Path(pattern="^(thumbnail|banner)$"),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Category:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    media_root = storage.ensure_media_root()
    dest = media_root / "catalog" / "categories" / slug
    path, _filename = await anyio.to_thread.run_sync(
        partial(
            storage.save_upload,
            file,
            root=dest,
            allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"),
            max_bytes=None,
            generate_thumbnails=True,
        )
    )

    field = "thumbnail_url" if kind == "thumbnail" else "banner_url"
    previous = getattr(category, field, None)
    if isinstance(previous, str) and previous.startswith("/media/"):
        storage.delete_file(previous)

    setattr(category, field, path)
    session.add(category)
    await session.commit()
    await session.refresh(category)
    if source:
        await audit_chain_service.add_admin_audit_log(
            session,
            action="catalog.category.image_upload",
            actor_user_id=current_user.id,
            subject_user_id=None,
            data={"source": source, "slug": slug, "kind": kind, "field": field},
        )
        await session.commit()
    return category


@router.get("/categories/{slug}/delete/preview", response_model=CategoryDeletePreview)
async def preview_delete_category(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> CategoryDeletePreview:
    category = await catalog_service.get_category_by_slug(session, slug)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    product_count = (
        await session.execute(select(func.count(Product.id)).where(Product.category_id == category.id))
    ).scalar_one()
    child_count = (
        await session.execute(select(func.count(Category.id)).where(Category.parent_id == category.id))
    ).scalar_one()
    product_count_int = int(product_count or 0)
    child_count_int = int(child_count or 0)
    return CategoryDeletePreview(
        slug=category.slug,
        product_count=product_count_int,
        child_count=child_count_int,
        can_delete=product_count_int == 0 and child_count_int == 0,
    )


@router.get("/categories/{slug}/merge/preview", response_model=CategoryMergePreview)
async def preview_merge_category(
    slug: str,
    target_slug: str = Query(min_length=1),
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> CategoryMergePreview:
    source = await catalog_service.get_category_by_slug(session, slug)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    target = await catalog_service.get_category_by_slug(session, target_slug)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target category not found")

    product_count = (
        await session.execute(select(func.count(Product.id)).where(Product.category_id == source.id))
    ).scalar_one()
    child_count = (
        await session.execute(select(func.count(Category.id)).where(Category.parent_id == source.id))
    ).scalar_one()
    product_count_int = int(product_count or 0)
    child_count_int = int(child_count or 0)

    can_merge = True
    reason: str | None = None
    if source.slug == target.slug:
        can_merge = False
        reason = "same_category"
    elif source.parent_id != target.parent_id:
        can_merge = False
        reason = "different_parent"
    elif child_count_int > 0:
        can_merge = False
        reason = "source_has_children"

    return CategoryMergePreview(
        source_slug=source.slug,
        target_slug=target.slug,
        product_count=product_count_int,
        child_count=child_count_int,
        can_merge=can_merge,
        reason=reason,
    )


async def _get_merge_source_and_target_categories(
    session: AsyncSession, source_slug: str, target_slug: str
) -> tuple[Category, Category]:
    source = await catalog_service.get_category_by_slug(session, source_slug)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    target = await catalog_service.get_category_by_slug(session, target_slug)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target category not found")
    return source, target


def _validate_merge_category_pair(source: Category, target: Category) -> None:
    if source.slug == target.slug:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot merge a category into itself")
    if source.parent_id != target.parent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categories must share the same parent")


async def _ensure_category_has_no_children(session: AsyncSession, category: Category) -> None:
    child_count = (await session.execute(select(func.count(Category.id)).where(Category.parent_id == category.id))).scalar_one()
    if int(child_count or 0) > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot merge a category with subcategories")


async def _audit_category_merge_if_requested(
    session: AsyncSession,
    *,
    audit_source: str | None,
    current_user: User,
    result_model: CategoryMergeResult,
) -> None:
    if not audit_source:
        return
    await audit_chain_service.add_admin_audit_log(
        session,
        action="catalog.category.merge",
        actor_user_id=current_user.id,
        subject_user_id=None,
        data={
            "source": audit_source,
            "source_slug": result_model.source_slug,
            "target_slug": result_model.target_slug,
            "moved_products": result_model.moved_products,
        },
    )
    await session.commit()


@router.post("/categories/{slug}/merge", response_model=CategoryMergeResult)
async def merge_category(
    slug: str,
    payload: CategoryMergeRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    audit_source: str | None = Query(default=None, alias="source", pattern="^(storefront)$"),
) -> CategoryMergeResult:
    source, target = await _get_merge_source_and_target_categories(session, slug, payload.target_slug)
    _validate_merge_category_pair(source, target)
    await _ensure_category_has_no_children(session, source)

    result = await session.execute(
        update(Product)
        .where(Product.category_id == source.id)
        .values(category_id=target.id, updated_at=func.now())
    )
    moved_products = int(result.rowcount or 0)

    await session.delete(source)
    await session.commit()
    result_model = CategoryMergeResult(source_slug=source.slug, target_slug=target.slug, moved_products=moved_products)
    await _audit_category_merge_if_requested(
        session, audit_source=audit_source, current_user=current_user, result_model=result_model
    )
    return result_model


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
) -> Product:
    return await catalog_service.create_product(session, payload, user_id=current_user.id)


@router.patch("/products/{slug}", response_model=ProductRead)
async def update_product(
    slug: str,
    payload: ProductUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Product:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await catalog_service.update_product(session, product, payload, user_id=current_user.id, source=source)


@router.get("/products/{slug}/translations", response_model=list[ProductTranslationRead])
async def list_product_translations(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
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
    _: object = Depends(require_admin_section("products")),
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
    _: object = Depends(require_admin_section("products")),
) -> None:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.delete_product_translation(session, product=product, lang=lang)
    return None


@router.get("/products/{slug}/relationships", response_model=ProductRelationshipsRead)
async def get_product_relationships(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> ProductRelationshipsRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await catalog_service.get_product_relationships(session, product.id)


@router.put("/products/{slug}/relationships", response_model=ProductRelationshipsRead)
async def update_product_relationships(
    slug: str,
    payload: ProductRelationshipsUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
) -> ProductRelationshipsRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await catalog_service.update_product_relationships(session, product=product, payload=payload, user_id=current_user.id)


@router.get("/products/{slug}/audit", response_model=list[AdminProductAuditEntry])
async def list_product_audit(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[AdminProductAuditEntry]:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    rows = (
        await session.execute(
            select(ProductAuditLog, User.email)
            .join(User, ProductAuditLog.user_id == User.id, isouter=True)
            .where(ProductAuditLog.product_id == product.id)
            .order_by(ProductAuditLog.created_at.desc())
            .limit(limit)
        )
    ).all()
    entries: list[AdminProductAuditEntry] = []
    for log, email in rows:
        payload: dict | None = None
        if log.payload:
            try:
                payload = json.loads(log.payload)
            except json.JSONDecodeError:
                payload = {"raw": log.payload}
        entries.append(
            AdminProductAuditEntry(
                id=log.id,
                action=log.action,
                created_at=log.created_at,
                user_id=log.user_id,
                user_email=email,
                payload=payload,
            )
        )
    return entries


@router.delete("/products/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_product(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
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
    _: object = Depends(require_admin_section("products")),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    path, filename = await anyio.to_thread.run_sync(
        partial(
            storage.save_upload,
            file,
            allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"),
            max_bytes=None,
            generate_thumbnails=True,
        )
    )
    await catalog_service.add_product_image_from_path(
        session, product, url=path, alt_text=filename, sort_order=len(product.images) + 1
    )
    refreshed = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not refreshed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return ProductRead.model_validate(refreshed)


@router.post("/products/bulk-update", response_model=list[ProductRead])
async def bulk_update_products(
    payload: list[BulkProductUpdateItem],
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> list[Product]:
    updated = await catalog_service.bulk_update_products(session, payload, user_id=current_user.id, source=source)
    return updated


@router.put("/products/{slug}/variants", response_model=list[ProductVariantRead])
async def update_product_variants(
    slug: str,
    payload: ProductVariantMatrixUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
) -> list[ProductVariantRead]:
    product = await catalog_service.get_product_by_slug(session, slug, options=[selectinload(Product.variants)])
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return await catalog_service.update_product_variants(session, product=product, payload=payload, user_id=current_user.id)


@router.get("/collections/featured", response_model=list[FeaturedCollectionRead])
async def list_featured_collections(
    session: AsyncSession = Depends(get_session),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
) -> list[FeaturedCollectionRead]:
    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    collections = await catalog_service.list_featured_collections(session, lang=lang)
    payload: list[FeaturedCollectionRead] = []
    for collection in collections:
        products = []
        for product in getattr(collection, "products", []) or []:
            if lang:
                catalog_service.apply_product_translation(product, lang)
            model = ProductReadBrief.model_validate(product)
            if not catalog_service.is_sale_active(product):
                model.sale_price = None
            products.append(model)
        payload.append(
            FeaturedCollectionRead(
                id=collection.id,
                slug=collection.slug,
                name=collection.name,
                description=collection.description,
                created_at=collection.created_at,
                products=products,
            )
        )
    return payload


@router.post("/collections/featured", response_model=FeaturedCollectionRead, status_code=status.HTTP_201_CREATED)
async def create_featured_collection(
    payload: FeaturedCollectionCreate,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> FeaturedCollectionRead:
    created = await catalog_service.create_featured_collection(session, payload)
    return FeaturedCollectionRead.model_validate(created)


@router.patch("/collections/featured/{slug}", response_model=FeaturedCollectionRead)
async def update_featured_collection(
    slug: str,
    payload: FeaturedCollectionUpdate,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
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
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category), selectinload(Product.options)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    clone = await catalog_service.duplicate_product(session, product, user_id=current_user.id, source=source)
    return clone


@router.get("/products/recently-viewed", response_model=list[ProductRead])
async def recently_viewed_products(
    session: AsyncSession = Depends(get_session),
    session_id: str | None = Query(default=None, description="Client session identifier for guests"),
    limit: int = Query(default=5, ge=1, le=20),
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    current_user=Depends(get_current_user_optional),
) -> list[Product]:
    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    products = await catalog_service.get_recently_viewed(
        session, getattr(current_user, "id", None) if current_user else None, session_id, limit
    )
    if lang:
        for p in products:
            catalog_service.apply_product_translation(p, lang)
    payload_items = []
    for p in products:
        model = ProductRead.model_validate(p)
        if not catalog_service.is_sale_active(p):
            model.sale_price = None
        payload_items.append(model)
    return payload_items


@router.get("/products/export", response_class=StreamingResponse)
async def export_products_csv(
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("products")),
):
    step_up_service.require_step_up(request, admin)
    content = await catalog_service.export_products_csv(session)
    headers = {"Content-Disposition": 'attachment; filename="products.csv"'}
    return StreamingResponse(iter([content]), media_type="text/csv", headers=headers)


@router.post("/products/import", response_model=ImportResult)
async def import_products_csv(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> ImportResult:
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file required")
    raw = await _read_upload_csv_bytes(file)
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
    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    product_options = _build_product_query_options(lang)
    product = await catalog_service.get_product_by_slug(
        session, slug, options=product_options, follow_history=True, lang=lang
    )
    if _product_is_missing(product):
        _raise_product_not_found()

    is_admin = _is_catalog_admin_viewer(current_user)
    if _should_hide_product_from_view(product, is_admin=is_admin):
        _raise_product_not_found()
    if _is_product_publicly_visible(product):
        await catalog_service.record_recently_viewed(
            session, product, _recently_viewed_user_id(current_user), session_id
        )

    model = ProductRead.model_validate(product)
    if _should_hide_sale_price(product, is_admin=is_admin):
        model.sale_price = None
    return model


@router.get("/products/{slug}/back-in-stock", response_model=BackInStockStatus)
async def get_back_in_stock_status(
    slug: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_complete_profile),
) -> BackInStockStatus:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) != UserRole.customer
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
    is_admin = current_user is not None and getattr(current_user, "role", None) != UserRole.customer
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
    is_admin = current_user is not None and getattr(current_user, "role", None) != UserRole.customer
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.cancel_back_in_stock_request(session, user_id=current_user.id, product_id=product.id)
    return None


@router.delete("/products/{slug}/images/{image_id}", response_model=ProductRead)
async def delete_product_image(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    await catalog_service.delete_product_image(session, product, str(image_id), user_id=current_user.id)
    refreshed = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not refreshed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return ProductRead.model_validate(refreshed)


@router.patch("/products/{slug}/images/{image_id}/sort", response_model=ProductRead)
async def reorder_product_image(
    slug: str,
    image_id: UUID,
    sort_order: int = Query(..., ge=0),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> Product:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.update_product_image_sort(session, product, str(image_id), sort_order, user_id=current_user.id, source=source)
    refreshed = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not refreshed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return ProductRead.model_validate(refreshed)


@router.get("/products/{slug}/images/deleted", response_model=list[AdminDeletedProductImage])
async def list_deleted_product_images(
    slug: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> list[AdminDeletedProductImage]:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    images = await catalog_service.list_deleted_product_images(session, product.id)
    return [
        AdminDeletedProductImage(
            id=image.id,
            url=image.url,
            alt_text=image.alt_text,
            caption=image.caption,
            deleted_at=getattr(image, "deleted_at", None),
        )
        for image in images
    ]


@router.post("/products/{slug}/images/{image_id}/restore", response_model=ProductRead)
async def restore_deleted_product_image(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
) -> ProductRead:
    product = await catalog_service.get_product_by_slug(session, slug)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await catalog_service.restore_product_image(session, product, str(image_id), user_id=current_user.id)
    refreshed = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not refreshed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return ProductRead.model_validate(refreshed)


@router.get("/products/{slug}/images/{image_id}/translations", response_model=list[ProductImageTranslationRead])
async def list_product_image_translations(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> list[ProductImageTranslationRead]:
    product = await catalog_service.get_product_by_slug(session, slug, options=[selectinload(Product.images)])
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return await catalog_service.list_product_image_translations(session, image=image)


@router.put("/products/{slug}/images/{image_id}/translations/{lang}", response_model=ProductImageTranslationRead)
async def upsert_product_image_translation(
    slug: str,
    image_id: UUID,
    payload: ProductImageTranslationUpsert,
    lang: str = Path(..., pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> ProductImageTranslationRead:
    product = await catalog_service.get_product_by_slug(session, slug, options=[selectinload(Product.images)])
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return await catalog_service.upsert_product_image_translation(
        session, image=image, lang=lang, payload=payload, user_id=current_user.id, source=source
    )


@router.delete("/products/{slug}/images/{image_id}/translations/{lang}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_image_translation(
    slug: str,
    image_id: UUID,
    lang: str = Path(..., pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(require_admin_section("products")),
    source: str | None = Query(default=None, pattern="^(storefront)$"),
) -> None:
    product = await catalog_service.get_product_by_slug(session, slug, options=[selectinload(Product.images)])
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    await catalog_service.delete_product_image_translation(session, image=image, lang=lang, user_id=current_user.id, source=source)
    return None


@router.get("/products/{slug}/images/{image_id}/stats", response_model=ProductImageOptimizationStats)
async def get_product_image_stats(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> ProductImageOptimizationStats:
    product = await catalog_service.get_product_by_slug(session, slug, options=[selectinload(Product.images)])
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return catalog_service.get_product_image_optimization_stats(image)


@router.post("/products/{slug}/images/{image_id}/reprocess", response_model=ProductImageOptimizationStats)
async def reprocess_product_image(
    slug: str,
    image_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
) -> ProductImageOptimizationStats:
    product = await catalog_service.get_product_by_slug(session, slug, options=[selectinload(Product.images)])
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return catalog_service.reprocess_product_image_thumbnails(image)


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
    is_admin = current_user is not None and getattr(current_user, "role", None) != UserRole.customer
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    review = await catalog_service.add_review(session, product, payload, getattr(current_user, "id", None) if current_user else None)
    return review


@router.post("/products/{slug}/reviews/{review_id}/approve", response_model=ProductReviewRead)
async def approve_review(
    slug: str,
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("products")),
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


async def _get_product_for_relationships(
    session: AsyncSession,
    slug: str,
    current_user: User | None,
) -> tuple[Product, bool]:
    product = await catalog_service.get_product_by_slug(
        session, slug, options=[selectinload(Product.images), selectinload(Product.category)]
    )
    if not product or product.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    is_admin = current_user is not None and getattr(current_user, "role", None) != UserRole.customer
    if not is_admin and (not product.is_active or product.status != ProductStatus.published):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product, is_admin


def _serialize_relationship_products(products: list[Product], lang: str | None) -> list[ProductRead]:
    payload_items: list[ProductRead] = []
    for p in products:
        if lang:
            catalog_service.apply_product_translation(p, lang)
        model = ProductRead.model_validate(p)
        if not catalog_service.is_sale_active(p):
            model.sale_price = None
        payload_items.append(model)
    return payload_items


@router.get("/products/{slug}/related", response_model=list[ProductRead])
async def related_products(
    slug: str,
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> list[Product]:
    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    product, is_admin = await _get_product_for_relationships(session, slug, current_user)
    curated = await catalog_service.get_curated_relationship_products(
        session,
        product_id=product.id,
        relationship_type=ProductRelationshipType.related,
        limit=4,
        include_inactive=is_admin,
    )
    related = curated or await catalog_service.get_related_products(session, product, limit=4)
    return _serialize_relationship_products(related, lang)


@router.get("/products/{slug}/upsells", response_model=list[ProductRead])
async def upsell_products(
    slug: str,
    lang: str | None = Query(default=None, pattern="^(en|ro)$"),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> list[Product]:
    await catalog_service.auto_publish_due_sales(session)
    await catalog_service.apply_due_product_schedules(session)
    product, is_admin = await _get_product_for_relationships(session, slug, current_user)
    upsells = await catalog_service.get_curated_relationship_products(
        session,
        product_id=product.id,
        relationship_type=ProductRelationshipType.upsell,
        limit=4,
        include_inactive=is_admin,
    )
    return _serialize_relationship_products(upsells, lang)
