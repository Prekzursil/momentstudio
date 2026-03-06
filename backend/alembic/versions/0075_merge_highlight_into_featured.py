"""merge highlight tag into featured flag

Revision ID: 0075
Revises: 0074
Create Date: 2026-01-19
"""

from collections.abc import Sequence
import uuid

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0075"
down_revision: str | None = "0074"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE products
        SET is_featured = TRUE
        WHERE id IN (
            SELECT pt.product_id
            FROM product_tags pt
            JOIN tags t ON t.id = pt.tag_id
            WHERE t.slug = 'highlight'
        )
        """
    )
    op.execute(
        """
        DELETE FROM product_tags
        WHERE tag_id IN (
            SELECT id FROM tags WHERE slug = 'highlight'
        )
        """
    )
    op.execute("DELETE FROM tags WHERE slug = 'highlight'")


def downgrade() -> None:
    tags_table = sa.table(
        "tags",
        sa.column("id", sa.String(length=36)),
        sa.column("name", sa.String(length=255)),
        sa.column("slug", sa.String(length=255)),
    )
    conn = op.get_bind()
    exists = conn.execute(
        sa.select(sa.literal(1)).select_from(tags_table).where(tags_table.c.slug == "highlight")
    ).first()
    if exists:
        return
    op.bulk_insert(tags_table, [{"id": str(uuid.uuid4()), "name": "Highlight", "slug": "highlight"}])
