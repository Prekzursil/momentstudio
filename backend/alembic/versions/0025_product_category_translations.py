"""add product and category translations

Revision ID: 0025_product_category_translations
Revises: 0024_preferred_language
Create Date: 2025-12-06 08:35:00.000000
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0025_product_category_translations"
down_revision: Union[str, None] = "0024_preferred_language"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "category_translations",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("category_id", sa.UUID(as_uuid=True), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.UniqueConstraint("category_id", "lang", name="uq_category_translations_category_lang"),
    )
    op.create_index("ix_category_translations_lang", "category_translations", ["lang"])

    op.create_table(
        "product_translations",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("product_id", sa.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("short_description", sa.String(length=280), nullable=True),
        sa.Column("long_description", sa.Text(), nullable=True),
        sa.Column("meta_title", sa.String(length=180), nullable=True),
        sa.Column("meta_description", sa.String(length=300), nullable=True),
        sa.UniqueConstraint("product_id", "lang", name="uq_product_translations_product_lang"),
    )
    op.create_index("ix_product_translations_lang", "product_translations", ["lang"])


def downgrade() -> None:
    op.drop_index("ix_product_translations_lang", table_name="product_translations")
    op.drop_table("product_translations")
    op.drop_index("ix_category_translations_lang", table_name="category_translations")
    op.drop_table("category_translations")
