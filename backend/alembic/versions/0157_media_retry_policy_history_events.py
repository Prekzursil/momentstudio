"""add media retry policy history events

Revision ID: 0157_media_retry_policy_history_events
Revises: 0156_sameday_easybox_mirror
Create Date: 2026-02-18 12:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0157_media_retry_policy_history_events"
down_revision: str | Sequence[str] | None = "0156_sameday_easybox_mirror"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _job_type_enum() -> sa.Enum:
    bind = op.get_bind()
    backend = (bind.dialect.name or "").lower()
    if backend == "postgresql":
        return postgresql.ENUM(
            "ingest",
            "variant",
            "edit",
            "ai_tag",
            "duplicate_scan",
            "usage_reconcile",
            name="mediajobtype",
            create_type=False,
        )
    return sa.Enum(
        "ingest",
        "variant",
        "edit",
        "ai_tag",
        "duplicate_scan",
        "usage_reconcile",
        name="mediajobtype",
        native_enum=False,
    )


def upgrade() -> None:
    op.create_table(
        "media_job_retry_policy_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", _job_type_enum(), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("preset_key", sa.String(length=32), nullable=True),
        sa.Column("before_policy_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("after_policy_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_media_job_retry_policy_events_job_type",
        "media_job_retry_policy_events",
        ["job_type"],
        unique=False,
    )
    op.create_index(
        "ix_media_job_retry_policy_events_action",
        "media_job_retry_policy_events",
        ["action"],
        unique=False,
    )
    op.create_index(
        "ix_media_job_retry_policy_events_actor_user_id",
        "media_job_retry_policy_events",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_media_job_retry_policy_events_created_at",
        "media_job_retry_policy_events",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_media_job_retry_policy_events_job_type_created_at",
        "media_job_retry_policy_events",
        ["job_type", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_media_job_retry_policy_events_job_type_created_at",
        table_name="media_job_retry_policy_events",
    )
    op.drop_index("ix_media_job_retry_policy_events_created_at", table_name="media_job_retry_policy_events")
    op.drop_index("ix_media_job_retry_policy_events_actor_user_id", table_name="media_job_retry_policy_events")
    op.drop_index("ix_media_job_retry_policy_events_action", table_name="media_job_retry_policy_events")
    op.drop_index("ix_media_job_retry_policy_events_job_type", table_name="media_job_retry_policy_events")
    op.drop_table("media_job_retry_policy_events")
