"""Blog post view count

Revision ID: 0129
Revises: 0128
Create Date: 2026-01-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0129"
down_revision: str | None = "0128"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("content_blocks", sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("content_blocks", "view_count", server_default=None)


def downgrade() -> None:
    op.drop_column("content_blocks", "view_count")

