"""add refresh session metadata

Revision ID: 0080
Revises: 0079
Create Date: 2026-01-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0080"
down_revision: str | None = "0079"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("refresh_sessions", sa.Column("user_agent", sa.String(length=255), nullable=True))
    op.add_column("refresh_sessions", sa.Column("ip_address", sa.String(length=45), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_sessions", "ip_address")
    op.drop_column("refresh_sessions", "user_agent")

