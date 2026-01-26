"""add order shipments

Revision ID: 0092
Revises: 0091
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0092"
down_revision: str | None = "0091"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_shipments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("courier", sa.String(length=30), nullable=True),
        sa.Column("tracking_number", sa.String(length=50), nullable=False),
        sa.Column("tracking_url", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_order_shipments_order_id"), "order_shipments", ["order_id"], unique=False)
    op.create_unique_constraint("uq_order_shipments_order_id_tracking_number", "order_shipments", ["order_id", "tracking_number"])


def downgrade() -> None:
    op.drop_constraint("uq_order_shipments_order_id_tracking_number", "order_shipments", type_="unique")
    op.drop_index(op.f("ix_order_shipments_order_id"), table_name="order_shipments")
    op.drop_table("order_shipments")

