"""Add receipt token versioning to orders.

Revision ID: 0061
Revises: 0060
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("receipt_token_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("orders", "receipt_token_version", server_default=None)


def downgrade() -> None:
    op.drop_column("orders", "receipt_token_version")

