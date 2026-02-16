"""media job retries, dead-letter triage, and job event/tag tables

Revision ID: 0154_media_job_retry_dead_letter_v2
Revises: 0153_add_media_usage_reconcile_job_type
Create Date: 2026-02-16 22:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0154_media_job_retry_dead_letter_v2"
down_revision: str | Sequence[str] | None = "0153_add_media_usage_reconcile_job_type"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    backend = (bind.dialect.name or "").lower()

    if backend == "postgresql":
        op.execute("ALTER TYPE mediajobstatus ADD VALUE IF NOT EXISTS 'dead_letter'")

    op.add_column("media_jobs", sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"))
    op.add_column("media_jobs", sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("media_jobs", sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("media_jobs", sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("media_jobs", sa.Column("triage_state", sa.String(length=32), nullable=False, server_default="open"))
    op.add_column(
        "media_jobs",
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("media_jobs", sa.Column("sla_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("media_jobs", sa.Column("incident_url", sa.String(length=512), nullable=True))

    op.create_foreign_key(
        "fk_media_jobs_assigned_to_user_id_users",
        "media_jobs",
        "users",
        ["assigned_to_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_media_jobs_next_retry_at", "media_jobs", ["next_retry_at"], unique=False)
    op.create_index("ix_media_jobs_dead_lettered_at", "media_jobs", ["dead_lettered_at"], unique=False)
    op.create_index("ix_media_jobs_triage_state", "media_jobs", ["triage_state"], unique=False)
    op.create_index("ix_media_jobs_assigned_to_user_id", "media_jobs", ["assigned_to_user_id"], unique=False)
    op.create_index("ix_media_jobs_sla_due_at", "media_jobs", ["sla_due_at"], unique=False)

    op.create_table(
        "media_job_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("meta_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["media_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_media_job_events_job_id", "media_job_events", ["job_id"], unique=False)
    op.create_index("ix_media_job_events_actor_user_id", "media_job_events", ["actor_user_id"], unique=False)
    op.create_index("ix_media_job_events_action", "media_job_events", ["action"], unique=False)

    op.create_table(
        "media_job_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("value"),
    )
    op.create_index("ix_media_job_tags_value", "media_job_tags", ["value"], unique=True)

    op.create_table(
        "media_job_tag_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["media_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["media_job_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "tag_id", name="uq_media_job_tag_links_job_tag"),
    )
    op.create_index("ix_media_job_tag_links_job_id", "media_job_tag_links", ["job_id"], unique=False)
    op.create_index("ix_media_job_tag_links_tag_id", "media_job_tag_links", ["tag_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_media_job_tag_links_tag_id", table_name="media_job_tag_links")
    op.drop_index("ix_media_job_tag_links_job_id", table_name="media_job_tag_links")
    op.drop_table("media_job_tag_links")

    op.drop_index("ix_media_job_tags_value", table_name="media_job_tags")
    op.drop_table("media_job_tags")

    op.drop_index("ix_media_job_events_action", table_name="media_job_events")
    op.drop_index("ix_media_job_events_actor_user_id", table_name="media_job_events")
    op.drop_index("ix_media_job_events_job_id", table_name="media_job_events")
    op.drop_table("media_job_events")

    op.drop_index("ix_media_jobs_sla_due_at", table_name="media_jobs")
    op.drop_index("ix_media_jobs_assigned_to_user_id", table_name="media_jobs")
    op.drop_index("ix_media_jobs_triage_state", table_name="media_jobs")
    op.drop_index("ix_media_jobs_dead_lettered_at", table_name="media_jobs")
    op.drop_index("ix_media_jobs_next_retry_at", table_name="media_jobs")
    op.drop_constraint("fk_media_jobs_assigned_to_user_id_users", "media_jobs", type_="foreignkey")

    op.drop_column("media_jobs", "incident_url")
    op.drop_column("media_jobs", "sla_due_at")
    op.drop_column("media_jobs", "assigned_to_user_id")
    op.drop_column("media_jobs", "triage_state")
    op.drop_column("media_jobs", "dead_lettered_at")
    op.drop_column("media_jobs", "last_error_at")
    op.drop_column("media_jobs", "next_retry_at")
    op.drop_column("media_jobs", "max_attempts")

    # Postgres enum value removals are not safely reversible in-place.
    # We intentionally keep `dead_letter` in `mediajobstatus` after downgrade.
    return

