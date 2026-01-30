"""Set default hero banner image for home.sections.

Revision ID: 0136
Revises: 0135
Create Date: 2026-01-30
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0136"
down_revision: str | None = "0135"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: object | None) -> list:
    return value if isinstance(value, list) else []


def _as_str(value: object | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def upgrade() -> None:
    conn = op.get_bind()

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
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
    blocks = _as_list(meta.get("blocks"))
    if not blocks:
        return

    changed = False
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if _as_str(block.get("type")).lower() != "banner":
            continue
        if _as_str(block.get("key")).lower() != "hero_banner":
            continue
        slide = _as_dict(block.get("slide"))
        current = _as_str(slide.get("image_url") or slide.get("image"))
        if current:
            continue
        slide["image_url"] = "assets/home/banner_image.jpeg"
        block["slide"] = slide
        changed = True

    if not changed:
        return

    meta["blocks"] = blocks
    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta))

    current_version = int(row.get("version") or 1)
    conn.execute(
        sa.update(versions)
        .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
        .values(meta=meta)
    )


def downgrade() -> None:
    # Intentionally no-op: this migration only fills a default value when missing, and we
    # don't want to remove user edits during downgrade.
    return

