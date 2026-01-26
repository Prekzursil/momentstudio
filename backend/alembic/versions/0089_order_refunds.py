"""order refunds

Revision ID: 0089
Revises: 0088
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0089"
down_revision: str | None = "0088"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_refunds",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "order_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="RON"),
        sa.Column("provider", sa.String(length=20), nullable=False, server_default="manual"),
        sa.Column("provider_refund_id", sa.String(length=255), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_order_refunds_order_id", "order_refunds", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_order_refunds_order_id", table_name="order_refunds")
    op.drop_table("order_refunds")

