"""add order event data and admin notes

Revision ID: 0090
Revises: 0089
Create Date: 2026-01-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0090"
down_revision: str | None = "0089"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("order_events", sa.Column("data", sa.JSON(), nullable=True))

    op.create_table(
        "order_admin_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("note", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_order_admin_notes_order_id"), "order_admin_notes", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_order_admin_notes_order_id"), table_name="order_admin_notes")
    op.drop_table("order_admin_notes")
    op.drop_column("order_events", "data")

