"""add content translation workflow flags

Revision ID: 0112
Revises: 0111
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0112"
down_revision: str | None = "0111"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "content_blocks",
        sa.Column("needs_translation_en", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "content_blocks",
        sa.Column("needs_translation_ro", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("content_blocks", "needs_translation_ro")
    op.drop_column("content_blocks", "needs_translation_en")

