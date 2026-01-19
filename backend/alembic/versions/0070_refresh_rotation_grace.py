"""refresh rotation grace fields

Revision ID: 0070
Revises: 0069
Create Date: 2026-01-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0070"
down_revision: str | None = "0069"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("refresh_sessions", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("refresh_sessions", sa.Column("replaced_by_jti", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_sessions", "replaced_by_jti")
    op.drop_column("refresh_sessions", "rotated_at")

