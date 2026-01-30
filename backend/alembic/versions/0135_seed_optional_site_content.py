"""Seed optional site content blocks

Revision ID: 0135
Revises: 0134
Create Date: 2026-01-30
"""

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0135"
down_revision: str | None = "0134"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    is_postgres = conn.dialect.name == "postgresql"

    content_status = postgresql.ENUM("draft", "review", "published", name="contentstatus", create_type=False)

    def status_value(value: str) -> sa.ColumnElement:
        if is_postgres:
            return sa.text(f"'{value}'::contentstatus")
        return sa.literal(value)

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
        sa.column("needs_translation_en", sa.Boolean()),
        sa.column("needs_translation_ro", sa.Boolean()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("published_until", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    versions = sa.table(
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
        sa.column("published_until", sa.DateTime(timezone=True)),
        sa.column("translations", sa.JSON()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    def seed_block(*, key: str, title: str, body_markdown: str, status: str, meta: dict | None = None) -> None:
        exists = conn.execute(sa.select(content_blocks.c.id).where(content_blocks.c.key == key)).first()
        if exists:
            return
        block_id = uuid.uuid4()
        published_at = now if status == "published" else None
        conn.execute(
            sa.insert(content_blocks).values(
                id=block_id,
                key=key,
                title=title,
                body_markdown=body_markdown,
                status=status_value(status),
                version=1,
                meta=meta,
                sort_order=0,
                lang=None,
                needs_translation_en=False,
                needs_translation_ro=False,
                published_at=published_at,
                published_until=None,
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(
            sa.insert(versions).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                version=1,
                title=title,
                body_markdown=body_markdown,
                status=status_value(status),
                meta=meta,
                lang=None,
                published_at=published_at,
                published_until=None,
                translations=[],
                created_at=now,
            )
        )

    seed_block(
        key="site.navigation",
        title="Site navigation",
        body_markdown="Navigation links for header/footer.",
        status="published",
        meta={"version": 1, "header_links": [], "footer_handcrafted_links": [], "footer_legal_links": []},
    )
    seed_block(
        key="site.header-banners",
        title="Header banners",
        body_markdown="Optional header banner blocks.",
        status="published",
        meta={"blocks": []},
    )
    seed_block(
        key="site.announcement",
        title="Announcement bar",
        body_markdown="Optional announcement bar blocks.",
        status="published",
        meta={"blocks": []},
    )
    seed_block(
        key="site.footer-promo",
        title="Footer promo",
        body_markdown="Optional footer promo blocks.",
        status="published",
        meta={"blocks": []},
    )
    seed_block(
        key="site.reports",
        title="Reports settings",
        body_markdown="Reports settings used by admin.",
        status="draft",
        meta={},
    )

    for page in ("home", "shop", "product", "category", "about"):
        seed_block(
            key=f"seo.{page}",
            title=f"SEO · {page}",
            body_markdown="SEO settings.",
            status="draft",
            meta={},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for key in (
        "site.navigation",
        "site.header-banners",
        "site.announcement",
        "site.footer-promo",
        "site.reports",
        "seo.home",
        "seo.shop",
        "seo.product",
        "seo.category",
        "seo.about",
    ):
        row = conn.execute(sa.text("SELECT id FROM content_blocks WHERE key = :key"), {"key": key}).first()
        if not row:
            continue
        block_id = row[0]
        conn.execute(
            sa.text(
                "DELETE FROM content_image_tags WHERE content_image_id IN (SELECT id FROM content_images WHERE content_block_id = :block_id)"
            ),
            {"block_id": block_id},
        )
        conn.execute(sa.text("DELETE FROM content_images WHERE content_block_id = :block_id"), {"block_id": block_id})
        conn.execute(
            sa.text("DELETE FROM content_block_translations WHERE content_block_id = :block_id"),
            {"block_id": block_id},
        )
        conn.execute(sa.text("DELETE FROM content_block_versions WHERE content_block_id = :block_id"), {"block_id": block_id})
        conn.execute(sa.text("DELETE FROM content_audit_log WHERE content_block_id = :block_id"), {"block_id": block_id})
        conn.execute(sa.text("DELETE FROM content_blocks WHERE id = :block_id"), {"block_id": block_id})
