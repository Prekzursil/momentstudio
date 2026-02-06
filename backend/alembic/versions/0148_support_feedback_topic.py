"""add feedback support topic

Revision ID: 0148
Revises: 0147
Create Date: 2026-02-05
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0148"
down_revision: str | None = "0147"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE contact_submission_topic ADD VALUE IF NOT EXISTS 'feedback'")
    else:
        # SQLite stores SQLAlchemy enums as strings and doesn't require enum DDL.
        pass


def downgrade() -> None:
    # PostgreSQL does not support removing enum values from a type. We remap
    # feedback rows back to 'support' so older code paths continue to work.
    op.execute("UPDATE contact_submissions SET topic = 'support' WHERE topic = 'feedback'")

