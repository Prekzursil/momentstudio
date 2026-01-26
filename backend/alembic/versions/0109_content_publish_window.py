"""add content publish window fields

Revision ID: 0109
Revises: 0108
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0109"
down_revision: str | None = "0108"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("content_blocks", sa.Column("published_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("content_block_versions", sa.Column("published_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("content_block_versions", "published_until")
    op.drop_column("content_blocks", "published_until")

