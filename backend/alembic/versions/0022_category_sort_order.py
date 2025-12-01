"""add category sort order

Revision ID: 0022_category_sort_order
Revises: 0021_user_avatar
Create Date: 2025-12-01 02:15:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0022_category_sort_order"
down_revision = "0021_user_avatar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("categories", "sort_order", server_default=None)


def downgrade() -> None:
    op.drop_column("categories", "sort_order")
