"""Seed default company info values for momentstudio.ro.

Revision ID: 0140
Revises: 0139
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0140"
down_revision: str | None = "0139"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


DEFAULT_COMPANY: dict[str, str] = {
    "name": "IONITA M.D. ADRIANA PFA",
    "registration_number": "F40/91/17012018",
    "cui": "38708340",
    "address": "Soldat Marin Nicolae 44, București, Sector 3",
    "phone": "+40723204204",
    "email": "momentstudio.ro@gmail.com",
}


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_str(value: object | None) -> str:
    return value.strip() if isinstance(value, str) else ""


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
                content_blocks.c.key == "site.company"
            )
        )
        .mappings()
        .first()
    )
    if not row:
        return

    meta = _as_dict(row["meta"])
    company = _as_dict(meta.get("company"))

    changed = False
    for key, value in DEFAULT_COMPANY.items():
        if _as_str(company.get(key)):
            continue
        company[key] = value
        changed = True

    if not changed:
        return

    meta.setdefault("version", 1)
    meta["company"] = company

    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta, updated_at=now))

    current_version = int(row.get("version") or 1)
    conn.execute(
        sa.update(versions)
        .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
        .values(meta=meta)
    )


def downgrade() -> None:
    # Intentionally no-op: removing seeded company info would overwrite user edits.
    return

