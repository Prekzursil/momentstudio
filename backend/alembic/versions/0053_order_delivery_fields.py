"""Add courier and locker delivery fields to orders.

Revision ID: 0053
Revises: 0052
Create Date: 2026-01-15
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0053"
down_revision: str | None = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("courier", sa.String(length=30), nullable=True))
    op.add_column("orders", sa.Column("delivery_type", sa.String(length=20), nullable=True))
    op.add_column("orders", sa.Column("locker_id", sa.String(length=80), nullable=True))
    op.add_column("orders", sa.Column("locker_name", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("locker_address", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("locker_lat", sa.Numeric(9, 6), nullable=True))
    op.add_column("orders", sa.Column("locker_lng", sa.Numeric(9, 6), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "locker_lng")
    op.drop_column("orders", "locker_lat")
    op.drop_column("orders", "locker_address")
    op.drop_column("orders", "locker_name")
    op.drop_column("orders", "locker_id")
    op.drop_column("orders", "delivery_type")
    op.drop_column("orders", "courier")

