"""add content redirects

Revision ID: 0079
Revises: 0078
Create Date: 2026-01-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0079"
down_revision: str | None = "0078"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_redirects",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("from_key", sa.String(length=120), nullable=False),
        sa.Column("to_key", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("from_key", name="uq_content_redirects_from_key"),
    )
    op.create_index("ix_content_redirects_from_key", "content_redirects", ["from_key"])
    op.create_index("ix_content_redirects_to_key", "content_redirects", ["to_key"])


def downgrade() -> None:
    op.drop_index("ix_content_redirects_to_key", table_name="content_redirects")
    op.drop_index("ix_content_redirects_from_key", table_name="content_redirects")
    op.drop_table("content_redirects")

