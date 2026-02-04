"""Newsletter double opt-in

Revision ID: 0147
Revises: 0146
Create Date: 2026-02-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0147"
down_revision: str | None = "0146"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("newsletter_subscribers", sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("newsletter_subscribers", sa.Column("confirmation_sent_at", sa.DateTime(timezone=True), nullable=True))

    # Existing rows predate double opt-in; treat them as confirmed.
    op.execute("UPDATE newsletter_subscribers SET confirmed_at = subscribed_at WHERE confirmed_at IS NULL")


def downgrade() -> None:
    op.drop_column("newsletter_subscribers", "confirmation_sent_at")
    op.drop_column("newsletter_subscribers", "confirmed_at")

