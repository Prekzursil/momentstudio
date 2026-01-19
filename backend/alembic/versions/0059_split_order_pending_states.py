"""Split order pending status into payment vs acceptance.

Revision ID: 0059
Revises: 0058
Create Date: 2026-01-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        enum_exists = conn.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'orderstatus'")).first()
        if enum_exists:
            with op.get_context().autocommit_block():
                op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'pending_payment'")
                op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'pending_acceptance'")
    # Map legacy `pending` orders into either:
    # - pending_payment: online payment not captured yet
    # - pending_acceptance: payment captured or payment not required (COD)
    conn.execute(
        sa.text(
            """
            UPDATE orders
            SET status = CASE
              WHEN lower(coalesce(payment_method, '')) IN ('stripe', 'paypal', 'netopia') THEN
                CASE
                  WHEN paypal_capture_id IS NOT NULL
                    OR EXISTS (
                      SELECT 1
                      FROM order_events oe
                      WHERE oe.order_id = orders.id
                        AND oe.event = 'payment_captured'
                    )
                  THEN 'pending_acceptance'
                  ELSE 'pending_payment'
                END
              ELSE 'pending_acceptance'
            END
            WHERE status = 'pending'
            """
        )
    )


def downgrade() -> None:
    # Intentionally no-op: collapsing the new states back into a single
    # legacy status would lose information and may break workflows.
    return
