"""Sale scheduling

Revision ID: 0067
Revises: 0066
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("sale_start_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("products", sa.Column("sale_end_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "products",
        sa.Column("sale_auto_publish", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_index("ix_products_sale_start_at", "products", ["sale_start_at"])
    op.create_index("ix_products_sale_end_at", "products", ["sale_end_at"])
    op.create_index("ix_products_sale_auto_publish", "products", ["sale_auto_publish"])


def downgrade() -> None:
    op.drop_index("ix_products_sale_auto_publish", table_name="products")
    op.drop_index("ix_products_sale_end_at", table_name="products")
    op.drop_index("ix_products_sale_start_at", table_name="products")

    op.drop_column("products", "sale_auto_publish")
    op.drop_column("products", "sale_end_at")
    op.drop_column("products", "sale_start_at")

