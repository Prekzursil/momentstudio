"""add promo_codes active flag

Revision ID: 0069
Revises: 0068
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0069"
down_revision: str | None = "0068"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("promo_codes", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.alter_column("promo_codes", "active", server_default=None)


def downgrade() -> None:
    op.drop_column("promo_codes", "active")

