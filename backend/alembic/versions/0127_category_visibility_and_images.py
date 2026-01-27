"""Category visibility and images

Revision ID: 0127
Revises: 0126
Create Date: 2026-01-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0127"
down_revision: str | None = "0126"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("categories", sa.Column("thumbnail_url", sa.String(length=500), nullable=True))
    op.add_column("categories", sa.Column("banner_url", sa.String(length=500), nullable=True))
    op.alter_column("categories", "is_visible", server_default=None)


def downgrade() -> None:
    op.drop_column("categories", "banner_url")
    op.drop_column("categories", "thumbnail_url")
    op.drop_column("categories", "is_visible")

