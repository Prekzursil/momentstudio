"""add content translations and lang support

Revision ID: 0026_content_translations_and_lang
Revises: 0025_product_category_translations
Create Date: 2025-12-06 09:05:00.000000
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0026_content_translations_and_lang"
down_revision: Union[str, None] = "0025_product_category_translations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("content_blocks", sa.Column("lang", sa.String(length=10), nullable=True))
    op.create_index("ix_content_blocks_lang", "content_blocks", ["lang"])

    op.create_table(
        "content_block_translations",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("content_block_id", sa.UUID(as_uuid=True), sa.ForeignKey("content_blocks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.UniqueConstraint("content_block_id", "lang", name="uq_content_block_translations_block_lang"),
    )
    op.create_index("ix_content_block_translations_lang", "content_block_translations", ["lang"])


def downgrade() -> None:
    op.drop_index("ix_content_block_translations_lang", table_name="content_block_translations")
    op.drop_table("content_block_translations")
    op.drop_index("ix_content_blocks_lang", table_name="content_blocks")
    op.drop_column("content_blocks", "lang")
