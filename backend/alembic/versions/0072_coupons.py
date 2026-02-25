"""coupons v2 schema

Revision ID: 0072
Revises: 0071
Create Date: 2026-01-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0072"
down_revision: str | None = "0071"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    promotion_discount_type = sa.Enum(
        "percent",
        "amount",
        "free_shipping",
        name="promotiondiscounttype",
        native_enum=False,
    )
    coupon_visibility = sa.Enum(
        "public",
        "assigned",
        name="couponvisibility",
        native_enum=False,
    )

    op.create_table(
        "promotions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=80), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("discount_type", promotion_discount_type, nullable=False),
        sa.Column("percentage_off", sa.Numeric(5, 2), nullable=True),
        sa.Column("amount_off", sa.Numeric(10, 2), nullable=True),
        sa.Column("max_discount_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("min_subtotal", sa.Numeric(10, 2), nullable=True),
        sa.Column("allow_on_sale_items", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_automatic", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_promotions_key"), "promotions", ["key"], unique=True)

    op.create_table(
        "coupons",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("promotion_id", sa.UUID(as_uuid=True), sa.ForeignKey("promotions.id"), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("visibility", coupon_visibility, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("global_max_redemptions", sa.Integer(), nullable=True),
        sa.Column("per_customer_max_redemptions", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_coupons_code"), "coupons", ["code"], unique=True)

    op.create_table(
        "coupon_assignments",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("coupon_id", sa.UUID(as_uuid=True), sa.ForeignKey("coupons.id"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("coupon_id", "user_id", name="uq_coupon_assignments_coupon_user"),
    )

    op.create_table(
        "coupon_reservations",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("coupon_id", sa.UUID(as_uuid=True), sa.ForeignKey("coupons.id"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("order_id", sa.UUID(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("reserved_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("discount_ron", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("shipping_discount_ron", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.UniqueConstraint("order_id", name="uq_coupon_reservations_order"),
    )
    op.create_index(op.f("ix_coupon_reservations_expires_at"), "coupon_reservations", ["expires_at"], unique=False)

    op.create_table(
        "coupon_redemptions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("coupon_id", sa.UUID(as_uuid=True), sa.ForeignKey("coupons.id"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("order_id", sa.UUID(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("discount_ron", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("shipping_discount_ron", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_reason", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("order_id", name="uq_coupon_redemptions_order"),
    )


def downgrade() -> None:
    op.drop_table("coupon_redemptions")
    op.drop_index(op.f("ix_coupon_reservations_expires_at"), table_name="coupon_reservations")
    op.drop_table("coupon_reservations")
    op.drop_table("coupon_assignments")
    op.drop_index(op.f("ix_coupons_code"), table_name="coupons")
    op.drop_table("coupons")
    op.drop_index(op.f("ix_promotions_key"), table_name="promotions")
    op.drop_table("promotions")
