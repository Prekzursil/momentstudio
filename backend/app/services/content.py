from datetime import datetime, timezone
from uuid import UUID
import re
import unicodedata
from urllib.parse import parse_qs, urlsplit
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import or_, update, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.content import (
    ContentAuditLog,
    ContentBlock,
    ContentBlockVersion,
    ContentBlockTranslation,
    ContentImage,
    ContentRedirect,
    ContentStatus,
)
from app.models.catalog import Category, Product, ProductStatus
from app.schemas.content import ContentLinkCheckIssue, ContentTranslationStatusUpdate
from app.schemas.content import ContentBlockCreate, ContentBlockUpdate
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

_SUPPORTED_LANGS = {"en", "ro"}


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


async def rename_page_slug(
    session: AsyncSession,
    *,
    old_slug: str,
    new_slug: str,
    actor_id: UUID | None = None,
) -> tuple[str, str, str, str]:
    old_norm = slugify_page_slug(old_slug)
    if not old_norm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")

    old_key = f"page.{old_norm}"
    block = await session.scalar(select(ContentBlock).where(ContentBlock.key == old_key))
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    if old_norm in _LOCKED_PAGE_SLUGS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This page URL cannot be changed")

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

    block.key = new_key
    session.add(block)

    await session.execute(update(ContentRedirect).where(ContentRedirect.to_key == old_key).values(to_key=new_key))
    redirect = await session.scalar(select(ContentRedirect).where(ContentRedirect.from_key == old_key))
    if redirect:
        redirect.to_key = new_key
    else:
        session.add(ContentRedirect(from_key=old_key, to_key=new_key))

    if actor_id is not None:
        session.add(
            ContentAuditLog(
                content_block_id=block.id,
                action=f"rename:{old_norm}->{new_norm}",
                version=block.version,
                user_id=actor_id,
            )
        )

    await session.commit()
    return old_norm, new_norm, old_key, new_key


