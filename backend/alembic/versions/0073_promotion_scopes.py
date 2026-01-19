"""promotion scopes for coupons v2

Revision ID: 0073
Revises: 0072
Create Date: 2026-01-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0073"
down_revision: str | None = "0072"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    entity_type = sa.Enum(
        "product",
        "category",
        name="promotionscopeentitytype",
        native_enum=False,
    )
    scope_mode = sa.Enum(
        "include",
        "exclude",
        name="promotionscopemode",
        native_enum=False,
    )

    op.create_table(
        "promotion_scopes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "promotion_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("promotions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_type", entity_type, nullable=False),
        sa.Column("entity_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("mode", scope_mode, nullable=False, server_default="include"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("promotion_id", "entity_type", "entity_id", name="uq_promotion_scopes_promotion_type_entity"),
    )
    op.create_index(op.f("ix_promotion_scopes_promotion_id"), "promotion_scopes", ["promotion_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_promotion_scopes_promotion_id"), table_name="promotion_scopes")
    op.drop_table("promotion_scopes")

