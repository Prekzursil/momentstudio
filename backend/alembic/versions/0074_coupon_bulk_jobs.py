"""coupon bulk jobs for segment targeting

Revision ID: 0074
Revises: 0073
Create Date: 2026-01-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0074"
down_revision: str | None = "0073"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    action = sa.Enum(
        "assign",
        "revoke",
        name="couponbulkjobaction",
        native_enum=False,
    )
    status = sa.Enum(
        "pending",
        "running",
        "succeeded",
        "failed",
        name="couponbulkjobstatus",
        native_enum=False,
    )

    op.create_table(
        "coupon_bulk_jobs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "coupon_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("coupons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", action, nullable=False, server_default="assign"),
        sa.Column("status", status, nullable=False, server_default="pending"),
        sa.Column("require_marketing_opt_in", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("require_email_verified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("send_email", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("revoke_reason", sa.String(length=255), nullable=True),
        sa.Column("total_candidates", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("restored", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("already_active", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revoked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("already_revoked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("not_assigned", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f("ix_coupon_bulk_jobs_coupon_id"), "coupon_bulk_jobs", ["coupon_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_coupon_bulk_jobs_coupon_id"), table_name="coupon_bulk_jobs")
    op.drop_table("coupon_bulk_jobs")
