"""enforce ron currency defaults

Revision ID: 0039
Revises: 0038
Create Date: 2026-01-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    def count_non_ron(table: str) -> int:
        return int(
            conn.execute(
                sa.text(f"SELECT COUNT(*) FROM {table} WHERE currency IS NOT NULL AND currency <> 'RON'")
            ).scalar_one()
        )

    offenders = {table: count_non_ron(table) for table in ("products", "orders", "promo_codes")}
    offenders = {table: count for table, count in offenders.items() if count > 0}
    if offenders:
        detail = ", ".join(f"{table}={count}" for table, count in sorted(offenders.items()))
        raise RuntimeError(
            "Migration 0039 enforces RON-only currency but found non-RON records "
            f"({detail}). Convert these rows to RON (or delete them) before applying this migration."
        )

    op.execute("UPDATE products SET currency='RON' WHERE currency IS NULL")
    op.alter_column("products", "currency", existing_type=sa.String(length=3), server_default="RON", nullable=False)

    op.execute("UPDATE orders SET currency='RON' WHERE currency IS NULL")
    op.alter_column("orders", "currency", existing_type=sa.String(length=3), server_default="RON", nullable=False)

    op.execute("UPDATE promo_codes SET currency='RON' WHERE amount_off IS NOT NULL AND currency IS NULL")


def downgrade() -> None:
    op.alter_column("products", "currency", existing_type=sa.String(length=3), server_default="USD", nullable=False)
    op.alter_column("orders", "currency", existing_type=sa.String(length=3), server_default="USD", nullable=False)
