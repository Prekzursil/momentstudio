"""Remove template disclaimer from the legal index page.

Revision ID: 0138
Revises: 0137
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0138"
down_revision: str | None = "0137"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


DISCLAIMER_EN = "> Important: This content is a template and must be reviewed by a legal professional before going live."
DISCLAIMER_RO = "> Important: Acest conținut este un șablon și trebuie revizuit de un specialist juridic înainte de publicare."


def _strip_disclaimer(body: str, disclaimer: str) -> str:
    normalized = (body or "").replace("\r\n", "\n")
    if not normalized:
        return ""
    lines = [line for line in normalized.split("\n") if line.strip() != disclaimer]
    return "\n".join(lines).strip() + "\n"


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    is_postgres = conn.dialect.name == "postgresql"

    content_status = postgresql.ENUM("draft", "review", "published", name="contentstatus", create_type=False)

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
        sa.column("status", content_status),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
        sa.column("lang", sa.String()),
        sa.column("needs_translation_en", sa.Boolean()),
        sa.column("needs_translation_ro", sa.Boolean()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("published_until", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    translations = sa.table(
        "content_block_translations",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("lang", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
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

    row = conn.execute(
        sa.select(
            content_blocks.c.id,
            content_blocks.c.version,
            content_blocks.c.title,
            content_blocks.c.body_markdown,
            content_blocks.c.status,
            content_blocks.c.meta,
            content_blocks.c.lang,
            content_blocks.c.published_at,
            content_blocks.c.published_until,
        ).where(content_blocks.c.key == "page.terms")
    ).first()
    if not row:
        return

    (
        block_id,
        current_version,
        current_title,
        current_body,
        current_status,
        current_meta,
        current_lang,
        current_published_at,
        current_published_until,
    ) = row

    translation_row = conn.execute(
        sa.select(translations.c.id, translations.c.title, translations.c.body_markdown).where(
            translations.c.content_block_id == block_id,
            translations.c.lang == "ro",
        )
    ).first()

    current_body = (current_body or "").replace("\r\n", "\n")
    updated_body_en = _strip_disclaimer(current_body, DISCLAIMER_EN)

    ro_translation_id: uuid.UUID | None = None
    ro_title = ""
    ro_body = ""
    if translation_row:
        ro_translation_id, ro_title, ro_body = translation_row
        ro_body = (ro_body or "").replace("\r\n", "\n")
    updated_body_ro = _strip_disclaimer(ro_body, DISCLAIMER_RO) if ro_body else ro_body

    if updated_body_en == (current_body.strip() + "\n") and updated_body_ro == (ro_body.strip() + "\n" if ro_body else ro_body):
        return

    new_version = int(current_version or 0) + 1
    conn.execute(
        sa.update(content_blocks)
        .where(content_blocks.c.id == block_id)
        .values(body_markdown=updated_body_en, version=new_version, updated_at=now)
    )

    if ro_translation_id:
        conn.execute(
            sa.update(translations)
            .where(translations.c.id == ro_translation_id)
            .values(body_markdown=updated_body_ro)
        )

    translations_snapshot: list[dict[str, object]] = []
    if ro_translation_id:
        translations_snapshot.append({"lang": "ro", "title": ro_title or "", "body_markdown": updated_body_ro})

    conn.execute(
        sa.insert(versions).values(
            id=uuid.uuid4(),
            content_block_id=block_id,
            version=new_version,
            title=current_title or "",
            body_markdown=updated_body_en,
            status=current_status if is_postgres else str(current_status),
            meta=current_meta,
            lang=current_lang,
            published_at=current_published_at,
            published_until=current_published_until,
            translations=translations_snapshot,
            created_at=now,
        )
    )


def downgrade() -> None:
    # Intentionally no-op: avoid overwriting user-edited CMS content.
    return

