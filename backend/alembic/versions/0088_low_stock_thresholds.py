"""add low stock threshold overrides

Revision ID: 0088
Revises: 0087
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0088"
down_revision: str | None = "0087"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("low_stock_threshold", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("low_stock_threshold", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "low_stock_threshold")
    op.drop_column("categories", "low_stock_threshold")

