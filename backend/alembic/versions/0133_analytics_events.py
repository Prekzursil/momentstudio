"""Analytics events

Revision ID: 0133
Revises: 0132
Create Date: 2026-01-30
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0133"
down_revision: str | None = "0132"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analytics_events",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_id", sa.String(length=100), nullable=False),
        sa.Column("event", sa.String(length=80), nullable=False),
        sa.Column("path", sa.String(length=500), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "order_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_index(op.f("ix_analytics_events_session_id"), "analytics_events", ["session_id"], unique=False)
    op.create_index(op.f("ix_analytics_events_event"), "analytics_events", ["event"], unique=False)
    op.create_index(op.f("ix_analytics_events_user_id"), "analytics_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_analytics_events_order_id"), "analytics_events", ["order_id"], unique=False)
    op.create_index(op.f("ix_analytics_events_created_at"), "analytics_events", ["created_at"], unique=False)
    op.create_index(
        op.f("ix_analytics_events_event_created_at"),
        "analytics_events",
        ["event", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_analytics_events_event_created_at"), table_name="analytics_events")
    op.drop_index(op.f("ix_analytics_events_created_at"), table_name="analytics_events")
    op.drop_index(op.f("ix_analytics_events_order_id"), table_name="analytics_events")
    op.drop_index(op.f("ix_analytics_events_user_id"), table_name="analytics_events")
    op.drop_index(op.f("ix_analytics_events_event"), table_name="analytics_events")
    op.drop_index(op.f("ix_analytics_events_session_id"), table_name="analytics_events")
    op.drop_table("analytics_events")

