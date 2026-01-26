"""return label support

Revision ID: 0116
Revises: 0115
Create Date: 2026-01-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0116"
down_revision: str | None = "0115"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("return_requests", sa.Column("return_label_path", sa.String(length=255), nullable=True))
    op.add_column("return_requests", sa.Column("return_label_filename", sa.String(length=255), nullable=True))
    op.add_column("return_requests", sa.Column("return_label_uploaded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("return_requests", "return_label_uploaded_at")
    op.drop_column("return_requests", "return_label_filename")
    op.drop_column("return_requests", "return_label_path")
