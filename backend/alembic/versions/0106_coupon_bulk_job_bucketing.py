"""add coupon bulk job bucketing fields

Revision ID: 0106
Revises: 0105
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0106"
down_revision: str | None = "0105"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("coupon_bulk_jobs", sa.Column("bucket_total", sa.Integer(), nullable=True))
    op.add_column("coupon_bulk_jobs", sa.Column("bucket_index", sa.Integer(), nullable=True))
    op.add_column("coupon_bulk_jobs", sa.Column("bucket_seed", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("coupon_bulk_jobs", "bucket_seed")
    op.drop_column("coupon_bulk_jobs", "bucket_index")
    op.drop_column("coupon_bulk_jobs", "bucket_total")

