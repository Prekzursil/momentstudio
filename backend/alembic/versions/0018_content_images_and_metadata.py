"""content images and metadata

Revision ID: 0018
Revises: 0017
Create Date: 2024-10-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("content_blocks", sa.Column("meta", sa.JSON(), nullable=True))
    op.add_column("content_blocks", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("content_blocks", "sort_order", server_default=None)

    op.create_table(
        "content_images",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("content_block_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("content_blocks.id"), nullable=False),
        sa.Column("url", sa.String(length=255), nullable=False),
        sa.Column("alt_text", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.alter_column("content_images", "sort_order", server_default=None)

    # update sort order/metadata for seeded blocks
    connection = op.get_bind()
    content_blocks = sa.table(
        "content_blocks",
        sa.column("key", sa.String()),
        sa.column("meta", sa.JSON()),
        sa.column("sort_order", sa.Integer()),
    )
    defaults = [
        ("home.hero", {"headline": "Welcome to AdrianaArt", "cta": "Shop now", "cta_link": "/shop"}),
        ("home.grid", {"sections": ["featured", "new", "bestsellers"]}),
        ("home.testimonials", {"quotes": []}),
        ("page.faq", {"priority": 1}),
    ]
    for key, meta in defaults:
        connection.execute(sa.update(content_blocks).where(content_blocks.c.key == key).values(meta=meta, sort_order=0))


def downgrade() -> None:
    op.drop_table("content_images")
    op.drop_column("content_blocks", "meta")
    op.drop_column("content_blocks", "sort_order")
