import asyncio
import argparse
import json
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any, TypedDict

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.core.config import settings
from app.models.catalog import Category, Product, ProductImage, ProductStatus, ProductVariant
from app.models.content import ContentBlock, ContentBlockTranslation, ContentBlockVersion, ContentStatus

SEED_PROFILES_ROOT = (Path(__file__).resolve().parent / "seed_profiles").resolve()
PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
PROFILE_CONTENT_PATH_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
SEED_JSON_ALLOWLIST = frozenset({"catalog.json", "content_blocks.json"})
NO_AVAILABLE_PROFILES = "<none>"


class SeedImage(TypedDict):
    url: str
    alt_text: str
    sort_order: int


class SeedVariant(TypedDict):
    name: str
    additional_price_delta: Decimal
    stock_quantity: int


class SeedProduct(TypedDict):
    slug: str
    name: str
    category_slug: str
    short_description: str
    long_description: str
    base_price: Decimal
    currency: str
    stock_quantity: int
    is_featured: bool
    images: list[SeedImage]
    variants: list[SeedVariant]


class SeedTranslation(TypedDict):
    lang: str
    title: str
    body_markdown: str


class SeedContentBlock(TypedDict):
    key: str
    title: str
    body_markdown: str
    status: str
    meta: dict[str, Any] | None
    lang: str | None
    translations: list[SeedTranslation]


def _list_available_profiles() -> list[str]:
    return sorted(p.name for p in SEED_PROFILES_ROOT.iterdir() if p.is_dir())


def _available_profiles_display() -> str:
    return ", ".join(_list_available_profiles()) or NO_AVAILABLE_PROFILES


def _normalize_profile_rel_path(rel_path: str) -> str:
    raw = str(rel_path or "").strip().replace("\\", "/")
    while raw.startswith("./"):
        raw = raw[2:]
    if not raw:
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    candidate = PurePosixPath(raw)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    normalized = candidate.as_posix()
    if not PROFILE_CONTENT_PATH_PATTERN.fullmatch(normalized):
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    return normalized


def _safe_profile_path(base_dir: Path, rel_path: str, *, allowed_paths: set[str] | frozenset[str]) -> Path:
    normalized_rel_path = _normalize_profile_rel_path(rel_path)
    if normalized_rel_path not in allowed_paths:
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    resolved = (base_dir / normalized_rel_path).resolve()
    if base_dir != resolved and base_dir not in resolved.parents:
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    return resolved


def _resolve_profile_dir(profile: str) -> Path:
    if not PROFILE_NAME_PATTERN.fullmatch(profile or ""):
        available = _available_profiles_display()
        raise SystemExit(f"Unknown seed profile '{profile}'. Available: {available}")
    profile_dir = (SEED_PROFILES_ROOT / profile).resolve()
    if SEED_PROFILES_ROOT != profile_dir and SEED_PROFILES_ROOT not in profile_dir.parents:
        available = _available_profiles_display()
        raise SystemExit(f"Unknown seed profile '{profile}'. Available: {available}")
    if not profile_dir.is_dir():
        available = _available_profiles_display()
        raise SystemExit(f"Unknown seed profile '{profile}'. Available: {available}")
    return profile_dir


def _load_md(base_dir: Path, rel_path: str, *, allowed_markdown_paths: set[str]) -> str:
    text = (
        _safe_profile_path(base_dir, rel_path, allowed_paths=allowed_markdown_paths)
        .read_text(encoding="utf-8")
        .replace("\r\n", "\n")
        .strip()
    )
    return f"{text}\n"


