from datetime import datetime, timezone
import csv
import io
import json
import random
import string
import uuid

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.catalog import (
    Category,
    Product,
    ProductImage,
    ProductOption,
    ProductVariant,
    ProductStatus,
    Tag,
    ProductReview,
    ProductSlugHistory,
    RecentlyViewedProduct,
    ProductAuditLog,
    FeaturedCollection,
)
from app.schemas.catalog import (
    CategoryCreate,
    CategoryUpdate,
    ProductCreate,
    ProductImageCreate,
    ProductUpdate,
    ProductVariantCreate,
    BulkProductUpdateItem,
    ProductOptionCreate,
    ProductReviewCreate,
    FeaturedCollectionCreate,
    FeaturedCollectionUpdate,
    FeaturedCollectionRead,
    ProductFeedItem,
)
from app.services.storage import delete_file
from app.services import email as email_service
from app.core.config import settings


async def get_category_by_slug(session: AsyncSession, slug: str) -> Category | None:
    result = await session.execute(select(Category).where(Category.slug == slug))
    return result.scalar_one_or_none()


async def get_product_by_slug(
    session: AsyncSession, slug: str, options: list | None = None, follow_history: bool = True
) -> Product | None:
    query = select(Product)
    if options:
        for opt in options:
            query = query.options(opt)
    result = await session.execute(query.where(Product.slug == slug))
    product = result.scalar_one_or_none()
    if product or not follow_history:
        return product
    hist_result = await session.execute(select(ProductSlugHistory).where(ProductSlugHistory.slug == slug))
    history = hist_result.scalar_one_or_none()
    if history:
        product = await session.get(Product, history.product_id)
    return product


async def _ensure_slug_unique(session: AsyncSession, slug: str, exclude_id: uuid.UUID | None = None) -> None:
    query = select(Product).where(Product.slug == slug)
    if exclude_id:
        query = query.where(Product.id != exclude_id)
    exists = await session.execute(query)
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product slug already exists")
    hist_query = select(ProductSlugHistory).where(ProductSlugHistory.slug == slug)
    if exclude_id:
        hist_query = hist_query.where(ProductSlugHistory.product_id != exclude_id)
    hist = await session.execute(hist_query)
    if hist.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product slug already exists in history")


async def _get_product_by_sku(session: AsyncSession, sku: str) -> Product | None:
    result = await session.execute(select(Product).where(Product.sku == sku))
    return result.scalar_one_or_none()


async def _ensure_sku_unique(session: AsyncSession, sku: str, exclude_id: uuid.UUID | None = None) -> None:
    query = select(Product).where(Product.sku == sku)
    if exclude_id:
        query = query.where(Product.id != exclude_id)
    exists = await session.execute(query)
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product SKU already exists")


async def _generate_unique_sku(session: AsyncSession, base: str) -> str:
    slug_part = base.replace("-", "").upper()[:8] or "SKU"
    while True:
        suffix = "".join(random.choices(string.digits, k=4))
        candidate = f"{slug_part}-{suffix}"
        if not await _get_product_by_sku(session, candidate):
            return candidate


def _validate_price_currency(base_price: float, currency: str) -> None:
    if base_price is not None and base_price < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Base price must be non-negative")
    if currency and len(currency.strip()) != 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Currency must be a 3-letter code")


async def _log_product_action(
    session: AsyncSession, product_id: uuid.UUID, action: str, user_id: uuid.UUID | None, payload: dict | None
) -> None:
    audit = ProductAuditLog(
        product_id=product_id,
        user_id=user_id,
        action=action,
        payload=json.dumps(payload, default=str) if payload else None,
    )
    session.add(audit)
    await session.commit()


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


