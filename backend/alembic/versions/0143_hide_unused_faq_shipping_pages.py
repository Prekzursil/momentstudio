"""Hide unused FAQ/Shipping pages by default.

Revision ID: 0143
Revises: 0142
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0143"
down_revision: str | None = "0142"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


HIDE_KEYS: tuple[str, ...] = ("page.faq", "page.shipping")


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    is_postgres = conn.dialect.name == "postgresql"

    content_status = postgresql.ENUM("draft", "review", "published", name="contentstatus", create_type=False)
    draft_status = sa.text("'draft'::contentstatus") if is_postgres else "draft"

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("status", content_status),
        sa.column("meta", sa.JSON()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    versions = sa.table(
        "content_block_versions",
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("status", content_status),
        sa.column("meta", sa.JSON()),
    )

    rows = (
        conn.execute(
            sa.select(
                content_blocks.c.id,
                content_blocks.c.key,
                content_blocks.c.version,
                content_blocks.c.meta,
            ).where(content_blocks.c.key.in_(HIDE_KEYS))
        )
        .mappings()
        .all()
    )
    if not rows:
        return

    for row in rows:
        meta = _as_dict(row.get("meta"))
        if meta.get("hidden") is True:
            continue
        meta.setdefault("version", 1)
        meta["hidden"] = True

        conn.execute(
            sa.update(content_blocks)
            .where(content_blocks.c.id == row["id"])
            .values(meta=meta, status=draft_status, updated_at=now)
        )

        current_version = int(row.get("version") or 1)
        conn.execute(
            sa.update(versions)
            .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
            .values(meta=meta, status=draft_status)
        )


def downgrade() -> None:
    # Intentionally no-op: un-hiding pages would be a user decision.
    return

