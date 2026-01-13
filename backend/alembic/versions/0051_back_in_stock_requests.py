"""back in stock requests

Revision ID: 0051
Revises: 0050
Create Date: 2026-01-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0051"
down_revision: str | None = "0050"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "back_in_stock_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_back_in_stock_requests_user_id", "back_in_stock_requests", ["user_id"])
    op.create_index("ix_back_in_stock_requests_product_id", "back_in_stock_requests", ["product_id"])
    op.create_index("ix_back_in_stock_requests_created_at", "back_in_stock_requests", ["created_at"])
    op.create_index("ix_back_in_stock_requests_fulfilled_at", "back_in_stock_requests", ["fulfilled_at"])
    op.create_index("ix_back_in_stock_requests_canceled_at", "back_in_stock_requests", ["canceled_at"])
    op.create_index("ix_back_in_stock_requests_notified_at", "back_in_stock_requests", ["notified_at"])
    op.create_index(
        "uq_back_in_stock_requests_active_user_product",
        "back_in_stock_requests",
        ["user_id", "product_id"],
        unique=True,
        postgresql_where=sa.text("fulfilled_at IS NULL AND canceled_at IS NULL"),
        sqlite_where=sa.text("fulfilled_at IS NULL AND canceled_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_back_in_stock_requests_active_user_product", table_name="back_in_stock_requests")
    op.drop_index("ix_back_in_stock_requests_notified_at", table_name="back_in_stock_requests")
    op.drop_index("ix_back_in_stock_requests_canceled_at", table_name="back_in_stock_requests")
    op.drop_index("ix_back_in_stock_requests_fulfilled_at", table_name="back_in_stock_requests")
    op.drop_index("ix_back_in_stock_requests_created_at", table_name="back_in_stock_requests")
    op.drop_index("ix_back_in_stock_requests_product_id", table_name="back_in_stock_requests")
    op.drop_index("ix_back_in_stock_requests_user_id", table_name="back_in_stock_requests")
    op.drop_table("back_in_stock_requests")

