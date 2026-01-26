"""add product relationships (related/upsell)

Revision ID: 0097
Revises: 0096
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0097"
down_revision: str | None = "0096"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    relationship_type = sa.Enum(
        "related",
        "upsell",
        name="productrelationshiptype",
        native_enum=False,
    )

    op.create_table(
        "product_relationships",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "product_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "related_product_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relationship_type", relationship_type, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "product_id",
            "related_product_id",
            "relationship_type",
            name="uq_product_relationship_unique",
        ),
    )
    op.create_index(op.f("ix_product_relationships_product_id"), "product_relationships", ["product_id"], unique=False)
    op.create_index(
        op.f("ix_product_relationships_related_product_id"),
        "product_relationships",
        ["related_product_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_product_relationships_relationship_type"),
        "product_relationships",
        ["relationship_type"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_product_relationships_relationship_type"), table_name="product_relationships")
    op.drop_index(op.f("ix_product_relationships_related_product_id"), table_name="product_relationships")
    op.drop_index(op.f("ix_product_relationships_product_id"), table_name="product_relationships")
    op.drop_table("product_relationships")
