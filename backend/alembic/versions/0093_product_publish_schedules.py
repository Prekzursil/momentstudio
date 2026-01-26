"""add product publish schedules

Revision ID: 0093
Revises: 0092
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0093"
down_revision: str | None = "0092"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("publish_scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.add_column("products", sa.Column("unpublish_scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_products_publish_scheduled_for"), "products", ["publish_scheduled_for"], unique=False)
    op.create_index(op.f("ix_products_unpublish_scheduled_for"), "products", ["unpublish_scheduled_for"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_products_unpublish_scheduled_for"), table_name="products")
    op.drop_index(op.f("ix_products_publish_scheduled_for"), table_name="products")
    op.drop_column("products", "unpublish_scheduled_for")
    op.drop_column("products", "publish_scheduled_for")

