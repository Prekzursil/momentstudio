"""add phone to addresses

Revision ID: 0086
Revises: 0085
Create Date: 2026-01-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0086"
down_revision: str | None = "0085"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("addresses", sa.Column("phone", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("addresses", "phone")

