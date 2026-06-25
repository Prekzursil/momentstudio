"""add google oauth fields to users

Revision ID: 0027_google_oauth_fields
Revises: 0026_content_translations_and_lang
Create Date: 2025-12-06 09:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0027_google_oauth_fields"
down_revision: Union[str, None] = "0026_content_translations_and_lang"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("google_sub", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "users", sa.Column("google_email", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "users", sa.Column("google_picture_url", sa.String(length=255), nullable=True)
    )
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_column("users", "google_picture_url")
    op.drop_column("users", "google_email")
    op.drop_column("users", "google_sub")
