"""add product audit logs and featured collections

Revision ID: 0012
Revises: 0011
Create Date: 2024-10-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "featured_collections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_featured_collections_slug"),
    )
    op.create_index("ix_featured_collections_slug", "featured_collections", ["slug"], unique=True)

    op.create_table(
        "product_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "featured_collection_products",
        sa.Column("collection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("featured_collections.id"), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), primary_key=True),
        sa.Column("sort_order", sa.Numeric(5, 2), nullable=False, server_default="0"),
    )
    op.alter_column("featured_collection_products", "sort_order", server_default=None)


def downgrade() -> None:
    op.drop_table("featured_collection_products")
    op.drop_table("product_audit_logs")
    op.drop_index("ix_featured_collections_slug", table_name="featured_collections")
    op.drop_table("featured_collections")
