"""add staff roles

Revision ID: 0103
Revises: 0102
Create Date: 2026-01-25
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0103"
down_revision: str | None = "0102"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'support'")
            op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'fulfillment'")
            op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'content'")
    else:
        # SQLite stores SQLAlchemy enums as strings and doesn't require enum DDL.
        pass


def downgrade() -> None:
    # PostgreSQL does not support removing enum values from a type. We remap
    # staff roles back to 'admin' so older code paths continue to work.
    op.execute("UPDATE users SET role = 'admin' WHERE role IN ('support', 'fulfillment', 'content')")

