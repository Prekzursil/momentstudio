"""Add fee_amount to orders.

Revision ID: 0060
Revises: 0059
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0060"
down_revision: str | None = "0059"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("fee_amount", sa.Numeric(10, 2), nullable=False, server_default="0"))
    op.alter_column("orders", "fee_amount", server_default=None)


def downgrade() -> None:
    op.drop_column("orders", "fee_amount")

