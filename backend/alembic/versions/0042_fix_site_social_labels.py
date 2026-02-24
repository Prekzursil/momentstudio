"""fix site.social labels for existing seeds

Revision ID: 0042
Revises: 0041
Create Date: 2026-01-08
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("meta", sa.JSON()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )

    row = conn.execute(
        sa.select(content_blocks.c.id, content_blocks.c.meta).where(content_blocks.c.key == "site.social")
    ).first()
    if row is None:
        return

    block_id, meta = row
    meta = meta or {}
    changed = False

    def update_pages(key: str) -> None:
        nonlocal changed
        pages = meta.get(key)
        if not isinstance(pages, list):
            return
        for page in pages:
            if not isinstance(page, dict):
                continue
            url = str(page.get("url") or "")
            label = str(page.get("label") or "").strip().lower()
            if not url:
                continue
            if "adrianaartizanat" in url and label == "momentstudio":
                page["label"] = "adrianaartizanat"
                changed = True

    update_pages("instagram_pages")
    update_pages("facebook_pages")

    if not changed:
        return

    conn.execute(
        sa.update(content_blocks)
        .where(content_blocks.c.id == block_id)
        .values(meta=meta, updated_at=now)
    )


def downgrade() -> None:
    # Intentionally no-op: this corrects seeded labels, but users may have edited them.
    return
