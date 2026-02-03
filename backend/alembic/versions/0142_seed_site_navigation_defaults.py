"""Seed default site navigation links (header/footer).

Revision ID: 0142
Revises: 0141
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0142"
down_revision: str | None = "0141"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


DEFAULT_HEADER_LINKS: list[dict[str, object]] = [
    {"id": "home", "url": "/", "label": {"en": "Home", "ro": "Acasă"}},
    {"id": "blog", "url": "/blog", "label": {"en": "Blog", "ro": "Blog"}},
    {"id": "shop", "url": "/shop", "label": {"en": "Shop", "ro": "Magazin"}},
    {"id": "about", "url": "/about", "label": {"en": "Our story", "ro": "Povestea noastră"}},
    {"id": "contact", "url": "/contact", "label": {"en": "Contact", "ro": "Contact"}},
    {"id": "terms", "url": "/pages/terms", "label": {"en": "Terms & Conditions", "ro": "Termeni și condiții"}},
]

DEFAULT_FOOTER_HANDCRAFTED_LINKS: list[dict[str, object]] = [
    {"id": "shop", "url": "/shop", "label": {"en": "Shop", "ro": "Magazin"}},
    {"id": "about", "url": "/about", "label": {"en": "Our story", "ro": "Povestea noastră"}},
    {"id": "contact", "url": "/contact", "label": {"en": "Contact", "ro": "Contact"}},
    {"id": "terms", "url": "/pages/terms", "label": {"en": "Terms & Conditions", "ro": "Termeni și condiții"}},
]

DEFAULT_FOOTER_LEGAL_LINKS: list[dict[str, object]] = [
    {"id": "terms", "url": "/pages/terms", "label": {"en": "Terms & Conditions", "ro": "Termeni și condiții"}},
    {"id": "privacy", "url": "/pages/privacy-policy", "label": {"en": "Privacy Policy", "ro": "Politica de confidențialitate"}},
    {"id": "anpc", "url": "/pages/anpc", "label": {"en": "ANPC", "ro": "ANPC"}},
]


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: object | None) -> list:
    return value if isinstance(value, list) else []


def _has_any_links(meta: dict) -> bool:
    header = _as_list(meta.get("header_links"))
    handcrafted = _as_list(meta.get("footer_handcrafted_links"))
    legal = _as_list(meta.get("footer_legal_links"))
    return bool(header or handcrafted or legal)


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    versions = sa.table(
        "content_block_versions",
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
    )

    row = (
        conn.execute(
            sa.select(content_blocks.c.id, content_blocks.c.version, content_blocks.c.meta).where(
                content_blocks.c.key == "site.navigation"
            )
        )
        .mappings()
        .first()
    )
    if not row:
        return

    meta = _as_dict(row.get("meta"))
    if _has_any_links(meta):
        return

    meta.setdefault("version", 1)
    meta["header_links"] = DEFAULT_HEADER_LINKS
    meta["footer_handcrafted_links"] = DEFAULT_FOOTER_HANDCRAFTED_LINKS
    meta["footer_legal_links"] = DEFAULT_FOOTER_LEGAL_LINKS

    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta, updated_at=now))

    current_version = int(row.get("version") or 1)
    conn.execute(
        sa.update(versions)
        .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
        .values(meta=meta)
    )


def downgrade() -> None:
    # Intentionally no-op: removing seeded navigation links would overwrite user edits.
    return

