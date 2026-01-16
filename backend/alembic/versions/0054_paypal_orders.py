"""Add PayPal order fields to orders.

Revision ID: 0054
Revises: 0053
Create Date: 2026-01-15
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0054"
down_revision: str | None = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("paypal_order_id", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("paypal_capture_id", sa.String(length=255), nullable=True))
    op.create_index("ix_orders_paypal_order_id", "orders", ["paypal_order_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_orders_paypal_order_id", table_name="orders")
    op.drop_column("orders", "paypal_capture_id")
    op.drop_column("orders", "paypal_order_id")

