"""Order document exports

Revision ID: 0132
Revises: 0131
Create Date: 2026-01-30
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0132"
down_revision: str | None = "0131"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_document_exports",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "packing_slip",
                "packing_slips_batch",
                "shipping_label",
                "receipt",
                name="orderdocumentexportkind",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "order_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("order_ids", sa.JSON(), nullable=True),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False, server_default="application/pdf"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(op.f("ix_order_document_exports_kind"), "order_document_exports", ["kind"], unique=False)
    op.create_index(op.f("ix_order_document_exports_order_id"), "order_document_exports", ["order_id"], unique=False)
    op.create_index(
        op.f("ix_order_document_exports_created_by_user_id"),
        "order_document_exports",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_order_document_exports_created_at"), "order_document_exports", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_order_document_exports_created_at"), table_name="order_document_exports")
    op.drop_index(op.f("ix_order_document_exports_created_by_user_id"), table_name="order_document_exports")
    op.drop_index(op.f("ix_order_document_exports_order_id"), table_name="order_document_exports")
    op.drop_index(op.f("ix_order_document_exports_kind"), table_name="order_document_exports")
    op.drop_table("order_document_exports")
    op.execute("DROP TYPE IF EXISTS orderdocumentexportkind")

