"""add two-factor auth fields

Revision ID: 0082
Revises: 0081
Create Date: 2026-01-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0082"
down_revision: str | None = "0081"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("two_factor_totp_secret", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("two_factor_recovery_codes", sa.JSON(), nullable=True))
    op.add_column("users", sa.Column("two_factor_confirmed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "two_factor_confirmed_at")
    op.drop_column("users", "two_factor_recovery_codes")
    op.drop_column("users", "two_factor_totp_secret")
    op.drop_column("users", "two_factor_enabled")

