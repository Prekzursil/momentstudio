"""Order checkout idempotency guard

Revision ID: 0134
Revises: 0133
Create Date: 2026-01-30
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0134"
down_revision: str | None = "0133"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("stripe_checkout_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("paypal_approval_url", sa.String(length=2048), nullable=True),
    )

    op.add_column(
        "carts",
        sa.Column("last_order_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_carts_last_order_id_orders",
        "carts",
        "orders",
        ["last_order_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_carts_last_order_id"), "carts", ["last_order_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_carts_last_order_id"), table_name="carts")
    op.drop_constraint("fk_carts_last_order_id_orders", "carts", type_="foreignkey")
    op.drop_column("carts", "last_order_id")
    op.drop_column("orders", "paypal_approval_url")
    op.drop_column("orders", "stripe_checkout_url")
