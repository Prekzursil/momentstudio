from decimal import Decimal
from datetime import datetime, timezone
import csv
import io
import json
import random
import string
import uuid

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select, update, or_, case, false
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.catalog import (
    BackInStockRequest,
    Category,
    CategoryTranslation,
    Product,
    ProductImage,
    ProductOption,
    ProductTranslation,
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
    CategoryTranslationUpsert,
    CategoryUpdate,
    CategoryReorderItem,
    CategoryRead,
    ProductCreate,
    ProductImageCreate,
    ProductTranslationUpsert,
    ProductUpdate,
    ProductVariantCreate,
    BulkProductUpdateItem,
    ProductReviewCreate,
    FeaturedCollectionCreate,
    FeaturedCollectionUpdate,
    ProductFeedItem,
)
from app.services.storage import delete_file
from app.services import email as email_service
from app.services import auth as auth_service
from app.services import notifications as notifications_service
from app.services import pricing
from app.core.config import settings
from app.models.user import User


async def get_category_by_slug(session: AsyncSession, slug: str) -> Category | None:
    result = await session.execute(select(Category).where(Category.slug == slug))
    return result.scalar_one_or_none()


async def _get_category_descendant_ids(session: AsyncSession, root_id: uuid.UUID) -> list[uuid.UUID]:
    result = await session.execute(select(Category.id, Category.parent_id))
    children_by_parent: dict[uuid.UUID, list[uuid.UUID]] = {}
    for cat_id, parent_id in result.all():
        if parent_id is None:
            continue
        children_by_parent.setdefault(parent_id, []).append(cat_id)
    resolved: list[uuid.UUID] = []
    stack = [root_id]
    seen: set[uuid.UUID] = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        resolved.append(current)
        stack.extend(children_by_parent.get(current, []))
    return resolved


async def _get_category_and_descendant_ids_by_slug(session: AsyncSession, slug: str) -> list[uuid.UUID]:
    category = await get_category_by_slug(session, slug)
    if not category:
        return []
    return await _get_category_descendant_ids(session, category.id)


async def _validate_category_parent_assignment(
    session: AsyncSession, *, category_id: uuid.UUID, parent_id: uuid.UUID | None
) -> None:
    if parent_id is None:
        return
    if parent_id == category_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category cannot be its own parent")
    result = await session.execute(select(Category.id, Category.parent_id))
    parent_by_id: dict[uuid.UUID, uuid.UUID | None] = {cat_id: parent for cat_id, parent in result.all()}
    if parent_id not in parent_by_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parent category not found")
    current: uuid.UUID | None = parent_id
    seen: set[uuid.UUID] = set()
    while current is not None:
        if current == category_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category parent would create a cycle")
        if current in seen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category hierarchy")
        seen.add(current)
        current = parent_by_id.get(current)


def apply_category_translation(category: Category, lang: str | None) -> None:
    if not category or not lang or not getattr(category, "translations", None):
        return
    match = next((t for t in category.translations if t.lang == lang), None)
    if match:
        category.name = match.name
        category.description = match.description


def apply_product_translation(product: Product, lang: str | None) -> None:
    if not product or not lang:
        return
    if getattr(product, "translations", None):
        match = next((t for t in product.translations if t.lang == lang), None)
        if match:
            product.name = match.name
            product.short_description = match.short_description
            product.long_description = match.long_description
            product.meta_title = match.meta_title or product.meta_title
            product.meta_description = match.meta_description or product.meta_description
    if product.category:
        apply_category_translation(product.category, lang)


