"""add content image tags

Revision ID: 0110
Revises: 0109
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0110"
down_revision: str | None = "0109"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_image_tags",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "content_image_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("content_images.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tag", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("content_image_id", "tag", name="uq_content_image_tags_image_tag"),
    )
    op.create_index(op.f("ix_content_image_tags_content_image_id"), "content_image_tags", ["content_image_id"], unique=False)
    op.create_index(op.f("ix_content_image_tags_tag"), "content_image_tags", ["tag"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_content_image_tags_tag"), table_name="content_image_tags")
    op.drop_index(op.f("ix_content_image_tags_content_image_id"), table_name="content_image_tags")
    op.drop_table("content_image_tags")

