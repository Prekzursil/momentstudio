"""add order tags

Revision ID: 0091
Revises: 0090
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0091"
down_revision: str | None = "0090"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("tag", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_order_tags_order_id"), "order_tags", ["order_id"], unique=False)
    op.create_index(op.f("ix_order_tags_tag"), "order_tags", ["tag"], unique=False)
    op.create_unique_constraint("uq_order_tags_order_id_tag", "order_tags", ["order_id", "tag"])


def downgrade() -> None:
    op.drop_constraint("uq_order_tags_order_id_tag", "order_tags", type_="unique")
    op.drop_index(op.f("ix_order_tags_tag"), table_name="order_tags")
    op.drop_index(op.f("ix_order_tags_order_id"), table_name="order_tags")
    op.drop_table("order_tags")

