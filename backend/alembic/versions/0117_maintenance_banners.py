"""maintenance banners

Revision ID: 0117
Revises: 0116
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0117"
down_revision: str | None = "0116"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "maintenance_banners",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False, server_default=sa.text("'info'")),
        sa.Column("message_en", sa.Text(), nullable=False),
        sa.Column("message_ro", sa.Text(), nullable=False),
        sa.Column("link_url", sa.String(length=500), nullable=True),
        sa.Column("link_label_en", sa.String(length=120), nullable=True),
        sa.Column("link_label_ro", sa.String(length=120), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_maintenance_banners_is_active", "maintenance_banners", ["is_active"])
    op.create_index("ix_maintenance_banners_level", "maintenance_banners", ["level"])
    op.create_index("ix_maintenance_banners_starts_at", "maintenance_banners", ["starts_at"])
    op.create_index("ix_maintenance_banners_ends_at", "maintenance_banners", ["ends_at"])


def downgrade() -> None:
    op.drop_index("ix_maintenance_banners_ends_at", table_name="maintenance_banners")
    op.drop_index("ix_maintenance_banners_starts_at", table_name="maintenance_banners")
    op.drop_index("ix_maintenance_banners_level", table_name="maintenance_banners")
    op.drop_index("ix_maintenance_banners_is_active", table_name="maintenance_banners")
    op.drop_table("maintenance_banners")
