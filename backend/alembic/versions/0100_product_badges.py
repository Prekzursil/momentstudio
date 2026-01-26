"""add product badges

Revision ID: 0100
Revises: 0099
Create Date: 2026-01-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0100"
down_revision: str | None = "0099"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    badge_type = sa.Enum(
        "new",
        "limited",
        "handmade",
        name="productbadgetype",
        native_enum=False,
    )

    op.create_table(
        "product_badges",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "product_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("badge", badge_type, nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "badge", name="uq_product_badges_unique"),
    )
    op.create_index(op.f("ix_product_badges_product_id"), "product_badges", ["product_id"], unique=False)
    op.create_index(op.f("ix_product_badges_badge"), "product_badges", ["badge"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_product_badges_badge"), table_name="product_badges")
    op.drop_index(op.f("ix_product_badges_product_id"), table_name="product_badges")
    op.drop_table("product_badges")
