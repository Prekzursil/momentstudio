"""email delivery events

Revision ID: 0124
Revises: 0123
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0124"
down_revision: str | None = "0123"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_delivery_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("to_email", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_email_delivery_events_to_email", "email_delivery_events", ["to_email"])
    op.create_index("ix_email_delivery_events_created_at", "email_delivery_events", ["created_at"])
    op.create_index("ix_email_delivery_events_status", "email_delivery_events", ["status"])

    op.execute(
        """
        INSERT INTO email_delivery_events (id, to_email, subject, status, error_message, created_at)
        SELECT id, to_email, subject, 'failed', error_message, created_at
        FROM email_delivery_failures
        """
    )


def downgrade() -> None:
    op.drop_index("ix_email_delivery_events_status", table_name="email_delivery_events")
    op.drop_index("ix_email_delivery_events_created_at", table_name="email_delivery_events")
    op.drop_index("ix_email_delivery_events_to_email", table_name="email_delivery_events")
    op.drop_table("email_delivery_events")
