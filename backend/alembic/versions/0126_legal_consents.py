"""Legal consent tracking

Revision ID: 0126
Revises: 0125
Create Date: 2026-01-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "0126"
down_revision: str | None = "0125"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "legal_consents",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("doc_key", sa.String(length=120), nullable=False),
        sa.Column("doc_version", sa.Integer(), nullable=False),
        sa.Column(
            "context",
            sa.Enum("register", "checkout", name="legalconsentcontext", native_enum=False),
            nullable=False,
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("order_id", UUID(as_uuid=True), sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("user_id IS NOT NULL OR order_id IS NOT NULL", name="ck_legal_consents_subject"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_legal_consents_doc_key", "legal_consents", ["doc_key"])
    op.create_index("ix_legal_consents_context", "legal_consents", ["context"])
    op.create_index("ix_legal_consents_user_id", "legal_consents", ["user_id"])
    op.create_index("ix_legal_consents_order_id", "legal_consents", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_legal_consents_order_id", table_name="legal_consents")
    op.drop_index("ix_legal_consents_user_id", table_name="legal_consents")
    op.drop_index("ix_legal_consents_context", table_name="legal_consents")
    op.drop_index("ix_legal_consents_doc_key", table_name="legal_consents")
    op.drop_table("legal_consents")

