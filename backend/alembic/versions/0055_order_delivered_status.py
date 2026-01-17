"""add delivered order status

Revision ID: 0055
Revises: 0054
Create Date: 2026-01-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Some installs store order status as VARCHAR (no enum type). Only alter the
        # enum if it exists; otherwise no DDL is required to allow the new value.
        enum_exists = bind.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'orderstatus'")).first()
        if not enum_exists:
            return
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'delivered'")
    else:
        # SQLite stores SQLAlchemy enums as strings and doesn't require enum DDL.
        pass


def downgrade() -> None:
    # NOTE:
    # PostgreSQL does not support removing enum values with a simple
    # "ALTER TYPE ... DROP VALUE" statement. This downgrade therefore only
    # remaps existing delivered orders back to shipped. The enum value remains
    # present in the underlying "orderstatus" type.
    op.execute("UPDATE orders SET status = 'shipped' WHERE status = 'delivered'")
