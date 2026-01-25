"""add content image focal point

Revision ID: 0111
Revises: 0110
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0111"
down_revision: str | None = "0110"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "content_images",
        sa.Column("focal_x", sa.Integer(), server_default="50", nullable=False),
    )
    op.add_column(
        "content_images",
        sa.Column("focal_y", sa.Integer(), server_default="50", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("content_images", "focal_y")
    op.drop_column("content_images", "focal_x")

