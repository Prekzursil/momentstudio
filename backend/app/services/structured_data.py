from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.catalog import Product, ProductStatus
from app.models.content import ContentBlock, ContentStatus


def _is_valid_currency(value: str) -> bool:
    raw = (value or "").strip()
    return len(raw) == 3 and raw.isalpha() and raw.upper() == raw


def _is_absolute_url(url: str) -> bool:
    value = (url or "").strip().lower()
    return value.startswith("http://") or value.startswith("https://")


def _display_price(base_price: Decimal, sale_price: Decimal | None) -> Decimal:
    if sale_price is None:
        return base_price
    try:
        if sale_price < base_price:
            return sale_price
    except Exception:
        return base_price
    return base_price


def _add_issue(issues: list[dict[str, str]], *, entity_type: str, entity_key: str, severity: str, message: str) -> None:
    issues.append(
        {
            "entity_type": entity_type,
            "entity_key": entity_key,
            "severity": severity,
            "message": message,
        }
    )


async def _published_products(session: AsyncSession) -> list[Product]:
    result = await session.execute(
        select(Product)
        .options(selectinload(Product.images))
        .where(
            Product.status == ProductStatus.published,
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
        )
        .order_by(Product.slug)
    )
    return result.scalars().all()


def _product_slug_or_issue(product: Product, issues: list[dict[str, str]]) -> str | None:
    slug = (product.slug or "").strip()
    if slug:
        return slug
    _add_issue(issues, entity_type="product", entity_key="<missing>", severity="error", message="Missing slug")
    return None


def _validate_product_identity(product: Product, slug: str, issues: list[dict[str, str]]) -> None:
    if not (product.name or "").strip():
        _add_issue(issues, entity_type="product", entity_key=slug, severity="error", message="Missing name")
    if _is_valid_currency(product.currency or ""):
        return
    _add_issue(
        issues,
        entity_type="product",
        entity_key=slug,
        severity="error",
        message=f"Invalid currency '{product.currency}' (expected ISO 4217)",
    )


def _validate_product_commercials(product: Product, slug: str, issues: list[dict[str, str]]) -> None:
    if _display_price(product.base_price, getattr(product, "sale_price", None)) <= 0:
        _add_issue(issues, entity_type="product", entity_key=slug, severity="warning", message="Offer price is 0 (rich results may be affected)")
    if (product.short_description or "").strip() or (product.long_description or "").strip():
        return
    _add_issue(issues, entity_type="product", entity_key=slug, severity="warning", message="Missing product description (short or long)")


def _product_has_non_absolute_image(product: Product) -> bool:
    images = list(getattr(product, "images", []) or [])
    for img in images:
        url = (getattr(img, "url", "") or "").strip()
        if url and not _is_absolute_url(url):
            return True
    return False


def _validate_product_images(product: Product, slug: str, issues: list[dict[str, str]]) -> None:
    images = list(getattr(product, "images", []) or [])
    if not images:
        _add_issue(issues, entity_type="product", entity_key=slug, severity="warning", message="Missing product images (recommended for rich results)")
        return
    if _product_has_non_absolute_image(product):
        _add_issue(issues, entity_type="product", entity_key=slug, severity="warning", message="Image URL should be absolute (include https://)")


def _validate_product_canonical(base: str, slug: str, issues: list[dict[str, str]]) -> None:
    if _is_absolute_url(f"{base}/products/{slug}"):
        return
    _add_issue(issues, entity_type="product", entity_key=slug, severity="error", message="Invalid frontend origin; cannot build absolute product URLs")


def _validate_product_data(base: str, product: Product, issues: list[dict[str, str]]) -> None:
    slug = _product_slug_or_issue(product, issues)
    if not slug:
        return
    _validate_product_identity(product, slug, issues)
    _validate_product_commercials(product, slug, issues)
    _validate_product_images(product, slug, issues)
    _validate_product_canonical(base, slug, issues)


async def _published_pages(session: AsyncSession, now: datetime) -> list[ContentBlock]:
    result = await session.execute(
        select(ContentBlock).where(
            ContentBlock.key.like("page.%"),
            ContentBlock.status == ContentStatus.published,
            or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
            or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
        )
    )
    return result.scalars().all()


def _page_url_path(slug: str) -> str:
    if slug == "about":
        return "/about"
    if slug == "contact":
        return "/contact"
    return f"/pages/{slug}"


def _page_slug_or_issue(page: ContentBlock, issues: list[dict[str, str]]) -> tuple[str, str] | None:
    key = (page.key or "").strip()
    slug = key.split(".", 1)[1] if key.startswith("page.") else ""
    if slug:
        return key, slug
    _add_issue(issues, entity_type="page", entity_key=key or "<missing>", severity="error", message="Invalid page key (expected page.<slug>)")
    return None


def _is_hidden_page(page: ContentBlock) -> bool:
    meta = page.meta or {}
    return isinstance(meta, dict) and bool(meta.get("hidden"))


def _validate_page_content(page: ContentBlock, key: str, issues: list[dict[str, str]]) -> None:
    if not (page.title or "").strip():
        _add_issue(issues, entity_type="page", entity_key=key, severity="error", message="Missing page title")
    meta = page.meta or {}
    has_blocks = bool(meta.get("blocks")) if isinstance(meta, dict) else False
    if has_blocks or (page.body_markdown or "").strip():
        return
    _add_issue(issues, entity_type="page", entity_key=key, severity="warning", message="Empty page content (no blocks and empty body)")


def _validate_page_canonical(base: str, key: str, slug: str, issues: list[dict[str, str]]) -> None:
    if _is_absolute_url(f"{base}{_page_url_path(slug)}"):
        return
    _add_issue(issues, entity_type="page", entity_key=key, severity="error", message="Invalid frontend origin; cannot build absolute page URLs")


def _validate_page_data(base: str, page: ContentBlock, issues: list[dict[str, str]]) -> None:
    parsed = _page_slug_or_issue(page, issues)
    if not parsed:
        return
    key, slug = parsed
    if _is_hidden_page(page):
        return
    _validate_page_content(page, key, issues)
    _validate_page_canonical(base, key, slug, issues)


async def validate_structured_data(session: AsyncSession) -> dict[str, object]:
    base = settings.frontend_origin.rstrip("/")
    now = datetime.now(timezone.utc)
    issues: list[dict[str, str]] = []
    products = await _published_products(session)
    for product in products:
        _validate_product_data(base, product, issues)
    pages = await _published_pages(session, now)
    for page in pages:
        _validate_page_data(base, page, issues)

    errors = sum(1 for i in issues if i.get("severity") == "error")
    warnings = sum(1 for i in issues if i.get("severity") == "warning")
    return {
        "checked_products": len(products),
        "checked_pages": len(pages),
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
    }
