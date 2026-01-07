"""home page builder blocks

Revision ID: 0038
Revises: 0037
Create Date: 2026-01-07
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    content_status = postgresql.ENUM("draft", "published", name="contentstatus", create_type=False)

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
        conn.execute(
            sa.insert(content_blocks).values(
                id=block_id,
                key=key,
                title=title,
                body_markdown=body_markdown,
                status="published",
                version=version,
                meta=meta,
                sort_order=0,
                lang=lang,
                published_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(
            sa.insert(content_versions).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                version=version,
                title=title,
                body_markdown=body_markdown,
                status="published",
                meta=meta,
                lang=lang,
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
                version=version,
                user_id=None,
                created_at=now,
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

    ensure_block(
        key="home.sections",
        title="Home layout",
        body_markdown="Home page builder sections and ordering.",
        meta={
            "version": 1,
            "sections": [
                {"id": "hero", "enabled": True},
                {"id": "featured_products", "enabled": True},
                {"id": "new_arrivals", "enabled": True},
                {"id": "featured_collections", "enabled": True},
                {"id": "story", "enabled": True},
                {"id": "recently_viewed", "enabled": True},
                {"id": "why", "enabled": True},
            ],
        },
    )

    ensure_block(
        key="home.story",
        title="Our story",
        body_markdown=(
            "A short look into the workshop—clay, wood, colour, and the small moments we shape by hand.\n\n"
            "Read the full story on the About page."
        ),
        translation_ro=(
            "Povestea noastră",
            "Un scurt fragment din atelier—lut, lemn, culoare și momentele mici pe care le modelăm manual.\n\n"
            "Citește povestea completă pe pagina Despre.",
        ),
    )


def downgrade() -> None:
    # Intentionally no-op: removing seeded CMS content can delete user edits.
    return

