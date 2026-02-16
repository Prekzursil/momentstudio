"""add media job retry policy overrides table

Revision ID: 0155_media_job_retry_policy_overrides
Revises: 0154_media_job_retry_dead_letter_v2
Create Date: 2026-02-17 02:10:00
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0155_media_job_retry_policy_overrides"
down_revision: str | Sequence[str] | None = "0154_media_job_retry_dead_letter_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


DEFAULT_POLICIES: dict[str, dict[str, object]] = {
    "ingest": {"max_attempts": 5, "schedule": [30, 120, 600, 1800], "jitter_ratio": 0.15, "enabled": True},
    "variant": {"max_attempts": 5, "schedule": [20, 90, 300, 900], "jitter_ratio": 0.20, "enabled": True},
    "edit": {"max_attempts": 5, "schedule": [20, 90, 300, 900], "jitter_ratio": 0.20, "enabled": True},
    "ai_tag": {"max_attempts": 4, "schedule": [60, 300, 900, 1800], "jitter_ratio": 0.20, "enabled": True},
    "duplicate_scan": {"max_attempts": 4, "schedule": [120, 600, 1800], "jitter_ratio": 0.20, "enabled": True},
    "usage_reconcile": {"max_attempts": 3, "schedule": [300, 900, 1800], "jitter_ratio": 0.10, "enabled": True},
}


def _job_type_enum() -> sa.Enum:
    bind = op.get_bind()
    backend = (bind.dialect.name or "").lower()
    if backend == "postgresql":
        return sa.Enum(
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
        "media_job_retry_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", _job_type_enum(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("backoff_schedule_json", sa.Text(), nullable=False, server_default=sa.text("'[30,120,600,1800]'")),
        sa.Column("jitter_ratio", sa.Float(), nullable=False, server_default="0.15"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_type", name="uq_media_job_retry_policies_job_type"),
    )
    op.create_index("ix_media_job_retry_policies_job_type", "media_job_retry_policies", ["job_type"], unique=True)
    op.create_index(
        "ix_media_job_retry_policies_updated_by_user_id",
        "media_job_retry_policies",
        ["updated_by_user_id"],
        unique=False,
    )

    table = sa.table(
        "media_job_retry_policies",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("job_type", sa.String()),
        sa.column("max_attempts", sa.Integer()),
        sa.column("backoff_schedule_json", sa.Text()),
        sa.column("jitter_ratio", sa.Float()),
        sa.column("enabled", sa.Boolean()),
    )
    rows = []
    for job_type, policy in DEFAULT_POLICIES.items():
        rows.append(
            {
                "id": uuid4(),
                "job_type": job_type,
                "max_attempts": int(policy["max_attempts"]),
                "backoff_schedule_json": json.dumps(policy["schedule"], separators=(",", ":")),
                "jitter_ratio": float(policy["jitter_ratio"]),
                "enabled": bool(policy.get("enabled", True)),
            }
        )
    op.bulk_insert(table, rows)


def downgrade() -> None:
    op.drop_index("ix_media_job_retry_policies_updated_by_user_id", table_name="media_job_retry_policies")
    op.drop_index("ix_media_job_retry_policies_job_type", table_name="media_job_retry_policies")
    op.drop_table("media_job_retry_policies")
