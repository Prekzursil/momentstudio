"""Add Netopia checkout fields to orders.

Revision ID: 0146
Revises: 0145
Create Date: 2026-02-04
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0146"
down_revision: str | None = "0145"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("netopia_ntp_id", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("netopia_payment_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "netopia_payment_url")
    op.drop_column("orders", "netopia_ntp_id")