async def create_product(
    session: AsyncSession, payload: ProductCreate, commit: bool = True, user_id: uuid.UUID | None = None
) -> Product:
    await _ensure_slug_unique(session, payload.slug)
    sku = payload.sku or await _generate_unique_sku(session, payload.slug)
    await _ensure_sku_unique(session, sku)
    _validate_price_currency(payload.base_price, payload.currency)

    images_payload = payload.images or []
    variants_payload: list[ProductVariantCreate] = getattr(payload, "variants", []) or []
    product_data = payload.model_dump(exclude={"images", "variants", "tags", "options"})
    product_data["sku"] = sku
    product_data["currency"] = payload.currency.upper()
    product = Product(**product_data)
    _set_publish_timestamp(product, payload.status)
    product.images = [ProductImage(**img.model_dump()) for img in images_payload]
    product.variants = [ProductVariant(**variant.model_dump()) for variant in variants_payload]
    if payload.tags:
        product.tags = await _get_or_create_tags(session, payload.tags)
    if payload.options:
        product.options = [ProductOption(**opt.model_dump()) for opt in payload.options]
    session.add(product)
    if commit:
        await session.commit()
        await session.refresh(product)
        await _log_product_action(session, product.id, "create", user_id, {"slug": product.slug})
    else:
        await session.flush()
    return product


async def update_product(
    session: AsyncSession, product: Product, payload: ProductUpdate, commit: bool = True, user_id: uuid.UUID | None = None
) -> Product:
    data = payload.model_dump(exclude_unset=True)
    if "base_price" in data or "currency" in data:
        _validate_price_currency(data.get("base_price", product.base_price), data.get("currency", product.currency))
    if "slug" in data:
        await _ensure_slug_unique(session, data["slug"], exclude_id=product.id)
        if data["slug"] and data["slug"] != product.slug:
            await _record_slug_history(session, product, product.slug)
    if "sku" in data and data["sku"]:
        await _ensure_sku_unique(session, data["sku"], exclude_id=product.id)
    if "tags" in data and data["tags"] is not None:
        product.tags = await _get_or_create_tags(session, data["tags"])
    if "options" in data and data["options"] is not None:
        product.options = [ProductOption(**opt.model_dump()) for opt in data["options"]]
    for field, value in data.items():
        if field == "currency" and value:
            setattr(product, field, value.upper())
        else:
            setattr(product, field, value)
    _set_publish_timestamp(product, data.get("status"))
    session.add(product)
    if commit:
        await session.commit()
        await session.refresh(product)
        await _log_product_action(session, product.id, "update", user_id, data)
        await _maybe_alert_low_stock(product)
    else:
        await session.flush()
    return product


async def add_product_image(session: AsyncSession, product: Product, payload: ProductImageCreate) -> ProductImage:
    image = ProductImage(product=product, **payload.model_dump())
    session.add(image)
    await session.commit()
    await session.refresh(image)
    return image


async def add_product_image_from_path(
    session: AsyncSession, product: Product, url: str, alt_text: str | None, sort_order: int
) -> ProductImage:
    image = ProductImage(product=product, url=url, alt_text=alt_text, sort_order=sort_order)
    session.add(image)
    await session.commit()
    await session.refresh(image)
    return image


async def delete_product_image(session: AsyncSession, product: Product, image_id: str) -> None:
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    delete_file(image.url)
    await session.delete(image)
    await session.commit()


async def soft_delete_product(session: AsyncSession, product: Product, user_id: uuid.UUID | None = None) -> None:
    product.is_deleted = True
    session.add(product)
    await session.commit()
    await _log_product_action(session, product.id, "soft_delete", user_id, {"slug": product.slug})


async def bulk_update_products(
    session: AsyncSession, updates: list[BulkProductUpdateItem], user_id: uuid.UUID | None = None
) -> list[Product]:
    product_ids = [item.product_id for item in updates]
    result = await session.execute(select(Product).where(Product.id.in_(product_ids)))
    products = {p.id: p for p in result.scalars()}

    updated: list[Product] = []
    for item in updates:
        product = products.get(item.product_id)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Product {item.product_id} not found")
        data = item.model_dump(exclude_unset=True)
        if "status" in data and data["status"]:
            _set_publish_timestamp(product, data["status"])
        for field in ("base_price", "stock_quantity", "status"):
            if field in data and data[field] is not None:
                setattr(product, field, data[field])
        session.add(product)
        updated.append(product)
    await session.commit()
    for product in updated:
        await session.refresh(product)
        await _log_product_action(
            session,
            product.id,
            "bulk_update",
            user_id,
            {"base_price": product.base_price, "stock_quantity": product.stock_quantity, "status": str(product.status)},
        )
    return updated


