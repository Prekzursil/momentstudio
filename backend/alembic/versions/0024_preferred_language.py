"""Add preferred_language to users

Revision ID: 0024_preferred_language
Revises: 0023_email_verification_and_payment_methods
Create Date: 2025-12-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0024_preferred_language"
down_revision: Union[str, None] = "0023_email_verification_and_payment_methods"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "preferred_language",
            sa.String(length=10),
            nullable=True,
            server_default="en",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "preferred_language")
