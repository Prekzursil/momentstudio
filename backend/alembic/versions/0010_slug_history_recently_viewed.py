"""add slug history and recently viewed

Revision ID: 0010
Revises: 0009
Create Date: 2024-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_slug_history",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("slug", name="uq_product_slug_history_slug"),
    )
    op.create_index(
        "ix_product_slug_history_slug", "product_slug_history", ["slug"], unique=True
    )

    op.create_table(
        "recently_viewed_products",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("session_id", sa.String(length=120), nullable=True),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_recently_viewed_session_id",
        "recently_viewed_products",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        "uq_recently_viewed_user_product",
        "recently_viewed_products",
        ["user_id", "product_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "uq_recently_viewed_session_product",
        "recently_viewed_products",
        ["session_id", "product_id"],
        unique=True,
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_recently_viewed_session_product", table_name="recently_viewed_products"
    )
    op.drop_index(
        "uq_recently_viewed_user_product", table_name="recently_viewed_products"
    )
    op.drop_index(
        "ix_recently_viewed_session_id", table_name="recently_viewed_products"
    )
    op.drop_table("recently_viewed_products")
    op.drop_index("ix_product_slug_history_slug", table_name="product_slug_history")
    op.drop_table("product_slug_history")
