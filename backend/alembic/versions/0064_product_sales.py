"""Product sale pricing

Revision ID: 0064
Revises: 0063
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0064"
down_revision: str | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("sale_type", sa.String(length=10), nullable=True))
    op.add_column("products", sa.Column("sale_value", sa.Numeric(10, 2), nullable=True))
    op.add_column("products", sa.Column("sale_price", sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "sale_price")
    op.drop_column("products", "sale_value")
    op.drop_column("products", "sale_type")

