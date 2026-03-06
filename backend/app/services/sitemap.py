from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.catalog import Category, Product, ProductStatus
from app.models.content import ContentBlock, ContentStatus


def _localized_url(base: str, path: str, lang: str) -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    if lang == "en":
        return f"{base}{normalized_path}"
    return f"{base}{normalized_path}?lang={lang}"


def _public_page_path(key: str, meta: object) -> str | None:
    if isinstance(meta, dict) and (meta.get("requires_auth") or meta.get("hidden")):
        return None
    slug = key.split(".", 1)[1] if key.startswith("page.") else key
    if not slug:
        return None
    if slug == "about":
        return "/about"
    if slug == "contact":
        return "/contact"
    return f"/pages/{slug}"


def _build_urls_for_language(
    *,
    base: str,
    lang: str,
    categories: list[str],
    products: list[str],
    blog_keys: list[str],
    page_rows: list[tuple[str, object]],
) -> list[str]:
    urls: set[str] = {_localized_url(base, "/", lang), _localized_url(base, "/shop", lang), _localized_url(base, "/blog", lang)}
    urls.update(_localized_url(base, f"/shop/{slug}", lang) for slug in categories)
    urls.update(_localized_url(base, f"/products/{slug}", lang) for slug in products)

    for key in blog_keys:
        slug = key.split(".", 1)[1] if key.startswith("blog.") else key
        urls.add(_localized_url(base, f"/blog/{slug}", lang))

    for key, meta in page_rows:
        path = _public_page_path(key, meta)
        if path:
            urls.add(_localized_url(base, path, lang))

    return sorted(urls)


async def _published_category_slugs(session: AsyncSession) -> list[str]:
    result = await session.execute(select(Category.slug).where(Category.is_visible.is_(True)))
    return list(result.scalars().all())


async def _published_product_slugs(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(Product.slug).where(
            Product.status == ProductStatus.published,
            Product.is_deleted.is_(False),
            Product.is_active.is_(True),
        )
    )
    return list(result.scalars().all())


async def _published_blog_keys(session: AsyncSession, now: datetime) -> list[str]:
    result = await session.execute(
        select(ContentBlock.key).where(
            ContentBlock.key.like("blog.%"),
            ContentBlock.status == ContentStatus.published,
            or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
            or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
        )
    )
    return list(result.scalars().all())


async def _published_page_rows(session: AsyncSession, now: datetime) -> list[tuple[str, object]]:
    result = await session.execute(
        select(ContentBlock.key, ContentBlock.meta).where(
            ContentBlock.key.like("page.%"),
            ContentBlock.status == ContentStatus.published,
            or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
            or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
        )
    )
    return [(str(key), meta) for key, meta in result.all()]


async def build_sitemap_urls(session: AsyncSession, *, langs: list[str] | None = None) -> dict[str, list[str]]:
    base = settings.frontend_origin.rstrip("/")
    now = datetime.now(timezone.utc)
    languages = langs or ["en", "ro"]

    categories = await _published_category_slugs(session)
    products = await _published_product_slugs(session)
    blog_keys = await _published_blog_keys(session, now)
    page_rows = await _published_page_rows(session, now)

    return {
        lang: _build_urls_for_language(
            base=base,
            lang=lang,
            categories=categories,
            products=products,
            blog_keys=blog_keys,
            page_rows=page_rows,
        )
        for lang in languages
    }
