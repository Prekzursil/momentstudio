"""add product sku and status fields

Revision ID: 0008
Revises: 0007
Create Date: 2024-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    productstatus = postgresql.ENUM(
        "draft", "published", "archived", name="productstatus"
    )
    productstatus.create(op.get_bind(), checkfirst=True)

    op.add_column("products", sa.Column("sku", sa.String(length=64), nullable=True))
    op.add_column(
        "products",
        sa.Column("status", productstatus, nullable=False, server_default="draft"),
    )
    op.add_column(
        "products", sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "products",
        sa.Column(
            "last_modified",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # backfill skus for existing rows
    conn = op.get_bind()
    products = conn.execute(
        sa.text("SELECT id, slug FROM products WHERE sku IS NULL")
    ).fetchall()
    for row in products:
        base = (row.slug or "SKU")[:8].upper().replace("-", "")
        suffix = row.id.hex[:4]
        conn.execute(
            sa.text("UPDATE products SET sku=:sku WHERE id=:id"),
            {"sku": f"{base}-{suffix}", "id": row.id},
        )

    op.alter_column("products", "sku", nullable=False)
    op.create_index("ix_products_sku", "products", ["sku"], unique=True)
    op.alter_column("products", "status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_products_sku", table_name="products")
    op.drop_column("products", "last_modified")
    op.drop_column("products", "publish_at")
    op.drop_column("products", "status")
    op.drop_column("products", "sku")
    productstatus = postgresql.ENUM(
        "draft", "published", "archived", name="productstatus"
    )
    productstatus.drop(op.get_bind(), checkfirst=True)
