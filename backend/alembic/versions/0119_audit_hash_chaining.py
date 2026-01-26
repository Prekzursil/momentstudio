"""Audit hash chaining

Revision ID: 0119
Revises: 0118
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0119"
down_revision: str | None = "0118"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_chain_state",
        sa.Column("entity", sa.String(length=32), primary_key=True),
        sa.Column("tail_hash", sa.String(length=64), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.add_column("product_audit_logs", sa.Column("chain_prev_hash", sa.String(length=64), nullable=True))
    op.add_column("product_audit_logs", sa.Column("chain_hash", sa.String(length=64), nullable=True))
    op.add_column("content_audit_log", sa.Column("chain_prev_hash", sa.String(length=64), nullable=True))
    op.add_column("content_audit_log", sa.Column("chain_hash", sa.String(length=64), nullable=True))
    op.add_column("admin_audit_log", sa.Column("chain_prev_hash", sa.String(length=64), nullable=True))
    op.add_column("admin_audit_log", sa.Column("chain_hash", sa.String(length=64), nullable=True))

    table = sa.table(
        "audit_chain_state",
        sa.Column("entity", sa.String(length=32)),
        sa.Column("tail_hash", sa.String(length=64)),
    )
    op.bulk_insert(
        table,
        [
            {"entity": "product", "tail_hash": None},
            {"entity": "content", "tail_hash": None},
            {"entity": "security", "tail_hash": None},
        ],
    )


def downgrade() -> None:
    op.drop_column("admin_audit_log", "chain_hash")
    op.drop_column("admin_audit_log", "chain_prev_hash")
    op.drop_column("content_audit_log", "chain_hash")
    op.drop_column("content_audit_log", "chain_prev_hash")
    op.drop_column("product_audit_logs", "chain_hash")
    op.drop_column("product_audit_logs", "chain_prev_hash")
    op.drop_table("audit_chain_state")

