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
        sa.text(
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
    )
    op.execute(
        sa.text(
            """
            DELETE FROM product_tags
            WHERE tag_id IN (
                SELECT id FROM tags WHERE slug = 'highlight'
            )
            """
        )
    )
    op.execute(sa.text("DELETE FROM tags WHERE slug = 'highlight'"))


def downgrade() -> None:
    conn = op.get_bind()
    exists = conn.execute(sa.text("SELECT 1 FROM tags WHERE slug = 'highlight'")).first()
    if exists:
        return
    op.execute(
        sa.text("INSERT INTO tags (id, name, slug) VALUES (:id, :name, :slug)")
        .bindparams(id=uuid.uuid4(), name="Highlight", slug="highlight")
    )
