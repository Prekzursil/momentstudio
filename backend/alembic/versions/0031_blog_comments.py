"""blog comments

Revision ID: 0031
Revises: 0030
Create Date: 2026-01-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "blog_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "content_block_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("content_blocks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("blog_comments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "deleted_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_blog_comments_content_block_id", "blog_comments", ["content_block_id"])
    op.create_index("ix_blog_comments_user_id", "blog_comments", ["user_id"])
    op.create_index("ix_blog_comments_parent_id", "blog_comments", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_blog_comments_parent_id", table_name="blog_comments")
    op.drop_index("ix_blog_comments_user_id", table_name="blog_comments")
    op.drop_index("ix_blog_comments_content_block_id", table_name="blog_comments")
    op.drop_table("blog_comments")

