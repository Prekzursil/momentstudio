"""Add manual last-updated metadata for legal pages.

Revision ID: 0144
Revises: 0143
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0144"
down_revision: str | None = "0143"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


LEGAL_KEYS: tuple[str, ...] = (
    "page.terms",
    "page.terms-and-conditions",
    "page.privacy-policy",
    "page.anpc",
)

# Initial value (manual; does not auto-update on edits).
DEFAULT_LAST_UPDATED = "2026-02-03"


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


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

    rows = (
        conn.execute(
            sa.select(content_blocks.c.id, content_blocks.c.key, content_blocks.c.version, content_blocks.c.meta).where(
                content_blocks.c.key.in_(LEGAL_KEYS)
            )
        )
        .mappings()
        .all()
    )
    if not rows:
        return

    for row in rows:
        meta = _as_dict(row.get("meta"))
        if _as_str(meta.get("last_updated")):
            continue
        meta.setdefault("version", 1)
        meta["last_updated"] = DEFAULT_LAST_UPDATED

        conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta, updated_at=now))

        current_version = int(row.get("version") or 1)
        conn.execute(
            sa.update(versions)
            .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
            .values(meta=meta)
        )


def downgrade() -> None:
    # Intentionally no-op: removing last_updated would overwrite user edits.
    return

