"""add user avatar url

Revision ID: 0021_user_avatar
Revises: 0020_password_reset_tokens
Create Date: 2025-12-01 01:06:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0021_user_avatar"
down_revision = "0020_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
