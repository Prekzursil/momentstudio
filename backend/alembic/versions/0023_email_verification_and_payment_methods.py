"""add email verification and payment methods

Revision ID: 0023_email_verification_and_payment_methods
Revises: 0022_category_sort_order
Create Date: 2025-12-02 00:00:00
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0023_email_verification_and_payment_methods"
down_revision = "0022_category_sort_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column(
            "alembic_version",
            "version_num",
            existing_type=sa.String(length=32),
            type_=sa.String(length=255),
            existing_nullable=False,
        )

    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("stripe_customer_id", sa.String(length=255), nullable=True))
    op.alter_column("users", "email_verified", server_default=None)

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_email_verification_tokens_token", "email_verification_tokens", ["token"], unique=True)

    op.create_table(
        "payment_methods",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("stripe_payment_method_id", sa.String(length=255), nullable=False, unique=True),
        sa.Column("brand", sa.String(length=50), nullable=True),
        sa.Column("last4", sa.String(length=4), nullable=True),
        sa.Column("exp_month", sa.Integer(), nullable=True),
        sa.Column("exp_year", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_payment_methods_stripe_pm", "payment_methods", ["stripe_payment_method_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_payment_methods_stripe_pm", table_name="payment_methods")
    op.drop_table("payment_methods")
    op.drop_index("ix_email_verification_tokens_token", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "stripe_customer_id")
    op.drop_column("users", "email_verified")
