"""seed site.social and page.contact content blocks

Revision ID: 0041
Revises: 0040
Create Date: 2026-01-08
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


CONTACT_EN_TITLE = "Contact"
CONTACT_RO_TITLE = "Contact"

CONTACT_EN_BODY = """Questions about an order, a custom piece, or a collaboration? We'd love to hear from you.

We typically reply within 1–2 business days."""

CONTACT_RO_BODY = """Ai întrebări despre o comandă, o piesă personalizată sau o colaborare? Scrie-ne și îți răspundem cu drag.

De obicei răspundem în 1–2 zile lucrătoare."""


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
    translations = sa.table(
        "content_block_translations",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("lang", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
    )

    def ensure_block(
        *,
        key: str,
        title: str,
        body_markdown: str,
        meta: dict | None = None,
        lang: str | None = None,
        translation_ro: tuple[str, str] | None = None,
    ) -> None:
        existing = conn.execute(sa.select(content_blocks.c.id).where(content_blocks.c.key == key)).first()
        if existing:
            return

        block_id = uuid.uuid4()
        version = 1
        translations_snapshot: list[dict[str, object]] = []

        conn.execute(
            sa.insert(content_blocks).values(
                id=block_id,
                key=key,
                title=title,
                body_markdown=body_markdown,
                status=published_status,
                version=version,
                meta=meta,
                sort_order=0,
                lang=lang,
                published_at=now,
                created_at=now,
                updated_at=now,
            )
        )

        if translation_ro:
            ro_title, ro_body = translation_ro
            conn.execute(
                sa.insert(translations).values(
                    id=uuid.uuid4(),
                    content_block_id=block_id,
                    lang="ro",
                    title=ro_title,
                    body_markdown=ro_body,
                )
            )
            translations_snapshot.append({"lang": "ro", "title": ro_title, "body_markdown": ro_body})

        conn.execute(
            sa.insert(content_versions).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                version=version,
                title=title,
                body_markdown=body_markdown,
                status=published_status,
                meta=meta,
                lang=lang,
                published_at=now,
                translations=translations_snapshot,
                created_at=now,
            )
        )
        conn.execute(
            sa.insert(content_audit).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                action="seeded",
                version=version,
                user_id=None,
                created_at=now,
            )
        )

    ensure_block(
        key="site.social",
        title="Site social links",
        body_markdown="Social pages and contact details used across the storefront.",
        meta={
            "version": 1,
            "contact": {"phone": "+40723204204", "email": "momentstudio.ro@gmail.com"},
            "instagram_pages": [
                {
                    "label": "Moments in Clay - Studio",
                    "url": "https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx",
                    "thumbnail_url": None,
                },
                {
                    "label": "momentstudio",
                    "url": "https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy",
                    "thumbnail_url": None,
                },
            ],
            "facebook_pages": [
                {
                    "label": "Moments in Clay - Studio",
                    "url": "https://www.facebook.com/share/17YqBmfX5x/",
                    "thumbnail_url": None,
                },
                {
                    "label": "momentstudio",
                    "url": "https://www.facebook.com/share/1APqKJM6Zi/",
                    "thumbnail_url": None,
                },
            ],
        },
    )

    ensure_block(
        key="page.contact",
        title=CONTACT_EN_TITLE,
        body_markdown=CONTACT_EN_BODY,
        lang="en",
        translation_ro=(CONTACT_RO_TITLE, CONTACT_RO_BODY),
    )


def downgrade() -> None:
    # Intentionally no-op: removing seeded CMS content can delete user edits.
    return

