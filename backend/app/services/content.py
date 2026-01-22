from datetime import datetime, timezone
from uuid import UUID
import re
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy import or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.content import (
    ContentAuditLog,
    ContentBlock,
    ContentBlockVersion,
    ContentBlockTranslation,
    ContentImage,
    ContentRedirect,
    ContentStatus,
)
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
    published_at = _ensure_utc(data.get("published_at"))
    if not block:
        validate_page_key_for_create(key)
        wants_published_at = None
        if data.get("status") == ContentStatus.published:
            wants_published_at = published_at or now
        block = ContentBlock(
            key=key,
            title=data.get("title") or "",
            body_markdown=data.get("body_markdown") or "",
            status=data.get("status") or ContentStatus.draft,
            version=1,
            published_at=wants_published_at,
            meta=data.get("meta"),
            sort_order=data.get("sort_order", 0),
            lang=lang,
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
    elif "published_at" in data:
        block.published_at = published_at
    if "meta" in data:
        block.meta = data["meta"]
    if "sort_order" in data and data["sort_order"] is not None:
        block.sort_order = data["sort_order"]
    if "lang" in data and data["lang"] is not None:
        block.lang = data["lang"]
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
    if block.status == ContentStatus.draft:
        block.published_at = None
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
