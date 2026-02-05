"""admin dashboard alert thresholds

Revision ID: 0149
Revises: 0148
Create Date: 2026-02-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0149"
down_revision: str | None = "0148"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_dashboard_alert_thresholds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=50), nullable=False, server_default="default"),
        sa.Column("failed_payments_min_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("failed_payments_min_delta_pct", sa.Numeric(8, 2), nullable=True),
        sa.Column("refund_requests_min_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("refund_requests_min_rate_pct", sa.Numeric(8, 2), nullable=True),
        sa.Column("stockouts_min_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("key", name="uq_admin_dashboard_alert_thresholds_key"),
    )
    op.create_index(
        "ix_admin_dashboard_alert_thresholds_key",
        "admin_dashboard_alert_thresholds",
        ["key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_dashboard_alert_thresholds_key", table_name="admin_dashboard_alert_thresholds")
    op.drop_table("admin_dashboard_alert_thresholds")

