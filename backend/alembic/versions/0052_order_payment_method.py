"""Add payment_method to orders.

Revision ID: 0052_order_payment_method
Revises: 0051_back_in_stock_requests
Create Date: 2026-01-13
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0052_order_payment_method"
down_revision = "0051_back_in_stock_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("payment_method", sa.String(length=20), nullable=False, server_default="stripe"),
    )
    op.execute("UPDATE orders SET payment_method='stripe' WHERE payment_method IS NULL OR payment_method=''")
    op.alter_column("orders", "payment_method", server_default=None)


def downgrade() -> None:
    op.drop_column("orders", "payment_method")

