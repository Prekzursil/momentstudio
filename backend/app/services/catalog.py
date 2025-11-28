from datetime import datetime, timezone
import random
import string
import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.catalog import (
    Category,
    Product,
    ProductImage,
    ProductOption,
    ProductVariant,
    ProductStatus,
    Tag,
    ProductReview,
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
)
from app.services.storage import delete_file


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


async def _ensure_slug_unique(session: AsyncSession, slug: str, exclude_id: uuid.UUID | None = None) -> None:
    query = select(Product).where(Product.slug == slug)
    if exclude_id:
        query = query.where(Product.id != exclude_id)
    exists = await session.execute(query)
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product slug already exists")


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
    await _ensure_slug_unique(session, payload.slug)
    sku = payload.sku or await _generate_unique_sku(session, payload.slug)
    await _ensure_sku_unique(session, sku)

    images_payload = payload.images or []
    variants_payload: list[ProductVariantCreate] = getattr(payload, "variants", []) or []
    product_data = payload.model_dump(exclude={"images", "variants", "tags", "options"})
    product_data["sku"] = sku
    product = Product(**product_data)
    _set_publish_timestamp(product, payload.status)
    product.images = [ProductImage(**img.model_dump()) for img in images_payload]
    product.variants = [ProductVariant(**variant.model_dump()) for variant in variants_payload]
    if payload.tags:
        product.tags = await _get_or_create_tags(session, payload.tags)
    if payload.options:
        product.options = [ProductOption(**opt.model_dump()) for opt in payload.options]
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


async def update_product(session: AsyncSession, product: Product, payload: ProductUpdate) -> Product:
    data = payload.model_dump(exclude_unset=True)
    if "slug" in data:
        await _ensure_slug_unique(session, data["slug"], exclude_id=product.id)
    if "sku" in data and data["sku"]:
        await _ensure_sku_unique(session, data["sku"], exclude_id=product.id)
    if "tags" in data and data["tags"] is not None:
        product.tags = await _get_or_create_tags(session, data["tags"])
    if "options" in data and data["options"] is not None:
        product.options = [ProductOption(**opt.model_dump()) for opt in data["options"]]
    for field, value in data.items():
        setattr(product, field, value)
    _set_publish_timestamp(product, data.get("status"))
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


async def soft_delete_product(session: AsyncSession, product: Product) -> None:
    product.is_deleted = True
    session.add(product)
    await session.commit()


async def bulk_update_products(session: AsyncSession, updates: list[BulkProductUpdateItem]) -> list[Product]:
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
    return updated


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
    return "-".join(filter(None, cleaned.split("-")))


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
