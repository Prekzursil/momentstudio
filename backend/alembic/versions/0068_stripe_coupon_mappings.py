"""Stripe coupon mappings for promo codes

Revision ID: 0068
Revises: 0067
Create Date: 2026-01-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0068"
down_revision: str | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stripe_coupon_mappings",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("promo_code_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("discount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'RON'")),
        sa.Column("stripe_coupon_id", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promo_codes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "promo_code_id",
            "discount_cents",
            "currency",
            name="uq_stripe_coupon_mappings_promo_discount",
        ),
        sa.UniqueConstraint("stripe_coupon_id"),
    )
    op.create_index(
        "ix_stripe_coupon_mappings_promo_code_id",
        "stripe_coupon_mappings",
        ["promo_code_id"],
    )
    op.create_index(
        "ix_stripe_coupon_mappings_stripe_coupon_id",
        "stripe_coupon_mappings",
        ["stripe_coupon_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_stripe_coupon_mappings_stripe_coupon_id", table_name="stripe_coupon_mappings")
    op.drop_index("ix_stripe_coupon_mappings_promo_code_id", table_name="stripe_coupon_mappings")
    op.drop_table("stripe_coupon_mappings")
