"""Seed site.checkout settings block.

Revision ID: 0057
Revises: 0056
Create Date: 2026-01-28
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0057"
down_revision: str | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    is_postgres = conn.dialect.name == "postgresql"

    content_status = postgresql.ENUM("draft", "published", name="contentstatus", create_type=False)
    published_status = sa.text("'published'::contentstatus") if is_postgres else "published"

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
        sa.column("status", content_status),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
        sa.column("sort_order", sa.Integer()),
        sa.column("lang", sa.String()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    content_versions = sa.table(
        "content_block_versions",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
        sa.column("status", content_status),
        sa.column("meta", sa.JSON()),
        sa.column("lang", sa.String()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("translations", sa.JSON()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    content_audit = sa.table(
        "content_audit_log",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("action", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("user_id", sa.UUID(as_uuid=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    exists = conn.execute(sa.select(content_blocks.c.id).where(content_blocks.c.key == "site.checkout")).first()
    if exists:
        return

    block_id = uuid.uuid4()
    meta = {"version": 1, "shipping_fee_ron": 20.0, "free_shipping_threshold_ron": 300.0}

    conn.execute(
        sa.insert(content_blocks).values(
            id=block_id,
            key="site.checkout",
            title="Checkout settings",
            body_markdown="Shipping fee and free-shipping threshold used at checkout.",
            status=published_status,
            version=1,
            meta=meta,
            sort_order=0,
            lang=None,
            published_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    conn.execute(
        sa.insert(content_versions).values(
            id=uuid.uuid4(),
            content_block_id=block_id,
            version=1,
            title="Checkout settings",
            body_markdown="Shipping fee and free-shipping threshold used at checkout.",
            status=published_status,
            meta=meta,
            lang=None,
            published_at=now,
            translations=[],
            created_at=now,
        )
    )
    conn.execute(
        sa.insert(content_audit).values(
            id=uuid.uuid4(),
            content_block_id=block_id,
            action="seeded",
            version=1,
            user_id=None,
            created_at=now,
        )
    )


def downgrade() -> None:
    # Intentionally no-op: removing seeded CMS content can delete user edits.
    return

