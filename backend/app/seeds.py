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


def _profile_dirs() -> dict[str, Path]:
    return {
        path.name: path.resolve()
        for path in SEED_PROFILES_ROOT.iterdir()
        if path.is_dir() and PROFILE_NAME_PATTERN.fullmatch(path.name)
    }


def _build_profile_file_map(profile_dir: Path) -> dict[str, Path]:
    file_map: dict[str, Path] = {}
    for path in profile_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(profile_dir).as_posix()
        if PROFILE_CONTENT_PATH_PATTERN.fullmatch(rel):
            file_map[rel] = path.resolve()
    return file_map


def _resolve_profile_file(
    profile_files: dict[str, Path],
    rel_path: str,
    *,
    allowed_paths: set[str] | frozenset[str],
) -> Path:
    normalized_rel_path = _normalize_profile_rel_path(rel_path)
    if normalized_rel_path not in allowed_paths:
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    resolved = profile_files.get(normalized_rel_path)
    if resolved is None:
        raise SystemExit(f"Invalid path '{rel_path}' in seed profile.")
    return resolved


def _resolve_profile_dir(profile: str) -> Path:
    if not PROFILE_NAME_PATTERN.fullmatch(profile or ""):
        available = _available_profiles_display()
        raise SystemExit(f"Unknown seed profile '{profile}'. Available: {available}")
    profile_dir = _profile_dirs().get(profile)
    if profile_dir is None:
        available = _available_profiles_display()
        raise SystemExit(f"Unknown seed profile '{profile}'. Available: {available}")
    if not profile_dir.is_dir():
        available = _available_profiles_display()
        raise SystemExit(f"Unknown seed profile '{profile}'. Available: {available}")
    return profile_dir


def _load_md(profile_files: dict[str, Path], rel_path: str, *, allowed_markdown_paths: set[str]) -> str:
    text = (
        _resolve_profile_file(profile_files, rel_path, allowed_paths=allowed_markdown_paths)
        .read_text(encoding="utf-8")
        .replace("\r\n", "\n")
        .strip()
    )
    return f"{text}\n"


def _build_allowed_markdown_paths(profile_dir: Path) -> set[str]:
    return {
        path.relative_to(profile_dir).as_posix()
        for path in profile_dir.rglob("*.md")
        if path.is_file() and PROFILE_CONTENT_PATH_PATTERN.fullmatch(path.relative_to(profile_dir).as_posix())
    }


def _load_profile_json(profile_files: dict[str, Path], rel_path: str) -> dict[str, Any]:
    content = _resolve_profile_file(profile_files, rel_path, allowed_paths=SEED_JSON_ALLOWLIST).read_text(encoding="utf-8")
    return json.loads(content)


def _parse_seed_variant(variant: dict[str, Any]) -> SeedVariant:
    return {
        "name": str(variant["name"]),
        "additional_price_delta": Decimal(str(variant["additional_price_delta"])),
        "stock_quantity": int(variant["stock_quantity"]),
    }


def _parse_seed_product(prod: dict[str, Any]) -> SeedProduct:
    return {
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
        "variants": [_parse_seed_variant(variant) for variant in prod.get("variants", [])],
    }


def _resolve_markdown_body(
    payload: dict[str, Any],
    *,
    profile_files: dict[str, Path],
    allowed_markdown_paths: set[str],
) -> Any:
    body_markdown = payload.get("body_markdown")
    if body_markdown is None and payload.get("body_markdown_file"):
        body_markdown = _load_md(
            profile_files,
            payload["body_markdown_file"],
            allowed_markdown_paths=allowed_markdown_paths,
        )
    return body_markdown or ""


def _parse_seed_translation(
    translation: dict[str, Any],
    *,
    profile_files: dict[str, Path],
    allowed_markdown_paths: set[str],
) -> SeedTranslation:
    return {
        "lang": translation["lang"],
        "title": translation["title"],
        "body_markdown": _resolve_markdown_body(
            translation,
            profile_files=profile_files,
            allowed_markdown_paths=allowed_markdown_paths,
        ),
    }


def _parse_seed_block(
    block: dict[str, Any],
    *,
    profile_files: dict[str, Path],
    allowed_markdown_paths: set[str],
) -> SeedContentBlock:
    return {
        "key": block["key"],
        "title": block["title"],
        "body_markdown": _resolve_markdown_body(
            block,
            profile_files=profile_files,
            allowed_markdown_paths=allowed_markdown_paths,
        ),
        "status": block.get("status", "draft"),
        "meta": block.get("meta"),
        "lang": block.get("lang"),
        "translations": [
            _parse_seed_translation(
                translation,
                profile_files=profile_files,
                allowed_markdown_paths=allowed_markdown_paths,
            )
            for translation in block.get("translations", [])
        ],
    }


def _load_profile(profile: str) -> tuple[list[dict[str, Any]], list[SeedProduct], list[SeedContentBlock]]:
    profile_dir = _resolve_profile_dir(profile)
    profile_files = _build_profile_file_map(profile_dir)
    allowed_markdown_paths = _build_allowed_markdown_paths(profile_dir)
    catalog = _load_profile_json(profile_files, "catalog.json")
    content = _load_profile_json(profile_files, "content_blocks.json")
    categories = list(catalog.get("categories", []))
    products = [_parse_seed_product(prod) for prod in catalog.get("products", [])]
    blocks = [
        _parse_seed_block(
            block,
            profile_files=profile_files,
            allowed_markdown_paths=allowed_markdown_paths,
        )
        for block in content.get("content_blocks", [])
    ]
    return categories, products, blocks


def _build_product(prod: SeedProduct, *, category_id: Any) -> Product:
    product = Product(
        category_id=category_id,
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
    return product


async def _seed_categories(session: AsyncSession, categories: list[dict[str, Any]]) -> None:
    for cat in categories:
        existing = await session.execute(select(Category).where(Category.slug == cat["slug"]))
        if existing.scalar_one_or_none():
            continue
        session.add(Category(**cat))
    await session.commit()


async def _seed_products(session: AsyncSession, products: list[SeedProduct]) -> None:
    for prod in products:
        result = await session.execute(select(Product).where(Product.slug == prod["slug"]))
        if result.scalar_one_or_none():
            continue
        cat_result = await session.execute(select(Category).where(Category.slug == prod["category_slug"]))
        category = cat_result.scalar_one()
        session.add(_build_product(prod, category_id=category.id))
    await session.commit()


def _build_content_block(block: SeedContentBlock) -> ContentBlock:
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
    return content_block


async def _seed_content_blocks(session: AsyncSession, blocks: list[SeedContentBlock]) -> None:
    for block in blocks:
        existing = await session.execute(select(ContentBlock).where(ContentBlock.key == block["key"]))
        if existing.scalar_one_or_none():
            continue
        session.add(_build_content_block(block))
    await session.commit()


async def seed(session: AsyncSession, *, profile: str = "default") -> None:
    categories, products, blocks = _load_profile(profile)
    await _seed_categories(session, categories)
    await _seed_products(session, products)
    await _seed_content_blocks(session, blocks)


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
