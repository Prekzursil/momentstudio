"""add refresh session country code

Revision ID: 0104
Revises: 0103
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0104"
down_revision: str | None = "0103"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("refresh_sessions", sa.Column("country_code", sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_sessions", "country_code")

