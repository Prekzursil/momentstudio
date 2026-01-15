"""Add payment_method to orders.

Revision ID: 0052
Revises: 0051
Create Date: 2026-01-13
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0052"
down_revision: str | None = "0051"
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
