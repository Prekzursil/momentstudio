"""PayPal webhook events

Revision ID: 0063
Revises: 0062
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0063"
down_revision: str | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "paypal_webhook_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("paypal_event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("paypal_event_id", name="uq_paypal_webhook_events_paypal_event_id"),
    )
    op.create_index("ix_paypal_webhook_events_paypal_event_id", "paypal_webhook_events", ["paypal_event_id"])


def downgrade() -> None:
    op.drop_index("ix_paypal_webhook_events_paypal_event_id", table_name="paypal_webhook_events")
    op.drop_table("paypal_webhook_events")

