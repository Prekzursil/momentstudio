"""add cart item note and cleanup job fields

Revision ID: 0014
Revises: 0013
Create Date: 2024-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cart_items", sa.Column("note", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("cart_items", "note")
