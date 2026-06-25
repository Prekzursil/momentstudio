"""add shipping, preorder, and seo meta fields

Revision ID: 0011
Revises: 0010
Create Date: 2024-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "allow_backorder", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "products", sa.Column("restock_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("products", sa.Column("weight_grams", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("width_cm", sa.Numeric(7, 2), nullable=True))
    op.add_column("products", sa.Column("height_cm", sa.Numeric(7, 2), nullable=True))
    op.add_column("products", sa.Column("depth_cm", sa.Numeric(7, 2), nullable=True))
    op.add_column(
        "products", sa.Column("meta_title", sa.String(length=180), nullable=True)
    )
    op.add_column(
        "products", sa.Column("meta_description", sa.String(length=300), nullable=True)
    )
    op.alter_column("products", "allow_backorder", server_default=None)


def downgrade() -> None:
    op.drop_column("products", "meta_description")
    op.drop_column("products", "meta_title")
    op.drop_column("products", "depth_cm")
    op.drop_column("products", "height_cm")
    op.drop_column("products", "width_cm")
    op.drop_column("products", "weight_grams")
    op.drop_column("products", "restock_at")
    op.drop_column("products", "allow_backorder")
