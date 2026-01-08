"""fx rates snapshot and override

Revision ID: 0038
Revises: 0037
Create Date: 2026-01-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fx_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("base", sa.String(length=3), nullable=False, server_default="RON"),
        sa.Column("eur_per_ron", sa.Numeric(12, 8), nullable=False),
        sa.Column("usd_per_ron", sa.Numeric(12, 8), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_override", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("is_override", name="uq_fx_rates_is_override"),
    )

    op.create_index("ix_fx_rates_is_override", "fx_rates", ["is_override"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_fx_rates_is_override", table_name="fx_rates")
    op.drop_table("fx_rates")