async def upsert_block(
    session: AsyncSession, key: str, payload: ContentBlockUpdate | ContentBlockCreate, actor_id: UUID | None = None
) -> ContentBlock:
    block = await get_block_by_key(session, key)
    now = datetime.now(timezone.utc)
    data = payload.model_dump(exclude_unset=True)
    expected_version = data.pop("expected_version", None)
    if "body_markdown" in data and data["body_markdown"] is not None:
        _sanitize_markdown(data["body_markdown"])
    lang = data.get("lang")
    content_changed = any(field in data for field in ("title", "body_markdown", "meta"))
    published_at = _ensure_utc(data.get("published_at"))
    published_until = _ensure_utc(data.get("published_until"))
    if not block:
        validate_page_key_for_create(key)
        wants_published_at = None
        wants_published_until = None
        if data.get("status") == ContentStatus.published:
            wants_published_at = published_at or now
            wants_published_until = published_until
            if wants_published_until and wants_published_until <= wants_published_at:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unpublish time must be after publish time",
                )
        needs_translation_en = False
        needs_translation_ro = False
        if lang == "en":
            needs_translation_ro = True
        elif lang == "ro":
            needs_translation_en = True
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
        )
        session.add(block)
        await session.flush()
        version_row = ContentBlockVersion(
            content_block_id=block.id,
            version=block.version,
            title=block.title,
            body_markdown=block.body_markdown,
            status=block.status,
            meta=block.meta,
            lang=block.lang,
            published_at=block.published_at,
            published_until=block.published_until,
            translations=[],
        )
        audit = ContentAuditLog(content_block_id=block.id, action="created", version=block.version, user_id=actor_id)
        session.add_all([version_row, audit])
        await session.commit()
        await session.refresh(block)
        return block

    if not data:
        return block
    if expected_version is not None and block.version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Content has changed (expected version {expected_version}, found {block.version})",
        )
    # If lang is provided and differs from the base language, upsert a translation instead of touching base content.
    # Admin UI often sends lang for base edits (e.g. en), so we treat lang==block.lang (or unset base lang) as base update.
    if lang and block.lang and lang != block.lang:
        translation_changed = (
            ("title" in data and data["title"] is not None) or ("body_markdown" in data and data["body_markdown"] is not None)
        )
        await session.refresh(block, attribute_names=["translations"])
        translation = next((t for t in block.translations if t.lang == lang), None)
        if translation:
            if "title" in data and data["title"] is not None:
                translation.title = data["title"]
            if "body_markdown" in data and data["body_markdown"] is not None:
                translation.body_markdown = data["body_markdown"]
        else:
            translation = ContentBlockTranslation(
                content_block_id=block.id,
                lang=lang,
                title=data.get("title") or block.title,
                body_markdown=data.get("body_markdown") or block.body_markdown,
            )
            session.add(translation)
            block.translations.append(translation)

        block.version += 1
        if translation_changed:
            _clear_needs_translation(block, lang)
        session.add(block)
        translations_snapshot = _snapshot_translations(block)
        version_row = ContentBlockVersion(
            content_block_id=block.id,
            version=block.version,
            title=block.title,
            body_markdown=block.body_markdown,
            status=block.status,
            meta=block.meta,
            lang=block.lang,
            published_at=block.published_at,
            published_until=block.published_until,
            translations=translations_snapshot,
        )
        audit = ContentAuditLog(content_block_id=block.id, action=f"translated:{lang}", version=block.version, user_id=actor_id)
        session.add_all([version_row, audit])
        await session.commit()
        await session.refresh(block)
        await session.refresh(block, attribute_names=["translations"])
        _apply_content_translation(block, lang)
        return block

    block.version += 1
    if "title" in data:
        block.title = data["title"] or block.title
    if "body_markdown" in data and data["body_markdown"] is not None:
        block.body_markdown = data["body_markdown"]
    if "status" in data and data["status"] is not None:
        block.status = data["status"]
        if block.status == ContentStatus.published:
            if "published_at" in data:
                block.published_at = published_at or now
            elif block.published_at is None:
                block.published_at = now
        elif block.status == ContentStatus.draft:
            block.published_at = None
            block.published_until = None
    elif "published_at" in data:
        block.published_at = published_at
    if "published_until" in data:
        block.published_until = published_until
    if "meta" in data:
        block.meta = data["meta"]
    if "sort_order" in data and data["sort_order"] is not None:
        block.sort_order = data["sort_order"]
    if "lang" in data and data["lang"] is not None:
        block.lang = data["lang"]
    effective_lang = (block.lang or lang) if isinstance(block.lang or lang, str) else None
    if content_changed and isinstance(effective_lang, str):
        _mark_other_needs_translation(block, effective_lang)
    if block.status == ContentStatus.draft:
        block.published_until = None
    if block.status == ContentStatus.published:
        if block.published_until and block.published_at and block.published_until <= block.published_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unpublish time must be after publish time",
            )
    await session.refresh(block, attribute_names=["translations"])
    session.add(block)
    translations_snapshot = _snapshot_translations(block)
    version_row = ContentBlockVersion(
        content_block_id=block.id,
        version=block.version,
        title=block.title,
        body_markdown=block.body_markdown,
        status=block.status,
        meta=block.meta,
        lang=block.lang,
        published_at=block.published_at,
        published_until=block.published_until,
        translations=translations_snapshot,
    )
    audit = ContentAuditLog(content_block_id=block.id, action="updated", version=block.version, user_id=actor_id)
    session.add_all([version_row, audit])
    await session.commit()
    await session.refresh(block)
    return block


