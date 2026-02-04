"""Strip the hardcoded legal index table (uses meta.last_updated instead).

Revision ID: 0145
Revises: 0144
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0145"
down_revision: str | None = "0144"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _strip_last_updated_table(body: str) -> str:
    lines = (body or "").replace("\r\n", "\n").split("\n")
    out: list[str] = []
    in_table = False
    for line in lines:
        trimmed = (line or "").strip().lower()
        if not in_table:
            if trimmed.startswith("|") and ("last updated" in trimmed or "ultima actualizare" in trimmed):
                in_table = True
                continue
            out.append(line)
            continue
        if (line or "").strip().startswith("|"):
            continue
        in_table = False
        out.append(line)
    cleaned = "\n".join(out).strip()
    return f"{cleaned}\n" if cleaned else ""


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("version", sa.Integer()),
        sa.column("body_markdown", sa.Text()),
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
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("body_markdown", sa.Text()),
        sa.column("translations", sa.JSON()),
    )

    row = (
        conn.execute(
            sa.select(content_blocks.c.id, content_blocks.c.version, content_blocks.c.body_markdown).where(
                content_blocks.c.key == "page.terms"
            )
        )
        .mappings()
        .first()
    )
    if not row:
        return

    block_id = row["id"]
    current_version = int(row.get("version") or 1)
    current_body = (row.get("body_markdown") or "").replace("\r\n", "\n")
    next_body = _strip_last_updated_table(current_body)

    tr_row = (
        conn.execute(
            sa.select(translations.c.id, translations.c.title, translations.c.body_markdown).where(
                translations.c.content_block_id == block_id,
                translations.c.lang == "ro",
            )
        )
        .mappings()
        .first()
    )
    tr_id = tr_row["id"] if tr_row else None
    tr_title = (tr_row.get("title") or "") if tr_row else ""
    tr_body = (tr_row.get("body_markdown") or "").replace("\r\n", "\n") if tr_row else ""
    next_tr_body = _strip_last_updated_table(tr_body) if tr_row else ""

    base_changed = next_body != current_body
    tr_changed = bool(tr_row) and next_tr_body != tr_body
    if not base_changed and not tr_changed:
        return

    if base_changed:
        conn.execute(
            sa.update(content_blocks).where(content_blocks.c.id == block_id).values(body_markdown=next_body, updated_at=now)
        )

    if tr_changed and tr_id:
        conn.execute(sa.update(translations).where(translations.c.id == tr_id).values(body_markdown=next_tr_body))

    version_row = (
        conn.execute(
            sa.select(versions.c.body_markdown, versions.c.translations).where(
                sa.and_(versions.c.content_block_id == block_id, versions.c.version == current_version)
            )
        )
        .mappings()
        .first()
    )
    if not version_row:
        return

    updates: dict[str, object] = {}
    if base_changed:
        updates["body_markdown"] = next_body

    if tr_changed:
        tr_list = version_row.get("translations") or []
        next_list: list[dict[str, object]] = []
        found = False
        if isinstance(tr_list, list):
            for item in tr_list:
                if not isinstance(item, dict):
                    continue
                if item.get("lang") == "ro":
                    found = True
                    next_item = dict(item)
                    next_item["title"] = next_item.get("title") or tr_title
                    next_item["body_markdown"] = next_tr_body
                    next_list.append(next_item)
                else:
                    next_list.append(item)
        if not found and tr_id:
            next_list.append({"lang": "ro", "title": tr_title, "body_markdown": next_tr_body})
        updates["translations"] = next_list

    if updates:
        conn.execute(
            sa.update(versions)
            .where(sa.and_(versions.c.content_block_id == block_id, versions.c.version == current_version))
            .values(**updates)
        )


def downgrade() -> None:
    # Intentionally no-op: restoring the old table would overwrite user edits.
    return

