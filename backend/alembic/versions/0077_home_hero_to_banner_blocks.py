"""Migrate legacy home.hero into banner blocks.

This converts the deprecated `home.hero` content into a `banner` block inside
`home.sections` so the homepage hero becomes reorderable/removable and supports
multiple banners/carousels.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0077"
down_revision: str | None = "0076"
branch_labels = None
depends_on = None


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: object | None) -> list:
    return value if isinstance(value, list) else []


def _as_str(value: object | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def upgrade() -> None:
    conn = op.get_bind()

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.String()),
        sa.column("key", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
        sa.column("meta", sa.JSON()),
        sa.column("lang", sa.String()),
    )
    translations = sa.table(
        "content_block_translations",
        sa.column("content_block_id", sa.String()),
        sa.column("lang", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
    )
    images = sa.table(
        "content_images",
        sa.column("content_block_id", sa.String()),
        sa.column("url", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    sections_row = conn.execute(
        sa.select(content_blocks.c.id, content_blocks.c.meta).where(content_blocks.c.key == "home.sections")
    ).mappings().first()
    if not sections_row:
        return

    sections_meta = _as_dict(sections_row["meta"])
    blocks = _as_list(sections_meta.get("blocks"))

    # Remove legacy hero blocks if present.
    blocks = [
        b
        for b in blocks
        if not (
            isinstance(b, dict)
            and (_as_str(b.get("type")).lower() == "hero" or _as_str(b.get("key")).lower() == "hero")
        )
    ]

    has_hero_like = any(isinstance(b, dict) and _as_str(b.get("type")).lower() in {"banner", "carousel"} for b in blocks)

    if not has_hero_like:
        hero_row = conn.execute(
            sa.select(
                content_blocks.c.id,
                content_blocks.c.title,
                content_blocks.c.body_markdown,
                content_blocks.c.meta,
                content_blocks.c.lang,
            ).where(content_blocks.c.key == "home.hero")
        ).mappings().first()

        headline_en = ""
        headline_ro = ""
        sub_en = ""
        sub_ro = ""
        cta_label = ""
        cta_url = ""
        image_url = ""

        if hero_row:
            base_lang = _as_str(hero_row.get("lang")) or "en"
            base_title = _as_str(hero_row.get("title"))
            base_body = _as_str(hero_row.get("body_markdown"))
            if base_lang == "ro":
                headline_ro = base_title
                sub_ro = base_body
            else:
                headline_en = base_title
                sub_en = base_body

            hero_meta = _as_dict(hero_row.get("meta"))
            cta_label = _as_str(hero_meta.get("cta_label") or hero_meta.get("cta"))
            cta_url = _as_str(hero_meta.get("cta_url") or hero_meta.get("cta_link"))
            image_url = _as_str(hero_meta.get("image"))

            hero_id = hero_row.get("id")
            if hero_id:
                img = conn.execute(
                    sa.select(images.c.url)
                    .where(images.c.content_block_id == hero_id)
                    .order_by(images.c.sort_order, images.c.created_at)
                    .limit(1)
                ).scalar()
                if isinstance(img, str) and img.strip():
                    image_url = image_url or img.strip()

                rows = conn.execute(
                    sa.select(translations.c.lang, translations.c.title, translations.c.body_markdown).where(
                        translations.c.content_block_id == hero_id
                    )
                ).mappings().all()
                for t in rows:
                    lang = _as_str(t.get("lang")).lower()
                    if lang == "en":
                        headline_en = _as_str(t.get("title")) or headline_en
                        sub_en = _as_str(t.get("body_markdown")) or sub_en
                    if lang == "ro":
                        headline_ro = _as_str(t.get("title")) or headline_ro
                        sub_ro = _as_str(t.get("body_markdown")) or sub_ro

        headline_en = headline_en or headline_ro
        headline_ro = headline_ro or headline_en
        sub_en = sub_en or sub_ro
        sub_ro = sub_ro or sub_en

        banner = {
            "key": "hero_banner",
            "type": "banner",
            "enabled": True,
            "title": {"en": "", "ro": ""},
            "slide": {
                "image_url": image_url,
                "alt": {"en": "", "ro": ""},
                "headline": {"en": headline_en, "ro": headline_ro},
                "subheadline": {"en": sub_en, "ro": sub_ro},
                "cta_label": {"en": cta_label, "ro": cta_label},
                "cta_url": cta_url,
                "variant": "split",
                "size": "L",
                "text_style": "dark",
            },
        }
        blocks.insert(0, banner)

    sections_meta["blocks"] = blocks

    # Keep legacy lists consistent (even if unused).
    sections = _as_list(sections_meta.get("sections"))
    sections_meta["sections"] = [
        s for s in sections if not (isinstance(s, dict) and _as_str(s.get("id")).lower() == "hero")
    ]
    order = _as_list(sections_meta.get("order"))
    sections_meta["order"] = [o for o in order if _as_str(o).lower() != "hero"]

    conn.execute(
        sa.update(content_blocks)
        .where(content_blocks.c.id == sections_row["id"])
        .values(meta=sections_meta)
    )


def downgrade() -> None:
    # Best-effort downgrade: remove the inserted banner if present.
    conn = op.get_bind()
    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.String()),
        sa.column("key", sa.String()),
        sa.column("meta", sa.JSON()),
    )
    row = conn.execute(
        sa.select(content_blocks.c.id, content_blocks.c.meta).where(content_blocks.c.key == "home.sections")
    ).mappings().first()
    if not row:
        return
    meta = _as_dict(row["meta"])
    blocks = _as_list(meta.get("blocks"))
    next_blocks = [
        b for b in blocks if not (isinstance(b, dict) and _as_str(b.get("key")).lower() == "hero_banner")
    ]
    if next_blocks == blocks:
        return
    meta["blocks"] = next_blocks
    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta))
