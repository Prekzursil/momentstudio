"""add usage_reconcile media job type

Revision ID: 0153_add_media_usage_reconcile_job_type
Revises: 0152
Create Date: 2026-02-16 12:00:00
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0153_add_media_usage_reconcile_job_type"
down_revision = "0152"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    backend = (bind.dialect.name or "").lower()
    if backend == "postgresql":
        op.execute("ALTER TYPE mediajobtype ADD VALUE IF NOT EXISTS 'usage_reconcile'")


def downgrade() -> None:
    # Postgres enum value removals are not safely reversible in-place.
    # Keeping a no-op downgrade avoids unsafe table/type rewrites.
    return