def _load_profile(profile: str) -> tuple[list[dict[str, Any]], list[SeedProduct], list[SeedContentBlock]]:
    profile_dir = _resolve_profile_dir(profile)
    allowed_markdown_paths = {
        path.relative_to(profile_dir).as_posix() for path in profile_dir.rglob("*.md") if path.is_file()
    }

    catalog = json.loads(
        _safe_profile_path(profile_dir, "catalog.json", allowed_paths=SEED_JSON_ALLOWLIST).read_text(encoding="utf-8")
    )
    content = json.loads(
        _safe_profile_path(profile_dir, "content_blocks.json", allowed_paths=SEED_JSON_ALLOWLIST).read_text(
            encoding="utf-8"
        )
    )

    categories = list(catalog.get("categories", []))
    products: list[SeedProduct] = []
    for prod in catalog.get("products", []):
        parsed_product: SeedProduct = {
            "slug": str(prod["slug"]),
            "name": str(prod["name"]),
            "category_slug": str(prod["category_slug"]),
            "short_description": str(prod["short_description"]),
            "long_description": str(prod["long_description"]),
            "base_price": Decimal(str(prod["base_price"])),
            "currency": str(prod["currency"]),
            "stock_quantity": int(prod["stock_quantity"]),
            "is_featured": bool(prod["is_featured"]),
            "images": list(prod.get("images", [])),
            "variants": [
                {
                    "name": str(variant["name"]),
                    "additional_price_delta": Decimal(str(variant["additional_price_delta"])),
                    "stock_quantity": int(variant["stock_quantity"]),
                }
                for variant in prod.get("variants", [])
            ],
        }
        products.append(parsed_product)

    blocks: list[SeedContentBlock] = []
    for block in content.get("content_blocks", []):
        body_markdown = block.get("body_markdown")
        if body_markdown is None and block.get("body_markdown_file"):
            body_markdown = _load_md(
                profile_dir, block["body_markdown_file"], allowed_markdown_paths=allowed_markdown_paths
            )

        translations: list[SeedTranslation] = []
        for translation in block.get("translations", []):
            translation_body = translation.get("body_markdown")
            if translation_body is None and translation.get("body_markdown_file"):
                translation_body = _load_md(
                    profile_dir, translation["body_markdown_file"], allowed_markdown_paths=allowed_markdown_paths
                )
            translations.append(
                {
                    "lang": translation["lang"],
                    "title": translation["title"],
                    "body_markdown": translation_body or "",
                }
            )

        blocks.append(
            {
                "key": block["key"],
                "title": block["title"],
                "body_markdown": body_markdown or "",
                "status": block.get("status", "draft"),
                "meta": block.get("meta"),
                "lang": block.get("lang"),
                "translations": translations,
            }
        )

    return categories, products, blocks


async def seed(session: AsyncSession, *, profile: str = "default") -> None:
    categories, products, blocks = _load_profile(profile)

    # Categories
    for cat in categories:
        existing = await session.execute(select(Category).where(Category.slug == cat["slug"]))
        if existing.scalar_one_or_none():
            continue
        session.add(Category(**cat))
    await session.commit()

    # Products
    for prod in products:
        result = await session.execute(select(Product).where(Product.slug == prod["slug"]))
        if result.scalar_one_or_none():
            continue

        cat_result = await session.execute(select(Category).where(Category.slug == prod["category_slug"]))
        category = cat_result.scalar_one()

        product = Product(
            category_id=category.id,
            slug=prod["slug"],
            name=prod["name"],
            short_description=prod["short_description"],
            long_description=prod["long_description"],
            base_price=prod["base_price"],
            currency=prod["currency"],
            is_active=True,
            status=ProductStatus.published,
            publish_at=datetime.now(timezone.utc),
            is_featured=prod["is_featured"],
            stock_quantity=prod["stock_quantity"],
        )
        product.images = [ProductImage(**img) for img in prod["images"]]
        product.variants = [ProductVariant(**variant) for variant in prod["variants"]]
        session.add(product)

    await session.commit()

    # Content blocks
    for block in blocks:
        existing = await session.execute(select(ContentBlock).where(ContentBlock.key == block["key"]))
        if existing.scalar_one_or_none():
            continue

        status = ContentStatus(block["status"])
        published_at = datetime.now(timezone.utc) if status == ContentStatus.published else None
        content_block = ContentBlock(
            key=block["key"],
            title=block["title"],
            body_markdown=block["body_markdown"],
            status=status,
            version=1,
            meta=block["meta"],
            lang=block["lang"],
            published_at=published_at,
        )
        content_block.translations = [ContentBlockTranslation(**translation) for translation in block["translations"]]
        content_block.versions = [
            ContentBlockVersion(
                version=1,
                title=block["title"],
                body_markdown=block["body_markdown"],
                status=status,
                meta=block["meta"],
                lang=block["lang"],
                published_at=published_at,
                translations=list(block["translations"]),
            )
        ]
        session.add(content_block)

    await session.commit()


async def main(profile: str) -> None:
    engine = create_async_engine(settings.database_url, future=True, echo=False)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as session:
        await seed(session, profile=profile)
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed catalog/content bootstrap data")
    parser.add_argument("--profile", default="default", help="Seed profile (e.g. default, adrianaart)")
    args = parser.parse_args()
    asyncio.run(main(args.profile))
