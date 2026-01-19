"""order promo code

Revision ID: 0071
Revises: 0070
Create Date: 2026-01-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0071"
down_revision: str | None = "0070"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("promo_code", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "promo_code")

