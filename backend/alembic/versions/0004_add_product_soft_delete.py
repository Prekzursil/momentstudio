"""add product soft delete

Revision ID: 0004
Revises: 0003
Create Date: 2024-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("products", "is_deleted", server_default=None)


def downgrade() -> None:
    op.drop_column("products", "is_deleted")
