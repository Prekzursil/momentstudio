from datetime import datetime, timezone
from functools import partial
import uuid
from uuid import UUID
import re
import unicodedata
from urllib.parse import parse_qs, urlsplit
from pathlib import Path
from typing import Any, Callable

import anyio
from fastapi import HTTPException, status
from PIL import Image, ImageOps
from sqlalchemy import String, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.content import (
    ContentBlock,
    ContentBlockVersion,
    ContentBlockTranslation,
    ContentImage,
    ContentImageTag,
    ContentRedirect,
    ContentStatus,
)
from app.models.catalog import Category, Product, ProductStatus
from app.schemas.content import ContentImageEditRequest, ContentLinkCheckIssue, ContentTranslationStatusUpdate
from app.schemas.content import ContentBlockCreate, ContentBlockUpdate
from app.services import audit_chain as audit_chain_service
from app.services import storage


_RESERVED_PAGE_SLUGS = {
    "about",
    "account",
    "admin",
    "auth",
    "blog",
    "cart",
    "checkout",
    "contact",
    "error",
    "faq",
    "home",
    "login",
    "pages",
    "password-reset",
    "products",
    "receipt",
    "register",
    "shop",
    "shipping",
    "tickets",
}

_LOCKED_PAGE_SLUGS = {
    "about",
    "contact",
    "faq",
    "shipping",
}

_LEGAL_PAGE_KEYS = {
    "page.terms",
    "page.terms-and-conditions",
    "page.privacy-policy",
    "page.anpc",
}

_SUPPORTED_LANGS = {"en", "ro"}

_NON_TRANSLATABLE_META_KEYS = {"hidden", "last_updated", "requires_auth", "version"}

_MEDIA_RELATIVE_PREFIX = "media/"
_MEDIA_PATH_PREFIX = "/media/"
_PRODUCTS_PATH_PREFIX = "/products/"
_PAGES_PATH_PREFIX = "/pages/"
_BLOG_PATH_PREFIX = "/blog/"


def _normalized_lang(value: str | None) -> str:
    return (value or "").strip().lower()


def _has_localized_content(lang: str | None, title: str | None, body: str | None) -> bool:
    return _normalized_lang(lang) in _SUPPORTED_LANGS and bool((title or "").strip()) and bool((body or "").strip())


def _present_langs_for_bilingual(block: ContentBlock) -> set[str]:
    present: set[str] = set()

    base_lang = _normalized_lang(block.lang)
    if _has_localized_content(base_lang, block.title, block.body_markdown):
        present.add(base_lang)

    for tr in getattr(block, "translations", None) or []:
        lang = _normalized_lang(getattr(tr, "lang", None))
        title = (getattr(tr, "title", None) or "").strip()
        body = (getattr(tr, "body_markdown", None) or "").strip()
        if _has_localized_content(lang, title, body):
            present.add(lang)

    return present


def _enforce_legal_pages_bilingual(key: str, block: ContentBlock) -> None:
    if key not in _LEGAL_PAGE_KEYS:
        return
    if block.status != ContentStatus.published:
        return
    base_lang = (block.lang or "").strip().lower()
    if base_lang not in _SUPPORTED_LANGS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Legal pages must set a base language (en/ro) before publishing",
        )
    present = _present_langs_for_bilingual(block)
    missing = sorted(_SUPPORTED_LANGS - present)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Legal pages require both EN and RO content before publishing (missing: {', '.join(missing)})",
        )


def _clear_needs_translation(block: ContentBlock, lang: str) -> None:
    if lang == "en":
        block.needs_translation_en = False
    elif lang == "ro":
        block.needs_translation_ro = False


def _mark_other_needs_translation(block: ContentBlock, lang: str) -> None:
    if lang == "en":
        block.needs_translation_en = False
        block.needs_translation_ro = True
    elif lang == "ro":
        block.needs_translation_ro = False
        block.needs_translation_en = True


def _meta_changes_require_translation(old_meta: object | None, new_meta: object | None) -> bool:
    old_dict = old_meta if isinstance(old_meta, dict) else {}
    new_dict = new_meta if isinstance(new_meta, dict) else {}
    keys = set(old_dict.keys()) | set(new_dict.keys())
    changed = {k for k in keys if old_dict.get(k) != new_dict.get(k)}
    if not changed:
        return False
    return not changed.issubset(_NON_TRANSLATABLE_META_KEYS)


def slugify_page_slug(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw)
    without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    cleaned = re.sub(r"[^a-z0-9]+", "-", without_marks)
    cleaned = cleaned.strip("-")
    cleaned = re.sub(r"-+", "-", cleaned)
    return cleaned


def _validate_page_slug(value: str) -> str:
    slug = slugify_page_slug(value)
    if not slug:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid page slug")
    if slug in _RESERVED_PAGE_SLUGS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Page slug is reserved")
    return slug


def validate_page_key_for_create(key: str) -> None:
    value = (key or "").strip()
    if not value.startswith("page."):
        return
    slug = value.split(".", 1)[1]
    slug_norm = slugify_page_slug(slug)
    if not slug_norm or f"page.{slug_norm}" != value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid page slug")
    if slug_norm in _RESERVED_PAGE_SLUGS and slug_norm not in _LOCKED_PAGE_SLUGS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Page slug is reserved")


async def resolve_redirect_key(session: AsyncSession, key: str, *, max_hops: int = 10) -> str:
    current = (key or "").strip()
    if not current:
        return current
    seen: set[str] = set()
    for _ in range(max_hops):
        if current in seen:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid content redirect loop")
        seen.add(current)
        redirect = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == current))
        if not redirect:
            return current
        current = redirect.to_key
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid content redirect chain")


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if not dt:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _apply_content_translation(block: ContentBlock, lang: str | None) -> None:
    if not lang or not getattr(block, "translations", None):
        return
    if block.lang and lang == block.lang:
        return
    match = next((t for t in block.translations if t.lang == lang), None)
    if match:
        block.title = match.title
        block.body_markdown = match.body_markdown


def _snapshot_translations(block: ContentBlock) -> list[dict[str, object]]:
    items = getattr(block, "translations", None) or []
    return [{"lang": t.lang, "title": t.title, "body_markdown": t.body_markdown} for t in items]


def _build_content_version_row(
    block: ContentBlock,
    *,
    translations: list[dict[str, object]] | None = None,
) -> ContentBlockVersion:
    return ContentBlockVersion(
        content_block_id=block.id,
        version=block.version,
        title=block.title,
        body_markdown=block.body_markdown,
        status=block.status,
        meta=block.meta,
        lang=block.lang,
        published_at=block.published_at,
        published_until=block.published_until,
        translations=translations if translations is not None else _snapshot_translations(block),
    )


async def _add_block_version_and_audit(
    session: AsyncSession,
    *,
    block: ContentBlock,
    action: str,
    actor_id: UUID | None,
    translations: list[dict[str, object]] | None = None,
) -> None:
    session.add(_build_content_version_row(block, translations=translations))
    await audit_chain_service.add_content_audit_log(
        session,
        content_block_id=block.id,
        action=action,
        version=block.version,
        user_id=actor_id,
    )


def _validate_publish_window(published_at: datetime | None, published_until: datetime | None) -> None:
    if published_until and published_at and published_until <= published_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unpublish time must be after publish time",
        )


def _create_block_translation_flags(lang: str | None) -> tuple[bool, bool]:
    needs_translation_en = False
    needs_translation_ro = False
    if lang == "en":
        needs_translation_ro = True
    elif lang == "ro":
        needs_translation_en = True
    return needs_translation_en, needs_translation_ro


def _translation_payload_changed(data: dict[str, Any]) -> bool:
    return ("title" in data and data["title"] is not None) or ("body_markdown" in data and data["body_markdown"] is not None)


def _update_translation_title_from_payload(translation: ContentBlockTranslation, data: dict[str, Any]) -> None:
    if "title" not in data:
        return
    value = data.get("title")
    if value is not None:
        translation.title = value


def _update_translation_body_from_payload(translation: ContentBlockTranslation, data: dict[str, Any]) -> None:
    if "body_markdown" not in data:
        return
    value = data.get("body_markdown")
    if value is not None:
        translation.body_markdown = value


def _upsert_translation_row(
    block: ContentBlock,
    *,
    lang: str,
    data: dict[str, Any],
    session: AsyncSession,
) -> None:
    translation = next((t for t in block.translations if t.lang == lang), None)
    if translation:
        _update_translation_title_from_payload(translation, data)
        _update_translation_body_from_payload(translation, data)
        return

    translation = ContentBlockTranslation(
        content_block_id=block.id,
        lang=lang,
        title=data.get("title") or block.title,
        body_markdown=data.get("body_markdown") or block.body_markdown,
    )
    session.add(translation)
    block.translations.append(translation)


def _sanitize_body_markdown_if_present(data: dict[str, Any]) -> None:
    body = data.get("body_markdown")
    if body is not None:
        _sanitize_markdown(body)


def _ensure_expected_version(block: ContentBlock, expected_version: int | None) -> None:
    if expected_version is None:
        return
    if block.version == expected_version:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Content has changed (expected version {expected_version}, found {block.version})",
    )


def _is_translation_lang_update(block: ContentBlock, lang: str | None) -> bool:
    if not lang:
        return False
    if not block.lang:
        return False
    return lang != block.lang


def _assign_base_title(block: ContentBlock, data: dict[str, Any]) -> None:
    if "title" in data:
        block.title = data["title"] or block.title


def _assign_base_body(block: ContentBlock, data: dict[str, Any]) -> None:
    body = data.get("body_markdown")
    if body is not None:
        block.body_markdown = body


