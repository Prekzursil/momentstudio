"""Webhook monitoring fields

Revision ID: 0118
Revises: 0117
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0118"
down_revision: str | None = "0117"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stripe_webhook_events",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column(
        "stripe_webhook_events",
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("stripe_webhook_events", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("stripe_webhook_events", sa.Column("last_error", sa.Text(), nullable=True))
    op.add_column("stripe_webhook_events", sa.Column("payload", sa.JSON(), nullable=True))
    op.create_index("ix_stripe_webhook_events_last_attempt_at", "stripe_webhook_events", ["last_attempt_at"])
    op.create_index("ix_stripe_webhook_events_processed_at", "stripe_webhook_events", ["processed_at"])

    op.add_column(
        "paypal_webhook_events",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column(
        "paypal_webhook_events",
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("paypal_webhook_events", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("paypal_webhook_events", sa.Column("last_error", sa.Text(), nullable=True))
    op.add_column("paypal_webhook_events", sa.Column("payload", sa.JSON(), nullable=True))
    op.create_index("ix_paypal_webhook_events_last_attempt_at", "paypal_webhook_events", ["last_attempt_at"])
    op.create_index("ix_paypal_webhook_events_processed_at", "paypal_webhook_events", ["processed_at"])


def downgrade() -> None:
    op.drop_index("ix_paypal_webhook_events_processed_at", table_name="paypal_webhook_events")
    op.drop_index("ix_paypal_webhook_events_last_attempt_at", table_name="paypal_webhook_events")
    op.drop_column("paypal_webhook_events", "payload")
    op.drop_column("paypal_webhook_events", "last_error")
    op.drop_column("paypal_webhook_events", "processed_at")
    op.drop_column("paypal_webhook_events", "last_attempt_at")
    op.drop_column("paypal_webhook_events", "attempts")

    op.drop_index("ix_stripe_webhook_events_processed_at", table_name="stripe_webhook_events")
    op.drop_index("ix_stripe_webhook_events_last_attempt_at", table_name="stripe_webhook_events")
    op.drop_column("stripe_webhook_events", "payload")
    op.drop_column("stripe_webhook_events", "last_error")
    op.drop_column("stripe_webhook_events", "processed_at")
    op.drop_column("stripe_webhook_events", "last_attempt_at")
    op.drop_column("stripe_webhook_events", "attempts")

