"""add deleted metadata for products/images

Revision ID: 0098
Revises: 0097
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0098"
down_revision: str | None = "0097"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("products", sa.Column("deleted_by", sa.UUID(as_uuid=True), nullable=True))
    op.add_column("products", sa.Column("deleted_slug", sa.String(length=160), nullable=True))
    op.create_foreign_key(
        op.f("fk_products_deleted_by_users"),
        "products",
        "users",
        ["deleted_by"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "product_images",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("product_images", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("product_images", sa.Column("deleted_by", sa.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        op.f("fk_product_images_deleted_by_users"),
        "product_images",
        "users",
        ["deleted_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_product_images_deleted_by_users"), "product_images", type_="foreignkey")
    op.drop_column("product_images", "deleted_by")
    op.drop_column("product_images", "deleted_at")
    op.drop_column("product_images", "is_deleted")

    op.drop_constraint(op.f("fk_products_deleted_by_users"), "products", type_="foreignkey")
    op.drop_column("products", "deleted_slug")
    op.drop_column("products", "deleted_by")
    op.drop_column("products", "deleted_at")