def _assign_base_meta(block: ContentBlock, data: dict[str, Any]) -> None:
    if "meta" in data:
        block.meta = data["meta"]


def _assign_base_optional_non_null(block: ContentBlock, data: dict[str, Any], field: str) -> None:
    value = data.get(field)
    if value is not None:
        setattr(block, field, value)


def _normalize_publish_window_for_status(block: ContentBlock) -> None:
    if block.status in (ContentStatus.draft, ContentStatus.review):
        block.published_at = None
        block.published_until = None
        return
    if block.status == ContentStatus.published:
        _validate_publish_window(block.published_at, block.published_until)


def _apply_published_at_on_publish(block: ContentBlock, *, data: dict[str, Any], published_at: datetime | None, now: datetime) -> None:
    if "published_at" in data:
        block.published_at = published_at or now
        return
    if block.published_at is None:
        block.published_at = now


def _apply_base_status_and_publish_fields(
    block: ContentBlock,
    data: dict[str, Any],
    *,
    published_at: datetime | None,
    now: datetime,
) -> None:
    status_value = data.get("status")
    if "status" not in data or status_value is None:
        if "published_at" in data:
            block.published_at = published_at
        return
    block.status = status_value
    if block.status == ContentStatus.published:
        _apply_published_at_on_publish(block, data=data, published_at=published_at, now=now)
        return
    if block.status in (ContentStatus.draft, ContentStatus.review):
        block.published_at = None
        block.published_until = None


def _apply_base_update_fields(
    block: ContentBlock,
    data: dict[str, Any],
    *,
    published_at: datetime | None,
    published_until: datetime | None,
    now: datetime,
) -> None:
    _assign_base_title(block, data)
    _assign_base_body(block, data)
    _apply_base_status_and_publish_fields(block, data, published_at=published_at, now=now)
    if "published_until" in data:
        block.published_until = published_until
    _assign_base_meta(block, data)
    _assign_base_optional_non_null(block, data, "sort_order")
    _assign_base_optional_non_null(block, data, "lang")
    _normalize_publish_window_for_status(block)


def _resolve_effective_lang(block: ContentBlock, fallback_lang: str | None) -> str | None:
    candidate = block.lang or fallback_lang
    return candidate if isinstance(candidate, str) else None


def _base_update_requires_translation(
    data: dict[str, Any],
    *,
    prev_meta: object | None,
    next_meta: object | None,
) -> bool:
    translation_sensitive_change = any(field in data for field in ("title", "body_markdown"))
    if not translation_sensitive_change and "meta" in data:
        translation_sensitive_change = _meta_changes_require_translation(prev_meta, next_meta)
    return translation_sensitive_change


async def get_published_by_key(session: AsyncSession, key: str, lang: str | None = None) -> ContentBlock | None:
    options = [
        selectinload(ContentBlock.images),
        selectinload(ContentBlock.audits),
    ]
    if lang:
        options.append(selectinload(ContentBlock.translations))
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(ContentBlock)
        .options(*options)
        .where(
            ContentBlock.key == key,
            ContentBlock.status == ContentStatus.published,
            or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
            or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
        )
    )
    block = result.scalar_one_or_none()
    if block:
        _apply_content_translation(block, lang)
    return block


async def get_published_by_key_following_redirects(
    session: AsyncSession,
    key: str,
    *,
    lang: str | None = None,
) -> ContentBlock | None:
    resolved = await resolve_redirect_key(session, key)
    return await get_published_by_key(session, resolved, lang=lang)


async def get_block_by_key(session: AsyncSession, key: str, lang: str | None = None) -> ContentBlock | None:
    options = [
        selectinload(ContentBlock.images),
        selectinload(ContentBlock.audits),
    ]
    if lang:
        options.append(selectinload(ContentBlock.translations))
    result = await session.execute(select(ContentBlock).options(*options).where(ContentBlock.key == key))
    block = result.scalar_one_or_none()
    if block:
        _apply_content_translation(block, lang)
    return block


async def _require_renamable_page_block(session: AsyncSession, old_slug: str) -> tuple[str, str, ContentBlock]:
    old_norm = slugify_page_slug(old_slug)
    if not old_norm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    old_key = f"page.{old_norm}"
    block = await session.scalar(select(ContentBlock).where(ContentBlock.key == old_key))
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    if old_norm in _LOCKED_PAGE_SLUGS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This page URL cannot be changed")
    return old_norm, old_key, block


async def _resolve_available_page_key(
    session: AsyncSession,
    *,
    old_norm: str,
    old_key: str,
    new_slug: str,
) -> tuple[str, str]:
    new_norm = _validate_page_slug(new_slug)
    if old_norm == new_norm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New page slug must be different")
    new_key = f"page.{new_norm}"
    existing = await session.scalar(select(ContentBlock.id).where(ContentBlock.key == new_key))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Page slug already exists")
    reserved_by_redirect = await session.scalar(select(ContentRedirect.id).where(ContentRedirect.from_key == new_key))
    if reserved_by_redirect:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Page slug is reserved by a redirect")
    resolved_target = await resolve_redirect_key(session, new_key)
    if resolved_target == old_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Page slug would create a redirect loop")
    return new_norm, new_key


async def rename_page_slug(
    session: AsyncSession,
    *,
    old_slug: str,
    new_slug: str,
    actor_id: UUID | None = None,
) -> tuple[str, str, str, str]:
    old_norm, old_key, block = await _require_renamable_page_block(session, old_slug)
    new_norm, new_key = await _resolve_available_page_key(
        session,
        old_norm=old_norm,
        old_key=old_key,
        new_slug=new_slug,
    )

    block.key = new_key
    session.add(block)

    await session.execute(update(ContentRedirect).where(ContentRedirect.to_key == old_key).values(to_key=new_key))
    redirect = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == old_key))
    if redirect:
        redirect.to_key = new_key
    else:
        session.add(ContentRedirect(from_key=old_key, to_key=new_key))

    if actor_id is not None:
        await audit_chain_service.add_content_audit_log(
            session,
            content_block_id=block.id,
            action=f"rename:{old_norm}->{new_norm}",
            version=block.version,
            user_id=actor_id,
        )

    await session.commit()
    return old_norm, new_norm, old_key, new_key


async def _create_block_from_upsert(
    session: AsyncSession,
    *,
    key: str,
    data: dict[str, Any],
    now: datetime,
    lang: str | None,
    published_at: datetime | None,
    published_until: datetime | None,
    actor_id: UUID | None,
) -> ContentBlock:
    validate_page_key_for_create(key)
    if data.get("status") == ContentStatus.published and key in _LEGAL_PAGE_KEYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Legal pages must be created as draft, translated (EN+RO), then published",
        )

    wants_published_at = None
    wants_published_until = None
    if data.get("status") == ContentStatus.published:
        wants_published_at = published_at or now
        wants_published_until = published_until
        _validate_publish_window(wants_published_at, wants_published_until)

    needs_translation_en, needs_translation_ro = _create_block_translation_flags(lang)
    block = ContentBlock(
        key=key,
        title=data.get("title") or "",
        body_markdown=data.get("body_markdown") or "",
        status=data.get("status") or ContentStatus.draft,
        version=1,
        published_at=wants_published_at,
        published_until=wants_published_until,
        meta=data.get("meta"),
        sort_order=data.get("sort_order", 0),
        lang=lang,
        needs_translation_en=needs_translation_en,
        needs_translation_ro=needs_translation_ro,
        author_id=actor_id,
    )
    session.add(block)
    await session.flush()
    await _add_block_version_and_audit(session, block=block, action="created", actor_id=actor_id, translations=[])
    await session.commit()
    await session.refresh(block)
    return block


async def _upsert_block_translation(
    session: AsyncSession,
    *,
    block: ContentBlock,
    key: str,
    lang: str,
    data: dict[str, Any],
    actor_id: UUID | None,
) -> ContentBlock:
    translation_changed = _translation_payload_changed(data)
    await session.refresh(block, attribute_names=["translations"])
    _upsert_translation_row(block, lang=lang, data=data, session=session)
    _enforce_legal_pages_bilingual(key, block)

    block.version += 1
    if translation_changed:
        _clear_needs_translation(block, lang)
    session.add(block)
    await _add_block_version_and_audit(session, block=block, action=f"translated:{lang}", actor_id=actor_id)
    await session.commit()
    await session.refresh(block)
    await session.refresh(block, attribute_names=["translations"])
    _apply_content_translation(block, lang)
    return block


async def _upsert_block_base(
    session: AsyncSession,
    *,
    block: ContentBlock,
    key: str,
    lang: str | None,
    data: dict[str, Any],
    now: datetime,
    published_at: datetime | None,
    published_until: datetime | None,
    actor_id: UUID | None,
) -> ContentBlock:
    prev_meta: object | None = block.meta
    block.version += 1
    _apply_base_update_fields(
        block,
        data,
        published_at=published_at,
        published_until=published_until,
        now=now,
    )

    effective_lang = _resolve_effective_lang(block, lang)
    if _base_update_requires_translation(data, prev_meta=prev_meta, next_meta=block.meta) and isinstance(effective_lang, str):
        _mark_other_needs_translation(block, effective_lang)

    await session.refresh(block, attribute_names=["translations"])
    _enforce_legal_pages_bilingual(key, block)
    session.add(block)
    await _add_block_version_and_audit(session, block=block, action="updated", actor_id=actor_id)
    await session.commit()
    await session.refresh(block)
    return block


