"""update about page copy

Revision ID: 0036
Revises: 0035
Create Date: 2026-01-06
"""

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


EN_TITLE = "Our story"
RO_TITLE = "Povestea noastră"

EN_BODY = """We work with clay, wood, and colour—with patience and the joy of making things that never turn out identical.
Here, mugs, plates, and ceramic pieces take shape—objects that gather the quiet moments of the day and a sense of well-being.
Every piece goes through hands, fire, and in-the-moment decisions that make it unique—imperfections are part of the process; they aren’t corrected, they’re embraced.

We also paint brooches, earrings, little angels, and wooden decorations, each with its own expression, a small story, and sometimes traces of “supervision” from the studio cats—who are very real and very involved.

We work in small batches or as one-of-a-kind pieces, without rushing and without the desire to repeat the exact same thing perfectly.
We like each object to be a little different, to make you smile, and to find its place in a home—or in a good moment.

Everything you see here is handmade, with care, attention, and the joy of creating things that are not only beautiful, but lived with."""

RO_BODY = """Lucrăm cu lut, lemn și culoare, cu răbdare și cu bucuria de a face lucruri care nu ies niciodată identic.
Aici iau formă căni, farfurii și obiecte ceramice care adună momentele liniștite ale zilei și starea de bine.
Fiecare piesă trece prin mâini, foc și decizii de moment care o fac unică — imperfecțiunile fac parte din proces, nu sunt corectate, ci asumate.

Pictăm broșe, cercei, îngerași și decorațiuni din lemn, fiecare cu expresia lui, cu o mică poveste și, uneori, cu urme de „supervizare” din partea pisicilor din atelier, care sunt foarte reale și foarte implicate.

Lucrăm în serii mici sau piese unicat, fără grabă și fără dorința de a repeta perfect același lucru.
Ne place ca fiecare obiect să fie puțin diferit, să te facă să zâmbești și să-și găsească locul într-o casă sau într-un moment bun.

Tot ce vezi aici e făcut manual, cu grijă, cu atenție și cu bucuria de a crea lucruri care nu sunt doar frumoase, ci și trăite."""


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
        sa.column("lang", sa.String()),
        sa.column("published_at", sa.DateTime(timezone=True)),
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
        sa.column("translations", sa.JSON()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    audits = sa.table(
        "content_audit_log",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("action", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("user_id", sa.UUID(as_uuid=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    row = conn.execute(
        sa.select(
            content_blocks.c.id,
            content_blocks.c.version,
            content_blocks.c.meta,
            content_blocks.c.lang,
            content_blocks.c.published_at,
        ).where(content_blocks.c.key == "page.about")
    ).first()
    if not row:
        return

    block_id, current_version, meta, lang, published_at = row
    new_version = int(current_version or 1) + 1
    effective_published_at = published_at or now
    effective_lang = lang or "en"

    conn.execute(
        sa.update(content_blocks)
        .where(content_blocks.c.id == block_id)
        .values(
            title=EN_TITLE,
            body_markdown=EN_BODY,
            version=new_version,
            status="published",
            lang=effective_lang,
            published_at=effective_published_at,
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
            .values(title=RO_TITLE, body_markdown=RO_BODY)
        )
    else:
        conn.execute(
            sa.insert(translations).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                lang="ro",
                title=RO_TITLE,
                body_markdown=RO_BODY,
            )
        )

    translation_rows = conn.execute(
        sa.select(translations.c.lang, translations.c.title, translations.c.body_markdown).where(
            translations.c.content_block_id == block_id
        )
    ).all()
    translations_snapshot = [{"lang": lng, "title": title, "body_markdown": body} for (lng, title, body) in translation_rows]

    conn.execute(
        sa.insert(versions).values(
            id=uuid.uuid4(),
            content_block_id=block_id,
            version=new_version,
            title=EN_TITLE,
            body_markdown=EN_BODY,
            status="published",
            meta=meta,
            lang=effective_lang,
            published_at=effective_published_at,
            translations=translations_snapshot,
            created_at=now,
        )
    )
    conn.execute(
        sa.insert(audits).values(
            id=uuid.uuid4(),
            content_block_id=block_id,
            action="seed:about_copy",
            version=new_version,
            user_id=None,
            created_at=now,
        )
    )


def downgrade() -> None:
    # Data migration only; no automatic rollback.
    pass
