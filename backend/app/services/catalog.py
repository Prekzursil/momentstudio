from decimal import Decimal
from datetime import datetime, timezone
import csv
import io
import json
import logging
import secrets
import string
import unicodedata
import uuid

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select, update, or_, case, false
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.models.catalog import (
    BackInStockRequest,
    Category,
    CategoryTranslation,
    Product,
    ProductBadge,
    ProductRelationship,
    ProductRelationshipType,
    ProductImage,
    ProductImageTranslation,
    ProductOption,
    ProductTranslation,
    ProductVariant,
    StockAdjustment,
    StockAdjustmentReason,
    ProductStatus,
    Tag,
    ProductReview,
    ProductSlugHistory,
    RecentlyViewedProduct,
    FeaturedCollection,
)
from app.models.cart import CartItem
from app.models.order import OrderItem
from app.models.taxes import TaxGroup
from app.schemas.catalog import (
    CategoryCreate,
    CategoryTranslationUpsert,
    CategoryUpdate,
    CategoryReorderItem,
    CategoryRead,
    ProductCreate,
    ProductImageCreate,
    ProductImageTranslationUpsert,
    ProductTranslationUpsert,
    ProductUpdate,
    ProductVariantCreate,
    ProductVariantMatrixUpdate,
    BulkProductUpdateItem,
    StockAdjustmentCreate,
    ProductReviewCreate,
    FeaturedCollectionCreate,
    FeaturedCollectionUpdate,
    ProductFeedItem,
    ProductRelationshipsUpdate,
)
from app.services.storage import get_media_image_stats, regenerate_media_thumbnails
from app.services import email as email_service
from app.services import auth as auth_service
from app.services import audit_chain as audit_chain_service
from app.services import notifications as notifications_service
from app.services import pricing
from app.core.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

_SEARCH_CHAR_MAP: tuple[tuple[str, str], ...] = (
    ("ă", "a"),
    ("â", "a"),
    ("î", "i"),
    ("ș", "s"),
    ("ş", "s"),
    ("ț", "t"),
    ("ţ", "t"),
)


async def get_category_by_slug(session: AsyncSession, slug: str) -> Category | None:
    result = await session.execute(select(Category).where(Category.slug == slug))
    return result.scalar_one_or_none()


async def _get_category_descendant_ids(session: AsyncSession, root_id: uuid.UUID) -> list[uuid.UUID]:
    resolved: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    frontier = [root_id]
    while frontier:
        next_frontier: list[uuid.UUID] = []
        for current in frontier:
            if current in seen:
                continue
            seen.add(current)
            resolved.append(current)
        child_rows = (
            await session.execute(select(Category.id).where(Category.parent_id.in_(frontier)))
        ).scalars()
        for child_id in child_rows:
            if child_id not in seen:
                next_frontier.append(child_id)
        frontier = next_frontier
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


def _find_translation_for_lang(translations, lang: str):
    if not translations:
        return None
    return next((translation for translation in translations if translation.lang == lang), None)


def _apply_product_text_translation(product: Product, lang: str) -> None:
    match = _find_translation_for_lang(getattr(product, "translations", None), lang)
    if not match:
        return
    product.name = match.name
    product.short_description = match.short_description
    product.long_description = match.long_description
    product.meta_title = match.meta_title or product.meta_title
    product.meta_description = match.meta_description or product.meta_description


def _apply_product_image_translation(image: ProductImage, lang: str) -> None:
    match = _find_translation_for_lang(getattr(image, "translations", None), lang)
    if not match:
        return
    if match.alt_text is not None:
        image.alt_text = match.alt_text
    if match.caption is not None:
        image.caption = match.caption


def _apply_product_image_translations(product: Product, lang: str) -> None:
    if not getattr(product, "images", None):
        return
    for image in product.images:
        _apply_product_image_translation(image, lang)


def apply_product_translation(product: Product, lang: str | None) -> None:
    if not product or not lang:
        return
    _apply_product_text_translation(product, lang)
    if product.category:
        apply_category_translation(product.category, lang)
    _apply_product_image_translations(product, lang)


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


