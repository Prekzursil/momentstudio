"""add user vip flag and admin notes

Revision ID: 0101
Revises: 0100
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0101"
down_revision: str | None = "0100"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "vip",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("users", sa.Column("admin_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "admin_note")
    op.drop_column("users", "vip")
