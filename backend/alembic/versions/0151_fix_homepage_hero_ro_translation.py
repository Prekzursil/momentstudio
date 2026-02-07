"""Fix missing Romanian translations for the seeded homepage hero banner.

This migration updates the `home.sections` content block hero slide fields when the
Romanian values are still using the English seed defaults.

Revision ID: 0151
Revises: 0150
Create Date: 2026-02-07
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0151"
down_revision: str | None = "0150"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


EN_HEADLINE = "Welcome to momentstudio"
RO_HEADLINE = "Bine ai venit la momentstudio"
EN_SUBHEADLINE = "Handmade art for your home"
RO_SUBHEADLINE = "Artă lucrată manual pentru casa ta"
EN_CTA = "Shop now"
RO_CTA = "Cumpără acum"


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: object | None) -> list:
    return value if isinstance(value, list) else []


def _get_localized(value: object | None, lang: str) -> str:
    if not isinstance(value, dict):
        return ""
    return str(value.get(lang) or "").strip()


def _maybe_set_ro(value: object | None, *, en_expected: str, ro_value: str) -> bool:
    if not isinstance(value, dict):
        return False
    en = _get_localized(value, "en")
    ro = _get_localized(value, "ro")
    if en != en_expected:
        return False
    if ro and ro != en_expected:
        return False
    value["ro"] = ro_value
    return True


def _fix_slide(slide: dict) -> bool:
    changed = False
    changed |= _maybe_set_ro(slide.get("headline"), en_expected=EN_HEADLINE, ro_value=RO_HEADLINE)
    changed |= _maybe_set_ro(slide.get("subheadline"), en_expected=EN_SUBHEADLINE, ro_value=RO_SUBHEADLINE)
    changed |= _maybe_set_ro(slide.get("cta_label"), en_expected=EN_CTA, ro_value=RO_CTA)
    return changed


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
    blocks = [b for b in _as_list(meta.get("blocks")) if isinstance(b, dict)]
    if not blocks:
        return

    any_changed = False
    for block in blocks:
        block_type = str(block.get("type") or "").strip().lower()
        if block_type == "banner":
            slide = _as_dict(block.get("slide"))
            if slide and _fix_slide(slide):
                block["slide"] = slide
                any_changed = True
        elif block_type == "carousel":
            slides = [s for s in _as_list(block.get("slides")) if isinstance(s, dict)]
            changed = False
            for slide in slides:
                changed |= _fix_slide(slide)
            if changed:
                block["slides"] = slides
                any_changed = True

    if not any_changed:
        return

    meta["blocks"] = blocks

    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta, updated_at=now))

    current_version = int(row.get("version") or 1)
    conn.execute(
        sa.update(versions)
        .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
        .values(meta=meta)
    )


def downgrade() -> None:
    # Intentionally no-op: reverting localized homepage strings would overwrite user edits.
    return

