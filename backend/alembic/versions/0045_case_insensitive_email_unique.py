"""enforce case-insensitive email uniqueness

Revision ID: 0045
Revises: 0044
Create Date: 2026-01-10
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _assert_no_case_insensitive_duplicates(conn: sa.Connection) -> None:
    duplicates = conn.execute(
        sa.text(
            """
            SELECT lower(email) AS email_lower, COUNT(*) AS cnt
            FROM users
            GROUP BY lower(email)
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()
    if not duplicates:
        return
    sample = ", ".join([str(row[0]) for row in duplicates[:5]])
    raise RuntimeError(
        "Cannot enforce case-insensitive email uniqueness; duplicates exist for LOWER(email). "
        f"Resolve duplicates first (sample: {sample})."
    )


def upgrade() -> None:
    conn = op.get_bind()
    _assert_no_case_insensitive_duplicates(conn)

    conn.execute(sa.text("UPDATE users SET email = lower(email)"))

    dialect = conn.dialect.name
    if dialect == "sqlite":
        conn.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_nocase ON users (email COLLATE NOCASE)"))
    else:
        conn.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users (lower(email))"))


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.dialect.name
    if dialect == "sqlite":
        conn.execute(sa.text("DROP INDEX IF EXISTS ux_users_email_nocase"))
    else:
        conn.execute(sa.text("DROP INDEX IF EXISTS ux_users_email_lower"))