async def add_image(session: AsyncSession, block: ContentBlock, file, actor_id: UUID | None = None) -> ContentBlock:
    path, filename = storage.save_upload(
        file, allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif"), max_bytes=5 * 1024 * 1024
    )
    next_sort = (max([img.sort_order for img in block.images], default=0) or 0) + 1
    image = ContentImage(content_block_id=block.id, url=path, alt_text=filename, sort_order=next_sort)
    audit = ContentAuditLog(content_block_id=block.id, action="image_upload", version=block.version, user_id=actor_id)
    session.add_all([image, audit])
    await session.commit()
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


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
        session.add(
            ContentAuditLog(
                content_block_id=block.id,
                action="translation_status",
                version=block.version,
                user_id=actor_id,
            )
        )
    await session.commit()
    await session.refresh(block)
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


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
    result = await session.execute(
        select(ContentBlockVersion).where(
            ContentBlockVersion.content_block_id == block.id, ContentBlockVersion.version == version
        )
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")

    now = datetime.now(timezone.utc)
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
    if block.status == ContentStatus.draft:
        block.published_at = None
        block.published_until = None
    elif block.status == ContentStatus.published and block.published_at is None:
        block.published_at = now
    snapshot_translations = getattr(snapshot, "translations", None)
    if snapshot_translations is not None:
        await session.refresh(block, attribute_names=["translations"])
        existing_by_lang = {t.lang: t for t in block.translations}
        target_langs: set[str] = set()
        for item in snapshot_translations:
            lang = item.get("lang") if isinstance(item, dict) else None
            title = item.get("title") if isinstance(item, dict) else None
            body = item.get("body_markdown") if isinstance(item, dict) else None
            if not isinstance(lang, str) or not lang:
                continue
            if not isinstance(title, str) or not isinstance(body, str):
                continue
            target_langs.add(lang)
            tr = existing_by_lang.get(lang)
            if tr:
                tr.title = title
                tr.body_markdown = body
            else:
                session.add(ContentBlockTranslation(content_block_id=block.id, lang=lang, title=title, body_markdown=body))
        for tr in list(block.translations):
            if tr.lang not in target_langs:
                await session.delete(tr)
    session.add(block)

    await session.refresh(block, attribute_names=["translations"])
    translations_snapshot = _snapshot_translations(block)
    version_row = ContentBlockVersion(
        content_block_id=block.id,
        version=block.version,
        title=block.title,
        body_markdown=block.body_markdown,
        status=block.status,
        meta=block.meta,
        lang=block.lang,
        published_at=block.published_at,
        published_until=block.published_until,
        translations=translations_snapshot,
    )
    audit = ContentAuditLog(
        content_block_id=block.id,
        action=f"rollback:{snapshot.version}",
        version=block.version,
        user_id=actor_id,
    )
    session.add_all([version_row, audit])
    await session.commit()
    await session.refresh(block)
    await session.refresh(block, attribute_names=["images", "audits"])
    return block


def _sanitize_markdown(body: str) -> None:
    lower = body.lower()
    forbidden = ["<script", "<iframe", "<object", "<embed", "javascript:"]
    if any(tok in lower for tok in forbidden):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed markup")
    if re.search(r"on\w+=", lower):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disallowed event handlers")


_MD_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def _normalize_md_url(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    if value.startswith("<") and value.endswith(">") and len(value) > 2:
        value = value[1:-1].strip()
    if not value:
        return ""
    if any(value.startswith(prefix) for prefix in ("mailto:", "tel:")):
        return ""
    if value.startswith("#"):
        return ""
    # Links may include an optional title: url "title"
    if " " in value or "\t" in value:
        value = re.split(r"\s+", value, maxsplit=1)[0]
    return value.strip()


def _extract_markdown_refs(body: str) -> list[tuple[str, str, str, str]]:
    refs: list[tuple[str, str, str, str]] = []
    for match in _MD_IMAGE_RE.finditer(body or ""):
        url = _normalize_md_url(match.group(1))
        if url:
            refs.append(("image", "markdown", "body_markdown", url))
    for match in _MD_LINK_RE.finditer(body or ""):
        url = _normalize_md_url(match.group(1))
        if url:
            refs.append(("link", "markdown", "body_markdown", url))
    return refs


def _extract_block_refs(meta: dict | None) -> list[tuple[str, str, str, str]]:
    if not isinstance(meta, dict):
        return []
    blocks = meta.get("blocks")
    if not isinstance(blocks, list):
        return []
    refs: list[tuple[str, str, str, str]] = []

    for idx, block in enumerate(blocks):
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "").strip().lower()
        prefix = f"meta.blocks[{idx}]"
        if block_type == "text":
            body = block.get("body_markdown")
            if isinstance(body, str):
                refs.extend([(k, s, f"{prefix}.body_markdown", u) for k, s, _, u in _extract_markdown_refs(body)])
            continue

        urls: list[tuple[str, str]] = []
        if block_type == "image":
            urls.append(("image", str(block.get("url") or "")))
            urls.append(("link", str(block.get("link_url") or "")))
        elif block_type == "gallery":
            images = block.get("images")
            if isinstance(images, list):
                for img_idx, img in enumerate(images):
                    if not isinstance(img, dict):
                        continue
                    urls.append(("image", str(img.get("url") or "")))
        elif block_type == "banner":
            slide = block.get("slide")
            if isinstance(slide, dict):
                urls.append(("image", str(slide.get("image_url") or "")))
                urls.append(("link", str(slide.get("cta_url") or "")))
        elif block_type == "carousel":
            slides = block.get("slides")
            if isinstance(slides, list):
                for slide_idx, slide in enumerate(slides):
                    if not isinstance(slide, dict):
                        continue
                    urls.append(("image", str(slide.get("image_url") or "")))
                    urls.append(("link", str(slide.get("cta_url") or "")))

        for kind, raw in urls:
            url = _normalize_md_url(raw)
            if not url:
                continue
            refs.append((kind, "block", f"{prefix}", url))
    return refs


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
    if value.startswith("media/"):
        value = "/" + value
    if not value.startswith("/media/"):
        return True
    base_root = Path(settings.media_root).resolve()
    rel = value.removeprefix("/media/")
    path = (base_root / rel).resolve()
    try:
        path.relative_to(base_root)
    except ValueError:
        return False
    return path.exists()


async def check_content_links(session: AsyncSession, *, key: str) -> list[ContentLinkCheckIssue]:
    block = await get_block_by_key(session, key)
    if not block:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")

    refs: list[tuple[str, str, str, str]] = []
    refs.extend([(k, s, f, u) for k, s, f, u in _extract_markdown_refs(block.body_markdown)])
    refs.extend([(k, s, f, u) for k, s, f, u in _extract_block_refs(getattr(block, "meta", None))])
    for img in getattr(block, "images", []) or []:
        url = _normalize_md_url(getattr(img, "url", "") or "")
        if url:
            refs.append(("image", "block", "images", url))

    product_slugs: set[str] = set()
    category_slugs: set[str] = set()
    page_keys: set[str] = set()
    blog_keys: set[str] = set()
    media_urls: set[str] = set()

    def register(kind: str, url: str) -> None:
        split = urlsplit(url)
        if split.scheme in ("http", "https"):
            return
        path = split.path or ""
        if url.startswith("media/") and not path.startswith("/"):
            path = "/" + path
        if path.startswith("/media/"):
            media_urls.add("/" + path.lstrip("/"))
            return
        if path.startswith("/products/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2:
                product_slugs.add(parts[1])
            return
        if path.startswith("/pages/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2:
                page_keys.add(f"page.{slugify_page_slug(parts[1])}")
            return
        if path.startswith("/blog/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2:
                blog_keys.add(f"blog.{slugify_page_slug(parts[1])}")
            return
        if path.startswith("/shop"):
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2 and parts[0] == "shop":
                category_slugs.add(slugify_page_slug(parts[1]))
            query = parse_qs(split.query or "")
            if "category" in query and query["category"]:
                category_slugs.add(slugify_page_slug(str(query["category"][0])))
            if "sub" in query and query["sub"]:
                category_slugs.add(slugify_page_slug(str(query["sub"][0])))
            return

    for kind, source, field, url in refs:
        register(kind, url)

    now = datetime.now(timezone.utc)

    products_by_slug: dict[str, tuple[ProductStatus, bool]] = {}
    if product_slugs:
        product_rows = (
            await session.execute(
                select(Product.slug, Product.status, Product.is_deleted).where(Product.slug.in_(product_slugs))
            )
        ).all()
        products_by_slug = {slug: (status, bool(is_deleted)) for slug, status, is_deleted in product_rows}

    existing_categories: set[str] = set()
    if category_slugs:
        existing_categories = set(
            (await session.execute(select(Category.slug).where(Category.slug.in_(category_slugs)))).scalars().all()
        )

    redirects: dict[str, str] = {}
    redirects_rows = (await session.execute(select(ContentRedirect.from_key, ContentRedirect.to_key))).all()
    redirects = {from_key: to_key for from_key, to_key in redirects_rows if from_key and to_key}

    content_keys = page_keys | blog_keys
    resolved_keys: dict[str, tuple[str, str | None]] = {}
    resolved_targets: set[str] = set()
    for k in content_keys:
        resolved, err = _resolve_redirect_chain(k, redirects)
        resolved_keys[k] = (resolved, err)
        resolved_targets.add(resolved)

    blocks_by_key: dict[str, tuple[ContentStatus, datetime | None, datetime | None]] = {}
    if resolved_targets:
        block_rows = (
            await session.execute(
                select(ContentBlock.key, ContentBlock.status, ContentBlock.published_at, ContentBlock.published_until).where(
                    ContentBlock.key.in_(resolved_targets)
                )
            )
        ).all()
        blocks_by_key = {
            key: (status, published_at, published_until) for key, status, published_at, published_until in block_rows
        }

    def is_public(status: ContentStatus, published_at: datetime | None, published_until: datetime | None) -> bool:
        if status != ContentStatus.published:
            return False
        if published_at and published_at > now:
            return False
        if published_until and published_until <= now:
            return False
        return True

    issues: list[ContentLinkCheckIssue] = []
    for kind, source, field, url in refs:
        split = urlsplit(url)
        if split.scheme in ("http", "https"):
            continue
        path = split.path or ""
        if url.startswith("media/") and not path.startswith("/"):
            path = "/" + path

        if path.startswith("/media/"):
            if not _media_url_exists(path):
                issues.append(
                    ContentLinkCheckIssue(
                        key=block.key,
                        kind=kind,
                        source=source,
                        field=field,
                        url=url,
                        reason="Media file not found",
                    )
                )
            continue

        if path.startswith("/products/"):
            slug = slugify_page_slug(path.split("/", 3)[2] if len(path.split("/")) >= 3 else "")
            if not slug:
                continue
            row = products_by_slug.get(slug)
            if not row:
                issues.append(
                    ContentLinkCheckIssue(
                        key=block.key,
                        kind=kind,
                        source=source,
                        field=field,
                        url=url,
                        reason="Product not found",
                    )
                )
                continue
            product_status, is_deleted = row
            if is_deleted or product_status != ProductStatus.published:
                issues.append(
                    ContentLinkCheckIssue(
                        key=block.key,
                        kind=kind,
                        source=source,
                        field=field,
                        url=url,
                        reason="Product is not publicly visible",
                    )
                )
            continue

        if path.startswith("/shop"):
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2 and parts[0] == "shop":
                slug = slugify_page_slug(parts[1])
                if slug and slug not in existing_categories:
                    issues.append(
                        ContentLinkCheckIssue(
                            key=block.key,
                            kind=kind,
                            source=source,
                            field=field,
                            url=url,
                            reason="Category not found",
                        )
                    )
            query = parse_qs(split.query or "")
            for param in ("category", "sub"):
                if param in query and query[param]:
                    slug = slugify_page_slug(str(query[param][0]))
                    if slug and slug not in existing_categories:
                        issues.append(
                            ContentLinkCheckIssue(
                                key=block.key,
                                kind=kind,
                                source=source,
                                field=field,
                                url=url,
                                reason="Category not found",
                            )
                        )
            continue

        if path.startswith("/pages/") or path.startswith("/blog/"):
            base = "page." if path.startswith("/pages/") else "blog."
            slug = slugify_page_slug(path.split("/", 3)[2] if len(path.split("/")) >= 3 else "")
            if not slug:
                continue
            original_key = f"{base}{slug}"
            resolved, err = resolved_keys.get(original_key, (original_key, None))
            if err:
                issues.append(
                    ContentLinkCheckIssue(
                        key=block.key,
                        kind=kind,
                        source=source,
                        field=field,
                        url=url,
                        reason=err,
                    )
                )
                continue
            target = blocks_by_key.get(resolved)
            if not target:
                issues.append(
                    ContentLinkCheckIssue(
                        key=block.key,
                        kind=kind,
                        source=source,
                        field=field,
                        url=url,
                        reason="Content not found",
                    )
                )
                continue
            content_status, published_at, published_until = target
            if not is_public(content_status, published_at, published_until):
                issues.append(
                    ContentLinkCheckIssue(
                        key=block.key,
                        kind=kind,
                        source=source,
                        field=field,
                        url=url,
                        reason="Content is not publicly visible",
                    )
                )
            continue

    return issues