async def list_category_translations(session: AsyncSession, category: Category) -> list[CategoryTranslation]:
    rows = (
        (
            await session.execute(
                select(CategoryTranslation)
                .where(CategoryTranslation.category_id == category.id)
                .order_by(CategoryTranslation.lang.asc())
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def upsert_category_translation(
    session: AsyncSession,
    *,
    category: Category,
    lang: str,
    payload: CategoryTranslationUpsert,
) -> CategoryTranslation:
    existing = await session.scalar(
        select(CategoryTranslation).where(CategoryTranslation.category_id == category.id, CategoryTranslation.lang == lang)
    )
    if existing:
        existing.name = payload.name
        existing.description = payload.description
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing

    created = CategoryTranslation(category_id=category.id, lang=lang, name=payload.name, description=payload.description)
    session.add(created)
    await session.commit()
    await session.refresh(created)
    return created


async def delete_category_translation(session: AsyncSession, *, category: Category, lang: str) -> None:
    existing = await session.scalar(
        select(CategoryTranslation).where(CategoryTranslation.category_id == category.id, CategoryTranslation.lang == lang)
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category translation not found")
    await session.delete(existing)
    await session.commit()


async def list_product_translations(session: AsyncSession, product: Product) -> list[ProductTranslation]:
    rows = (
        (
            await session.execute(
                select(ProductTranslation)
                .where(ProductTranslation.product_id == product.id)
                .order_by(ProductTranslation.lang.asc())
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def upsert_product_translation(
    session: AsyncSession,
    *,
    product: Product,
    lang: str,
    payload: ProductTranslationUpsert,
) -> ProductTranslation:
    existing = await session.scalar(
        select(ProductTranslation).where(ProductTranslation.product_id == product.id, ProductTranslation.lang == lang)
    )
    if existing:
        existing.name = payload.name
        existing.short_description = payload.short_description
        existing.long_description = payload.long_description
        existing.meta_title = payload.meta_title
        existing.meta_description = payload.meta_description
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing

    created = ProductTranslation(
        product_id=product.id,
        lang=lang,
        name=payload.name,
        short_description=payload.short_description,
        long_description=payload.long_description,
        meta_title=payload.meta_title,
        meta_description=payload.meta_description,
    )
    session.add(created)
    await session.commit()
    await session.refresh(created)
    return created


async def delete_product_translation(session: AsyncSession, *, product: Product, lang: str) -> None:
    existing = await session.scalar(
        select(ProductTranslation).where(ProductTranslation.product_id == product.id, ProductTranslation.lang == lang)
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product translation not found")
    await session.delete(existing)
    await session.commit()


async def get_product_by_slug(
    session: AsyncSession, slug: str, options: list | None = None, follow_history: bool = True, lang: str | None = None
) -> Product | None:
    query = select(Product)
    final_options = options[:] if options else []
    if lang:
        final_options.append(selectinload(Product.translations))
        final_options.append(selectinload(Product.category).selectinload(Category.translations))
    if final_options:
        for opt in final_options:
            query = query.options(opt)
    result = await session.execute(query.where(Product.slug == slug))
    product = result.scalar_one_or_none()
    if product or not follow_history:
        if product:
            apply_product_translation(product, lang)
        return product
    hist_result = await session.execute(select(ProductSlugHistory).where(ProductSlugHistory.slug == slug))
    history = hist_result.scalar_one_or_none()
    if history:
        product = await session.get(Product, history.product_id)
        if product:
            apply_product_translation(product, lang)
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


def _validate_price_currency(base_price: Decimal | None, currency: str) -> None:
    if base_price is not None and base_price < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Base price must be non-negative")
    cleaned = (currency or "").strip().upper()
    if cleaned and len(cleaned) != 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Currency must be a 3-letter code")
    if cleaned and cleaned != "RON":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only RON currency is supported")


def _to_decimal(value: object | None) -> Decimal:
    if value is None:
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _tz_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _validate_sale_schedule(*, sale_start_at: datetime | None, sale_end_at: datetime | None, sale_auto_publish: bool) -> None:
    start = _tz_aware(sale_start_at)
    end = _tz_aware(sale_end_at)
    if start and end and end < start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sale end must be after sale start")
    if sale_auto_publish and not start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sale start is required for auto-publish")


def is_sale_active(product: Product, *, now: datetime | None = None) -> bool:
    sale_price = getattr(product, "sale_price", None)
    if sale_price is None:
        return False
    now_dt = now or datetime.now(timezone.utc)
    start = _tz_aware(getattr(product, "sale_start_at", None))
    end = _tz_aware(getattr(product, "sale_end_at", None))
    if start and now_dt < start:
        return False
    if end and now_dt >= end:
        return False
    return True


def _sale_active_clause(now: datetime):
    start_ok = or_(Product.sale_start_at.is_(None), Product.sale_start_at <= now)
    end_ok = or_(Product.sale_end_at.is_(None), Product.sale_end_at > now)
    return and_(Product.sale_price.is_not(None), start_ok, end_ok)


async def auto_publish_due_sales(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Publish draft products once their scheduled sale begins (best-effort, request-driven)."""
    now_dt = now or datetime.now(timezone.utc)
    clause = and_(
        Product.is_deleted.is_(False),
        Product.is_active.is_(True),
        Product.status == ProductStatus.draft,
        Product.sale_auto_publish.is_(True),
        Product.sale_price.is_not(None),
        Product.sale_start_at.is_not(None),
        Product.sale_start_at <= now_dt,
        or_(Product.sale_end_at.is_(None), Product.sale_end_at > now_dt),
    )
    res = await session.execute(
        update(Product)
        .where(clause)
        .values(status=ProductStatus.published, publish_at=func.coalesce(Product.publish_at, now_dt))
    )
    updated = int(res.rowcount or 0)
    if updated:
        await session.commit()
    return updated


def _compute_sale_price(
    *,
    base_price: object,
    sale_type: str | None,
    sale_value: object | None,
) -> Decimal | None:
    if not sale_type or sale_value is None:
        return None
    base = pricing.quantize_money(_to_decimal(base_price))
    if base <= 0:
        return None
    value = pricing.quantize_money(_to_decimal(sale_value))
    if value <= 0:
        return None

    discount = Decimal("0.00")
    if sale_type == "percent":
        if value >= 100:
            discount = base
        else:
            discount = pricing.quantize_money(base * value / Decimal("100"))
    elif sale_type == "amount":
        discount = value
    else:
        return None

    price = base - discount
    if price <= 0:
        return Decimal("0.00")
    price = pricing.quantize_money(price)
    if price >= base:
        return None
    return price


def _sync_sale_fields(product: Product) -> None:
    sale_price = _compute_sale_price(
        base_price=product.base_price,
        sale_type=getattr(product, "sale_type", None),
        sale_value=getattr(product, "sale_value", None),
    )
    product.sale_price = sale_price
    if sale_price is None:
        product.sale_type = None
        product.sale_value = None
        if hasattr(product, "sale_start_at"):
            product.sale_start_at = None
        if hasattr(product, "sale_end_at"):
            product.sale_end_at = None
        if hasattr(product, "sale_auto_publish"):
            product.sale_auto_publish = False
        return

    sale_auto_publish = bool(getattr(product, "sale_auto_publish", False))
    _validate_sale_schedule(
        sale_start_at=getattr(product, "sale_start_at", None),
        sale_end_at=getattr(product, "sale_end_at", None),
        sale_auto_publish=sale_auto_publish,
    )
    if hasattr(product, "sale_start_at"):
        product.sale_start_at = _tz_aware(getattr(product, "sale_start_at", None))
    if hasattr(product, "sale_end_at"):
        product.sale_end_at = _tz_aware(getattr(product, "sale_end_at", None))
    if hasattr(product, "sale_auto_publish"):
        product.sale_auto_publish = sale_auto_publish


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
    base = (slugify(payload.name or "") or "category")[:120]
    candidate = base
    counter = 2
    while await get_category_by_slug(session, candidate):
        suffix = f"-{counter}"
        candidate = f"{base[: 120 - len(suffix)]}{suffix}"
        counter += 1

    if payload.parent_id is not None:
        parent = await session.get(Category, payload.parent_id)
        if not parent:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parent category not found")

    category = Category(
        slug=candidate,
        name=payload.name,
        description=payload.description,
        sort_order=payload.sort_order,
        parent_id=payload.parent_id,
    )
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


async def update_category(session: AsyncSession, category: Category, payload: CategoryUpdate) -> Category:
    data = payload.model_dump(exclude_unset=True)
    if "slug" in data:
        requested_slug = (data.get("slug") or "").strip()
        if requested_slug and requested_slug != category.slug:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category slug cannot be changed")
        data.pop("slug", None)
    if "parent_id" in data:
        await _validate_category_parent_assignment(session, category_id=category.id, parent_id=data.get("parent_id"))
    for field, value in data.items():
        setattr(category, field, value)
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


async def reorder_categories(session: AsyncSession, payload: list[CategoryReorderItem]) -> list[CategoryRead]:
    slugs = [item.slug for item in payload]
    if not slugs:
        return []
    result = await session.execute(select(Category).where(Category.slug.in_(slugs)))
    categories = {c.slug: c for c in result.scalars()}
    updated: list[Category] = []
    for item in payload:
        if not item.slug or item.slug not in categories:
            continue
        cat = categories[item.slug]
        if item.sort_order is not None:
            cat.sort_order = item.sort_order
            cat.updated_at = datetime.now(timezone.utc)
            updated.append(cat)
    if not updated:
        return []
    session.add_all(updated)
    await session.commit()
    return [
        CategoryRead(
            id=cat.id,
            slug=cat.slug,
            name=cat.name,
            description=cat.description,
            sort_order=cat.sort_order,
            parent_id=cat.parent_id,
            created_at=cat.created_at,
            updated_at=cat.updated_at,
        )
        for cat in updated
    ]


async def create_product(
    session: AsyncSession, payload: ProductCreate, commit: bool = True, user_id: uuid.UUID | None = None
) -> Product:
    requested_slug = (payload.slug or "").strip()
    base_slug = (requested_slug or slugify(payload.name or "") or "product")[:160]
    candidate_slug = base_slug
    counter = 2
    while True:
        try:
            await _ensure_slug_unique(session, candidate_slug)
            break
        except HTTPException:
            suffix = f"-{counter}"
            candidate_slug = f"{base_slug[: 160 - len(suffix)]}{suffix}"
            counter += 1

    sku = payload.sku or await _generate_unique_sku(session, candidate_slug)
    await _ensure_sku_unique(session, sku)
    _validate_price_currency(payload.base_price, payload.currency)

    images_payload = payload.images or []
    variants_payload: list[ProductVariantCreate] = getattr(payload, "variants", []) or []
    product_data = payload.model_dump(exclude={"images", "variants", "tags", "options"})
    product_data["slug"] = candidate_slug
    product_data["sku"] = sku
    product_data["currency"] = payload.currency.upper()
    product = Product(**product_data)
    _sync_sale_fields(product)
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
    was_out_of_stock = is_out_of_stock(product)
    before_sale_type = getattr(product, "sale_type", None)
    before_sale_value = getattr(product, "sale_value", None)
    data = payload.model_dump(exclude_unset=True)
    if "base_price" in data or "currency" in data:
        _validate_price_currency(data.get("base_price", product.base_price), data.get("currency", product.currency))
    if "slug" in data:
        if data["slug"] and data["slug"] != product.slug:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slug cannot be changed")
        data.pop("slug", None)
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
    is_now_out_of_stock = is_out_of_stock(product)
    sale_fields_touched = any(
        key in data for key in ("sale_type", "sale_value", "sale_start_at", "sale_end_at", "sale_auto_publish")
    )
    if sale_fields_touched or "base_price" in data:
        _sync_sale_fields(product)
    if sale_fields_touched:
        sale_changed = (getattr(product, "sale_type", None) != before_sale_type) or (
            getattr(product, "sale_value", None) != before_sale_value
        )
        if sale_changed and product.status == ProductStatus.published:
            product.status = ProductStatus.draft
    _set_publish_timestamp(product, product.status)
    session.add(product)
    if commit:
        await session.commit()
        await session.refresh(product)
        if was_out_of_stock and not is_now_out_of_stock:
            await fulfill_back_in_stock_requests(session, product=product)
        await _log_product_action(session, product.id, "update", user_id, data)
        await _maybe_alert_low_stock(session, product)
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


async def delete_product_image(session: AsyncSession, product: Product, image_id: str, user_id: uuid.UUID | None = None) -> None:
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    delete_file(image.url)
    await session.delete(image)
    await session.commit()
    await _log_product_action(session, product.id, "image_deleted", user_id, {"image_id": image_id, "url": image.url})


async def update_product_image_sort(session: AsyncSession, product: Product, image_id: str, sort_order: int) -> Product:
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    image.sort_order = sort_order
    session.add(image)
    await session.commit()
    await session.refresh(product, attribute_names=["images"])
    return product


async def soft_delete_product(session: AsyncSession, product: Product, user_id: uuid.UUID | None = None) -> None:
    original_slug = product.slug
    product.is_deleted = True
    # Free the slug for reuse by moving deleted products to a stable tombstone slug.
    product.slug = f"deleted-{product.id}"
    session.add(product)
    await session.execute(delete(ProductSlugHistory).where(ProductSlugHistory.product_id == product.id))
    await session.commit()
    await _log_product_action(
        session, product.id, "soft_delete", user_id, {"slug": original_slug, "tombstone_slug": product.slug}
    )


async def bulk_update_products(
    session: AsyncSession, updates: list[BulkProductUpdateItem], user_id: uuid.UUID | None = None
) -> list[Product]:
    product_ids = [item.product_id for item in updates]
    result = await session.execute(select(Product).where(Product.id.in_(product_ids)))
    products = {p.id: p for p in result.scalars()}

    updated: list[Product] = []
    restocked: set[uuid.UUID] = set()
    for item in updates:
        product = products.get(item.product_id)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Product {item.product_id} not found")
        was_out_of_stock = is_out_of_stock(product)
        before_sale_type = getattr(product, "sale_type", None)
        before_sale_value = getattr(product, "sale_value", None)
        data = item.model_dump(exclude_unset=True)
        for field in (
            "base_price",
            "sale_type",
            "sale_value",
            "sale_start_at",
            "sale_end_at",
            "sale_auto_publish",
            "stock_quantity",
            "status",
        ):
            if field not in data:
                continue
            if field == "sale_auto_publish":
                if data[field] is None:
                    setattr(product, field, False)
                else:
                    setattr(product, field, bool(data[field]))
                continue
            if field in {"sale_type", "sale_value", "sale_start_at", "sale_end_at"}:
                setattr(product, field, data[field] if data[field] is not None else None)
                continue
            if data[field] is not None:
                setattr(product, field, data[field])

        sale_fields_touched = any(
            key in data for key in ("sale_type", "sale_value", "sale_start_at", "sale_end_at", "sale_auto_publish")
        )
        if sale_fields_touched or "base_price" in data:
            _sync_sale_fields(product)
        if sale_fields_touched:
            sale_changed = (getattr(product, "sale_type", None) != before_sale_type) or (
                getattr(product, "sale_value", None) != before_sale_value
            )
            if sale_changed and product.status == ProductStatus.published:
                product.status = ProductStatus.draft

        _set_publish_timestamp(product, product.status)
        if was_out_of_stock and not is_out_of_stock(product):
            restocked.add(product.id)
        session.add(product)
        updated.append(product)
    await session.commit()
    for product in updated:
        await session.refresh(product)
        if product.id in restocked:
            await fulfill_back_in_stock_requests(session, product=product)
        await _log_product_action(
            session,
            product.id,
            "bulk_update",
            user_id,
            {
                "base_price": product.base_price,
                "sale_type": product.sale_type,
                "sale_value": product.sale_value,
                "sale_price": product.sale_price,
                "stock_quantity": product.stock_quantity,
                "status": str(product.status),
            },
        )
    return updated


async def get_featured_collection_by_slug(session: AsyncSession, slug: str) -> FeaturedCollection | None:
    result = await session.execute(
        select(FeaturedCollection).options(selectinload(FeaturedCollection.products)).where(FeaturedCollection.slug == slug)
    )
    return result.scalar_one_or_none()


async def list_featured_collections(session: AsyncSession) -> list[FeaturedCollection]:
    result = await session.execute(
        select(FeaturedCollection)
        .options(
            selectinload(
                FeaturedCollection.products.and_(
                    Product.is_deleted.is_(False),
                    Product.is_active.is_(True),
                    Product.status == ProductStatus.published,
                )
            )
        )
        .order_by(FeaturedCollection.created_at.desc())
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
    base = (slugify(payload.name or "") or "collection")[:120]
    candidate = base
    counter = 2
    while await get_featured_collection_by_slug(session, candidate):
        suffix = f"-{counter}"
        candidate = f"{base[: 120 - len(suffix)]}{suffix}"
        counter += 1
    products = await _load_products_by_ids(session, payload.product_ids)
    collection = FeaturedCollection(slug=candidate, name=payload.name, description=payload.description)
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


async def get_product_feed(session: AsyncSession, lang: str | None = None) -> list[ProductFeedItem]:
    result = await session.execute(
        select(Product)
        .options(
            selectinload(Product.tags),
            selectinload(Product.translations) if lang else selectinload(Product.category),
            selectinload(Product.category).selectinload(Category.translations) if lang else selectinload(Product.category),
        )
        .where(
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
            Product.status == ProductStatus.published,
        )
        .order_by(Product.created_at.desc())
    )
    products = result.scalars().unique().all()
    feed: list[ProductFeedItem] = []
    for p in products:
        apply_product_translation(p, lang)
        effective_price = p.sale_price if is_sale_active(p) and p.sale_price is not None else p.base_price
        feed.append(
            ProductFeedItem(
                slug=p.slug,
                name=p.name,
                price=float(effective_price),
                currency=p.currency,
                description=p.short_description or p.long_description,
                category_slug=p.category.slug if p.category else None,
                tags=[tag.slug for tag in p.tags],
            )
        )
    return feed


async def get_product_feed_csv(session: AsyncSession, lang: str | None = None) -> str:
    feed = await get_product_feed(session, lang=lang)
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


async def get_product_price_bounds(
    session: AsyncSession,
    category_slug: str | None,
    on_sale: bool | None,
    is_featured: bool | None,
    search: str | None,
    tags: list[str] | None,
) -> tuple[float, float, str | None]:
    now_dt = datetime.now(timezone.utc)
    sale_active = _sale_active_clause(now_dt)
    effective_price = case((sale_active, Product.sale_price), else_=Product.base_price)
    query = select(
        func.min(effective_price),
        func.max(effective_price),
        func.count(func.distinct(Product.currency)),
        func.min(Product.currency),
    ).where(
        Product.is_deleted.is_(False),
        Product.is_active.is_(True),
        Product.status == ProductStatus.published,
    )

    if category_slug:
        category_ids = await _get_category_and_descendant_ids_by_slug(session, category_slug)
        if category_ids:
            query = query.where(Product.category_id.in_(category_ids))
        else:
            query = query.where(false())
    if on_sale is not None:
        query = query.where(sale_active if on_sale else ~sale_active)
    if is_featured is not None:
        query = query.where(Product.is_featured == is_featured)
    if search:
        like = f"%{search.lower()}%"
        query = query.where(
            (Product.name.ilike(like)) | (Product.short_description.ilike(like)) | (Product.long_description.ilike(like))
        )
    if tags:
        query = query.join(Product.tags).where(Tag.slug.in_(tags))

    row = (await session.execute(query)).one()
    min_price, max_price, currency_count, currency = row
    min_value = float(min_price) if min_price is not None else 0.0
    max_value = float(max_price) if max_price is not None else 0.0
    currency_value = currency if int(currency_count or 0) == 1 else None
    return min_value, max_value, currency_value


async def list_products_with_filters(
    session: AsyncSession,
    category_slug: str | None,
    on_sale: bool | None,
    is_featured: bool | None,
    search: str | None,
    min_price: float | None,
    max_price: float | None,
    tags: list[str] | None,
    sort: str | None,
    limit: int,
    offset: int,
    lang: str | None = None,
):
    now_dt = datetime.now(timezone.utc)
    sale_active = _sale_active_clause(now_dt)
    effective_price = case((sale_active, Product.sale_price), else_=Product.base_price)
    options = [
        selectinload(Product.images),
        selectinload(Product.tags),
    ]
    if lang:
        options.append(selectinload(Product.translations))
        options.append(selectinload(Product.category).selectinload(Category.translations))
    else:
        options.append(selectinload(Product.category))
    base_query = (
        select(Product)
        .options(*options)
        .where(Product.is_deleted.is_(False), Product.is_active.is_(True), Product.status == ProductStatus.published)
    )
    if category_slug:
        category_ids = await _get_category_and_descendant_ids_by_slug(session, category_slug)
        if category_ids:
            base_query = base_query.where(Product.category_id.in_(category_ids))
        else:
            base_query = base_query.where(false())
    if on_sale is not None:
        base_query = base_query.where(sale_active if on_sale else ~sale_active)
    if is_featured is not None:
        base_query = base_query.where(Product.is_featured == is_featured)
    if search:
        like = f"%{search.lower()}%"
        base_query = base_query.where(
            (Product.name.ilike(like)) | (Product.short_description.ilike(like)) | (Product.long_description.ilike(like))
        )
    if min_price is not None:
        base_query = base_query.where(effective_price >= min_price)
    if max_price is not None:
        base_query = base_query.where(effective_price <= max_price)
    if tags:
        base_query = base_query.join(Product.tags).where(Tag.slug.in_(tags))

    total_query = base_query.with_only_columns(func.count(func.distinct(Product.id))).order_by(None)
    total_result = await session.execute(total_query)
    total_items = total_result.scalar_one()

    if sort == "price_asc":
        base_query = base_query.order_by(effective_price.asc())
    elif sort == "price_desc":
        base_query = base_query.order_by(effective_price.desc())
    elif sort == "name_asc":
        base_query = base_query.order_by(Product.name.asc())
    elif sort == "name_desc":
        base_query = base_query.order_by(Product.name.desc())
    else:
        base_query = base_query.order_by(Product.created_at.desc())

    result = await session.execute(base_query.limit(limit).offset(offset))
    items = list(result.scalars().unique())
    if lang:
        for item in items:
            apply_product_translation(item, lang)
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
    while True:
        try:
            await _ensure_slug_unique(session, new_slug)
            break
        except HTTPException:
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
        sale_type=product.sale_type,
        sale_value=product.sale_value,
        sale_price=product.sale_price,
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
    if not product:
        return
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
            Product.is_active.is_(True),
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
                and_(
                    Product.is_deleted.is_(False),
                    Product.is_active.is_(True),
                    Product.status == ProductStatus.published,
                )
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
            base_price = Decimal(str(row.get("base_price") or "0")).quantize(Decimal("0.01"))
            stock_quantity = int(row.get("stock_quantity") or 0)
        except Exception:
            errors.append(f"Row {idx}: invalid base_price or stock_quantity")
            continue
        currency = (row.get("currency") or "RON").strip().upper()
        if currency != "RON":
            errors.append(f"Row {idx}: currency must be RON")
            continue
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
            create_payload = ProductCreate(
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
            await create_product(session, create_payload, commit=False)
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


DEFAULT_LOW_STOCK_ALERT_THRESHOLD = 2


async def _effective_low_stock_threshold(
    session: AsyncSession, *, product: Product, default_threshold: int
) -> int:
    override = getattr(product, "low_stock_threshold", None)
    if override is not None:
        return int(override)

    category_override = None
    category_obj = getattr(product, "category", None)
    if category_obj is not None:
        category_override = getattr(category_obj, "low_stock_threshold", None)
    if category_override is None:
        category_override = await session.scalar(select(Category.low_stock_threshold).where(Category.id == product.category_id))
    if category_override is not None:
        return int(category_override)

    return int(default_threshold)


async def _maybe_alert_low_stock(session: AsyncSession, product: Product, threshold: int = DEFAULT_LOW_STOCK_ALERT_THRESHOLD) -> None:
    effective_threshold = await _effective_low_stock_threshold(session, product=product, default_threshold=threshold)
    if product.stock_quantity is None or product.stock_quantity > effective_threshold:
        return

    to_email = await auth_service.get_owner_email(session)
    if not to_email:
        to_email = settings.admin_alert_email
    if not to_email:
        return

    await email_service.send_low_stock_alert(to_email, product.name, product.stock_quantity)


def is_out_of_stock(product: Product) -> bool:
    return bool((product.stock_quantity or 0) <= 0 and not getattr(product, "allow_backorder", False))


async def get_active_back_in_stock_request(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    product_id: uuid.UUID,
) -> BackInStockRequest | None:
    stmt = (
        select(BackInStockRequest)
        .where(
            BackInStockRequest.user_id == user_id,
            BackInStockRequest.product_id == product_id,
            BackInStockRequest.fulfilled_at.is_(None),
            BackInStockRequest.canceled_at.is_(None),
        )
        .order_by(BackInStockRequest.created_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def create_back_in_stock_request(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    product: Product,
) -> BackInStockRequest:
    if not is_out_of_stock(product):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product is in stock")

    existing = await get_active_back_in_stock_request(session, user_id=user_id, product_id=product.id)
    if existing:
        return existing

    record = BackInStockRequest(user_id=user_id, product_id=product.id)
    session.add(record)
    await session.commit()
    await session.refresh(record)
    owner = await auth_service.get_owner_user(session)
    if owner:
        try:
            await notifications_service.create_notification(
                session,
                user_id=owner.id,
                type="back_in_stock_request",
                title=f"Product interest: {product.name}",
                body="A customer asked to be notified when this product is back in stock.",
                url=f"/admin/products?search={product.slug}",
            )
        except Exception:
            # Notifications are best-effort; the request should still succeed.
            pass
    return record


async def cancel_back_in_stock_request(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    product_id: uuid.UUID,
) -> BackInStockRequest | None:
    record = await get_active_back_in_stock_request(session, user_id=user_id, product_id=product_id)
    if not record:
        return None
    record.canceled_at = datetime.now(timezone.utc)
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def fulfill_back_in_stock_requests(session: AsyncSession, *, product: Product) -> int:
    now = datetime.now(timezone.utc)
    stmt = (
        select(BackInStockRequest, User.email)
        .join(User, User.id == BackInStockRequest.user_id)
        .where(
            BackInStockRequest.product_id == product.id,
            BackInStockRequest.fulfilled_at.is_(None),
            BackInStockRequest.canceled_at.is_(None),
        )
        .order_by(BackInStockRequest.created_at.asc())
    )
    rows = list((await session.execute(stmt)).all())
    if not rows:
        return 0

    requests: list[BackInStockRequest] = []
    for req, _email in rows:
        req.fulfilled_at = now
        requests.append(req)
    session.add_all(requests)
    await session.commit()

    sent = 0
    for req, email in rows:
        if not email:
            continue
        if await email_service.send_back_in_stock(email, product.name):
            req.notified_at = datetime.now(timezone.utc)
            sent += 1
    if sent:
        session.add_all([req for req, _ in rows])
        await session.commit()
    return sent
