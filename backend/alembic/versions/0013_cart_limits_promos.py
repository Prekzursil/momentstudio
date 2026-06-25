"""add cart limits and promo codes

Revision ID: 0013
Revises: 0012
Create Date: 2024-10-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cart_items", sa.Column("max_quantity", sa.Integer(), nullable=True))
    op.create_table(
        "promo_codes",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("code", sa.String(length=40), nullable=False, unique=True),
        sa.Column("percentage_off", sa.Numeric(5, 2), nullable=True),
        sa.Column("amount_off", sa.Numeric(10, 2), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("times_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.alter_column("promo_codes", "times_used", server_default=None)


def downgrade() -> None:
    op.drop_table("promo_codes")
    op.drop_column("cart_items", "max_quantity")
