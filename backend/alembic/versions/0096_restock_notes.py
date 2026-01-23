"""add restock notes table

Revision ID: 0096
Revises: 0095
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0096"
down_revision: str | None = "0095"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "restock_notes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("target_key", sa.String(length=100), nullable=False),
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
        sa.Column("supplier", sa.String(length=200), nullable=True),
        sa.Column("desired_quantity", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("target_key", name="uq_restock_notes_target_key"),
    )
    op.create_index(op.f("ix_restock_notes_target_key"), "restock_notes", ["target_key"], unique=False)
    op.create_index(op.f("ix_restock_notes_product_id"), "restock_notes", ["product_id"], unique=False)
    op.create_index(op.f("ix_restock_notes_variant_id"), "restock_notes", ["variant_id"], unique=False)
    op.create_index(op.f("ix_restock_notes_actor_user_id"), "restock_notes", ["actor_user_id"], unique=False)
    op.create_index(op.f("ix_restock_notes_updated_at"), "restock_notes", ["updated_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_restock_notes_updated_at"), table_name="restock_notes")
    op.drop_index(op.f("ix_restock_notes_actor_user_id"), table_name="restock_notes")
    op.drop_index(op.f("ix_restock_notes_variant_id"), table_name="restock_notes")
    op.drop_index(op.f("ix_restock_notes_product_id"), table_name="restock_notes")
    op.drop_index(op.f("ix_restock_notes_target_key"), table_name="restock_notes")
    op.drop_table("restock_notes")

