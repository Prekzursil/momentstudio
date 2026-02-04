"""Seed homepage layout defaults to match the current storefront configuration.

This migration fills in a canonical `home.sections.meta.blocks` ordering when the
site is still using legacy/seed defaults (i.e. no explicit section blocks have
been configured yet).

Revision ID: 0141
Revises: 0140
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0141"
down_revision: str | None = "0140"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


HOME_SECTION_TYPES: set[str] = {
    "featured_products",
    "sale_products",
    "new_arrivals",
    "featured_collections",
    "story",
    "recently_viewed",
    "why",
}

HERO_LIKE_TYPES: set[str] = {"banner", "carousel"}


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: object | None) -> list:
    return value if isinstance(value, list) else []


def _as_str(value: object | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    versions = sa.table(
        "content_block_versions",
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
    )

    row = (
        conn.execute(
            sa.select(content_blocks.c.id, content_blocks.c.version, content_blocks.c.meta).where(
                content_blocks.c.key == "home.sections"
            )
        )
        .mappings()
        .first()
    )
    if not row:
        return

    meta = _as_dict(row["meta"])
    blocks_raw = _as_list(meta.get("blocks"))

    blocks: list[dict] = [b for b in blocks_raw if isinstance(b, dict)]

    has_explicit_sections = any(_as_str(b.get("type")).lower() in HOME_SECTION_TYPES for b in blocks)
    if has_explicit_sections:
        return

    has_custom_non_hero = any(
        (t := _as_str(b.get("type")).lower()) and (t not in HOME_SECTION_TYPES) and (t not in HERO_LIKE_TYPES)
        for b in blocks
    )
    if has_custom_non_hero:
        return

    hero_like_blocks = [b for b in blocks if _as_str(b.get("type")).lower() in HERO_LIKE_TYPES]
    if not hero_like_blocks:
        hero_like_blocks = [
            {
                "key": "hero_banner",
                "type": "banner",
                "enabled": True,
                "title": {"en": "", "ro": ""},
                "slide": {
                    "image_url": "assets/home/banner_image.jpeg",
                    "alt": {"en": "", "ro": ""},
                    "headline": {"en": "Welcome to momentstudio", "ro": "Welcome to momentstudio"},
                    "subheadline": {"en": "Handmade art for your home", "ro": "Handmade art for your home"},
                    "cta_label": {"en": "Shop now", "ro": "Shop now"},
                    "cta_url": "/shop",
                    "variant": "split",
                    "size": "L",
                    "text_style": "dark",
                },
            }
        ]

    section_blocks = [
        {"key": "featured_products", "type": "featured_products", "enabled": True},
        {"key": "sale_products", "type": "sale_products", "enabled": True},
        {"key": "new_arrivals", "type": "new_arrivals", "enabled": True},
        {"key": "recently_viewed", "type": "recently_viewed", "enabled": True},
        {"key": "featured_collections", "type": "featured_collections", "enabled": True},
        {"key": "story", "type": "story", "enabled": True},
        {"key": "why", "type": "why", "enabled": False},
    ]

    meta.setdefault("version", 1)
    meta["blocks"] = hero_like_blocks + section_blocks

    # Keep legacy lists consistent (for older clients / tooling).
    meta["sections"] = [{"id": b["type"], "enabled": bool(b["enabled"])} for b in section_blocks]
    meta["order"] = [b["type"] for b in section_blocks]

    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta, updated_at=now))

    current_version = int(row.get("version") or 1)
    conn.execute(
        sa.update(versions)
        .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
        .values(meta=meta)
    )


def downgrade() -> None:
    # Intentionally no-op: removing seeded homepage layout defaults would overwrite user edits.
    return

