"""content version snapshots v2

Revision ID: 0032
Revises: 0031
Create Date: 2026-01-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("content_block_versions", sa.Column("meta", sa.JSON(), nullable=True))
    op.add_column("content_block_versions", sa.Column("lang", sa.String(length=10), nullable=True))
    op.add_column("content_block_versions", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("content_block_versions", sa.Column("translations", sa.JSON(), nullable=True))

    conn = op.get_bind()
    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.String()),
        sa.column("meta", sa.JSON()),
        sa.column("lang", sa.String()),
        sa.column("published_at", sa.DateTime(timezone=True)),
    )
    content_translations = sa.table(
        "content_block_translations",
        sa.column("content_block_id", sa.String()),
        sa.column("lang", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
    )
    versions = sa.table(
        "content_block_versions",
        sa.column("content_block_id", sa.String()),
        sa.column("meta", sa.JSON()),
        sa.column("lang", sa.String()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("translations", sa.JSON()),
    )

    blocks = conn.execute(sa.select(content_blocks.c.id, content_blocks.c.meta, content_blocks.c.lang, content_blocks.c.published_at)).all()
    translations = conn.execute(
        sa.select(
            content_translations.c.content_block_id,
            content_translations.c.lang,
            content_translations.c.title,
            content_translations.c.body_markdown,
        )
    ).all()

    translation_map: dict[object, list[dict[str, object]]] = {}
    for block_id, lang, title, body_markdown in translations:
        translation_map.setdefault(block_id, []).append(
            {"lang": lang, "title": title, "body_markdown": body_markdown}
        )

    for block_id, meta, lang, published_at in blocks:
        conn.execute(
            sa.update(versions)
            .where(versions.c.content_block_id == block_id)
            .values(
                meta=meta,
                lang=lang,
                published_at=published_at,
                translations=translation_map.get(block_id, []),
            )
        )


def downgrade() -> None:
    op.drop_column("content_block_versions", "translations")
    op.drop_column("content_block_versions", "published_at")
    op.drop_column("content_block_versions", "lang")
    op.drop_column("content_block_versions", "meta")

