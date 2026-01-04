"""content blocks and versions

Revision ID: 0017
Revises: 0016
Create Date: 2024-10-09
"""

from collections.abc import Sequence
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    content_status = postgresql.ENUM("draft", "published", name="contentstatus", create_type=False)
    content_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "content_blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False, unique=True, index=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column("status", content_status, nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "content_block_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("content_block_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("content_blocks.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column("status", content_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Seed default blocks
    now = datetime.now(timezone.utc)
    defaults = [
        ("home.hero", "Welcome to AdrianaArt", "Handmade art for your home", now),
        ("page.about", "About Us", "Story about AdrianaArt.", now),
        ("page.faq", "FAQ", "Frequently asked questions.", now),
        ("page.shipping", "Shipping & Returns", "Shipping and return policies.", now),
        ("page.care", "Care Instructions", "How to care for your items.", now),
    ]
    # Use explicit inserts for compatibility
    connection = op.get_bind()
    for key, title, body, ts in defaults:
        block_id = str(uuid.uuid4())
        version = 1
        connection.execute(
            sa.text(
                "INSERT INTO content_blocks (id, key, title, body_markdown, status, version, published_at, created_at, updated_at) "
                "VALUES (:id, :key, :title, :body, 'published', :version, :published_at, :created_at, :created_at)"
            ),
            {"id": block_id, "key": key, "title": title, "body": body, "version": version, "published_at": ts, "created_at": ts},
        )
        connection.execute(
            sa.text(
                "INSERT INTO content_block_versions (id, content_block_id, version, title, body_markdown, status, created_at) "
                "VALUES (:vid, :bid, :version, :title, :body, 'published', :created_at)"
            ),
            {
                "vid": str(uuid.uuid4()),
                "bid": block_id,
                "version": version,
                "title": title,
                "body": body,
                "created_at": ts,
            },
        )


def downgrade() -> None:
    op.drop_table("content_block_versions")
    op.drop_table("content_blocks")
    content_status = postgresql.ENUM("draft", "published", name="contentstatus", create_type=False)
    content_status.drop(op.get_bind(), checkfirst=True)