async def list_product_image_translations(session: AsyncSession, *, image: ProductImage) -> list[ProductImageTranslation]:
    rows = (
        (
            await session.execute(
                select(ProductImageTranslation)
                .where(ProductImageTranslation.image_id == image.id)
                .order_by(ProductImageTranslation.lang.asc())
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def upsert_product_image_translation(
    session: AsyncSession,
    *,
    image: ProductImage,
    lang: str,
    payload: ProductImageTranslationUpsert,
    user_id: uuid.UUID | None = None,
    source: str | None = None,
) -> ProductImageTranslation:
    existing = await session.scalar(
        select(ProductImageTranslation).where(ProductImageTranslation.image_id == image.id, ProductImageTranslation.lang == lang)
    )

    alt_text = payload.alt_text.strip() if payload.alt_text else None
    caption = payload.caption.strip() if payload.caption else None

    if existing:
        existing.alt_text = alt_text
        existing.caption = caption
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        await _log_product_action(
            session,
            image.product_id,
            "image_translation_upsert",
            user_id,
            {"source": source, "image_id": str(image.id), "lang": lang}
            if source
            else {"image_id": str(image.id), "lang": lang},
        )
        return existing

    created = ProductImageTranslation(image_id=image.id, lang=lang, alt_text=alt_text, caption=caption)
    session.add(created)
    await session.commit()
    await session.refresh(created)
    await _log_product_action(
        session,
        image.product_id,
        "image_translation_upsert",
        user_id,
        {"source": source, "image_id": str(image.id), "lang": lang} if source else {"image_id": str(image.id), "lang": lang},
    )
    return created


async def delete_product_image_translation(
    session: AsyncSession,
    *,
    image: ProductImage,
    lang: str,
    user_id: uuid.UUID | None = None,
    source: str | None = None,
) -> None:
    existing = await session.scalar(
        select(ProductImageTranslation).where(ProductImageTranslation.image_id == image.id, ProductImageTranslation.lang == lang)
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product image translation not found")
    await session.delete(existing)
    await session.commit()
    await _log_product_action(
        session,
        image.product_id,
        "image_translation_delete",
        user_id,
        {"source": source, "image_id": str(image.id), "lang": lang} if source else {"image_id": str(image.id), "lang": lang},
    )


def get_product_image_optimization_stats(image: ProductImage) -> dict[str, int | None]:
    try:
        return get_media_image_stats(image.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to read image stats")


def reprocess_product_image_thumbnails(image: ProductImage) -> dict[str, int | None]:
    try:
        return regenerate_media_thumbnails(image.url)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to reprocess thumbnails")


def _base_product_lookup_query():
    return select(Product).execution_options(populate_existing=True).options(
        with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True)
    )


def _build_product_lookup_options(options: list | None, lang: str | None) -> list:
    final_options = list(options or [])
    if lang:
        final_options.append(selectinload(Product.translations))
        final_options.append(selectinload(Product.category).selectinload(Category.translations))
    return final_options


def _apply_lookup_options(query, options: list):
    for option in options:
        query = query.options(option)
    return query


async def _get_product_by_exact_slug(session: AsyncSession, slug: str, options: list) -> Product | None:
    query = _apply_lookup_options(_base_product_lookup_query(), options)
    result = await session.execute(query.where(Product.slug == slug))
    return result.scalar_one_or_none()


async def _get_product_by_slug_history(session: AsyncSession, slug: str, options: list) -> Product | None:
    hist_result = await session.execute(select(ProductSlugHistory).where(ProductSlugHistory.slug == slug))
    history = hist_result.scalar_one_or_none()
    if not history:
        return None
    query = _apply_lookup_options(_base_product_lookup_query(), options)
    result = await session.execute(query.where(Product.id == history.product_id))
    return result.scalar_one_or_none()


async def get_product_by_slug(
    session: AsyncSession, slug: str, options: list | None = None, follow_history: bool = True, lang: str | None = None
) -> Product | None:
    lookup_options = _build_product_lookup_options(options, lang)
    product = await _get_product_by_exact_slug(session, slug, lookup_options)
    if not product and follow_history:
        product = await _get_product_by_slug_history(session, slug, lookup_options)
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
        suffix = "".join(secrets.choice(string.digits) for _ in range(4))
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


def _extract_badge_value(item: dict[str, object]) -> object:
    badge = item.get("badge")
    if not badge:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Badge is required")
    return badge


def _parse_badge_schedule(item: dict[str, object]) -> tuple[datetime | None, datetime | None]:
    start_at_raw = item.get("start_at")
    end_at_raw = item.get("end_at")
    start_at = _tz_aware(start_at_raw) if isinstance(start_at_raw, datetime) else None
    end_at = _tz_aware(end_at_raw) if isinstance(end_at_raw, datetime) else None
    if start_at and end_at and end_at < start_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Badge end must be after badge start")
    return start_at, end_at


def _build_product_badges(payload: list[dict[str, object]]) -> list[ProductBadge]:
    seen: set[object] = set()
    badges: list[ProductBadge] = []
    for item in payload:
        badge = _extract_badge_value(item)
        if badge in seen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate badge")
        seen.add(badge)
        start_at, end_at = _parse_badge_schedule(item)
        badges.append(ProductBadge(badge=badge, start_at=start_at, end_at=end_at))
    return badges


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
    updated = int(getattr(res, "rowcount", 0) or 0)
    if updated:
        await session.commit()
    return updated


async def apply_due_product_schedules(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Apply scheduled publish/unpublish timestamps (best-effort, request-driven)."""
    now_dt = now or datetime.now(timezone.utc)
    updated = 0

    publish_clause = and_(
        Product.is_deleted.is_(False),
        Product.publish_scheduled_for.is_not(None),
        Product.publish_scheduled_for <= now_dt,
    )
    res = await session.execute(
        update(Product)
        .where(publish_clause)
        .values(
            status=ProductStatus.published,
            publish_at=func.coalesce(Product.publish_at, now_dt),
            publish_scheduled_for=None,
        )
    )
    updated += int(getattr(res, "rowcount", 0) or 0)

    unpublish_clause = and_(
        Product.is_deleted.is_(False),
        Product.status == ProductStatus.published,
        Product.unpublish_scheduled_for.is_not(None),
        Product.unpublish_scheduled_for <= now_dt,
    )
    res = await session.execute(
        update(Product)
        .where(unpublish_clause)
        .values(status=ProductStatus.archived, unpublish_scheduled_for=None)
    )
    updated += int(getattr(res, "rowcount", 0) or 0)

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

    discount = _resolve_sale_discount(base, sale_type, value)
    if discount is None:
        return None

    return _finalize_sale_price(base, discount)


def _resolve_sale_discount(base: Decimal, sale_type: str, value: Decimal) -> Decimal | None:
    if sale_type == "percent":
        if value >= 100:
            return base
        return pricing.quantize_money(base * value / Decimal("100"))
    if sale_type == "amount":
        return value
    return None


def _finalize_sale_price(base: Decimal, discount: Decimal) -> Decimal | None:
    price = base - discount
    if price <= 0:
        return Decimal("0.00")
    quantized_price = pricing.quantize_money(price)
    if quantized_price >= base:
        return None
    return quantized_price


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
    await audit_chain_service.add_product_audit_log(
        session,
        product_id=product_id,
        user_id=user_id,
        action=action,
        payload=json.dumps(payload, default=str) if payload else None,
    )
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

    if payload.tax_group_id is not None:
        tax_group = await session.get(TaxGroup, payload.tax_group_id)
        if not tax_group:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax group not found")

    category = Category(
        slug=candidate,
        name=payload.name,
        description=payload.description,
        thumbnail_url=getattr(payload, "thumbnail_url", None),
        banner_url=getattr(payload, "banner_url", None),
        is_visible=getattr(payload, "is_visible", True),
        sort_order=payload.sort_order,
        parent_id=payload.parent_id,
        tax_group_id=payload.tax_group_id,
    )
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


def _sanitize_category_update_data(category: Category, data: dict[str, object]) -> dict[str, object]:
    sanitized = dict(data)
    if "slug" not in sanitized:
        return sanitized
    requested_slug = (sanitized.get("slug") or "").strip()
    if requested_slug and requested_slug != category.slug:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category slug cannot be changed")
    sanitized.pop("slug", None)
    return sanitized


async def _validate_category_tax_group(session: AsyncSession, tax_group_id: object) -> None:
    if tax_group_id is None:
        return
    tax_group = await session.get(TaxGroup, tax_group_id)
    if not tax_group:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tax group not found")


async def _validate_category_update_relations(
    session: AsyncSession, category_id: uuid.UUID, data: dict[str, object]
) -> None:
    if "parent_id" in data:
        await _validate_category_parent_assignment(session, category_id=category_id, parent_id=data.get("parent_id"))
    if "tax_group_id" in data:
        await _validate_category_tax_group(session, data.get("tax_group_id"))


def _apply_field_updates(entity: object, data: dict[str, object]) -> None:
    for field, value in data.items():
        setattr(entity, field, value)


async def update_category(session: AsyncSession, category: Category, payload: CategoryUpdate) -> Category:
    data = _sanitize_category_update_data(category, payload.model_dump(exclude_unset=True))
    await _validate_category_update_relations(session, category.id, data)
    _apply_field_updates(category, data)
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return category


async def _load_categories_by_slug(session: AsyncSession, slugs: list[str]) -> dict[str, Category]:
    result = await session.execute(select(Category).where(Category.slug.in_(slugs)))
    return {category.slug: category for category in result.scalars()}


def _collect_category_reorder_updates(
    payload: list[CategoryReorderItem], categories_by_slug: dict[str, Category]
) -> list[Category]:
    updated: list[Category] = []
    for item in payload:
        if not item.slug or item.slug not in categories_by_slug:
            continue
        category = categories_by_slug[item.slug]
        if item.sort_order is None:
            continue
        category.sort_order = item.sort_order
        category.updated_at = datetime.now(timezone.utc)
        updated.append(category)
    return updated


async def reorder_categories(session: AsyncSession, payload: list[CategoryReorderItem]) -> list[CategoryRead]:
    slugs = [item.slug for item in payload]
    if not slugs:
        return []
    categories = await _load_categories_by_slug(session, slugs)
    updated = _collect_category_reorder_updates(payload, categories)
    if not updated:
        return []
    session.add_all(updated)
    await session.commit()
    return [CategoryRead.model_validate(cat) for cat in updated]


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
    product_data = payload.model_dump(exclude={"images", "variants", "tags", "badges", "options"})
    product_data["slug"] = candidate_slug
    product_data["sku"] = sku
    product_data["currency"] = payload.currency.upper()
    custom_count = await session.scalar(
        select(func.count(Product.id)).where(
            Product.is_deleted.is_(False),
            Product.category_id == payload.category_id,
            Product.sort_order != 0,
        )
    )
    if int(custom_count or 0) > 0:
        max_sort = await session.scalar(
            select(func.max(Product.sort_order)).where(
                Product.is_deleted.is_(False),
                Product.category_id == payload.category_id,
            )
        )
        product_data["sort_order"] = int(max_sort or 0) + 1
    else:
        product_data["sort_order"] = 0
    product = Product(**product_data)
    _sync_sale_fields(product)
    _set_publish_timestamp(product, payload.status)
    product.images = [ProductImage(**img.model_dump()) for img in images_payload]
    product.variants = [ProductVariant(**variant.model_dump()) for variant in variants_payload]
    if payload.tags:
        product.tags = await _get_or_create_tags(session, payload.tags)
    if payload.badges:
        product.badges = _build_product_badges([b.model_dump() for b in payload.badges])
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
    session: AsyncSession,
    product: Product,
    payload: ProductUpdate,
    commit: bool = True,
    user_id: uuid.UUID | None = None,
    source: str | None = None,
) -> Product:
    was_out_of_stock = is_out_of_stock(product)
    before_stock_quantity = int(getattr(product, "stock_quantity", 0) or 0)
    before_sale_type = getattr(product, "sale_type", None)
    before_sale_value = getattr(product, "sale_value", None)
    data = payload.model_dump(exclude_unset=True)
    if "slug" in data:
        if data["slug"] and data["slug"] != product.slug:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slug cannot be changed")
        data.pop("slug", None)
    patch_snapshot = dict(data)
    tracked_fields = (
        "name",
        "category_id",
        "sku",
        "base_price",
        "currency",
        "sale_type",
        "sale_value",
        "sale_start_at",
        "sale_end_at",
        "sale_auto_publish",
        "stock_quantity",
        "low_stock_threshold",
        "allow_backorder",
        "restock_at",
        "weight_grams",
        "width_cm",
        "height_cm",
        "depth_cm",
        "shipping_class",
        "shipping_allow_locker",
        "shipping_disallowed_couriers",
        "meta_title",
        "meta_description",
        "short_description",
        "long_description",
        "status",
        "publish_at",
        "is_active",
        "is_featured",
        "publish_scheduled_for",
        "unpublish_scheduled_for",
    )
    before_snapshot = {field: getattr(product, field, None) for field in tracked_fields}
    before_tags = [getattr(tag, "slug", None) for tag in getattr(product, "tags", []) or []]
    before_badges = [
        (
            getattr(badge, "badge", None),
            _tz_aware(getattr(badge, "start_at", None)),
            _tz_aware(getattr(badge, "end_at", None)),
        )
        for badge in getattr(product, "badges", []) or []
    ]
    before_options = [
        (getattr(opt, "option_name", None), getattr(opt, "option_value", None))
        for opt in getattr(product, "options", []) or []
    ]
    if "base_price" in data or "currency" in data:
        _validate_price_currency(data.get("base_price", product.base_price), data.get("currency", product.currency))
    if "sku" in data and data["sku"]:
        await _ensure_sku_unique(session, data["sku"], exclude_id=product.id)
    if "tags" in data:
        tags_payload = data.pop("tags")
        if tags_payload is None:
            product.tags = []
        else:
            product.tags = await _get_or_create_tags(session, tags_payload)
    if "badges" in data:
        badges_payload = data.pop("badges")
        if badges_payload is None:
            product.badges = []
        else:
            product.badges = _build_product_badges(badges_payload)
    if "options" in data:
        options_payload = data.pop("options")
        if options_payload is None:
            product.options = []
        else:
            product.options = [ProductOption(**opt) for opt in options_payload]
    if "publish_scheduled_for" in data:
        data["publish_scheduled_for"] = _tz_aware(data.get("publish_scheduled_for"))
    if "unpublish_scheduled_for" in data:
        data["unpublish_scheduled_for"] = _tz_aware(data.get("unpublish_scheduled_for"))
    for field, value in data.items():
        if field == "currency" and value:
            setattr(product, field, value.upper())
        else:
            setattr(product, field, value)
    publish_scheduled_for = _tz_aware(getattr(product, "publish_scheduled_for", None))
    unpublish_scheduled_for = _tz_aware(getattr(product, "unpublish_scheduled_for", None))
    if publish_scheduled_for and unpublish_scheduled_for and unpublish_scheduled_for <= publish_scheduled_for:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unpublish schedule must be after publish schedule",
        )
    if "stock_quantity" in data and int(getattr(product, "stock_quantity", 0) or 0) != before_stock_quantity:
        _queue_stock_adjustment(
            session,
            product_id=product.id,
            variant_id=None,
            before_quantity=before_stock_quantity,
            after_quantity=int(getattr(product, "stock_quantity", 0) or 0),
            reason=StockAdjustmentReason.manual_correction,
            note=None,
            user_id=user_id,
        )
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

    after_tags = [getattr(tag, "slug", None) for tag in getattr(product, "tags", []) or []]
    after_badges = [
        (
            getattr(badge, "badge", None),
            _tz_aware(getattr(badge, "start_at", None)),
            _tz_aware(getattr(badge, "end_at", None)),
        )
        for badge in getattr(product, "badges", []) or []
    ]
    after_options = [
        (getattr(opt, "option_name", None), getattr(opt, "option_value", None))
        for opt in getattr(product, "options", []) or []
    ]
    changes: dict[str, dict[str, object | None]] = {}
    for field in tracked_fields:
        before_value = before_snapshot.get(field)
        after_value = getattr(product, field, None)
        if before_value != after_value:
            changes[field] = {"before": before_value, "after": after_value}
    if before_tags != after_tags:
        changes["tags"] = {"before": before_tags, "after": after_tags}
    if before_badges != after_badges:
        changes["badges"] = {"before": before_badges, "after": after_badges}
    if before_options != after_options:
        changes["options"] = {"before": before_options, "after": after_options}

    session.add(product)
    if commit:
        await session.commit()
        await session.refresh(product)
        if was_out_of_stock and not is_now_out_of_stock:
            await fulfill_back_in_stock_requests(session, product=product)
        if changes:
            audit_payload: dict[str, object] = {"changes": changes, "patch": patch_snapshot}
            if source:
                audit_payload["source"] = source
            await _log_product_action(session, product.id, "update", user_id, audit_payload)
        await _maybe_alert_low_stock(session, product)
    else:
        await session.flush()
    return product


def _queue_stock_adjustment(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    variant_id: uuid.UUID | None,
    before_quantity: int,
    after_quantity: int,
    reason: StockAdjustmentReason,
    note: str | None,
    user_id: uuid.UUID | None,
) -> None:
    if before_quantity == after_quantity:
        return
    adjustment = StockAdjustment(
        product_id=product_id,
        variant_id=variant_id,
        actor_user_id=user_id,
        reason=reason,
        delta=int(after_quantity) - int(before_quantity),
        before_quantity=int(before_quantity),
        after_quantity=int(after_quantity),
        note=note,
    )
    session.add(adjustment)


async def update_product_variants(
    session: AsyncSession,
    *,
    product: Product,
    payload: ProductVariantMatrixUpdate,
    user_id: uuid.UUID | None = None,
) -> list[ProductVariant]:
    existing_by_id: dict[uuid.UUID, ProductVariant] = {v.id: v for v in product.variants}

    normalized_names: list[str] = []
    for variant_item in payload.variants:
        name = (variant_item.name or "").strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Variant name is required")
        normalized_names.append(name.casefold())
    if len(set(normalized_names)) != len(normalized_names):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Variant names must be unique")

    delete_ids = set(payload.delete_variant_ids or [])
    for variant_id in delete_ids:
        if any(v.id == variant_id for v in payload.variants if v.id is not None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete a variant that is also being updated"
            )

    updated_rows: list[ProductVariant] = []
    created_with_stock: list[ProductVariant] = []
    for item in payload.variants:
        name = (item.name or "").strip()
        if item.id is not None:
            existing_variant = existing_by_id.get(item.id)
            if not existing_variant:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")
            before_qty = int(existing_variant.stock_quantity)
            existing_variant.name = name
            existing_variant.additional_price_delta = item.additional_price_delta
            existing_variant.stock_quantity = item.stock_quantity
            if int(existing_variant.stock_quantity) != before_qty:
                _queue_stock_adjustment(
                    session,
                    product_id=product.id,
                    variant_id=existing_variant.id,
                    before_quantity=before_qty,
                    after_quantity=int(existing_variant.stock_quantity),
                    reason=StockAdjustmentReason.manual_correction,
                    note=None,
                    user_id=user_id,
                )
            session.add(existing_variant)
            updated_rows.append(existing_variant)
            continue

        created = ProductVariant(
            product_id=product.id,
            name=name,
            additional_price_delta=item.additional_price_delta,
            stock_quantity=item.stock_quantity,
        )
        session.add(created)
        if int(created.stock_quantity) != 0:
            created_with_stock.append(created)
        updated_rows.append(created)

    for variant_id in delete_ids:
        variant_model = existing_by_id.get(variant_id)
        if not variant_model:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

        in_cart = await session.scalar(select(CartItem.id).where(CartItem.variant_id == variant_id).limit(1))
        if in_cart is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Variant is used in a cart")
        in_order = await session.scalar(select(OrderItem.id).where(OrderItem.variant_id == variant_id).limit(1))
        if in_order is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Variant is used in an order")
        if int(getattr(variant_model, "stock_quantity", 0) or 0) != 0:
            _queue_stock_adjustment(
                session,
                product_id=product.id,
                variant_id=variant_model.id,
                before_quantity=int(getattr(variant_model, "stock_quantity", 0) or 0),
                after_quantity=0,
                reason=StockAdjustmentReason.manual_correction,
                note="Variant deleted",
                user_id=user_id,
            )
        await session.delete(variant_model)

    if created_with_stock:
        await session.flush()
        for created_variant in created_with_stock:
            _queue_stock_adjustment(
                session,
                product_id=product.id,
                variant_id=created_variant.id,
                before_quantity=0,
                after_quantity=int(created_variant.stock_quantity),
                reason=StockAdjustmentReason.manual_correction,
                note="Variant created",
                user_id=user_id,
            )

    await session.commit()
    await session.refresh(product, attribute_names=["variants"])
    await _log_product_action(
        session,
        product.id,
        "variants_update",
        user_id,
        {
            "upserted": [str(v.id) for v in updated_rows if getattr(v, "id", None) is not None],
            "deleted": [str(v) for v in delete_ids],
        },
    )
    return list(getattr(product, "variants", []) or [])


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
    image.is_deleted = True
    image.deleted_at = datetime.now(timezone.utc)
    image.deleted_by = user_id
    session.add(image)
    await session.commit()
    await _log_product_action(session, product.id, "image_deleted", user_id, {"image_id": image_id, "url": image.url})


async def list_deleted_product_images(session: AsyncSession, product_id: uuid.UUID) -> list[ProductImage]:
    result = await session.execute(
        select(ProductImage)
        .where(ProductImage.product_id == product_id, ProductImage.is_deleted.is_(True))
        .order_by(ProductImage.deleted_at.desc(), ProductImage.created_at.desc())
    )
    return list(result.scalars())


async def restore_product_image(session: AsyncSession, product: Product, image_id: str, user_id: uuid.UUID | None = None) -> None:
    try:
        image_uuid = uuid.UUID(str(image_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image id")
    image = (
        await session.execute(
            select(ProductImage).where(ProductImage.id == image_uuid, ProductImage.product_id == product.id)
        )
    ).scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if not getattr(image, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image is not deleted")
    image.is_deleted = False
    image.deleted_at = None
    image.deleted_by = None
    session.add(image)
    await session.commit()
    await _log_product_action(session, product.id, "image_restored", user_id, {"image_id": image_id, "url": image.url})


async def update_product_image_sort(
    session: AsyncSession,
    product: Product,
    image_id: str,
    sort_order: int,
    user_id: uuid.UUID | None = None,
    source: str | None = None,
) -> Product:
    image = next((img for img in product.images if str(img.id) == str(image_id)), None)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    image.sort_order = sort_order
    session.add(image)
    await session.commit()
    await session.refresh(product, attribute_names=["images"])
    await _log_product_action(
        session,
        product.id,
        "image_sort",
        user_id,
        {"source": source, "image_id": image_id, "sort_order": sort_order}
        if source
        else {"image_id": image_id, "sort_order": sort_order},
    )
    return product


async def soft_delete_product(session: AsyncSession, product: Product, user_id: uuid.UUID | None = None) -> None:
    original_slug = product.slug
    product.is_deleted = True
    product.deleted_at = datetime.now(timezone.utc)
    product.deleted_by = user_id
    product.deleted_slug = original_slug
    # Free the slug for reuse by moving deleted products to a stable tombstone slug.
    product.slug = f"deleted-{product.id}"
    session.add(product)
    await session.execute(delete(ProductSlugHistory).where(ProductSlugHistory.product_id == product.id))
    await session.commit()
    await _log_product_action(
        session, product.id, "soft_delete", user_id, {"slug": original_slug, "tombstone_slug": product.slug}
    )


async def restore_soft_deleted_product(
    session: AsyncSession, product: Product, user_id: uuid.UUID | None = None
) -> Product:
    if not getattr(product, "is_deleted", False):
        return product

    base_slug = (getattr(product, "deleted_slug", None) or "").strip() or (slugify(product.name or "") or "product")
    base_slug = base_slug[:160]
    candidate = base_slug
    counter = 2
    while True:
        try:
            await _ensure_slug_unique(session, candidate, exclude_id=product.id)
            break
        except HTTPException:
            suffix = f"-{counter}"
            candidate = f"{base_slug[: 160 - len(suffix)]}{suffix}"
            counter += 1

    product.is_deleted = False
    product.slug = candidate
    product.deleted_at = None
    product.deleted_by = None
    product.deleted_slug = None
    session.add(product)
    await session.execute(delete(ProductSlugHistory).where(ProductSlugHistory.product_id == product.id))
    await session.commit()
    await _log_product_action(session, product.id, "restore", user_id, {"slug": product.slug})
    return product


async def bulk_update_products(
    session: AsyncSession,
    updates: list[BulkProductUpdateItem],
    user_id: uuid.UUID | None = None,
    source: str | None = None,
) -> list[Product]:
    product_ids = [item.product_id for item in updates]
    category_ids = {
        item.category_id
        for item in updates
        if "category_id" in item.model_fields_set and item.category_id is not None  # type: ignore[attr-defined]
    }
    if category_ids:
        category_result = await session.execute(select(Category.id).where(Category.id.in_(category_ids)))
        found_categories = set(category_result.scalars())
        missing = category_ids - found_categories
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more categories not found")
    product_result = await session.execute(select(Product).where(Product.id.in_(product_ids)))
    products = {p.id: p for p in product_result.scalars()}
    category_sort_meta: dict[uuid.UUID, dict[str, int | bool]] = {}
    if category_ids:
        stats_rows = (
            await session.execute(
                select(
                    Product.category_id,
                    func.coalesce(func.max(Product.sort_order), 0),
                    func.count(Product.id).filter(Product.sort_order != 0),
                )
                .where(Product.is_deleted.is_(False), Product.category_id.in_(category_ids))
                .group_by(Product.category_id)
            )
        ).all()
        for cat_id, max_sort, custom_count in stats_rows:
            if not cat_id:
                continue
            category_sort_meta[cat_id] = {
                "max": int(max_sort or 0),
                "has_custom": int(custom_count or 0) > 0,
            }
        for cat_id in category_ids:
            category_sort_meta.setdefault(cat_id, {"max": 0, "has_custom": False})

    updated: list[Product] = []
    restocked: set[uuid.UUID] = set()
    for item in updates:
        product = products.get(item.product_id)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Product {item.product_id} not found")
        before_category_id = product.category_id
        was_out_of_stock = is_out_of_stock(product)
        before_stock_quantity = int(getattr(product, "stock_quantity", 0) or 0)
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
            "is_featured",
            "sort_order",
            "category_id",
            "publish_scheduled_for",
            "unpublish_scheduled_for",
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
            if field == "category_id":
                if data[field] is None:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="category_id cannot be null")
                setattr(product, field, data[field])
                continue
            if field in {"publish_scheduled_for", "unpublish_scheduled_for"}:
                setattr(product, field, _tz_aware(data[field]) if data[field] is not None else None)
                continue
            if field in {"sale_type", "sale_value", "sale_start_at", "sale_end_at"}:
                setattr(product, field, data[field] if data[field] is not None else None)
                continue
            if data[field] is not None:
                setattr(product, field, data[field])

        if "category_id" in data and product.category_id != before_category_id and "sort_order" not in data:
            meta = category_sort_meta.get(product.category_id)
            if meta and bool(meta.get("has_custom")):
                next_sort = int(meta.get("max") or 0) + 1
                product.sort_order = next_sort
                meta["max"] = next_sort
            else:
                product.sort_order = 0

        publish_scheduled_for = _tz_aware(getattr(product, "publish_scheduled_for", None))
        unpublish_scheduled_for = _tz_aware(getattr(product, "unpublish_scheduled_for", None))
        if publish_scheduled_for and unpublish_scheduled_for and unpublish_scheduled_for <= publish_scheduled_for:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unpublish schedule must be after publish schedule",
            )

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
        if "stock_quantity" in data and data.get("stock_quantity") is not None:
            after_stock_quantity = int(getattr(product, "stock_quantity", 0) or 0)
            if after_stock_quantity != before_stock_quantity:
                _queue_stock_adjustment(
                    session,
                    product_id=product.id,
                    variant_id=None,
                    before_quantity=before_stock_quantity,
                    after_quantity=after_stock_quantity,
                    reason=StockAdjustmentReason.manual_correction,
                    note=None,
                    user_id=user_id,
                )
        if was_out_of_stock and not is_out_of_stock(product):
            restocked.add(product.id)
        session.add(product)
        updated.append(product)
    await session.commit()
    for product in updated:
        await session.refresh(product)
        if product.id in restocked:
            await fulfill_back_in_stock_requests(session, product=product)
        payload = {
            "base_price": product.base_price,
            "sale_type": product.sale_type,
            "sale_value": product.sale_value,
            "sale_price": product.sale_price,
            "stock_quantity": product.stock_quantity,
            "is_featured": product.is_featured,
            "sort_order": getattr(product, "sort_order", 0),
            "category_id": str(product.category_id) if product.category_id else None,
            "publish_scheduled_for": getattr(product, "publish_scheduled_for", None),
            "unpublish_scheduled_for": getattr(product, "unpublish_scheduled_for", None),
            "status": str(product.status),
        }
        if source:
            payload["source"] = source
        await _log_product_action(session, product.id, "bulk_update", user_id, payload)
    return updated


async def list_stock_adjustments(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[StockAdjustment]:
    stmt = (
        select(StockAdjustment)
        .where(StockAdjustment.product_id == product_id)
        .order_by(StockAdjustment.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


async def apply_stock_adjustment(
    session: AsyncSession,
    *,
    payload: StockAdjustmentCreate,
    user_id: uuid.UUID | None = None,
) -> StockAdjustment:
    if payload.delta == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delta cannot be zero")

    product = await session.get(Product, payload.product_id)
    if not product or getattr(product, "is_deleted", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    note = (payload.note or "").strip() or None
    variant_id: uuid.UUID | None = None
    before_quantity = 0
    after_quantity = 0
    was_out_of_stock = False
    affected_variant: ProductVariant | None = None

    if payload.variant_id is not None:
        affected_variant = await session.get(ProductVariant, payload.variant_id)
        if not affected_variant or affected_variant.product_id != product.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid variant")
        variant_id = affected_variant.id
        before_quantity = int(getattr(affected_variant, "stock_quantity", 0) or 0)
        after_quantity = before_quantity + int(payload.delta)
        if after_quantity < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stock cannot be negative")
        affected_variant.stock_quantity = after_quantity
        session.add(affected_variant)
    else:
        was_out_of_stock = is_out_of_stock(product)
        before_quantity = int(getattr(product, "stock_quantity", 0) or 0)
        after_quantity = before_quantity + int(payload.delta)
        if after_quantity < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stock cannot be negative")
        product.stock_quantity = after_quantity
        session.add(product)

    adjustment = StockAdjustment(
        product_id=product.id,
        variant_id=variant_id,
        actor_user_id=user_id,
        reason=payload.reason,
        delta=int(payload.delta),
        before_quantity=before_quantity,
        after_quantity=after_quantity,
        note=note,
    )
    session.add(adjustment)
    await session.commit()
    await session.refresh(adjustment)

    if payload.variant_id is None:
        await session.refresh(product)
        if was_out_of_stock and not is_out_of_stock(product):
            await fulfill_back_in_stock_requests(session, product=product)
        await _maybe_alert_low_stock(session, product)

    await _log_product_action(
        session,
        product.id,
        "stock_adjustment",
        user_id,
        {
            "variant_id": str(variant_id) if variant_id else None,
            "reason": str(payload.reason),
            "delta": int(payload.delta),
            "before": before_quantity,
            "after": after_quantity,
            "note": note,
        },
    )
    return adjustment


async def get_featured_collection_by_slug(session: AsyncSession, slug: str) -> FeaturedCollection | None:
    result = await session.execute(
        select(FeaturedCollection).options(selectinload(FeaturedCollection.products)).where(FeaturedCollection.slug == slug)
    )
    return result.scalar_one_or_none()


async def list_featured_collections(session: AsyncSession, lang: str | None = None) -> list[FeaturedCollection]:
    products_loader = selectinload(
        FeaturedCollection.products.and_(
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
            Product.status == ProductStatus.published,
        )
    )
    if lang:
        products_loader = products_loader.options(
            selectinload(Product.translations),
            selectinload(Product.category).selectinload(Category.translations),
        )

    result = await session.execute(
        select(FeaturedCollection)
        .options(products_loader)
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


def _product_feed_options(lang: str | None) -> tuple:
    if lang:
        return (
            selectinload(Product.tags),
            selectinload(Product.translations),
            selectinload(Product.category).selectinload(Category.translations),
        )
    return (
        selectinload(Product.tags),
        selectinload(Product.category),
        selectinload(Product.category),
    )


def _effective_feed_price(product: Product) -> Decimal:
    if is_sale_active(product) and product.sale_price is not None:
        return product.sale_price
    return product.base_price


def _build_product_feed_item(product: Product, lang: str | None) -> ProductFeedItem:
    apply_product_translation(product, lang)
    return ProductFeedItem(
        slug=product.slug,
        name=product.name,
        price=float(_effective_feed_price(product)),
        currency=product.currency,
        description=product.short_description or product.long_description,
        category_slug=product.category.slug if product.category else None,
        tags=[tag.slug for tag in product.tags],
    )


async def get_product_feed(session: AsyncSession, lang: str | None = None) -> list[ProductFeedItem]:
    result = await session.execute(
        select(Product)
        .options(*_product_feed_options(lang))
        .where(
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
            Product.status == ProductStatus.published,
        )
        .order_by(Product.created_at.desc())
    )
    products = result.scalars().unique().all()
    return [_build_product_feed_item(product, lang) for product in products]


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


def _normalize_search_text(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw)
    without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return without_marks.lower()


def _normalized_search_expr(column):
    expr = func.lower(func.coalesce(column, ""))
    for source, target in _SEARCH_CHAR_MAP:
        expr = func.replace(expr, source, target)
    return expr


async def get_product_price_bounds(
    session: AsyncSession,
    category_slug: str | None,
    on_sale: bool | None,
    is_featured: bool | None,
    search: str | None,
    tags: list[str] | None,
    include_unpublished: bool = False,
) -> tuple[float, float, str | None]:
    now_dt = datetime.now(timezone.utc)
    sale_active = _sale_active_clause(now_dt)
    effective_price = case((sale_active, Product.sale_price), else_=Product.base_price)
    query = select(
        func.min(effective_price),
        func.max(effective_price),
        func.count(func.distinct(Product.currency)),
        func.min(Product.currency),
    ).where(Product.is_deleted.is_(False))
    if not include_unpublished:
        query = query.where(Product.is_active.is_(True), Product.status == ProductStatus.published)

    if category_slug:
        category_ids = await _get_category_and_descendant_ids_by_slug(session, category_slug)
        if category_ids and not include_unpublished:
            visible_ids = (
                await session.execute(
                    select(Category.id).where(Category.id.in_(category_ids), Category.is_visible.is_(True))
                )
            ).scalars().all()
            category_ids = list(visible_ids)
        if category_ids:
            query = query.where(Product.category_id.in_(category_ids))
        else:
            query = query.where(false())
    if on_sale is not None:
        query = query.where(sale_active if on_sale else ~sale_active)
    if is_featured is not None:
        query = query.where(Product.is_featured == is_featured)
    normalized_search = _normalize_search_text(search)
    if normalized_search:
        like = f"%{normalized_search}%"
        query = query.where(
            _normalized_search_expr(Product.name).like(like)
            | _normalized_search_expr(Product.short_description).like(like)
            | _normalized_search_expr(Product.long_description).like(like)
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
    include_unpublished: bool = False,
):
    now_dt = datetime.now(timezone.utc)
    sale_active = _sale_active_clause(now_dt)
    effective_price = case((sale_active, Product.sale_price), else_=Product.base_price)
    image_loader = selectinload(Product.images)
    if lang:
        image_loader = image_loader.selectinload(ProductImage.translations)
    options = [
        with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True),
        image_loader,
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
        .where(Product.is_deleted.is_(False))
    )
    if not include_unpublished:
        base_query = base_query.where(Product.is_active.is_(True), Product.status == ProductStatus.published)
    if category_slug:
        category_ids = await _get_category_and_descendant_ids_by_slug(session, category_slug)
        if category_ids and not include_unpublished:
            visible_ids = (
                await session.execute(
                    select(Category.id).where(Category.id.in_(category_ids), Category.is_visible.is_(True))
                )
            ).scalars().all()
            category_ids = list(visible_ids)
        if category_ids:
            base_query = base_query.where(Product.category_id.in_(category_ids))
        else:
            base_query = base_query.where(false())
    if on_sale is not None:
        base_query = base_query.where(sale_active if on_sale else ~sale_active)
    if is_featured is not None:
        base_query = base_query.where(Product.is_featured == is_featured)
    normalized_search = _normalize_search_text(search)
    if normalized_search:
        like = f"%{normalized_search}%"
        base_query = base_query.where(
            _normalized_search_expr(Product.name).like(like)
            | _normalized_search_expr(Product.short_description).like(like)
            | _normalized_search_expr(Product.long_description).like(like)
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

    if sort == "recommended":
        base_query = base_query.order_by(Product.sort_order.asc(), Product.created_at.desc())
    elif sort == "price_asc":
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


async def duplicate_product(
    session: AsyncSession,
    product: Product,
    user_id: uuid.UUID | None = None,
    source: str | None = None,
) -> Product:
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
    custom_count = await session.scalar(
        select(func.count(Product.id)).where(
            Product.is_deleted.is_(False),
            Product.category_id == product.category_id,
            Product.sort_order != 0,
        )
    )
    sort_order = 0
    if int(custom_count or 0) > 0:
        max_sort = await session.scalar(
            select(func.max(Product.sort_order)).where(
                Product.is_deleted.is_(False),
                Product.category_id == product.category_id,
            )
        )
        sort_order = int(max_sort or 0) + 1

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
        sort_order=sort_order,
        stock_quantity=product.stock_quantity,
        status=ProductStatus.draft,
        allow_backorder=product.allow_backorder,
        restock_at=product.restock_at,
        weight_grams=product.weight_grams,
        width_cm=product.width_cm,
        height_cm=product.height_cm,
        depth_cm=product.depth_cm,
        shipping_class=product.shipping_class,
        shipping_allow_locker=product.shipping_allow_locker,
        shipping_disallowed_couriers=list(getattr(product, "shipping_disallowed_couriers", []) or []),
        meta_title=product.meta_title,
        meta_description=product.meta_description,
    )
    clone.images = [
        ProductImage(
            url=img.url,
            alt_text=img.alt_text,
            caption=getattr(img, "caption", None),
            sort_order=img.sort_order,
        )
        for img in product.images
    ]
    clone.variants = [
        ProductVariant(name=variant.name, additional_price_delta=variant.additional_price_delta, stock_quantity=variant.stock_quantity)
        for variant in product.variants
    ]
    clone.options = [ProductOption(option_name=opt.option_name, option_value=opt.option_value) for opt in product.options]
    clone.tags = product.tags.copy()
    clone.badges = [ProductBadge(badge=badge.badge, start_at=badge.start_at, end_at=badge.end_at) for badge in product.badges]
    session.add(clone)
    await session.commit()
    await session.refresh(clone)
    payload = {"from_product_id": str(product.id), "from_slug": product.slug}
    if source:
        payload["source"] = source
    await _log_product_action(session, clone.id, "duplicate", user_id, payload)
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


def _dedupe_uuid_list(values: list[uuid.UUID]) -> list[uuid.UUID]:
    seen: set[uuid.UUID] = set()
    out: list[uuid.UUID] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


async def get_curated_relationship_products(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    relationship_type: ProductRelationshipType,
    limit: int,
    include_inactive: bool,
) -> list[Product]:
    stmt = (
        select(Product)
        .join(ProductRelationship, ProductRelationship.related_product_id == Product.id)
        .where(
            ProductRelationship.product_id == product_id,
            ProductRelationship.relationship_type == relationship_type,
            Product.id != product_id,
            Product.is_deleted.is_(False),
        )
        .order_by(ProductRelationship.sort_order.asc(), ProductRelationship.created_at.asc())
        .limit(limit)
        .options(
            selectinload(Product.images),
            selectinload(Product.category),
            selectinload(Product.tags),
        )
    )
    if not include_inactive:
        stmt = stmt.where(Product.is_active.is_(True), Product.status == ProductStatus.published)
    result = await session.execute(stmt)
    return list(result.scalars().unique().all())


async def get_product_relationships(session: AsyncSession, product_id: uuid.UUID) -> ProductRelationshipsUpdate:
    related = list(
        await session.scalars(
            select(ProductRelationship.related_product_id)
            .where(
                ProductRelationship.product_id == product_id,
                ProductRelationship.relationship_type == ProductRelationshipType.related,
            )
            .order_by(ProductRelationship.sort_order.asc(), ProductRelationship.created_at.asc())
        )
    )
    upsells = list(
        await session.scalars(
            select(ProductRelationship.related_product_id)
            .where(
                ProductRelationship.product_id == product_id,
                ProductRelationship.relationship_type == ProductRelationshipType.upsell,
            )
            .order_by(ProductRelationship.sort_order.asc(), ProductRelationship.created_at.asc())
        )
    )
    return ProductRelationshipsUpdate(
        related_product_ids=related,
        upsell_product_ids=upsells,
    )


async def update_product_relationships(
    session: AsyncSession,
    *,
    product: Product,
    payload: ProductRelationshipsUpdate,
    user_id: uuid.UUID | None = None,
) -> ProductRelationshipsUpdate:
    related_ids = _dedupe_uuid_list(list(payload.related_product_ids or []))
    upsell_ids = _dedupe_uuid_list(list(payload.upsell_product_ids or []))

    if product.id in related_ids or product.id in upsell_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product cannot reference itself")

    # Prevent overlap: if an id appears in related, drop it from upsells.
    related_set = set(related_ids)
    upsell_ids = [pid for pid in upsell_ids if pid not in related_set]

    candidate_ids = _dedupe_uuid_list([*related_ids, *upsell_ids])
    if candidate_ids:
        found = set(
            await session.scalars(
                select(Product.id).where(Product.id.in_(candidate_ids), Product.is_deleted.is_(False))
            )
        )
        missing = set(candidate_ids) - found
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more related products not found")

    await session.execute(delete(ProductRelationship).where(ProductRelationship.product_id == product.id))

    rows: list[ProductRelationship] = []
    for idx, pid in enumerate(related_ids):
        rows.append(
            ProductRelationship(
                product_id=product.id,
                related_product_id=pid,
                relationship_type=ProductRelationshipType.related,
                sort_order=idx,
            )
        )
    for idx, pid in enumerate(upsell_ids):
        rows.append(
            ProductRelationship(
                product_id=product.id,
                related_product_id=pid,
                relationship_type=ProductRelationshipType.upsell,
                sort_order=idx,
            )
        )
    if rows:
        session.add_all(rows)

    await session.commit()
    await _log_product_action(
        session,
        product.id,
        "relationships_update",
        user_id,
        {
            "related_product_ids": [str(pid) for pid in related_ids],
            "upsell_product_ids": [str(pid) for pid in upsell_ids],
        },
    )
    return ProductRelationshipsUpdate(related_product_ids=related_ids, upsell_product_ids=upsell_ids)


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
        .options(
            selectinload(RecentlyViewedProduct.product).selectinload(Product.images),
            with_loader_criteria(ProductImage, ProductImage.is_deleted.is_(False), include_aliases=True),
        )
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


async def export_categories_csv(session: AsyncSession, template: bool = False) -> str:
    buf = io.StringIO()
    fieldnames = [
        "slug",
        "name",
        "parent_slug",
        "sort_order",
        "is_visible",
        "description",
        "name_ro",
        "description_ro",
        "name_en",
        "description_en",
    ]
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    if template:
        return buf.getvalue()

    result = await session.execute(
        select(Category)
        .options(selectinload(Category.translations))
        .order_by(Category.sort_order.asc(), Category.slug.asc())
    )
    categories = result.scalars().unique().all()
    id_to_slug = {c.id: c.slug for c in categories}

    for c in categories:
        translations = {t.lang: t for t in (c.translations or [])}
        ro = translations.get("ro")
        en = translations.get("en")
        writer.writerow(
            {
                "slug": c.slug,
                "name": c.name,
                "parent_slug": id_to_slug.get(c.parent_id, "") if c.parent_id else "",
                "sort_order": c.sort_order,
                "is_visible": "true" if c.is_visible else "false",
                "description": c.description or "",
                "name_ro": ro.name if ro else "",
                "description_ro": ro.description or "" if ro and ro.description else "",
                "name_en": en.name if en else "",
                "description_en": en.description or "" if en and en.description else "",
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


async def import_categories_csv(session: AsyncSession, content: str, dry_run: bool = True):
    reader = csv.DictReader(io.StringIO(content))
    created = 0
    updated = 0
    errors: list[str] = []
    rows: list[dict] = []
    seen: set[str] = set()

    for idx, row in enumerate(reader, start=2):
        slug = (row.get("slug") or "").strip()
        name = (row.get("name") or "").strip()
        if not slug or not name:
            errors.append(f"Row {idx}: missing slug or name")
            continue
        if slug != slugify(slug):
            errors.append(f"Row {idx}: invalid slug {slug}")
            continue
        if slug in seen:
            errors.append(f"Row {idx}: duplicate slug {slug}")
            continue
        seen.add(slug)

        parent_slug = (row.get("parent_slug") or "").strip() or None
        if parent_slug and parent_slug == slug:
            errors.append(f"Row {idx}: parent_slug cannot match slug")
            continue

        sort_order_raw = str(row.get("sort_order") or "").strip()
        sort_order = 0
        if sort_order_raw:
            try:
                sort_order = int(sort_order_raw)
            except Exception:
                errors.append(f"Row {idx}: invalid sort_order {sort_order_raw}")
                continue

        is_visible_raw = str(row.get("is_visible") or "").strip()
        is_visible: bool | None = None
        if is_visible_raw:
            is_visible = is_visible_raw.lower() not in {"false", "0", "no"}

        description = (row.get("description") or "").strip() or None
        name_ro = (row.get("name_ro") or "").strip()
        name_en = (row.get("name_en") or "").strip()
        description_ro = (row.get("description_ro") or "").strip() or None
        description_en = (row.get("description_en") or "").strip() or None
        if description_ro and not name_ro:
            errors.append(f"Row {idx}: description_ro provided without name_ro")
            continue
        if description_en and not name_en:
            errors.append(f"Row {idx}: description_en provided without name_en")
            continue

        rows.append(
            {
                "idx": idx,
                "slug": slug,
                "name": name,
                "description": description,
                "parent_slug": parent_slug,
                "sort_order": sort_order,
                "is_visible": is_visible,
                "name_ro": name_ro,
                "name_en": name_en,
                "description_ro": description_ro,
                "description_en": description_en,
            }
        )

    file_slugs = {r["slug"] for r in rows}
    if file_slugs:
        existing_slug_result = await session.execute(select(Category.slug).where(Category.slug.in_(file_slugs)))
        existing_slugs = set(existing_slug_result.scalars().all())
        created = len(file_slugs - existing_slugs)
        updated = len(file_slugs & existing_slugs)
    else:
        existing_slugs = set()

    if rows:
        parent_candidates = {r["parent_slug"] for r in rows if r["parent_slug"] and r["parent_slug"] not in file_slugs}
        if parent_candidates:
            parent_slug_result = await session.execute(select(Category.slug).where(Category.slug.in_(parent_candidates)))
            found = set(parent_slug_result.scalars().all())
            missing = parent_candidates - found
            if missing:
                missing_set = set(missing)
                for row in rows:
                    parent_slug = row["parent_slug"]
                    if parent_slug and parent_slug in missing_set:
                        errors.append(f"Row {row['idx']}: parent category {parent_slug} not found")

    if dry_run and rows:
        hierarchy_result = await session.execute(select(Category.id, Category.slug, Category.parent_id))
        category_rows = hierarchy_result.all()
        id_to_slug = {cat_id: slug for cat_id, slug, _parent_id in category_rows}
        parent_slug_by_slug = {slug: id_to_slug.get(parent_id) if parent_id else None for _id, slug, parent_id in category_rows}
        proposed_parent_by_slug = {r["slug"]: r["parent_slug"] for r in rows}

        for row in rows:
            slug = row["slug"]
            current = row["parent_slug"]
            seen_slugs: set[str] = set()
            while current is not None:
                if current == slug:
                    errors.append(f"Row {row['idx']}: Category parent would create a cycle")
                    break
                if current in seen_slugs:
                    errors.append(f"Row {row['idx']}: Invalid category hierarchy")
                    break
                seen_slugs.add(current)
                if current in proposed_parent_by_slug:
                    current = proposed_parent_by_slug[current]
                else:
                    current = parent_slug_by_slug.get(current)

    if dry_run:
        return {"created": created, "updated": updated, "errors": errors}

    if errors:
        await session.rollback()
        return {"created": created, "updated": updated, "errors": errors}

    all_slugs = set(file_slugs)
    all_slugs.update(r["parent_slug"] for r in rows if r["parent_slug"])
    category_result = await session.execute(select(Category).where(Category.slug.in_(all_slugs)))
    by_slug: dict[str, Category] = {c.slug: c for c in category_result.scalars().all()}

    for row in rows:
        slug = row["slug"]
        category = by_slug.get(slug)
        if category:
            category.name = row["name"]
            category.description = row["description"]
            category.sort_order = row["sort_order"]
            if row["is_visible"] is not None:
                category.is_visible = row["is_visible"]
            session.add(category)
            continue

        category = Category(
            slug=slug,
            name=row["name"],
            description=row["description"],
            sort_order=row["sort_order"],
            is_visible=row["is_visible"] if row["is_visible"] is not None else True,
            parent_id=None,
        )
        session.add(category)
        by_slug[slug] = category

    await session.flush()

    for row in rows:
        slug = row["slug"]
        category = by_slug.get(slug)
        if not category:
            errors.append(f"Row {row['idx']}: category {slug} not found after upsert")
            continue

        parent_slug = row["parent_slug"]
        parent = by_slug.get(parent_slug) if parent_slug else None
        parent_id = parent.id if parent is not None else None
        try:
            await _validate_category_parent_assignment(session, category_id=category.id, parent_id=parent_id)
        except HTTPException as exc:
            errors.append(f"Row {row['idx']}: {exc.detail}")
            continue
        category.parent_id = parent_id
        session.add(category)

    if errors:
        await session.rollback()
        return {"created": created, "updated": updated, "errors": errors}

    for row in rows:
        category = by_slug.get(row["slug"])
        if not category:
            continue

        for lang in ("ro", "en"):
            name_key = f"name_{lang}"
            desc_key = f"description_{lang}"
            raw_name = (row.get(name_key) or "").strip()
            raw_desc = row.get(desc_key)
            if not raw_name:
                continue
            description_value = (raw_desc or "").strip() or None

            existing = await session.scalar(
                select(CategoryTranslation).where(
                    CategoryTranslation.category_id == category.id,
                    CategoryTranslation.lang == lang,
                )
            )
            if existing:
                existing.name = raw_name
                existing.description = description_value
                session.add(existing)
            else:
                session.add(
                    CategoryTranslation(
                        category_id=category.id,
                        lang=lang,
                        name=raw_name,
                        description=description_value,
                    )
                )

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
        except Exception as exc:
            # Notifications are best-effort; the request should still succeed.
            logger.debug(
                "back_in_stock_owner_notification_failed",
                extra={
                    "request_user_id": str(user_id),
                    "owner_user_id": str(owner.id),
                    "product_id": str(product.id),
                },
                exc_info=exc,
            )
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
