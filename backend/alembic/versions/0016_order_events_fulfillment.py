"""order events, fulfillment, and retry/refund stubs

Revision ID: 0016
Revises: 0015
Create Date: 2024-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("shipped_quantity", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("order_items", "shipped_quantity", server_default=None)
    op.add_column("orders", sa.Column("payment_retry_count", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("orders", "payment_retry_count", server_default=None)

    op.create_table(
        "order_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("event", sa.String(length=50), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("order_events")
    op.drop_column("orders", "payment_retry_count")
    op.drop_column("order_items", "shipped_quantity")
