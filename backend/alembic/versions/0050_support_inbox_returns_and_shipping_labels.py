"""support inbox, returns, and shipping labels

Revision ID: 0050
Revises: 0049
Create Date: 2026-01-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    contact_topic = sa.Enum(
        "contact",
        "support",
        "refund",
        "dispute",
        name="contact_submission_topic",
    )
    contact_status = sa.Enum(
        "new",
        "triaged",
        "resolved",
        name="contact_submission_status",
    )

    op.create_table(
        "contact_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("topic", contact_topic, nullable=False, server_default=sa.text("'contact'")),
        sa.Column("status", contact_status, nullable=False, server_default=sa.text("'new'")),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("order_reference", sa.String(length=50), nullable=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_contact_submissions_email", "contact_submissions", ["email"])
    op.create_index("ix_contact_submissions_order_reference", "contact_submissions", ["order_reference"])
    op.create_index("ix_contact_submissions_status", "contact_submissions", ["status"])
    op.create_index("ix_contact_submissions_created_at", "contact_submissions", ["created_at"])

    return_status = sa.Enum(
        "requested",
        "approved",
        "rejected",
        "received",
        "refunded",
        "closed",
        name="return_request_status",
    )
    op.create_table(
        "return_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", return_status, nullable=False, server_default=sa.text("'requested'")),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("customer_message", sa.Text(), nullable=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_return_requests_order_id", "return_requests", ["order_id"])
    op.create_index("ix_return_requests_user_id", "return_requests", ["user_id"])
    op.create_index("ix_return_requests_status", "return_requests", ["status"])
    op.create_index("ix_return_requests_created_at", "return_requests", ["created_at"])

    op.create_table(
        "return_request_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "return_request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("return_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "order_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("order_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_return_request_items_return_request_id", "return_request_items", ["return_request_id"])
    op.create_index("ix_return_request_items_order_item_id", "return_request_items", ["order_item_id"])

    op.add_column("orders", sa.Column("tracking_url", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shipping_label_path", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shipping_label_filename", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("shipping_label_uploaded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "shipping_label_uploaded_at")
    op.drop_column("orders", "shipping_label_filename")
    op.drop_column("orders", "shipping_label_path")
    op.drop_column("orders", "tracking_url")

    op.drop_index("ix_return_request_items_order_item_id", table_name="return_request_items")
    op.drop_index("ix_return_request_items_return_request_id", table_name="return_request_items")
    op.drop_table("return_request_items")

    op.drop_index("ix_return_requests_created_at", table_name="return_requests")
    op.drop_index("ix_return_requests_status", table_name="return_requests")
    op.drop_index("ix_return_requests_user_id", table_name="return_requests")
    op.drop_index("ix_return_requests_order_id", table_name="return_requests")
    op.drop_table("return_requests")

    op.drop_index("ix_contact_submissions_created_at", table_name="contact_submissions")
    op.drop_index("ix_contact_submissions_status", table_name="contact_submissions")
    op.drop_index("ix_contact_submissions_order_reference", table_name="contact_submissions")
    op.drop_index("ix_contact_submissions_email", table_name="contact_submissions")
    op.drop_table("contact_submissions")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS return_request_status")
        op.execute("DROP TYPE IF EXISTS contact_submission_status")
        op.execute("DROP TYPE IF EXISTS contact_submission_topic")

