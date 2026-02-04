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


async def validate_structured_data(session: AsyncSession) -> dict[str, object]:
    base = settings.frontend_origin.rstrip("/")
    now = datetime.now(timezone.utc)
    issues: list[dict[str, str]] = []

    def add(entity_type: str, entity_key: str, severity: str, message: str) -> None:
        issues.append(
            {
                "entity_type": entity_type,
                "entity_key": entity_key,
                "severity": severity,
                "message": message,
            }
        )

    products = (
        await session.execute(
            select(Product)
            .options(selectinload(Product.images))
            .where(
                Product.status == ProductStatus.published,
                Product.is_deleted.is_(False),
                Product.is_active.is_(True),
            )
            .order_by(Product.slug)
        )
    ).scalars().all()
    for product in products:
        slug = (product.slug or "").strip()
        if not slug:
            add("product", "<missing>", "error", "Missing slug")
            continue
        if not (product.name or "").strip():
            add("product", slug, "error", "Missing name")
        if not _is_valid_currency(product.currency or ""):
            add("product", slug, "error", f"Invalid currency '{product.currency}' (expected ISO 4217)")
        price = _display_price(product.base_price, getattr(product, "sale_price", None))
        if price <= 0:
            add("product", slug, "warning", "Offer price is 0 (rich results may be affected)")
        if not (product.short_description or "").strip() and not (product.long_description or "").strip():
            add("product", slug, "warning", "Missing product description (short or long)")
        if not getattr(product, "images", []) or len(product.images) == 0:
            add("product", slug, "warning", "Missing product images (recommended for rich results)")
        else:
            for img in product.images:
                url = (getattr(img, "url", "") or "").strip()
                if url and not _is_absolute_url(url):
                    add("product", slug, "warning", "Image URL should be absolute (include https://)")
                    break

        canonical = f"{base}/products/{slug}"
        if not _is_absolute_url(canonical):
            add("product", slug, "error", "Invalid frontend origin; cannot build absolute product URLs")

    pages = (
        await session.execute(
            select(ContentBlock).where(
                ContentBlock.key.like("page.%"),
                ContentBlock.status == ContentStatus.published,
                or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
                or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
            )
        )
    ).scalars().all()
    for page in pages:
        key = (page.key or "").strip()
        slug = key.split(".", 1)[1] if key.startswith("page.") else ""
        if not slug:
            add("page", key or "<missing>", "error", "Invalid page key (expected page.<slug>)")
            continue
        meta = page.meta or {}
        if isinstance(meta, dict) and meta.get("hidden"):
            continue
        if not (page.title or "").strip():
            add("page", key, "error", "Missing page title")
        has_blocks = bool(meta.get("blocks")) if isinstance(meta, dict) else False
        if not has_blocks and not (page.body_markdown or "").strip():
            add("page", key, "warning", "Empty page content (no blocks and empty body)")
        url_path = "/about" if slug == "about" else "/contact" if slug == "contact" else f"/pages/{slug}"
        url = f"{base}{url_path}"
        if not _is_absolute_url(url):
            add("page", key, "error", "Invalid frontend origin; cannot build absolute page URLs")

    errors = sum(1 for i in issues if i.get("severity") == "error")
    warnings = sum(1 for i in issues if i.get("severity") == "warning")
    return {
        "checked_products": len(products),
        "checked_pages": len(pages),
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
    }
