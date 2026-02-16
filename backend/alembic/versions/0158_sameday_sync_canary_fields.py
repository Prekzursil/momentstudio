"""add sameday sync canary telemetry fields

Revision ID: 0158_sameday_sync_canary_fields
Revises: 0157_media_retry_policy_history_events
Create Date: 2026-02-18 18:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0158_sameday_sync_canary_fields"
down_revision: str | Sequence[str] | None = "0157_media_retry_policy_history_events"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("normalized_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("normalization_ratio", sa.Float(), nullable=True),
    )
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("schema_signature", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("schema_drift_detected", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("failure_kind", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "shipping_locker_sync_runs",
        sa.Column("challenge_failure", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_index(
        "ix_shipping_locker_sync_runs_schema_drift_detected",
        "shipping_locker_sync_runs",
        ["schema_drift_detected"],
        unique=False,
    )
    op.create_index(
        "ix_shipping_locker_sync_runs_failure_kind",
        "shipping_locker_sync_runs",
        ["failure_kind"],
        unique=False,
    )
    op.create_index(
        "ix_shipping_locker_sync_runs_challenge_failure",
        "shipping_locker_sync_runs",
        ["challenge_failure"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_shipping_locker_sync_runs_challenge_failure", table_name="shipping_locker_sync_runs")
    op.drop_index("ix_shipping_locker_sync_runs_failure_kind", table_name="shipping_locker_sync_runs")
    op.drop_index("ix_shipping_locker_sync_runs_schema_drift_detected", table_name="shipping_locker_sync_runs")

    op.drop_column("shipping_locker_sync_runs", "challenge_failure")
    op.drop_column("shipping_locker_sync_runs", "failure_kind")
    op.drop_column("shipping_locker_sync_runs", "schema_drift_detected")
    op.drop_column("shipping_locker_sync_runs", "schema_signature")
    op.drop_column("shipping_locker_sync_runs", "normalization_ratio")
    op.drop_column("shipping_locker_sync_runs", "normalized_count")
    op.drop_column("shipping_locker_sync_runs", "candidate_count")
