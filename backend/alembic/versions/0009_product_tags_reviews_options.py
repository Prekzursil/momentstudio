"""product tags, options, reviews, rating fields

Revision ID: 0009
Revises: 0008
Create Date: 2024-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.UniqueConstraint("name", name="uq_tags_name"),
        sa.UniqueConstraint("slug", name="uq_tags_slug"),
    )
    op.create_index("ix_tags_name", "tags", ["name"], unique=True)
    op.create_index("ix_tags_slug", "tags", ["slug"], unique=True)

    op.create_table(
        "product_options",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("option_name", sa.String(length=50), nullable=False),
        sa.Column("option_value", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "product_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("author_name", sa.String(length=160), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.add_column(
        "products",
        sa.Column("rating_average", sa.Numeric(3, 2), nullable=False, server_default="0"),
    )
    op.add_column("products", sa.Column("rating_count", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("products", "rating_average", server_default=None)
    op.alter_column("products", "rating_count", server_default=None)

    op.create_table(
        "product_tags",
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), primary_key=True),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tags.id"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("product_tags")
    op.drop_column("products", "rating_count")
    op.drop_column("products", "rating_average")
    op.drop_table("product_reviews")
    op.drop_table("product_options")
    op.drop_index("ix_tags_slug", table_name="tags")
    op.drop_index("ix_tags_name", table_name="tags")
    op.drop_table("tags")
