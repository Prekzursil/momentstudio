"""content review status + author attribution

Revision ID: 0113
Revises: 0112
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0113"
down_revision: str | None = "0112"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_type t
                JOIN pg_enum e ON t.oid = e.enumtypid
                WHERE t.typname = 'contentstatus'
                  AND e.enumlabel = 'review'
              ) THEN
                ALTER TYPE contentstatus ADD VALUE 'review';
              END IF;
            END
            $$;
            """
        )

    op.add_column(
        "content_blocks",
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_content_blocks_author_id", "content_blocks", ["author_id"])

    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE content_blocks cb
            SET author_id = src.user_id
            FROM (
              SELECT DISTINCT ON (content_block_id)
                content_block_id,
                user_id
              FROM content_audit_log
              WHERE user_id IS NOT NULL
              ORDER BY content_block_id, created_at ASC
            ) AS src
            WHERE cb.id = src.content_block_id
              AND cb.author_id IS NULL;
            """
        )


def downgrade() -> None:
    op.drop_index("ix_content_blocks_author_id", table_name="content_blocks")
    op.drop_column("content_blocks", "author_id")