async def get_featured_collection_by_slug(session: AsyncSession, slug: str) -> FeaturedCollection | None:
    result = await session.execute(
        select(FeaturedCollection).options(selectinload(FeaturedCollection.products)).where(FeaturedCollection.slug == slug)
    )
    return result.scalar_one_or_none()


async def list_featured_collections(session: AsyncSession) -> list[FeaturedCollection]:
    result = await session.execute(
        select(FeaturedCollection).options(selectinload(FeaturedCollection.products)).order_by(FeaturedCollection.created_at.desc())
    )
    return list(result.scalars().unique())


async def _load_products_by_ids(session: AsyncSession, product_ids: list[uuid.UUID]) -> list[Product]:
    if not product_ids:
        return []
    result = await session.execute(select(Product).where(Product.id.in_(product_ids), Product.is_deleted.is_(False)))
    products = list(result.scalars().unique())
    if len(products) != len(set(product_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more products not found")
    return products


async def create_featured_collection(session: AsyncSession, payload: FeaturedCollectionCreate) -> FeaturedCollection:
    existing = await get_featured_collection_by_slug(session, payload.slug)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Featured collection slug already exists")
    products = await _load_products_by_ids(session, payload.product_ids)
    collection = FeaturedCollection(slug=payload.slug, name=payload.name, description=payload.description)
    collection.products = products
    session.add(collection)
    await session.commit()
    await session.refresh(collection)
    return collection


async def update_featured_collection(
    session: AsyncSession, collection: FeaturedCollection, payload: FeaturedCollectionUpdate
) -> FeaturedCollection:
    data = payload.model_dump(exclude_unset=True)
    if "product_ids" in data and data["product_ids"] is not None:
        collection.products = await _load_products_by_ids(session, data.pop("product_ids"))
    for field, value in data.items():
        setattr(collection, field, value)
    session.add(collection)
    await session.commit()
    await session.refresh(collection)
    return collection


async def get_product_feed(session: AsyncSession) -> list[ProductFeedItem]:
    result = await session.execute(
        select(Product)
        .options(selectinload(Product.category), selectinload(Product.tags))
        .where(Product.is_deleted.is_(False), Product.status == ProductStatus.published)
        .order_by(Product.created_at.desc())
    )
    products = result.scalars().unique().all()
    feed: list[ProductFeedItem] = []
    for p in products:
        feed.append(
            ProductFeedItem(
                slug=p.slug,
                name=p.name,
                price=float(p.base_price),
                currency=p.currency,
                description=p.short_description or p.long_description,
                category_slug=p.category.slug if p.category else None,
                tags=[tag.slug for tag in p.tags],
            )
        )
    return feed


async def get_product_feed_csv(session: AsyncSession) -> str:
    feed = await get_product_feed(session)
    buf = io.StringIO()
    fieldnames = ["slug", "name", "price", "currency", "description", "category_slug", "tags"]
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for item in feed:
        writer.writerow(
            {
                "slug": item.slug,
                "name": item.name,
                "price": item.price,
                "currency": item.currency,
                "description": item.description or "",
                "category_slug": item.category_slug or "",
                "tags": ",".join(item.tags),
            }
        )
    return buf.getvalue()


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
    return "-".join(filter(None, cleaned.split("-")))


async def list_products_with_filters(
    session: AsyncSession,
    category_slug: str | None,
    is_featured: bool | None,
    search: str | None,
    min_price: float | None,
    max_price: float | None,
    tags: list[str] | None,
    sort: str | None,
    limit: int,
    offset: int,
):
    base_query = select(Product).options(
        selectinload(Product.images),
        selectinload(Product.category),
        selectinload(Product.tags),
    ).where(Product.is_deleted.is_(False))
    if category_slug:
        base_query = base_query.join(Category).where(Category.slug == category_slug)
    if is_featured is not None:
        base_query = base_query.where(Product.is_featured == is_featured)
    if search:
        like = f"%{search.lower()}%"
        base_query = base_query.where(
            (Product.name.ilike(like)) | (Product.short_description.ilike(like)) | (Product.long_description.ilike(like))
        )
    if min_price is not None:
        base_query = base_query.where(Product.base_price >= min_price)
    if max_price is not None:
        base_query = base_query.where(Product.base_price <= max_price)
    if tags:
        base_query = base_query.join(Product.tags).where(Tag.slug.in_(tags))

    total_query = base_query.with_only_columns(func.count(func.distinct(Product.id))).order_by(None)
    total_result = await session.execute(total_query)
    total_items = total_result.scalar_one()

    if sort == "price_asc":
        base_query = base_query.order_by(Product.base_price.asc())
    elif sort == "price_desc":
        base_query = base_query.order_by(Product.base_price.desc())
    elif sort == "name_asc":
        base_query = base_query.order_by(Product.name.asc())
    elif sort == "name_desc":
        base_query = base_query.order_by(Product.name.desc())
    else:
        base_query = base_query.order_by(Product.created_at.desc())

    result = await session.execute(base_query.limit(limit).offset(offset))
    items = list(result.scalars().unique())
    return items, total_items


async def _get_or_create_tags(session: AsyncSession, names: list[str]) -> list[Tag]:
    slugs = [slugify(name) for name in names]
    result = await session.execute(select(Tag).where(Tag.slug.in_(slugs)))
    existing = {tag.slug: tag for tag in result.scalars()}
    tags: list[Tag] = []
    for name, slug in zip(names, slugs):
        if slug in existing:
            tags.append(existing[slug])
        else:
            tag = Tag(name=name, slug=slug)
            session.add(tag)
            tags.append(tag)
    await session.flush()
    return tags


async def duplicate_product(session: AsyncSession, product: Product) -> Product:
    base_slug = f"{product.slug}-copy"
    new_slug = base_slug
    counter = 1
    while await get_product_by_slug(session, new_slug):
        counter += 1
        new_slug = f"{base_slug}-{counter}"
    new_sku = await _generate_unique_sku(session, new_slug)

    clone = Product(
        category_id=product.category_id,
        sku=new_sku,
        slug=new_slug,
        name=f"{product.name} (Copy)",
        short_description=product.short_description,
        long_description=product.long_description,
        base_price=product.base_price,
        currency=product.currency,
        is_active=False,
        is_featured=False,
        stock_quantity=product.stock_quantity,
        status=ProductStatus.draft,
        allow_backorder=product.allow_backorder,
        restock_at=product.restock_at,
        weight_grams=product.weight_grams,
        width_cm=product.width_cm,
        height_cm=product.height_cm,
        depth_cm=product.depth_cm,
        meta_title=product.meta_title,
        meta_description=product.meta_description,
    )
    clone.images = [ProductImage(url=img.url, alt_text=img.alt_text, sort_order=img.sort_order) for img in product.images]
    clone.variants = [
        ProductVariant(name=variant.name, additional_price_delta=variant.additional_price_delta, stock_quantity=variant.stock_quantity)
        for variant in product.variants
    ]
    clone.options = [ProductOption(option_name=opt.option_name, option_value=opt.option_value) for opt in product.options]
    clone.tags = product.tags.copy()
    session.add(clone)
    await session.commit()
    await session.refresh(clone)
    return clone


def _set_publish_timestamp(product: Product, status_value: ProductStatus | str | None) -> None:
    if not status_value:
        return
    status_enum = ProductStatus(status_value)
    if status_enum == ProductStatus.published and product.publish_at is None:
        product.publish_at = datetime.now(timezone.utc)


async def add_review(
    session: AsyncSession, product: Product, payload: ProductReviewCreate, user_id: uuid.UUID | None
) -> ProductReview:
    review = ProductReview(
        product=product,
        user_id=user_id,
        author_name=payload.author_name,
        rating=payload.rating,
        title=payload.title,
        body=payload.body,
        is_approved=False,
    )
    session.add(review)
    await session.commit()
    await session.refresh(review)
    return review


async def approve_review(session: AsyncSession, review: ProductReview) -> ProductReview:
    review.is_approved = True
    session.add(review)
    await session.commit()
    await session.refresh(review)
    await recompute_product_rating(session, review.product_id)
    return review


async def recompute_product_rating(session: AsyncSession, product_id: uuid.UUID) -> None:
    result = await session.execute(
        select(ProductReview).where(ProductReview.product_id == product_id, ProductReview.is_approved.is_(True))
    )
    reviews = result.scalars().all()
    count = len(reviews)
    avg = sum(r.rating for r in reviews) / count if count else 0
    product = await session.get(Product, product_id)
    product.rating_average = avg
    product.rating_count = count
    session.add(product)
    await session.commit()
    await session.refresh(product)


async def get_related_products(session: AsyncSession, product: Product, limit: int = 4):
    result = await session.execute(
        select(Product)
        .where(
            Product.category_id == product.category_id,
            Product.id != product.id,
            Product.is_deleted.is_(False),
            Product.status == ProductStatus.published,
        )
        .order_by(Product.is_featured.desc(), Product.created_at.desc())
        .limit(limit)
    )
    return result.scalars().unique().all()


async def record_recently_viewed(
    session: AsyncSession, product: Product, user_id: uuid.UUID | None, session_id: str | None, limit: int = 10
) -> None:
    if not user_id and not session_id:
        return
    query = select(RecentlyViewedProduct).where(RecentlyViewedProduct.product_id == product.id)
    if user_id:
        query = query.where(RecentlyViewedProduct.user_id == user_id)
    else:
        query = query.where(RecentlyViewedProduct.session_id == session_id)
    existing = await session.execute(query)
    view = existing.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if view:
        view.viewed_at = now
    else:
        view = RecentlyViewedProduct(
            product_id=product.id,
            user_id=user_id,
            session_id=session_id,
            viewed_at=now,
        )
        session.add(view)
    await session.commit()

    # enforce cap
    cleanup_query = select(RecentlyViewedProduct).where(
        (RecentlyViewedProduct.user_id == user_id) if user_id else (RecentlyViewedProduct.session_id == session_id)
    ).order_by(RecentlyViewedProduct.viewed_at.desc())
    result = await session.execute(cleanup_query)
    all_views = result.scalars().all()
    for extra in all_views[limit:]:
        await session.delete(extra)
    if len(all_views) > limit:
        await session.commit()


async def get_recently_viewed(
    session: AsyncSession, user_id: uuid.UUID | None, session_id: str | None, limit: int = 10
):
    if not user_id and not session_id:
        return []
    query = (
        select(RecentlyViewedProduct)
        .options(selectinload(RecentlyViewedProduct.product).selectinload(Product.images))
        .where(
            RecentlyViewedProduct.product.has(
                and_(Product.is_deleted.is_(False), Product.status == ProductStatus.published)
            )
        )
    )
    if user_id:
        query = query.where(RecentlyViewedProduct.user_id == user_id)
    else:
        query = query.where(RecentlyViewedProduct.session_id == session_id)
    query = query.order_by(RecentlyViewedProduct.viewed_at.desc()).limit(limit)
    result = await session.execute(query)
    return [rv.product for rv in result.scalars()]


async def export_products_csv(session: AsyncSession) -> str:
    products_result = await session.execute(
        select(Product)
        .options(selectinload(Product.category), selectinload(Product.tags))
        .where(Product.is_deleted.is_(False))
        .order_by(Product.created_at.desc())
    )
    products = products_result.scalars().unique().all()
    buf = io.StringIO()
    fieldnames = [
        "slug",
        "name",
        "category_slug",
        "base_price",
        "currency",
        "stock_quantity",
        "status",
        "is_featured",
        "is_active",
        "short_description",
        "long_description",
        "tags",
    ]
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for p in products:
        writer.writerow(
            {
                "slug": p.slug,
                "name": p.name,
                "category_slug": p.category.slug if p.category else "",
                "base_price": float(p.base_price),
                "currency": p.currency,
                "stock_quantity": p.stock_quantity,
                "status": p.status.value,
                "is_featured": p.is_featured,
                "is_active": p.is_active,
                "short_description": p.short_description or "",
                "long_description": p.long_description or "",
                "tags": ",".join(tag.slug for tag in p.tags),
            }
        )
    return buf.getvalue()


async def import_products_csv(session: AsyncSession, content: str, dry_run: bool = True):
    reader = csv.DictReader(io.StringIO(content))
    created = 0
    updated = 0
    errors: list[str] = []

    for idx, row in enumerate(reader, start=2):
        slug = (row.get("slug") or "").strip()
        name = (row.get("name") or "").strip()
        category_slug = (row.get("category_slug") or "").strip()
        if not slug or not name or not category_slug:
            errors.append(f"Row {idx}: missing slug, name, or category_slug")
            continue
        try:
            base_price = float(row.get("base_price") or 0)
            stock_quantity = int(row.get("stock_quantity") or 0)
        except ValueError:
            errors.append(f"Row {idx}: invalid base_price or stock_quantity")
            continue
        currency = (row.get("currency") or "USD").strip()
        status_value = (row.get("status") or ProductStatus.draft.value).strip()
        try:
            status_enum = ProductStatus(status_value)
        except ValueError:
            errors.append(f"Row {idx}: invalid status {status_value}")
            continue
        is_featured = str(row.get("is_featured") or "").lower() in {"true", "1", "yes"}
        is_active = str(row.get("is_active") or "true").lower() not in {"false", "0", "no"}
        short_description = (row.get("short_description") or "").strip() or None
        long_description = (row.get("long_description") or "").strip() or None
        tag_slugs = [t.strip() for t in (row.get("tags") or "").split(",") if t.strip()]

        category = await get_category_by_slug(session, category_slug)
        if not category:
            if dry_run:
                errors.append(f"Row {idx}: category {category_slug} not found")
                continue
            category = Category(slug=category_slug, name=category_slug.replace("-", " ").title())
            session.add(category)
            await session.flush()

        existing = await get_product_by_slug(session, slug, follow_history=False)
        if existing:
            updated += 1
            if dry_run:
                continue
            payload = ProductUpdate(
                name=name,
                base_price=base_price,
                currency=currency,
                stock_quantity=stock_quantity,
                status=status_enum,
                is_featured=is_featured,
                is_active=is_active,
                short_description=short_description,
                long_description=long_description,
                category_id=category.id,
                tags=tag_slugs if tag_slugs else [],
            )
            await update_product(session, existing, payload, commit=False)
        else:
            created += 1
            if dry_run:
                continue
            payload = ProductCreate(
                category_id=category.id,
                slug=slug,
                name=name,
                base_price=base_price,
                currency=currency,
                stock_quantity=stock_quantity,
                status=status_enum,
                is_featured=is_featured,
                is_active=is_active,
                short_description=short_description,
                long_description=long_description,
                tags=tag_slugs,
            )
            await create_product(session, payload, commit=False)
    if errors:
        if not dry_run:
            await session.rollback()
    else:
        if not dry_run:
            await session.commit()
    return {"created": created, "updated": updated, "errors": errors}


async def _record_slug_history(session: AsyncSession, product: Product, old_slug: str) -> None:
    history = ProductSlugHistory(product_id=product.id, slug=old_slug)
    session.add(history)
    await session.flush()


async def notify_back_in_stock(emails: list[str], product_name: str) -> int:
    sent = 0
    for email in emails:
        if await email_service.send_back_in_stock(email, product_name):
            sent += 1
    return sent


async def _maybe_alert_low_stock(product: Product, threshold: int = 2) -> None:
    if product.stock_quantity is not None and product.stock_quantity <= threshold and settings.admin_alert_email:
        await email_service.send_low_stock_alert(settings.admin_alert_email, product.name, product.stock_quantity)
