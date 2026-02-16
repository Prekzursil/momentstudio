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


async def build_sitemap_urls(session: AsyncSession, *, langs: list[str] | None = None) -> dict[str, list[str]]:
    base = settings.frontend_origin.rstrip("/")
    now = datetime.now(timezone.utc)
    languages = langs or ["en", "ro"]

    categories = (await session.execute(select(Category.slug).where(Category.is_visible.is_(True)))).scalars().all()
    products = (
        await session.execute(
            select(Product.slug).where(
                Product.status == ProductStatus.published,
                Product.is_deleted.is_(False),
                Product.is_active.is_(True),
            )
        )
    ).scalars().all()
    blog_keys = (
        await session.execute(
            select(ContentBlock.key).where(
                ContentBlock.key.like("blog.%"),
                ContentBlock.status == ContentStatus.published,
                or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
                or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
            )
        )
    ).scalars().all()
    page_rows = (
        await session.execute(
            select(ContentBlock.key, ContentBlock.meta).where(
                ContentBlock.key.like("page.%"),
                ContentBlock.status == ContentStatus.published,
                or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
                or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
            )
        )
    ).all()

    by_lang: dict[str, list[str]] = {}
    for lang in languages:
        urls: set[str] = set()
        urls.add(_localized_url(base, "/", lang))
        urls.add(_localized_url(base, "/shop", lang))
        urls.add(_localized_url(base, "/blog", lang))

        for slug in categories:
            urls.add(_localized_url(base, f"/shop/{slug}", lang))
        for slug in products:
            urls.add(_localized_url(base, f"/products/{slug}", lang))

        for key in blog_keys:
            slug = key.split(".", 1)[1] if key.startswith("blog.") else key
            urls.add(_localized_url(base, f"/blog/{slug}", lang))

        for key, meta in page_rows:
            if isinstance(meta, dict) and meta.get("requires_auth"):
                continue
            if isinstance(meta, dict) and meta.get("hidden"):
                continue
            slug = key.split(".", 1)[1] if key.startswith("page.") else key
            if not slug:
                continue
            if slug == "about":
                path = "/about"
            elif slug == "contact":
                path = "/contact"
            else:
                path = f"/pages/{slug}"
            urls.add(_localized_url(base, path, lang))

        by_lang[lang] = sorted(urls)

    return by_lang
