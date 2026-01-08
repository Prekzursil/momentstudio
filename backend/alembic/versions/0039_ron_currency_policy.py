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
    op.alter_column("products", "currency", existing_type=sa.String(length=3), server_default="RON", nullable=False)
    op.execute("UPDATE products SET currency='RON' WHERE currency IS NULL OR currency <> 'RON'")

    op.alter_column("orders", "currency", existing_type=sa.String(length=3), server_default="RON", nullable=False)
    op.execute("UPDATE orders SET currency='RON' WHERE currency IS NULL OR currency <> 'RON'")

    op.execute("UPDATE promo_codes SET currency='RON' WHERE currency IS NOT NULL AND currency <> 'RON'")


def downgrade() -> None:
    op.alter_column("products", "currency", existing_type=sa.String(length=3), server_default="USD", nullable=False)
    op.alter_column("orders", "currency", existing_type=sa.String(length=3), server_default="USD", nullable=False)
