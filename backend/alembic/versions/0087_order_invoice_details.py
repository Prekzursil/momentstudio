"""add invoice details to orders

Revision ID: 0087
Revises: 0086
Create Date: 2026-01-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0087"
down_revision: str | None = "0086"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("invoice_company", sa.String(length=200), nullable=True))
    op.add_column("orders", sa.Column("invoice_vat_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "invoice_vat_id")
    op.drop_column("orders", "invoice_company")

