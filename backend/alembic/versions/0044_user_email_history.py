"""add user email history

Revision ID: 0044
Revises: 0043
Create Date: 2026-01-09
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_email_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_email_history_user_id", "user_email_history", ["user_id"])

    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id, email FROM users")).fetchall()
    if not users:
        return

    now = datetime.now(timezone.utc)
    rows = [{"id": uuid.uuid4(), "user_id": row[0], "email": row[1], "created_at": now} for row in users]
    email_history = sa.table(
        "user_email_history",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("user_id", postgresql.UUID(as_uuid=True)),
        sa.column("email", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(email_history, rows)


def downgrade() -> None:
    op.drop_index("ix_user_email_history_user_id", table_name="user_email_history")
    op.drop_table("user_email_history")