async def upsert_block(
    session: AsyncSession, key: str, payload: ContentBlockUpdate | ContentBlockCreate, actor_id: UUID | None = None
) -> ContentBlock:
    block = await get_block_by_key(session, key)
    now = datetime.now(timezone.utc)
    data = payload.model_dump(exclude_unset=True)
    expected_version = data.pop("expected_version", None)
    _sanitize_body_markdown_if_present(data)
    raw_lang = data.get("lang")
    lang = raw_lang if isinstance(raw_lang, str) and raw_lang else None
    published_at = _ensure_utc(data.get("published_at"))
    published_until = _ensure_utc(data.get("published_until"))

    if not block:
        return await _create_block_from_upsert(
            session,
            key=key,
            data=data,
            now=now,
            lang=lang,
            published_at=published_at,
            published_until=published_until,
            actor_id=actor_id,
        )

    if not data:
        return block
    _ensure_expected_version(block, expected_version)
    if _is_translation_lang_update(block, lang):
        assert lang is not None
        return await _upsert_block_translation(
            session,
            block=block,
            key=key,
            lang=lang,
            data=data,
            actor_id=actor_id,
        )

    return await _upsert_block_base(
        session,
        block=block,
        key=key,
        lang=lang,
        data=data,
        now=now,
        published_at=published_at,
        published_until=published_until,
        actor_id=actor_id,
    )


async def add_image(session: AsyncSession, block: ContentBlock, file, actor_id: UUID | None = None) -> ContentBlock:
    path, filename = await anyio.to_thread.run_sync(
        partial(
            storage.save_upload,
            file,
            allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"),
            max_bytes=None,
            generate_thumbnails=True,
        )
    )
    next_sort = (max([img.sort_order for img in block.images], default=0) or 0) + 1
    image = ContentImage(content_block_id=block.id, url=path, alt_text=filename, sort_order=next_sort)
    session.add(image)
    await audit_chain_service.add_content_audit_log(
        session,
        content_block_id=block.id,
        action="image_upload",
        version=block.version,
        user_id=actor_id,
    )
    await session.commit()
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


