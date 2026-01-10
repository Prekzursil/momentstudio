"""add owner role

Revision ID: 0046
Revises: 0045
Create Date: 2026-01-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Postgres requires the new enum value to be committed before it can be
        # referenced in subsequent DDL (e.g. partial index predicates).
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'owner'")

    op.create_index(
        "uq_users_single_owner_role",
        "users",
        ["role"],
        unique=True,
        postgresql_where=sa.text("role = 'owner'"),
        sqlite_where=sa.text("role = 'owner'"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("UPDATE users SET role = 'admin' WHERE role = 'owner'")
    else:
        op.execute("UPDATE users SET role = 'admin' WHERE role = 'owner'")

    op.drop_index("uq_users_single_owner_role", table_name="users")
