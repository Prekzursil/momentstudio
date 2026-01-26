"""support ticket assignment fields

Revision ID: 0114
Revises: 0113
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0114"
down_revision: str | None = "0113"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "contact_submissions",
        sa.Column(
            "assignee_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "contact_submissions",
        sa.Column(
            "assigned_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "contact_submissions",
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.create_index("ix_contact_submissions_assignee_user_id", "contact_submissions", ["assignee_user_id"])
    op.create_index("ix_contact_submissions_assigned_by_user_id", "contact_submissions", ["assigned_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_contact_submissions_assigned_by_user_id", table_name="contact_submissions")
    op.drop_index("ix_contact_submissions_assignee_user_id", table_name="contact_submissions")
    op.drop_column("contact_submissions", "assigned_at")
    op.drop_column("contact_submissions", "assigned_by_user_id")
    op.drop_column("contact_submissions", "assignee_user_id")