def _resolve_editable_image_source(image: ContentImage) -> tuple[Path, str, str]:
    source_url = (getattr(image, "url", None) or "").strip()
    if not source_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image URL")
    try:
        source_path = storage.media_url_to_path(source_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")

    suffix = source_path.suffix.lower()
    format_map = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP", ".gif": "GIF"}
    out_format = format_map.get(suffix)
    if not out_format:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported image type")
    if out_format == "GIF":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GIF editing is not supported")
    return source_path, suffix, out_format


def _rotate_image_with_focal(
    img: Image.Image,
    *,
    payload: ContentImageEditRequest,
    base_w: int,
    base_h: int,
    fx: float,
    fy: float,
) -> tuple[Image.Image, float, float]:
    rotate_cw = int(getattr(payload, "rotate_cw", 0) or 0)
    if rotate_cw == 90:
        return img.transpose(Image.Transpose.ROTATE_270), base_h - fy, fx
    if rotate_cw == 180:
        return img.transpose(Image.Transpose.ROTATE_180), base_w - fx, base_h - fy
    if rotate_cw == 270:
        return img.transpose(Image.Transpose.ROTATE_90), fy, base_w - fx
    return img, fx, fy


def _crop_image_with_focal(
    img: Image.Image,
    *,
    payload: ContentImageEditRequest,
    fx: float,
    fy: float,
) -> tuple[Image.Image, float, float]:
    if payload.crop_aspect_w is None or payload.crop_aspect_h is None:
        return img, fx, fy
    width, height = img.size
    target_ratio = float(payload.crop_aspect_w) / float(payload.crop_aspect_h)
    current_ratio = float(width) / float(height) if height else 0.0
    if current_ratio > target_ratio:
        crop_h = float(height)
        crop_w = crop_h * target_ratio
    else:
        crop_w = float(width)
        crop_h = crop_w / target_ratio if target_ratio else float(height)

    left = fx - crop_w / 2
    top = fy - crop_h / 2
    left = max(0.0, min(left, float(width) - crop_w))
    top = max(0.0, min(top, float(height) - crop_h))
    right = left + crop_w
    bottom = top + crop_h
    crop_box = (int(round(left)), int(round(top)), int(round(right)), int(round(bottom)))
    crop_box = (
        max(0, min(crop_box[0], width - 1)),
        max(0, min(crop_box[1], height - 1)),
        max(1, min(crop_box[2], width)),
        max(1, min(crop_box[3], height)),
    )
    if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid crop")
    cropped = img.crop(crop_box)
    return cropped, fx - crop_box[0], fy - crop_box[1]


def _resize_image_with_focal(
    img: Image.Image,
    *,
    payload: ContentImageEditRequest,
    fx: float,
    fy: float,
) -> tuple[Image.Image, float, float]:
    if not payload.resize_max_width and not payload.resize_max_height:
        return img, fx, fy

    width, height = img.size
    scale = 1.0
    if payload.resize_max_width:
        scale = min(scale, float(payload.resize_max_width) / float(width))
    if payload.resize_max_height:
        scale = min(scale, float(payload.resize_max_height) / float(height))
    scale = min(scale, 1.0)
    if scale >= 1.0:
        return img, fx, fy

    new_w = max(1, int(round(float(width) * scale)))
    new_h = max(1, int(round(float(height) * scale)))
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return resized, fx * scale, fy * scale


def _focal_percent(fx: float, fy: float, width: int, height: int) -> tuple[int, int]:
    new_focal_x = int(round((fx / float(width)) * 100)) if width else 50
    new_focal_y = int(round((fy / float(height)) * 100)) if height else 50
    return max(0, min(100, new_focal_x)), max(0, min(100, new_focal_y))


def _save_edited_image(img: Image.Image, *, suffix: str, out_format: str) -> str:
    base_root = storage.ensure_media_root()
    edited_root = base_root / "edited"
    edited_root.mkdir(parents=True, exist_ok=True)
    new_filename = f"{uuid.uuid4().hex}{suffix or '.png'}"
    destination = edited_root / new_filename

    save_kwargs: dict[str, object] = {"optimize": True}
    image_to_save = img
    if out_format == "JPEG":
        if image_to_save.mode not in ("RGB", "L"):
            image_to_save = image_to_save.convert("RGB")
        save_kwargs.update({"quality": 90, "progressive": True})
    elif out_format == "WEBP":
        save_kwargs.update({"quality": 85})

    image_to_save.save(destination, format=out_format, **save_kwargs)
    storage.generate_thumbnails(destination)
    rel_path = destination.relative_to(base_root).as_posix()
    return f"{_MEDIA_PATH_PREFIX}{rel_path}"


def _process_image_edit_sync(
    source_path: Path,
    *,
    suffix: str,
    out_format: str,
    image: ContentImage,
    payload: ContentImageEditRequest,
) -> tuple[str, int, int]:
    with Image.open(source_path) as opened:
        img = ImageOps.exif_transpose(opened) or opened
        base_w, base_h = img.size
        focal_x = int(getattr(image, "focal_x", 50) or 50)
        focal_y = int(getattr(image, "focal_y", 50) or 50)
        fx = base_w * (focal_x / 100.0)
        fy = base_h * (focal_y / 100.0)

        img, fx, fy = _rotate_image_with_focal(img, payload=payload, base_w=base_w, base_h=base_h, fx=fx, fy=fy)
        img, fx, fy = _crop_image_with_focal(img, payload=payload, fx=fx, fy=fy)
        img, fx, fy = _resize_image_with_focal(img, payload=payload, fx=fx, fy=fy)
        width, height = img.size
        new_focal_x, new_focal_y = _focal_percent(fx, fy, width, height)
        new_url = _save_edited_image(img, suffix=suffix, out_format=out_format)
        return new_url, new_focal_x, new_focal_y


async def _get_image_block_or_404(session: AsyncSession, *, image: ContentImage) -> ContentBlock:
    block = await session.scalar(select(ContentBlock).where(ContentBlock.id == image.content_block_id))
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return block


async def _create_edited_image_row(
    session: AsyncSession,
    *,
    block: ContentBlock,
    image: ContentImage,
    new_url: str,
    new_focal_x: int,
    new_focal_y: int,
) -> ContentImage:
    next_sort = (
        await session.scalar(select(func.max(ContentImage.sort_order)).where(ContentImage.content_block_id == block.id))
    ) or 0
    root_image_id = getattr(image, "root_image_id", None) or image.id
    new_image = ContentImage(
        content_block_id=block.id,
        root_image_id=root_image_id,
        source_image_id=image.id,
        url=new_url,
        alt_text=image.alt_text,
        sort_order=int(next_sort) + 1,
        focal_x=new_focal_x,
        focal_y=new_focal_y,
    )
    session.add(new_image)
    await session.flush()
    return new_image


async def _copy_image_tags(
    session: AsyncSession,
    *,
    source_image_id: UUID,
    target_image_id: UUID,
) -> None:
    tag_rows = await session.execute(select(ContentImageTag.tag).where(ContentImageTag.content_image_id == source_image_id))
    tags = sorted(set(tag_rows.scalars().all()))
    for tag in tags:
        session.add(ContentImageTag(content_image_id=target_image_id, tag=tag))


async def edit_image_asset(
    session: AsyncSession,
    *,
    image: ContentImage,
    payload: ContentImageEditRequest,
    actor_id: UUID | None = None,
) -> ContentImage:
    source_path, suffix, out_format = _resolve_editable_image_source(image)
    new_url, new_focal_x, new_focal_y = await anyio.to_thread.run_sync(
        partial(
            _process_image_edit_sync,
            source_path,
            suffix=suffix,
            out_format=out_format,
            image=image,
            payload=payload,
        )
    )

    block = await _get_image_block_or_404(session, image=image)
    new_image = await _create_edited_image_row(
        session,
        block=block,
        image=image,
        new_url=new_url,
        new_focal_x=new_focal_x,
        new_focal_y=new_focal_y,
    )
    await _copy_image_tags(session, source_image_id=image.id, target_image_id=new_image.id)

    await audit_chain_service.add_content_audit_log(
        session,
        content_block_id=block.id,
        action="image_edit",
        version=block.version,
        user_id=actor_id,
    )
    await session.commit()
    return new_image


async def get_asset_usage_keys(session: AsyncSession, *, url: str) -> list[str]:
    needle = (url or "").strip()
    if not needle:
        return []

    like = f"%{needle}%"
    rows = await session.execute(
        select(ContentBlock.key)
        .distinct()
        .select_from(ContentBlock)
        .outerjoin(ContentBlockTranslation, ContentBlockTranslation.content_block_id == ContentBlock.id)
        .where(
            or_(
                ContentBlock.body_markdown.ilike(like),
                cast(ContentBlock.meta, String).ilike(like),
                ContentBlockTranslation.body_markdown.ilike(like),
            )
        )
    )
    return sorted({row[0] for row in rows.all() if row and row[0]})


def _require_image_id(image: ContentImage) -> UUID:
    image_id = getattr(image, "id", None)
    if not image_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return image_id


async def _assert_image_url_deletable(
    session: AsyncSession,
    *,
    url: str,
    exclude_ids: set[UUID] | None = None,
    exclude_id: UUID | None = None,
) -> None:
    if exclude_ids is not None:
        shared = await session.scalar(
            select(func.count()).select_from(ContentImage).where(ContentImage.url == url, ContentImage.id.notin_(exclude_ids))
        )
    else:
        shared = await session.scalar(
            select(func.count()).select_from(ContentImage).where(ContentImage.url == url, ContentImage.id != exclude_id)
        )
    if int(shared or 0) > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Image file is shared by other assets")
    if await get_asset_usage_keys(session, url=url):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Image is used")


async def _load_image_versions(session: AsyncSession, *, root_id: UUID) -> list[ContentImage]:
    return list(
        (
            await session.execute(select(ContentImage).where(or_(ContentImage.id == root_id, ContentImage.root_image_id == root_id)))
        )
        .scalars()
        .all()
    )


def _collect_referenced_source_ids(remaining: dict[UUID, ContentImage]) -> set[UUID]:
    referenced: set[UUID] = set()
    for img in remaining.values():
        source_id = getattr(img, "source_image_id", None)
        if source_id and source_id in remaining:
            referenced.add(source_id)
    return referenced


def _pick_leaf_images(remaining: dict[UUID, ContentImage], referenced: set[UUID]) -> list[ContentImage]:
    leaves = [img for img in remaining.values() if img.id not in referenced]
    return leaves if leaves else list(remaining.values())


async def _delete_image_leaves(session: AsyncSession, *, images: list[ContentImage]) -> None:
    remaining: dict[UUID, ContentImage] = {img.id: img for img in images if img.id}
    while remaining:
        referenced = _collect_referenced_source_ids(remaining)
        leaves = _pick_leaf_images(remaining, referenced)
        for leaf in leaves:
            await session.delete(leaf)
            remaining.pop(leaf.id, None)


async def _collect_image_delete_urls(
    session: AsyncSession,
    *,
    images: list[ContentImage],
    delete_ids: set[UUID],
) -> set[str]:
    urls: set[str] = set()
    for img in images:
        url = (getattr(img, "url", None) or "").strip()
        if not url:
            continue
        urls.add(url)
        await _assert_image_url_deletable(session, url=url, exclude_ids=delete_ids)
    return urls


async def _delete_image_versions(
    session: AsyncSession,
    *,
    image: ContentImage,
    actor_id: UUID | None,
) -> None:
    image_id = _require_image_id(image)
    root_id = getattr(image, "root_image_id", None) or image_id
    images = await _load_image_versions(session, root_id=root_id)
    if not images:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    delete_ids = {img.id for img in images if getattr(img, "id", None)}
    urls = await _collect_image_delete_urls(session, images=images, delete_ids=delete_ids)
    block = await _get_image_block_or_404(session, image=image)
    await _delete_image_leaves(session, images=images)
    await audit_chain_service.add_content_audit_log(
        session,
        content_block_id=block.id,
        action="image_delete_versions",
        version=block.version,
        user_id=actor_id,
    )
    await session.commit()
    for url in sorted(urls):
        storage.delete_file(url)


async def _ensure_image_has_no_children(session: AsyncSession, *, image_id: UUID) -> None:
    child_id = await session.scalar(
        select(ContentImage.id).where(or_(ContentImage.root_image_id == image_id, ContentImage.source_image_id == image_id)).limit(1)
    )
    if child_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Image has edited versions")


async def _delete_single_image(
    session: AsyncSession,
    *,
    image: ContentImage,
    actor_id: UUID | None,
) -> None:
    image_id = _require_image_id(image)
    await _ensure_image_has_no_children(session, image_id=image_id)
    url = (getattr(image, "url", None) or "").strip()
    if url:
        await _assert_image_url_deletable(session, url=url, exclude_id=image_id)

    block = await _get_image_block_or_404(session, image=image)
    await session.delete(image)
    await audit_chain_service.add_content_audit_log(
        session,
        content_block_id=block.id,
        action="image_delete",
        version=block.version,
        user_id=actor_id,
    )
    await session.commit()
    if url:
        storage.delete_file(url)


async def delete_image_asset(
    session: AsyncSession,
    *,
    image: ContentImage,
    actor_id: UUID | None = None,
    delete_versions: bool = False,
) -> None:
    if delete_versions:
        await _delete_image_versions(session, image=image, actor_id=actor_id)
        return

    await _delete_single_image(session, image=image, actor_id=actor_id)


async def set_translation_status(
    session: AsyncSession,
    *,
    key: str,
    payload: ContentTranslationStatusUpdate,
    actor_id: UUID | None = None,
) -> ContentBlock:
    block = await get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    changed = False
    if payload.needs_translation_en is not None:
        block.needs_translation_en = bool(payload.needs_translation_en)
        changed = True
    if payload.needs_translation_ro is not None:
        block.needs_translation_ro = bool(payload.needs_translation_ro)
        changed = True
    if not changed:
        return block

    session.add(block)
    if actor_id is not None:
        await audit_chain_service.add_content_audit_log(
            session,
            content_block_id=block.id,
            action="translation_status",
            version=block.version,
            user_id=actor_id,
        )
    await session.commit()
    await session.refresh(block)
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


def _apply_version_snapshot_to_block(
    block: ContentBlock,
    *,
    snapshot: ContentBlockVersion,
    now: datetime,
) -> None:
    block.version += 1
    block.title = snapshot.title
    block.body_markdown = snapshot.body_markdown
    block.status = snapshot.status
    if hasattr(snapshot, "meta"):
        block.meta = snapshot.meta
    if hasattr(snapshot, "lang"):
        block.lang = snapshot.lang
    if hasattr(snapshot, "published_at"):
        block.published_at = snapshot.published_at
    if hasattr(snapshot, "published_until"):
        block.published_until = snapshot.published_until
    if block.status in (ContentStatus.draft, ContentStatus.review):
        block.published_at = None
        block.published_until = None
    elif block.status == ContentStatus.published and block.published_at is None:
        block.published_at = now


def _parse_snapshot_translation_item(item: object) -> tuple[str, str, str] | None:
    if not isinstance(item, dict):
        return None
    lang = item.get("lang")
    title = item.get("title")
    body = item.get("body_markdown")
    if not isinstance(lang, str) or not lang:
        return None
    if not isinstance(title, str) or not isinstance(body, str):
        return None
    return lang, title, body


def _apply_snapshot_translation(
    session: AsyncSession,
    *,
    block_id: UUID,
    existing_by_lang: dict[str, ContentBlockTranslation],
    target_langs: set[str],
    parsed: tuple[str, str, str],
) -> None:
    lang, title, body = parsed
    target_langs.add(lang)
    tr = existing_by_lang.get(lang)
    if tr is None:
        session.add(ContentBlockTranslation(content_block_id=block_id, lang=lang, title=title, body_markdown=body))
        return
    tr.title = title
    tr.body_markdown = body


async def _sync_snapshot_translations(
    session: AsyncSession,
    *,
    block: ContentBlock,
    snapshot_translations: object | None,
) -> None:
    if snapshot_translations is None:
        return
    if not isinstance(snapshot_translations, list):
        return
    await session.refresh(block, attribute_names=["translations"])
    existing_by_lang = {t.lang: t for t in block.translations}
    target_langs: set[str] = set()
    for item in snapshot_translations:
        parsed = _parse_snapshot_translation_item(item)
        if not parsed:
            continue
        _apply_snapshot_translation(
            session,
            block_id=block.id,
            existing_by_lang=existing_by_lang,
            target_langs=target_langs,
            parsed=parsed,
        )
    for tr in list(block.translations):
        if tr.lang not in target_langs:
            await session.delete(tr)


async def _get_version_snapshot_or_404(
    session: AsyncSession,
    *,
    block_id: UUID,
    version: int,
) -> ContentBlockVersion:
    result = await session.execute(
        select(ContentBlockVersion).where(ContentBlockVersion.content_block_id == block_id, ContentBlockVersion.version == version)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return snapshot


async def rollback_to_version(
    session: AsyncSession,
    *,
    key: str,
    version: int,
    actor_id: UUID | None = None,
) -> ContentBlock:
    block = await get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    snapshot = await _get_version_snapshot_or_404(session, block_id=block.id, version=version)
    now = datetime.now(timezone.utc)
    _apply_version_snapshot_to_block(block, snapshot=snapshot, now=now)
    await _sync_snapshot_translations(session, block=block, snapshot_translations=getattr(snapshot, "translations", None))
    session.add(block)
    await session.refresh(block, attribute_names=["translations"])
    _enforce_legal_pages_bilingual(key, block)
    await _add_block_version_and_audit(session, block=block, action=f"rollback:{snapshot.version}", actor_id=actor_id)
    await session.commit()
    await session.refresh(block)
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


def _sanitize_markdown(body: str) -> None:
    lower = body.lower()
    forbidden = ["<script", "<iframe", "<object", "<embed", "javascript:"]
    if any(tok in lower for tok in forbidden):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed markup")
    if _contains_inline_event_handler(lower):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed event handlers")


def _is_event_handler_boundary_char(ch: str) -> bool:
    return ch.isalnum() or ch == "_" or ch == "-"


def _is_event_handler_name_char(ch: str) -> bool:
    return ("a" <= ch <= "z") or ("0" <= ch <= "9") or ch == "_"


def _has_event_handler_assignment(text: str, idx: int, *, text_len: int) -> bool:
    cursor = idx + 2
    if cursor >= text_len or not _is_event_handler_name_char(text[cursor]):
        return False
    while cursor < text_len and _is_event_handler_name_char(text[cursor]):
        cursor += 1
    while cursor < text_len and text[cursor].isspace():
        cursor += 1
    return cursor < text_len and text[cursor] == "="


def _contains_inline_event_handler(text: str) -> bool:
    if not text:
        return False

    text_len = len(text)
    start = 0
    while True:
        idx = text.find("on", start)
        if idx < 0:
            return False
        start = idx + 2
        if idx > 0 and _is_event_handler_boundary_char(text[idx - 1]):
            continue
        if _has_event_handler_assignment(text, idx, text_len=text_len):
            return True


def _find_replace_subn(text: str, find: str, replace: str, *, case_sensitive: bool) -> tuple[str, int]:
    if not find:
        return text, 0
    if case_sensitive:
        return text.replace(find, replace), text.count(find)
    pattern = re.compile(re.escape(find), flags=re.IGNORECASE)
    return pattern.subn(replace, text)


def _find_replace_in_json(value: Any, find: str, replace: str, *, case_sensitive: bool) -> tuple[Any, int]:
    if isinstance(value, str):
        return _find_replace_subn(value, find, replace, case_sensitive=case_sensitive)
    if isinstance(value, list):
        total = 0
        out_list: list[Any] = []
        for item in value:
            nxt, changed = _find_replace_in_json(item, find, replace, case_sensitive=case_sensitive)
            total += changed
            out_list.append(nxt)
        return out_list, total
    if isinstance(value, dict):
        total = 0
        out_dict: dict[Any, Any] = {}
        for k, v in value.items():
            nxt, changed = _find_replace_in_json(v, find, replace, case_sensitive=case_sensitive)
            total += changed
            out_dict[k] = nxt
        return out_dict, total
    return value, 0


def _build_preview_find_replace_query(
    *,
    find: str,
    key_prefix: str | None,
    case_sensitive: bool,
    limit: int,
) -> Any:
    needle = f"%{find}%"
    like = (lambda col: col.like(needle)) if case_sensitive else (lambda col: col.ilike(needle))
    query = (
        select(ContentBlock)
        .distinct()
        .select_from(ContentBlock)
        .outerjoin(ContentBlockTranslation, ContentBlockTranslation.content_block_id == ContentBlock.id)
        .options(selectinload(ContentBlock.translations))
        .where(
            or_(
                like(ContentBlock.title),
                like(ContentBlock.body_markdown),
                like(cast(ContentBlock.meta, String)),
                like(ContentBlockTranslation.title),
                like(ContentBlockTranslation.body_markdown),
            )
        )
        .order_by(ContentBlock.key)
        .limit(limit + 1)
    )
    if key_prefix:
        query = query.where(ContentBlock.key.like(f"{key_prefix}%"))
    return query


def _preview_base_match_count(block: ContentBlock, find: str, replace: str, *, case_sensitive: bool) -> int:
    base_matches = 0
    _, n = _find_replace_subn(block.title or "", find, replace, case_sensitive=case_sensitive)
    base_matches += n
    _, n = _find_replace_subn(block.body_markdown or "", find, replace, case_sensitive=case_sensitive)
    base_matches += n
    meta = getattr(block, "meta", None)
    if meta is not None:
        _, n = _find_replace_in_json(meta, find, replace, case_sensitive=case_sensitive)
        base_matches += n
    return base_matches


def _preview_translation_matches(
    block: ContentBlock, find: str, replace: str, *, case_sensitive: bool
) -> tuple[list[dict[str, object]], int]:
    translations_out: list[dict[str, object]] = []
    total = 0
    for tr in getattr(block, "translations", None) or []:
        tr_matches = 0
        _, n = _find_replace_subn(tr.title or "", find, replace, case_sensitive=case_sensitive)
        tr_matches += n
        _, n = _find_replace_subn(tr.body_markdown or "", find, replace, case_sensitive=case_sensitive)
        tr_matches += n
        if tr_matches:
            translations_out.append({"lang": tr.lang, "matches": tr_matches})
            total += tr_matches
    return translations_out, total


def _build_preview_find_replace_item(
    block: ContentBlock,
    *,
    find: str,
    replace: str,
    case_sensitive: bool,
) -> tuple[dict[str, object] | None, int]:
    base_matches = _preview_base_match_count(block, find, replace, case_sensitive=case_sensitive)
    translations_out, tr_total = _preview_translation_matches(block, find, replace, case_sensitive=case_sensitive)
    matches = base_matches + tr_total
    if matches <= 0:
        return None, 0
    item = {
        "key": block.key,
        "title": block.title,
        "matches": matches,
        "base_matches": base_matches,
        "translations": sorted(translations_out, key=lambda it: str(it.get("lang") or "")),
    }
    return item, matches


async def preview_find_replace(
    session: AsyncSession,
    *,
    find: str,
    replace: str,
    key_prefix: str | None = None,
    case_sensitive: bool = True,
    limit: int = 200,
) -> tuple[list[dict[str, object]], int, int, bool]:
    query = _build_preview_find_replace_query(
        find=find,
        key_prefix=key_prefix,
        case_sensitive=case_sensitive,
        limit=limit,
    )
    rows = (await session.execute(query)).scalars().all()
    truncated = len(rows) > limit
    blocks = rows[:limit]

    items: list[dict[str, object]] = []
    total_items = 0
    total_matches = 0

    for block in blocks:
        item, matches = _build_preview_find_replace_item(
            block,
            find=find,
            replace=replace,
            case_sensitive=case_sensitive,
        )
        if item is None:
            continue
        total_items += 1
        total_matches += matches
        items.append(item)

    return items, total_items, total_matches, truncated


def _build_apply_find_replace_query(
    *,
    find: str,
    key_prefix: str | None,
    case_sensitive: bool,
) -> Any:
    needle = f"%{find}%"
    like = (lambda col: col.like(needle)) if case_sensitive else (lambda col: col.ilike(needle))
    query = (
        select(ContentBlock)
        .distinct()
        .select_from(ContentBlock)
        .outerjoin(ContentBlockTranslation, ContentBlockTranslation.content_block_id == ContentBlock.id)
        .options(selectinload(ContentBlock.translations))
        .where(
            or_(
                like(ContentBlock.title),
                like(ContentBlock.body_markdown),
                like(cast(ContentBlock.meta, String)),
                like(ContentBlockTranslation.title),
                like(ContentBlockTranslation.body_markdown),
            )
        )
        .order_by(ContentBlock.key)
    )
    if key_prefix:
        query = query.where(ContentBlock.key.like(f"{key_prefix}%"))
    return query


def _plan_base_find_replace_update(
    block: ContentBlock,
    *,
    find: str,
    replace: str,
    case_sensitive: bool,
) -> tuple[bool, int, str, str, Any]:
    base_changed = False
    base_matches = 0
    next_title, n = _find_replace_subn(block.title or "", find, replace, case_sensitive=case_sensitive)
    if n:
        base_matches += n
        base_changed = True

    next_body, n = _find_replace_subn(block.body_markdown or "", find, replace, case_sensitive=case_sensitive)
    if n:
        base_matches += n
        base_changed = True

    next_meta = getattr(block, "meta", None)
    if next_meta is not None:
        replaced_meta, n = _find_replace_in_json(next_meta, find, replace, case_sensitive=case_sensitive)
        if n:
            next_meta = replaced_meta
            base_matches += n
            base_changed = True
    return base_changed, base_matches, next_title, next_body, next_meta


def _plan_translation_find_replace_updates(
    block: ContentBlock,
    *,
    find: str,
    replace: str,
    case_sensitive: bool,
) -> tuple[set[str], int, int, list[tuple[ContentBlockTranslation, str, str]]]:
    translations_changed_langs: set[str] = set()
    translation_rows_changed = 0
    translation_matches_total = 0
    translation_updates: list[tuple[ContentBlockTranslation, str, str]] = []
    for tr in getattr(block, "translations", None) or []:
        tr_changed = False
        tr_matches = 0
        next_tr_title, n = _find_replace_subn(tr.title or "", find, replace, case_sensitive=case_sensitive)
        if n:
            tr_matches += n
            tr_changed = True

        next_tr_body, n = _find_replace_subn(tr.body_markdown or "", find, replace, case_sensitive=case_sensitive)
        if n:
            tr_matches += n
            tr_changed = True
        if not tr_changed:
            continue

        translations_changed_langs.add(tr.lang)
        translation_rows_changed += 1
        translation_matches_total += tr_matches
        translation_updates.append((tr, next_tr_title, next_tr_body))
    return translations_changed_langs, translation_rows_changed, translation_matches_total, translation_updates


def _apply_translation_replacements(translation_updates: list[tuple[ContentBlockTranslation, str, str]]) -> None:
    for tr, next_tr_title, next_tr_body in translation_updates:
        if next_tr_body != tr.body_markdown:
            _sanitize_markdown(next_tr_body)
        tr.title = next_tr_title
        tr.body_markdown = next_tr_body


def _apply_base_replacement(
    block: ContentBlock,
    *,
    base_changed: bool,
    next_title: str,
    next_body: str,
    next_meta: Any,
) -> None:
    if not base_changed:
        return
    if next_body != block.body_markdown:
        _sanitize_markdown(next_body)
    block.title = next_title
    block.body_markdown = next_body
    block.meta = next_meta


def _update_translation_flags_after_find_replace(
    block: ContentBlock,
    *,
    base_changed: bool,
    translations_changed_langs: set[str],
) -> None:
    base_lang = (block.lang or "").strip().lower()
    if base_changed and base_lang in _SUPPORTED_LANGS:
        _mark_other_needs_translation(block, base_lang)
    for lang in translations_changed_langs:
        lang_norm = (lang or "").strip().lower()
        if lang_norm in _SUPPORTED_LANGS:
            _clear_needs_translation(block, lang_norm)


async def _apply_find_replace_to_block(
    session: AsyncSession,
    *,
    block: ContentBlock,
    find: str,
    replace: str,
    case_sensitive: bool,
    actor_id: UUID | None,
) -> tuple[bool, int, int]:
    base_changed, base_matches, next_title, next_body, next_meta = _plan_base_find_replace_update(
        block, find=find, replace=replace, case_sensitive=case_sensitive
    )
    translations_changed_langs, translation_rows_changed, translation_matches_total, translation_updates = (
        _plan_translation_find_replace_updates(block, find=find, replace=replace, case_sensitive=case_sensitive)
    )
    matches = base_matches + translation_matches_total
    if matches <= 0:
        return False, 0, 0

    async with session.begin_nested():
        _apply_translation_replacements(translation_updates)
        _apply_base_replacement(
            block,
            base_changed=base_changed,
            next_title=next_title,
            next_body=next_body,
            next_meta=next_meta,
        )
        _update_translation_flags_after_find_replace(
            block,
            base_changed=base_changed,
            translations_changed_langs=translations_changed_langs,
        )
        _enforce_legal_pages_bilingual(block.key, block)

        block.version += 1
        session.add(block)
        await _add_block_version_and_audit(session, block=block, action="find_replace", actor_id=actor_id)
    return True, translation_rows_changed, matches


async def apply_find_replace(
    session: AsyncSession,
    *,
    find: str,
    replace: str,
    key_prefix: str | None = None,
    case_sensitive: bool = True,
    actor_id: UUID | None = None,
) -> tuple[int, int, int, list[dict[str, str]]]:
    query = _build_apply_find_replace_query(find=find, key_prefix=key_prefix, case_sensitive=case_sensitive)
    blocks = (await session.execute(query)).scalars().all()
    updated_blocks = 0
    updated_translations = 0
    total_replacements = 0
    errors: list[dict[str, str]] = []
    for block in blocks:
        try:
            changed, translation_rows_changed, matches = await _apply_find_replace_to_block(
                session,
                block=block,
                find=find,
                replace=replace,
                case_sensitive=case_sensitive,
                actor_id=actor_id,
            )
            if not changed:
                continue
            updated_blocks += 1
            updated_translations += translation_rows_changed
            total_replacements += matches
        except HTTPException as exc:
            errors.append({"key": block.key, "error": str(getattr(exc, "detail", None) or "Update failed")})
            await session.refresh(block, attribute_names=["translations"])

    await session.commit()
    return updated_blocks, updated_translations, total_replacements, errors


def _normalize_md_url(raw: str) -> str:
    value = (raw or "").strip().strip("<>").strip()
    if not value:
        return ""
    if value.startswith(("mailto:", "tel:", "#")):
        return ""
    return value.split(maxsplit=1)[0].strip()


def _extract_markdown_refs(body: str) -> list[tuple[str, str, str, str]]:
    refs: list[tuple[str, str, str, str]] = []
    for url in _extract_markdown_target_urls(body, image_only=True):
        refs.append(("image", "markdown", "body_markdown", url))
    for url in _extract_markdown_target_urls(body, image_only=False):
        refs.append(("link", "markdown", "body_markdown", url))
    return refs


def _iter_meta_blocks(meta: dict | None) -> list[tuple[int, dict[str, Any]]]:
    if not isinstance(meta, dict):
        return []
    blocks = meta.get("blocks")
    if not isinstance(blocks, list):
        return []
    return [(idx, block) for idx, block in enumerate(blocks) if isinstance(block, dict)]


def _refs_from_text_block(block: dict[str, Any], *, prefix: str) -> list[tuple[str, str, str, str]]:
    body = block.get("body_markdown")
    if not isinstance(body, str):
        return []
    return [(k, s, f"{prefix}.body_markdown", u) for k, s, _, u in _extract_markdown_refs(body)]


def _refs_from_asset_block(
    block_type: str,
    block: dict[str, Any],
    *,
    prefix: str,
) -> list[tuple[str, str, str, str]]:
    extractor = _BLOCK_URL_EXTRACTORS.get(block_type)
    if not extractor:
        return []
    refs: list[tuple[str, str, str, str]] = []
    for kind, raw in extractor(block):
        url = _normalize_md_url(raw)
        if url:
            refs.append((kind, "block", prefix, url))
    return refs


def _is_markdown_target_match_start(text: str, *, index: int, image_only: bool) -> bool:
    is_image = index > 0 and text[index - 1] == "!"
    return is_image if image_only else not is_image


def _scan_to_char(text: str, *, start: int, stop_char: str, text_len: int) -> int:
    cursor = start
    while cursor < text_len and text[cursor] != stop_char:
        cursor += 1
    return cursor


def _skip_inline_whitespace(text: str, *, start: int, text_len: int) -> int:
    cursor = start
    while cursor < text_len and text[cursor].isspace():
        cursor += 1
    return cursor


def _next_markdown_target_start(text: str, *, start: int, image_only: bool, text_len: int) -> int:
    idx = start
    while idx < text_len:
        if text[idx] == "[" and _is_markdown_target_match_start(text, index=idx, image_only=image_only):
            return idx
        idx += 1
    return -1


def _parse_markdown_target_span(text: str, *, start: int, text_len: int) -> tuple[int, int, int] | None:
    close_idx = _scan_to_char(text, start=start + 1, stop_char="]", text_len=text_len)
    if close_idx >= text_len:
        return None
    cursor = _skip_inline_whitespace(text, start=close_idx + 1, text_len=text_len)
    if cursor >= text_len or text[cursor] != "(":
        return -1, -1, close_idx + 1
    target_start = cursor + 1
    target_end = _scan_to_char(text, start=target_start, stop_char=")", text_len=text_len)
    if target_end >= text_len:
        return None
    return target_start, target_end, target_end + 1


def _extract_markdown_target_urls(body: str, *, image_only: bool) -> list[str]:
    text = body or ""
    if not text:
        return []

    text_len = len(text)
    idx = 0
    urls: list[str] = []
    while True:
        match_idx = _next_markdown_target_start(text, start=idx, image_only=image_only, text_len=text_len)
        if match_idx < 0:
            break
        parsed = _parse_markdown_target_span(text, start=match_idx, text_len=text_len)
        if parsed is None:
            break
        target_start, target_end, idx = parsed
        if target_end > target_start:
            url = _normalize_md_url(text[target_start:target_end])
            if url:
                urls.append(url)
    return urls


def _block_urls_image(block: dict[str, object]) -> list[tuple[str, str]]:
    return [("image", str(block.get("url") or "")), ("link", str(block.get("link_url") or ""))]


def _block_urls_gallery(block: dict[str, object]) -> list[tuple[str, str]]:
    urls: list[tuple[str, str]] = []
    images = block.get("images")
    if not isinstance(images, list):
        return urls
    for img in images:
        if isinstance(img, dict):
            urls.append(("image", str(img.get("url") or "")))
    return urls


def _block_urls_banner(block: dict[str, object]) -> list[tuple[str, str]]:
    slide = block.get("slide")
    if not isinstance(slide, dict):
        return []
    return [("image", str(slide.get("image_url") or "")), ("link", str(slide.get("cta_url") or ""))]


def _block_urls_carousel(block: dict[str, object]) -> list[tuple[str, str]]:
    urls: list[tuple[str, str]] = []
    slides = block.get("slides")
    if not isinstance(slides, list):
        return urls
    for slide in slides:
        if isinstance(slide, dict):
            urls.append(("image", str(slide.get("image_url") or "")))
            urls.append(("link", str(slide.get("cta_url") or "")))
    return urls


_BLOCK_URL_EXTRACTORS: dict[str, Any] = {
    "image": _block_urls_image,
    "gallery": _block_urls_gallery,
    "banner": _block_urls_banner,
    "carousel": _block_urls_carousel,
}


def _extract_block_refs(meta: dict | None) -> list[tuple[str, str, str, str]]:
    refs: list[tuple[str, str, str, str]] = []
    for idx, block in _iter_meta_blocks(meta):
        block_type = str(block.get("type") or "").strip().lower()
        prefix = f"meta.blocks[{idx}]"
        if block_type == "text":
            refs.extend(_refs_from_text_block(block, prefix=prefix))
        else:
            refs.extend(_refs_from_asset_block(block_type, block, prefix=prefix))
    return refs


def _path_parts(path: str) -> list[str]:
    return [part for part in path.split("/") if part]


def _register_shop_targets(path: str, query: str, *, category_slugs: set[str]) -> None:
    parts = _path_parts(path)
    if len(parts) >= 2 and parts[0] == "shop":
        category_slugs.add(slugify_page_slug(parts[1]))
    parsed = parse_qs(query or "")
    for param in ("category", "sub"):
        values = parsed.get(param)
        if values:
            category_slugs.add(slugify_page_slug(str(values[0])))


def _normalize_content_path(url: str, path: str) -> str:
    if url.startswith(_MEDIA_RELATIVE_PREFIX) and not path.startswith("/"):
        return "/" + path
    return path


def _register_media_target(path: str, *, media_urls: set[str] | None) -> bool:
    if not path.startswith(_MEDIA_PATH_PREFIX):
        return False
    if media_urls is not None:
        media_urls.add("/" + path.lstrip("/"))
    return True


def _register_product_target(path: str, *, product_slugs: set[str]) -> bool:
    if not path.startswith(_PRODUCTS_PATH_PREFIX):
        return False
    parts = _path_parts(path)
    if len(parts) >= 2:
        product_slugs.add(parts[1])
    return True


def _register_page_target(path: str, *, page_keys: set[str]) -> bool:
    if not path.startswith(_PAGES_PATH_PREFIX):
        return False
    parts = _path_parts(path)
    if len(parts) >= 2:
        page_keys.add(f"page.{slugify_page_slug(parts[1])}")
    return True


def _register_blog_target(path: str, *, blog_keys: set[str]) -> bool:
    if not path.startswith(_BLOG_PATH_PREFIX):
        return False
    parts = _path_parts(path)
    if len(parts) >= 2:
        blog_keys.add(f"blog.{slugify_page_slug(parts[1])}")
    return True


def _register_content_target_url(
    url: str,
    *,
    product_slugs: set[str],
    category_slugs: set[str],
    page_keys: set[str],
    blog_keys: set[str],
    media_urls: set[str] | None = None,
) -> None:
    split = urlsplit(url)
    if split.scheme in ("http", "https"):
        return

    path = _normalize_content_path(url, split.path or "")
    handlers = (
        lambda: _register_media_target(path, media_urls=media_urls),
        lambda: _register_product_target(path, product_slugs=product_slugs),
        lambda: _register_page_target(path, page_keys=page_keys),
        lambda: _register_blog_target(path, blog_keys=blog_keys),
    )
    for handler in handlers:
        if handler():
            return
    if path.startswith("/shop"):
        _register_shop_targets(path, split.query or "", category_slugs=category_slugs)


def _resolve_redirect_chain(key: str, redirects: dict[str, str], *, max_hops: int = 10) -> tuple[str, str | None]:
    current = (key or "").strip()
    if not current:
        return current, None
    seen: set[str] = set()
    for _ in range(max_hops):
        if current in seen:
            return current, "Redirect loop"
        seen.add(current)
        nxt = redirects.get(current)
        if not nxt:
            return current, None
        current = nxt
    return current, "Redirect chain too deep"


def _media_url_exists(url: str) -> bool:
    value = (url or "").strip()
    if value.startswith(_MEDIA_RELATIVE_PREFIX):
        value = "/" + value
    if not value.startswith(_MEDIA_PATH_PREFIX):
        return True
    base_root = Path(settings.media_root).resolve()
    rel = value.removeprefix(_MEDIA_PATH_PREFIX)
    path = (base_root / rel).resolve()
    try:
        path.relative_to(base_root)
    except ValueError:
        return False
    return path.exists()


def _collect_block_link_refs(block: ContentBlock) -> list[tuple[str, str, str, str]]:
    refs: list[tuple[str, str, str, str]] = []
    refs.extend([(k, s, f, u) for k, s, f, u in _extract_markdown_refs(block.body_markdown)])
    refs.extend([(k, s, f, u) for k, s, f, u in _extract_block_refs(getattr(block, "meta", None))])
    for img in getattr(block, "images", []) or []:
        url = _normalize_md_url(getattr(img, "url", "") or "")
        if url:
            refs.append(("image", "block", "images", url))
    return refs


def _collect_preview_link_refs(
    *,
    body_markdown: str,
    meta: dict | None,
    images: list[str] | None,
) -> list[tuple[str, str, str, str]]:
    refs: list[tuple[str, str, str, str]] = []
    refs.extend([(k, s, f, u) for k, s, f, u in _extract_markdown_refs(body_markdown)])
    refs.extend([(k, s, f, u) for k, s, f, u in _extract_block_refs(meta)])
    for raw in images or []:
        url = _normalize_md_url(str(raw or ""))
        if url:
            refs.append(("image", "block", "images", url))
    return refs


def _collect_link_targets(
    refs: list[tuple[str, str, str, str]],
    *,
    include_media_urls: bool,
) -> tuple[set[str], set[str], set[str], set[str], set[str] | None]:
    product_slugs: set[str] = set()
    category_slugs: set[str] = set()
    page_keys: set[str] = set()
    blog_keys: set[str] = set()
    media_urls: set[str] | None = set() if include_media_urls else None
    for _kind, _source, _field, url in refs:
        _register_content_target_url(
            url,
            product_slugs=product_slugs,
            category_slugs=category_slugs,
            page_keys=page_keys,
            blog_keys=blog_keys,
            media_urls=media_urls,
        )
    return product_slugs, category_slugs, page_keys, blog_keys, media_urls


async def _load_products_by_slug(
    session: AsyncSession,
    *,
    product_slugs: set[str],
) -> dict[str, tuple[ProductStatus, bool]]:
    if not product_slugs:
        return {}
    rows = (await session.execute(select(Product.slug, Product.status, Product.is_deleted).where(Product.slug.in_(product_slugs)))).all()
    return {slug: (status, bool(is_deleted)) for slug, status, is_deleted in rows}


async def _load_existing_categories(session: AsyncSession, *, category_slugs: set[str]) -> set[str]:
    if not category_slugs:
        return set()
    return set((await session.execute(select(Category.slug).where(Category.slug.in_(category_slugs)))).scalars().all())


async def _load_redirects(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(ContentRedirect.from_key, ContentRedirect.to_key))).all()
    return {from_key: to_key for from_key, to_key in rows if from_key and to_key}


def _resolve_content_keys(
    content_keys: set[str],
    *,
    redirects: dict[str, str],
) -> tuple[dict[str, tuple[str, str | None]], set[str]]:
    resolved_keys: dict[str, tuple[str, str | None]] = {}
    resolved_targets: set[str] = set()
    for key in content_keys:
        resolved, err = _resolve_redirect_chain(key, redirects)
        resolved_keys[key] = (resolved, err)
        resolved_targets.add(resolved)
    return resolved_keys, resolved_targets


async def _load_blocks_by_key(
    session: AsyncSession,
    *,
    resolved_targets: set[str],
) -> dict[str, tuple[ContentStatus, datetime | None, datetime | None]]:
    if not resolved_targets:
        return {}
    rows = (
        await session.execute(
            select(ContentBlock.key, ContentBlock.status, ContentBlock.published_at, ContentBlock.published_until).where(
                ContentBlock.key.in_(resolved_targets)
            )
        )
    ).all()
    return {key: (status, published_at, published_until) for key, status, published_at, published_until in rows}


async def _load_link_validation_context(
    session: AsyncSession,
    *,
    product_slugs: set[str],
    category_slugs: set[str],
    page_keys: set[str],
    blog_keys: set[str],
) -> tuple[
    dict[str, tuple[ProductStatus, bool]],
    set[str],
    dict[str, tuple[str, str | None]],
    dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
]:
    products_by_slug = await _load_products_by_slug(session, product_slugs=product_slugs)
    existing_categories = await _load_existing_categories(session, category_slugs=category_slugs)
    redirects = await _load_redirects(session)
    resolved_keys, resolved_targets = _resolve_content_keys(page_keys | blog_keys, redirects=redirects)
    blocks_by_key = await _load_blocks_by_key(session, resolved_targets=resolved_targets)
    return products_by_slug, existing_categories, resolved_keys, blocks_by_key


def _append_link_issue(
    issues: list[ContentLinkCheckIssue],
    *,
    content_key: str,
    kind: str,
    source: str,
    field: str,
    url: str,
    reason: str,
) -> None:
    issues.append(
        ContentLinkCheckIssue(
            key=content_key,
            kind=kind,
            source=source,
            field=field,
            url=url,
            reason=reason,
        )
    )


def _slug_from_prefixed_path(path: str) -> str:
    parts = path.split("/", 3)
    return slugify_page_slug(parts[2] if len(parts) >= 3 else "")


def _shop_path_category_candidate(path: str) -> str | None:
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2 or parts[0] != "shop":
        return None
    slug = slugify_page_slug(parts[1])
    return slug or None


def _shop_query_category_candidates(query: str) -> list[str]:
    candidates: list[str] = []
    parsed = parse_qs(query or "")
    for param in ("category", "sub"):
        if param not in parsed or not parsed[param]:
            continue
        slug = slugify_page_slug(str(parsed[param][0]))
        if slug:
            candidates.append(slug)
    return candidates


def _shop_category_candidates(path: str, query: str) -> list[str]:
    candidates: list[str] = []
    path_slug = _shop_path_category_candidate(path)
    if path_slug:
        candidates.append(path_slug)
    candidates.extend(_shop_query_category_candidates(query))
    return candidates


def _handle_media_link_issue(
    issues: list[ContentLinkCheckIssue],
    *,
    content_key: str,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
) -> bool:
    if not path.startswith(_MEDIA_PATH_PREFIX):
        return False
    if not _media_url_exists(path):
        _append_link_issue(
            issues,
            content_key=content_key,
            kind=kind,
            source=source,
            field=field,
            url=url,
            reason="Media file not found",
        )
    return True


def _handle_product_link_issue(
    issues: list[ContentLinkCheckIssue],
    *,
    content_key: str,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
    products_by_slug: dict[str, tuple[ProductStatus, bool]],
) -> bool:
    if not path.startswith(_PRODUCTS_PATH_PREFIX):
        return False
    slug = _slug_from_prefixed_path(path)
    if not slug:
        return True
    row = products_by_slug.get(slug)
    if not row:
        _append_link_issue(
            issues,
            content_key=content_key,
            kind=kind,
            source=source,
            field=field,
            url=url,
            reason="Product not found",
        )
        return True
    product_status, is_deleted = row
    if is_deleted or product_status != ProductStatus.published:
        _append_link_issue(
            issues,
            content_key=content_key,
            kind=kind,
            source=source,
            field=field,
            url=url,
            reason="Product is not publicly visible",
        )
    return True


def _handle_shop_link_issues(
    issues: list[ContentLinkCheckIssue],
    *,
    content_key: str,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
    query: str,
    existing_categories: set[str],
) -> bool:
    if not path.startswith("/shop"):
        return False
    for slug in _shop_category_candidates(path, query):
        if slug in existing_categories:
            continue
        _append_link_issue(
            issues,
            content_key=content_key,
            kind=kind,
            source=source,
            field=field,
            url=url,
            reason="Category not found",
        )
    return True


def _handle_content_link_issue(
    issues: list[ContentLinkCheckIssue],
    *,
    content_key: str,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
    resolved_keys: dict[str, tuple[str, str | None]],
    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
    is_public: Callable[[ContentStatus, datetime | None, datetime | None], bool],
) -> bool:
    original_key = _resolve_content_link_key(path)
    if original_key is None:
        return False
    reason = _resolve_content_link_reason(
        original_key,
        resolved_keys=resolved_keys,
        blocks_by_key=blocks_by_key,
        is_public=is_public,
    )
    if reason is None:
        return True
    _append_link_issue(
        issues,
        content_key=content_key,
        kind=kind,
        source=source,
        field=field,
        url=url,
        reason=reason,
    )
    return True


def _resolve_content_link_key(path: str) -> str | None:
    if not path.startswith(_PAGES_PATH_PREFIX) and not path.startswith(_BLOG_PATH_PREFIX):
        return None
    base = "page." if path.startswith(_PAGES_PATH_PREFIX) else "blog."
    slug = _slug_from_prefixed_path(path)
    if not slug:
        return ""
    return f"{base}{slug}"


def _resolve_content_link_reason(
    original_key: str,
    *,
    resolved_keys: dict[str, tuple[str, str | None]],
    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
    is_public: Callable[[ContentStatus, datetime | None, datetime | None], bool],
) -> str | None:
    if not original_key:
        return None
    resolved, err = resolved_keys.get(original_key, (original_key, None))
    if err:
        return err
    target = blocks_by_key.get(resolved)
    if not target:
        return "Content not found"
    content_status, published_at, published_until = target
    if not is_public(content_status, published_at, published_until):
        return "Content is not publicly visible"
    return None


def _published_at_visible(published_at: datetime | None, *, now: datetime) -> bool:
    return not published_at or published_at <= now


def _published_until_visible(
    published_until: datetime | None,
    *,
    now: datetime,
    allow_until_equal: bool,
) -> bool:
    if not published_until:
        return True
    return now <= published_until if allow_until_equal else now < published_until


def _is_content_public(
    status: ContentStatus,
    published_at: datetime | None,
    published_until: datetime | None,
    *,
    now: datetime,
    allow_until_equal: bool,
) -> bool:
    return (
        status == ContentStatus.published
        and _published_at_visible(published_at, now=now)
        and _published_until_visible(published_until, now=now, allow_until_equal=allow_until_equal)
    )


def _dispatch_single_link_issue(
    issues: list[ContentLinkCheckIssue],
    *,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
    query: str,
    content_key: str,
    products_by_slug: dict[str, tuple[ProductStatus, bool]],
    existing_categories: set[str],
    resolved_keys: dict[str, tuple[str, str | None]],
    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
    is_public: Callable[[ContentStatus, datetime | None, datetime | None], bool],
) -> None:
    if _dispatch_single_link_issue_primary(
        issues,
        kind=kind,
        source=source,
        field=field,
        url=url,
        path=path,
        content_key=content_key,
        products_by_slug=products_by_slug,
    ):
        return
    _dispatch_single_link_issue_secondary(
        issues,
        kind=kind,
        source=source,
        field=field,
        url=url,
        path=path,
        query=query,
        content_key=content_key,
        existing_categories=existing_categories,
        resolved_keys=resolved_keys,
        blocks_by_key=blocks_by_key,
        is_public=is_public,
    )


def _dispatch_single_link_issue_primary(
    issues: list[ContentLinkCheckIssue],
    *,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
    content_key: str,
    products_by_slug: dict[str, tuple[ProductStatus, bool]],
) -> bool:
    if _handle_media_link_issue(
        issues, content_key=content_key, kind=kind, source=source, field=field, url=url, path=path
    ):
        return True
    return _handle_product_link_issue(
        issues,
        content_key=content_key,
        kind=kind,
        source=source,
        field=field,
        url=url,
        path=path,
        products_by_slug=products_by_slug,
    )


def _dispatch_single_link_issue_secondary(
    issues: list[ContentLinkCheckIssue],
    *,
    kind: str,
    source: str,
    field: str,
    url: str,
    path: str,
    query: str,
    content_key: str,
    existing_categories: set[str],
    resolved_keys: dict[str, tuple[str, str | None]],
    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
    is_public: Callable[[ContentStatus, datetime | None, datetime | None], bool],
) -> None:
    if _handle_shop_link_issues(
        issues,
        content_key=content_key,
        kind=kind,
        source=source,
        field=field,
        url=url,
        path=path,
        query=query,
        existing_categories=existing_categories,
    ):
        return
    _handle_content_link_issue(
        issues,
        content_key=content_key,
        kind=kind,
        source=source,
        field=field,
        url=url,
        path=path,
        resolved_keys=resolved_keys,
        blocks_by_key=blocks_by_key,
        is_public=is_public,
    )


def _build_single_link_issue(
    issues: list[ContentLinkCheckIssue],
    *,
    ref: tuple[str, str, str, str],
    content_key: str,
    products_by_slug: dict[str, tuple[ProductStatus, bool]],
    existing_categories: set[str],
    resolved_keys: dict[str, tuple[str, str | None]],
    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
    is_public: Callable[[ContentStatus, datetime | None, datetime | None], bool],
) -> None:
    kind, source, field, url = ref
    split = urlsplit(url)
    if split.scheme in ("http", "https"):
        return
    path = _normalize_content_path(url, split.path or "")
    _dispatch_single_link_issue(
        issues,
        kind=kind,
        source=source,
        field=field,
        url=url,
        path=path,
        query=split.query or "",
        content_key=content_key,
        products_by_slug=products_by_slug,
        existing_categories=existing_categories,
        resolved_keys=resolved_keys,
        blocks_by_key=blocks_by_key,
        is_public=is_public,
    )


def _build_link_issues(
    refs: list[tuple[str, str, str, str]],
    *,
    content_key: str,
    products_by_slug: dict[str, tuple[ProductStatus, bool]],
    existing_categories: set[str],
    resolved_keys: dict[str, tuple[str, str | None]],
    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]],
    is_public: Callable[[ContentStatus, datetime | None, datetime | None], bool],
) -> list[ContentLinkCheckIssue]:
    issues: list[ContentLinkCheckIssue] = []
    for ref in refs:
        _build_single_link_issue(
            issues,
            ref=ref,
            content_key=content_key,
            products_by_slug=products_by_slug,
            existing_categories=existing_categories,
            resolved_keys=resolved_keys,
            blocks_by_key=blocks_by_key,
            is_public=is_public,
        )
    return issues


