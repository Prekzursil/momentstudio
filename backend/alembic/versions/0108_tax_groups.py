"""add tax groups and VAT rates

Revision ID: 0108
Revises: 0107
Create Date: 2026-01-25
"""

from collections.abc import Sequence
import uuid

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0108"
down_revision: str | None = "0107"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tax_groups",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("code", name="uq_tax_groups_code"),
    )
    op.create_index(op.f("ix_tax_groups_code"), "tax_groups", ["code"], unique=False)
    op.create_index(op.f("ix_tax_groups_is_default"), "tax_groups", ["is_default"], unique=False)

    op.create_table(
        "tax_rates",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "group_id", sa.UUID(as_uuid=True), sa.ForeignKey("tax_groups.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("vat_rate_percent", sa.Numeric(5, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("group_id", "country_code", name="uq_tax_rates_group_country"),
    )
    op.create_index(op.f("ix_tax_rates_country_code"), "tax_rates", ["country_code"], unique=False)
    op.create_index(op.f("ix_tax_rates_group_id"), "tax_rates", ["group_id"], unique=False)

    op.add_column(
        "categories",
        sa.Column(
            "tax_group_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("tax_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(op.f("ix_categories_tax_group_id"), "categories", ["tax_group_id"], unique=False)

    default_id = uuid.uuid4()
    op.execute(
        sa.text(
            "INSERT INTO tax_groups (id, code, name, description, is_default) "
            "VALUES (:id, :code, :name, :description, :is_default)"
        ).bindparams(
            id=default_id,
            code="standard",
            name="Standard VAT",
            description="Default VAT rate group.",
            is_default=True,
        )
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_categories_tax_group_id"), table_name="categories")
    op.drop_column("categories", "tax_group_id")

    op.drop_index(op.f("ix_tax_rates_group_id"), table_name="tax_rates")
    op.drop_index(op.f("ix_tax_rates_country_code"), table_name="tax_rates")
    op.drop_table("tax_rates")

    op.drop_index(op.f("ix_tax_groups_is_default"), table_name="tax_groups")
    op.drop_index(op.f("ix_tax_groups_code"), table_name="tax_groups")
    op.drop_table("tax_groups")

