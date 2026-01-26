"""support canned responses

Revision ID: 0115
Revises: 0114
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0115"
down_revision: str | None = "0114"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "support_canned_responses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body_en", sa.Text(), nullable=False),
        sa.Column("body_ro", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_support_canned_responses_is_active", "support_canned_responses", ["is_active"])
    op.create_index("ix_support_canned_responses_title", "support_canned_responses", ["title"])


def downgrade() -> None:
    op.drop_index("ix_support_canned_responses_title", table_name="support_canned_responses")
    op.drop_index("ix_support_canned_responses_is_active", table_name="support_canned_responses")
    op.drop_table("support_canned_responses")
