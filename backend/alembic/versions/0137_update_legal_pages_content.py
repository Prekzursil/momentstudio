"""Update seeded legal CMS pages with production content.

Revision ID: 0137
Revises: 0136
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0137"
down_revision: str | None = "0136"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _load_seed_md(filename: str) -> str:
    seed_dir = Path(__file__).resolve().parents[1] / "seed_data" / "legal"
    text = (seed_dir / filename).read_text(encoding="utf-8")
    text = text.replace("\r\n", "\n").strip()
    return f"{text}\n"


TERMS_EN_BODY = _load_seed_md("terms.en.md")
TERMS_RO_BODY = _load_seed_md("terms.ro.md")
PRIVACY_EN_BODY = _load_seed_md("privacy.en.md")
PRIVACY_RO_BODY = _load_seed_md("privacy.ro.md")
ANPC_EN_BODY = _load_seed_md("anpc.en.md")
ANPC_RO_BODY = _load_seed_md("anpc.ro.md")


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    is_postgres = conn.dialect.name == "postgresql"

    content_status = postgresql.ENUM("draft", "review", "published", name="contentstatus", create_type=False)
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

    def upsert_page(
        *,
        key: str,
        en_title: str,
        en_body: str,
        ro_title: str,
        ro_body: str,
        template_sentinels: Sequence[str],
    ) -> None:
        row = conn.execute(
            sa.select(
                content_blocks.c.id,
                content_blocks.c.version,
                content_blocks.c.title,
                content_blocks.c.body_markdown,
                content_blocks.c.meta,
                content_blocks.c.lang,
            ).where(content_blocks.c.key == key)
        ).first()

        if not row:
            block_id = uuid.uuid4()
            conn.execute(
                sa.insert(content_blocks).values(
                    id=block_id,
                    key=key,
                    title=en_title,
                    body_markdown=en_body,
                    status=published_status,
                    version=1,
                    meta=None,
                    lang="en",
                    needs_translation_en=False,
                    needs_translation_ro=False,
                    published_at=now,
                    published_until=None,
                    created_at=now,
                    updated_at=now,
                )
            )
            conn.execute(
                sa.insert(translations).values(
                    id=uuid.uuid4(),
                    content_block_id=block_id,
                    lang="ro",
                    title=ro_title,
                    body_markdown=ro_body,
                )
            )
            conn.execute(
                sa.insert(versions).values(
                    id=uuid.uuid4(),
                    content_block_id=block_id,
                    version=1,
                    title=en_title,
                    body_markdown=en_body,
                    status=published_status,
                    meta=None,
                    lang="en",
                    published_at=now,
                    published_until=None,
                    translations=[{"lang": "ro", "title": ro_title, "body_markdown": ro_body}],
                    created_at=now,
                )
            )
            return

        block_id, current_version, current_title, current_body, current_meta, current_lang = row
        current_body = current_body or ""
        current_title = current_title or ""

        looks_like_template = "(template)" in current_title.lower() or "șablon" in current_title.lower()
        looks_like_template = looks_like_template or any(s in current_body for s in template_sentinels)

        if not looks_like_template:
            return

        new_version = int(current_version or 0) + 1

        conn.execute(
            sa.update(content_blocks)
            .where(content_blocks.c.id == block_id)
            .values(
                title=en_title,
                body_markdown=en_body,
                status=published_status,
                version=new_version,
                needs_translation_en=False,
                needs_translation_ro=False,
                published_at=now,
                updated_at=now,
            )
        )

        translation_id = conn.execute(
            sa.select(translations.c.id).where(
                translations.c.content_block_id == block_id,
                translations.c.lang == "ro",
            )
        ).scalar_one_or_none()
        if translation_id:
            conn.execute(
                sa.update(translations)
                .where(translations.c.id == translation_id)
                .values(title=ro_title, body_markdown=ro_body)
            )
        else:
            conn.execute(
                sa.insert(translations).values(
                    id=uuid.uuid4(),
                    content_block_id=block_id,
                    lang="ro",
                    title=ro_title,
                    body_markdown=ro_body,
                )
            )

        conn.execute(
            sa.insert(versions).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                version=new_version,
                title=en_title,
                body_markdown=en_body,
                status=published_status,
                meta=current_meta,
                lang=current_lang,
                published_at=now,
                published_until=None,
                translations=[{"lang": "ro", "title": ro_title, "body_markdown": ro_body}],
                created_at=now,
            )
        )

    upsert_page(
        key="page.terms",
        en_title="Terms & Conditions",
        en_body=TERMS_EN_BODY,
        ro_title="Termeni și condiții",
        ro_body=TERMS_RO_BODY,
        template_sentinels=[
            "This content is a template",
            "Acest conținut este un șablon",
        ],
    )
    upsert_page(
        key="page.terms-and-conditions",
        en_title="Terms & Conditions",
        en_body=TERMS_EN_BODY,
        ro_title="Termeni și condiții",
        ro_body=TERMS_RO_BODY,
        template_sentinels=[
            "This page is a template",
            "Această pagină este un șablon",
        ],
    )
    upsert_page(
        key="page.privacy-policy",
        en_title="Privacy Policy",
        en_body=PRIVACY_EN_BODY,
        ro_title="Politica de confidențialitate",
        ro_body=PRIVACY_RO_BODY,
        template_sentinels=[
            "This page is a template",
            "Această pagină este un șablon",
            "This page is a template and is not legal advice",
        ],
    )
    upsert_page(
        key="page.anpc",
        en_title="ANPC / Consumer information",
        en_body=ANPC_EN_BODY,
        ro_title="ANPC / Informații pentru consumatori",
        ro_body=ANPC_RO_BODY,
        template_sentinels=[
            "legislatie.just.ro/Public/DetaliiDocument/257649",
            "noi-reglementari-de-la-anpc-in-ceea-ce-priveste-procedurile-de-solutionaare-alternativa-a-litigiilor",
        ],
    )


def downgrade() -> None:
    # Intentionally no-op: avoid overwriting user-edited CMS content.
    return
