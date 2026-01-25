"""add fx override audit logs

Revision ID: 0107
Revises: 0106
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0107"
down_revision: str | None = "0106"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fx_override_audit_logs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("eur_per_ron", sa.Numeric(12, 8), nullable=True),
        sa.Column("usd_per_ron", sa.Numeric(12, 8), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_fx_override_audit_logs_created_at"), "fx_override_audit_logs", ["created_at"], unique=False)
    op.create_index(op.f("ix_fx_override_audit_logs_user_id"), "fx_override_audit_logs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_fx_override_audit_logs_user_id"), table_name="fx_override_audit_logs")
    op.drop_index(op.f("ix_fx_override_audit_logs_created_at"), table_name="fx_override_audit_logs")
    op.drop_table("fx_override_audit_logs")

