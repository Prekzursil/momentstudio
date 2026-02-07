"""remove cart item note

Revision ID: 0150
Revises: 0149
Create Date: 2026-02-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0150"
down_revision: str | None = "0149"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("cart_items", "note")


def downgrade() -> None:
    op.add_column("cart_items", sa.Column("note", sa.String(length=255), nullable=True))

