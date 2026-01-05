"""blog comment moderation and notifications

Revision ID: 0033
Revises: 0032
Create Date: 2026-01-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "blog_comments",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("blog_comments", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "blog_comments",
        sa.Column(
            "hidden_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("blog_comments", sa.Column("hidden_reason", sa.Text(), nullable=True))

    op.create_table(
        "blog_comment_flags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "comment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("blog_comments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("comment_id", "user_id", name="uq_blog_comment_flags_comment_user"),
    )
    op.create_index("ix_blog_comment_flags_comment_id", "blog_comment_flags", ["comment_id"])
    op.create_index("ix_blog_comment_flags_user_id", "blog_comment_flags", ["user_id"])
    op.create_index("ix_blog_comment_flags_resolved_at", "blog_comment_flags", ["resolved_at"])

    op.add_column(
        "users",
        sa.Column("notify_blog_comments", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "users",
        sa.Column(
            "notify_blog_comment_replies",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "notify_blog_comment_replies")
    op.drop_column("users", "notify_blog_comments")

    op.drop_index("ix_blog_comment_flags_resolved_at", table_name="blog_comment_flags")
    op.drop_index("ix_blog_comment_flags_user_id", table_name="blog_comment_flags")
    op.drop_index("ix_blog_comment_flags_comment_id", table_name="blog_comment_flags")
    op.drop_table("blog_comment_flags")

    op.drop_column("blog_comments", "hidden_reason")
    op.drop_column("blog_comments", "hidden_by")
    op.drop_column("blog_comments", "hidden_at")
    op.drop_column("blog_comments", "is_hidden")
