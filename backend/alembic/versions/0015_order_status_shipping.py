"""add order reference code and shipping methods

Revision ID: 0015
Revises: 0014
Create Date: 2024-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shipping_methods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("rate_flat", sa.Numeric(10, 2), nullable=True),
        sa.Column("rate_per_kg", sa.Numeric(10, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.add_column("orders", sa.Column("reference_code", sa.String(length=20), nullable=True, unique=True))
    op.add_column("orders", sa.Column("shipping_method_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shipping_methods.id"), nullable=True))
    op.add_column("orders", sa.Column("tracking_number", sa.String(length=50), nullable=True))
    op.add_column("orders", sa.Column("tax_amount", sa.Numeric(10, 2), nullable=False, server_default="0"))
    op.add_column("orders", sa.Column("shipping_amount", sa.Numeric(10, 2), nullable=False, server_default="0"))
    if "status" in {col["name"] for col in sa.inspect(op.get_bind()).get_columns("orders")}:
        op.alter_column("orders", "status", server_default=None)
    op.alter_column("orders", "tax_amount", server_default=None)
    op.alter_column("orders", "shipping_amount", server_default=None)


def downgrade() -> None:
    op.drop_column("orders", "shipping_amount")
    op.drop_column("orders", "tax_amount")
    op.drop_column("orders", "tracking_number")
    op.drop_column("orders", "shipping_method_id")
    op.drop_column("orders", "reference_code")
    if "status" in {col["name"] for col in sa.inspect(op.get_bind()).get_columns("orders")}:
        op.alter_column("orders", "status", server_default="pending")
    op.drop_table("shipping_methods")
