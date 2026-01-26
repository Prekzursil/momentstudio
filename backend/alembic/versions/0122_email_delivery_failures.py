"""email delivery failures

Revision ID: 0122
Revises: 0121
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0122"
down_revision: str | None = "0121"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_delivery_failures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("to_email", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_email_delivery_failures_to_email", "email_delivery_failures", ["to_email"])
    op.create_index("ix_email_delivery_failures_created_at", "email_delivery_failures", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_email_delivery_failures_created_at", table_name="email_delivery_failures")
    op.drop_index("ix_email_delivery_failures_to_email", table_name="email_delivery_failures")
    op.drop_table("email_delivery_failures")

