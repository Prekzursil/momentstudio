"""Admin favorites

Revision ID: 0121
Revises: 0120
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0121"
down_revision: str | None = "0120"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("admin_favorites", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "admin_favorites")

