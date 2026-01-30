"""Product sort order

Revision ID: 0128
Revises: 0127
Create Date: 2026-01-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0128"
down_revision: str | None = "0127"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("products", "sort_order", server_default=None)


def downgrade() -> None:
    op.drop_column("products", "sort_order")

