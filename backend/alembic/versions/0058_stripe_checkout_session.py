"""Add Stripe Checkout session id to orders.

Revision ID: 0058
Revises: 0057
Create Date: 2026-01-16
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("stripe_checkout_session_id", sa.String(length=255), nullable=True))
    op.create_index(
        "ix_orders_stripe_checkout_session_id",
        "orders",
        ["stripe_checkout_session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_orders_stripe_checkout_session_id", table_name="orders")
    op.drop_column("orders", "stripe_checkout_session_id")

