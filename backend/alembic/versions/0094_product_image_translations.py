"""add product image translations

Revision ID: 0094
Revises: 0093
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0094"
down_revision: str | None = "0093"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("product_images", sa.Column("caption", sa.Text(), nullable=True))
    op.create_table(
        "product_image_translations",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "image_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_images.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("alt_text", sa.String(length=255), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.UniqueConstraint("image_id", "lang", name="uq_product_image_translations_image_lang"),
    )
    op.create_index("ix_product_image_translations_image_id", "product_image_translations", ["image_id"])
    op.create_index("ix_product_image_translations_lang", "product_image_translations", ["lang"])


def downgrade() -> None:
    op.drop_index("ix_product_image_translations_lang", table_name="product_image_translations")
    op.drop_index("ix_product_image_translations_image_id", table_name="product_image_translations")
    op.drop_table("product_image_translations")
    op.drop_column("product_images", "caption")

