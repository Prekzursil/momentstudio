"""Content image lineage fields

Revision ID: 0131
Revises: 0130
Create Date: 2026-01-29
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0131"
down_revision: str | None = "0130"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("content_images", sa.Column("root_image_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("content_images", sa.Column("source_image_id", postgresql.UUID(as_uuid=True), nullable=True))

    op.create_index(op.f("ix_content_images_root_image_id"), "content_images", ["root_image_id"], unique=False)
    op.create_index(op.f("ix_content_images_source_image_id"), "content_images", ["source_image_id"], unique=False)

    op.create_foreign_key(
        op.f("fk_content_images_root_image_id_content_images"),
        "content_images",
        "content_images",
        ["root_image_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_content_images_source_image_id_content_images"),
        "content_images",
        "content_images",
        ["source_image_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_content_images_source_image_id_content_images"), "content_images", type_="foreignkey")
    op.drop_constraint(op.f("fk_content_images_root_image_id_content_images"), "content_images", type_="foreignkey")

    op.drop_index(op.f("ix_content_images_source_image_id"), table_name="content_images")
    op.drop_index(op.f("ix_content_images_root_image_id"), table_name="content_images")

    op.drop_column("content_images", "source_image_id")
    op.drop_column("content_images", "root_image_id")

