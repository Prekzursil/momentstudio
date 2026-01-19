"""add cancelled status to coupon bulk jobs

Revision ID: 0076
Revises: 0075
Create Date: 2026-01-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0076"
down_revision: str | None = "0075"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _status_constraint_names(conn: sa.engine.Connection) -> list[str]:
    if conn.dialect.name != "postgresql":
        return []
    rows = conn.execute(
        sa.text(
            """
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'coupon_bulk_jobs'
              AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) LIKE '%status%'
              AND pg_get_constraintdef(con.oid) LIKE '%pending%'
            """
        )
    ).fetchall()
    return [row[0] for row in rows]


def upgrade() -> None:
    conn = op.get_bind()
    for name in _status_constraint_names(conn):
        op.drop_constraint(name, "coupon_bulk_jobs", type_="check")
    if conn.dialect.name == "postgresql":
        op.create_check_constraint(
            "couponbulkjobstatus",
            "coupon_bulk_jobs",
            "status IN ('pending','running','succeeded','failed','cancelled')",
        )


def downgrade() -> None:
    conn = op.get_bind()
    for name in _status_constraint_names(conn):
        op.drop_constraint(name, "coupon_bulk_jobs", type_="check")
    if conn.dialect.name == "postgresql":
        op.create_check_constraint(
            "couponbulkjobstatus",
            "coupon_bulk_jobs",
            "status IN ('pending','running','succeeded','failed')",
        )
