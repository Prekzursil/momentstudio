"""Secondary emails

Revision ID: 0066
Revises: 0065
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0066"
down_revision: str | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_secondary_emails",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email", name="uq_user_secondary_emails_email"),
    )
    op.create_index("ix_user_secondary_emails_user_id", "user_secondary_emails", ["user_id"])
    op.create_index("ix_user_secondary_emails_email", "user_secondary_emails", ["email"])

    op.create_table(
        "secondary_email_verification_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "secondary_email_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_secondary_emails.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("token", name="uq_secondary_email_verification_tokens_token"),
    )
    op.create_index(
        "ix_secondary_email_verification_tokens_user_id",
        "secondary_email_verification_tokens",
        ["user_id"],
    )
    op.create_index(
        "ix_secondary_email_verification_tokens_secondary_email_id",
        "secondary_email_verification_tokens",
        ["secondary_email_id"],
    )
    op.create_index(
        "ix_secondary_email_verification_tokens_created_at",
        "secondary_email_verification_tokens",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_secondary_email_verification_tokens_created_at", table_name="secondary_email_verification_tokens")
    op.drop_index("ix_secondary_email_verification_tokens_secondary_email_id", table_name="secondary_email_verification_tokens")
    op.drop_index("ix_secondary_email_verification_tokens_user_id", table_name="secondary_email_verification_tokens")
    op.drop_table("secondary_email_verification_tokens")

    op.drop_index("ix_user_secondary_emails_email", table_name="user_secondary_emails")
    op.drop_index("ix_user_secondary_emails_user_id", table_name="user_secondary_emails")
    op.drop_table("user_secondary_emails")
