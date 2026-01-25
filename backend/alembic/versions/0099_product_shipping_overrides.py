"""add product shipping overrides

Revision ID: 0099
Revises: 0098
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0099"
down_revision: str | None = "0098"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("shipping_class", sa.String(length=20), nullable=False, server_default="standard"),
    )
    op.add_column(
        "products",
        sa.Column(
            "shipping_allow_locker",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "shipping_disallowed_couriers",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "shipping_disallowed_couriers")
    op.drop_column("products", "shipping_allow_locker")
    op.drop_column("products", "shipping_class")

