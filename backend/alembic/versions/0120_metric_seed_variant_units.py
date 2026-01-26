"""Metric seed variant units

Revision ID: 0120
Revises: 0119
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0120"
down_revision: str | None = "0119"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    products = sa.table(
        "products",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("slug", sa.String(length=255)),
    )
    variants = sa.table(
        "product_variants",
        sa.column("product_id", sa.UUID(as_uuid=True)),
        sa.column("name", sa.String(length=120)),
    )

    product_id = bind.execute(  # type: ignore[assignment]
        sa.select(products.c.id).where(products.c.slug == "white-cup")
    ).scalar()
    if not product_id:
        return

    bind.execute(  # type: ignore[call-arg]
        sa.update(variants)
        .where(variants.c.product_id == product_id, variants.c.name == "8oz")
        .values(name="250 ml")
    )
    bind.execute(  # type: ignore[call-arg]
        sa.update(variants)
        .where(variants.c.product_id == product_id, variants.c.name == "12oz")
        .values(name="350 ml")
    )


def downgrade() -> None:
    bind = op.get_bind()
    products = sa.table(
        "products",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("slug", sa.String(length=255)),
    )
    variants = sa.table(
        "product_variants",
        sa.column("product_id", sa.UUID(as_uuid=True)),
        sa.column("name", sa.String(length=120)),
    )

    product_id = bind.execute(  # type: ignore[assignment]
        sa.select(products.c.id).where(products.c.slug == "white-cup")
    ).scalar()
    if not product_id:
        return

    bind.execute(  # type: ignore[call-arg]
        sa.update(variants)
        .where(variants.c.product_id == product_id, variants.c.name == "250 ml")
        .values(name="8oz")
    )
    bind.execute(  # type: ignore[call-arg]
        sa.update(variants)
        .where(variants.c.product_id == product_id, variants.c.name == "350 ml")
        .values(name="12oz")
    )

