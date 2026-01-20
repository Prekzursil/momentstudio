"""add user security events

Revision ID: 0081
Revises: 0080
Create Date: 2026-01-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0081"
down_revision: str | None = "0080"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_security_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_user_security_events_user_id", "user_security_events", ["user_id"])
    op.create_index("ix_user_security_events_event_type", "user_security_events", ["event_type"])
    op.create_index("ix_user_security_events_created_at", "user_security_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_user_security_events_created_at", table_name="user_security_events")
    op.drop_index("ix_user_security_events_event_type", table_name="user_security_events")
    op.drop_index("ix_user_security_events_user_id", table_name="user_security_events")
    op.drop_table("user_security_events")