async def check_content_links(session: AsyncSession, *, key: str) -> list[ContentLinkCheckIssue]:
    block = await get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    refs = _collect_block_link_refs(block)
    product_slugs, category_slugs, page_keys, blog_keys, _ = _collect_link_targets(refs, include_media_urls=False)
    products_by_slug, existing_categories, resolved_keys, blocks_by_key = await _load_link_validation_context(
        session,
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
    )
    now = datetime.now(timezone.utc)
    is_public = partial(_is_content_public, now=now, allow_until_equal=False)
    return _build_link_issues(
        refs,
        content_key=block.key,
        products_by_slug=products_by_slug,
        existing_categories=existing_categories,
        resolved_keys=resolved_keys,
        blocks_by_key=blocks_by_key,
        is_public=is_public,
    )


async def check_content_links_preview(
    session: AsyncSession,
    *,
    key: str,
    body_markdown: str = "",
    meta: dict | None = None,
    images: list[str] | None = None,
) -> list[ContentLinkCheckIssue]:
    content_key = (key or "").strip() or "preview"
    refs = _collect_preview_link_refs(body_markdown=body_markdown, meta=meta, images=images)
    product_slugs, category_slugs, page_keys, blog_keys, _ = _collect_link_targets(refs, include_media_urls=True)
    products_by_slug, existing_categories, resolved_keys, blocks_by_key = await _load_link_validation_context(
        session,
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
    )
    now = datetime.now(timezone.utc)
    is_public = partial(_is_content_public, now=now, allow_until_equal=True)
    return _build_link_issues(
        refs,
        content_key=content_key,
        products_by_slug=products_by_slug,
        existing_categories=existing_categories,
        resolved_keys=resolved_keys,
        blocks_by_key=blocks_by_key,
        is_public=is_public,
    )
