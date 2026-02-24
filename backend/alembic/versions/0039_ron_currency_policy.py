"""enforce ron currency defaults

Revision ID: 0039
Revises: 0038
Create Date: 2026-01-08
"""

from collections.abc import Sequence
import sys

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    products = sa.table("products", sa.column("currency", sa.String()))
    orders = sa.table("orders", sa.column("currency", sa.String()))
    promo_codes = sa.table("promo_codes", sa.column("currency", sa.String()), sa.column("amount_off", sa.Numeric()))
    table_map = {"products": products, "orders": orders, "promo_codes": promo_codes}

    def count_non_ron(table: str) -> int:
        table_ref = table_map[table]
        condition = sa.and_(table_ref.c.currency.is_not(None), table_ref.c.currency != "RON")
        if table == "promo_codes":
            condition = sa.and_(table_ref.c.amount_off.is_not(None), condition)
        stmt = sa.select(sa.func.count()).select_from(table_ref).where(condition)
        return int(conn.execute(stmt).scalar_one())

    # Normalize casing to avoid treating "ron" as a foreign currency.
    op.execute("UPDATE products SET currency='RON' WHERE currency IS NOT NULL AND UPPER(currency)='RON'")
    op.execute("UPDATE orders SET currency='RON' WHERE currency IS NOT NULL AND UPPER(currency)='RON'")
    op.execute("UPDATE promo_codes SET currency='RON' WHERE currency IS NOT NULL AND UPPER(currency)='RON'")

    offenders = {table: count_non_ron(table) for table in ("products", "orders", "promo_codes")}
    offenders = {table: count for table, count in offenders.items() if count > 0}
    if offenders:
        detail = ", ".join(f"{table}={count}" for table, count in sorted(offenders.items()))
        print(
            "Migration 0039 enforces RON-only currency and will normalize existing non-RON records to RON "
            f"({detail}). Ensure amounts are already stored in RON before continuing.",
            file=sys.stderr,
        )
        op.execute("UPDATE products SET currency='RON' WHERE currency IS NOT NULL AND currency <> 'RON'")
        op.execute("UPDATE orders SET currency='RON' WHERE currency IS NOT NULL AND currency <> 'RON'")
        op.execute(
            "UPDATE promo_codes SET currency='RON' WHERE amount_off IS NOT NULL AND currency IS NOT NULL AND currency <> 'RON'"
        )

    op.execute("UPDATE products SET currency='RON' WHERE currency IS NULL")
    op.alter_column("products", "currency", existing_type=sa.String(length=3), server_default="RON", nullable=False)

    op.execute("UPDATE orders SET currency='RON' WHERE currency IS NULL")
    op.alter_column("orders", "currency", existing_type=sa.String(length=3), server_default="RON", nullable=False)

    op.execute("UPDATE promo_codes SET currency='RON' WHERE amount_off IS NOT NULL AND currency IS NULL")


def downgrade() -> None:
    op.alter_column("products", "currency", existing_type=sa.String(length=3), server_default="USD", nullable=False)
    op.alter_column("orders", "currency", existing_type=sa.String(length=3), server_default="USD", nullable=False)
