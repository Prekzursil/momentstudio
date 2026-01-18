"""contact submission message thread

Revision ID: 0062
Revises: 0061
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "contact_submission_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contact_submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_contact_submission_messages_submission_id", "contact_submission_messages", ["submission_id"])
    op.create_index("ix_contact_submission_messages_created_at", "contact_submission_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_contact_submission_messages_created_at", table_name="contact_submission_messages")
    op.drop_index("ix_contact_submission_messages_submission_id", table_name="contact_submission_messages")
    op.drop_table("contact_submission_messages")

