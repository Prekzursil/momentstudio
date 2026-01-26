"""add stock adjustments ledger

Revision ID: 0095
Revises: 0094
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0095"
down_revision: str | None = "0094"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    reason = sa.Enum(
        "restock",
        "damage",
        "manual_correction",
        name="stockadjustmentreason",
        native_enum=False,
    )

    op.create_table(
        "stock_adjustments",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "product_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "variant_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("product_variants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reason", reason, nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("before_quantity", sa.Integer(), nullable=False),
        sa.Column("after_quantity", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_stock_adjustments_product_id"), "stock_adjustments", ["product_id"], unique=False)
    op.create_index(op.f("ix_stock_adjustments_variant_id"), "stock_adjustments", ["variant_id"], unique=False)
    op.create_index(op.f("ix_stock_adjustments_actor_user_id"), "stock_adjustments", ["actor_user_id"], unique=False)
    op.create_index(op.f("ix_stock_adjustments_created_at"), "stock_adjustments", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_stock_adjustments_created_at"), table_name="stock_adjustments")
    op.drop_index(op.f("ix_stock_adjustments_actor_user_id"), table_name="stock_adjustments")
    op.drop_index(op.f("ix_stock_adjustments_variant_id"), table_name="stock_adjustments")
    op.drop_index(op.f("ix_stock_adjustments_product_id"), table_name="stock_adjustments")
    op.drop_table("stock_adjustments")

