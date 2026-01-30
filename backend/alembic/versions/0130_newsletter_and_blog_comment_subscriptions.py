"""Newsletter subscribers and blog comment subscriptions

Revision ID: 0130
Revises: 0129
Create Date: 2026-01-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0130"
down_revision: str | None = "0129"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "newsletter_subscribers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("subscribed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_newsletter_subscribers_email"), "newsletter_subscribers", ["email"], unique=False)

    op.create_table(
        "blog_comment_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_block_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["content_block_id"], ["content_blocks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("content_block_id", "user_id", name="uq_blog_comment_subscriptions_post_user"),
    )
    op.create_index(
        op.f("ix_blog_comment_subscriptions_content_block_id"),
        "blog_comment_subscriptions",
        ["content_block_id"],
        unique=False,
    )
    op.create_index(op.f("ix_blog_comment_subscriptions_user_id"), "blog_comment_subscriptions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_blog_comment_subscriptions_user_id"), table_name="blog_comment_subscriptions")
    op.drop_index(op.f("ix_blog_comment_subscriptions_content_block_id"), table_name="blog_comment_subscriptions")
    op.drop_table("blog_comment_subscriptions")

    op.drop_index(op.f("ix_newsletter_subscribers_email"), table_name="newsletter_subscribers")
    op.drop_table("newsletter_subscribers")

