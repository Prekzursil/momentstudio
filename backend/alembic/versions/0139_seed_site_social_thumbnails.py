"""Seed default thumbnails for site.social pages.

Revision ID: 0139
Revises: 0138
Create Date: 2026-02-03
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0139"
down_revision: str | None = "0138"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


THUMBNAILS_BY_URL: dict[str, str] = {
    "https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx": "https://scontent.cdninstagram.com/v/t51.2885-19/491737685_1404380280564762_4553794314336734014_n.jpg?stp=dst-jpg_s100x100_tt6&_nc_cat=105&ccb=7-5&_nc_sid=bf7eb4&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDc5LkMzIn0%3D&_nc_ohc=oVszzF6T4WkQ7kNvwH05s8p&_nc_oc=AdnmCW5jZxFWsC_l84jMMOhWDnPopxkopgd2b7dJwVeNonkwQ3MttmyUy1H8IXRHtqs&_nc_zt=24&_nc_ht=scontent.cdninstagram.com&oh=00_AfrHp6cEljVWRcmq632m2CFAjfN4pX5H1zMGgw77DxLD4A&oe=696AF278",
    "https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy": "https://scontent.cdninstagram.com/v/t51.2885-19/18444162_1923764237836500_5339930760352628736_a.jpg?stp=dst-jpg_s100x100_tt6&_nc_cat=101&ccb=7-5&_nc_sid=bf7eb4&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy43ODkuQzMifQ%3D%3D&_nc_ohc=fHZixS3eRyoQ7kNvwFnMsAC&_nc_oc=Adn3mAe9jOCEK4RoigUWl5VRfqWKMjPMx6JMA6fPMqVrMeJHVJv9VWl0Ey6NUQl_ebk&_nc_zt=24&_nc_ht=scontent.cdninstagram.com&oh=00_AfpVriUd_E1enhIHe27PtBjjtmT52XGsWKrxI6OUYEPZFw&oe=696B2424",
    "https://www.facebook.com/share/17YqBmfX5x/": "https://scontent.fotp3-3.fna.fbcdn.net/v/t39.30808-1/528299650_122135861786841687_5365101171661479697_n.jpg?stp=dst-jpg_tt6&cstp=mx1843x1843&ctp=s720x720&_nc_cat=102&ccb=1-7&_nc_sid=3ab345&_nc_ohc=KFbwKVKfZE8Q7kNvwG6OhPU&_nc_oc=AdkcvFx5eBYqn14HFRlYm0FrQh6xsBvdOqJ4SA7eaPxd_H3m-0lY5a-LpQZdINEROFU&_nc_zt=24&_nc_ht=scontent.fotp3-3.fna&_nc_gid=FWQV7MGLBxrGVnj3AN68gQ&oh=00_AfrgxST7IDIFKCFTWh6HMWJowwdDg7k_mQP7owVKpSyoAw&oe=696AF544",
    "https://www.facebook.com/share/1APqKJM6Zi/": "https://scontent.fotp3-3.fna.fbcdn.net/v/t39.30808-1/464863122_122181436856162857_8128354325909289505_n.jpg?stp=dst-jpg_tt6&cstp=mx1035x1035&ctp=s720x720&_nc_cat=102&ccb=1-7&_nc_sid=3ab345&_nc_ohc=Sjdlw0SPfAcQ7kNvwHdNV_Q&_nc_oc=AdlgKxSx6B1g32lk_3qQl-_Yscm5gdTkEraRJekcN4W0r1X0ytJDYCIpzKsvPSY73Pk&_nc_zt=24&_nc_ht=scontent.fotp3-3.fna&_nc_gid=YDbNH4WGMtTlqg1t0PfLfw&oh=00_Afpu3eq4gdDPMtPe4MPpE8aYr44VX8uZvZrE7NavfESErg&oe=696AF510",
}


def _as_dict(value: object | None) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: object | None) -> list:
    return value if isinstance(value, list) else []


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
                content_blocks.c.key == "site.social"
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        return

    meta = _as_dict(row["meta"])
    def patch_page_list(key: str) -> bool:
        local_changed = False
        pages = _as_list(meta.get(key))
        if not pages:
            return local_changed

        for page in pages:
            if not isinstance(page, dict):
                continue
            url = _as_str(page.get("url"))
            if not url:
                continue
            desired = THUMBNAILS_BY_URL.get(url)
            if not desired:
                continue
            current_thumb = _as_str(page.get("thumbnail_url"))
            if current_thumb:
                continue
            page["thumbnail_url"] = desired
            local_changed = True

        meta[key] = pages
        return local_changed

    changed = patch_page_list("instagram_pages") or patch_page_list("facebook_pages")

    if not changed:
        return

    conn.execute(sa.update(content_blocks).where(content_blocks.c.id == row["id"]).values(meta=meta, updated_at=now))

    current_version = int(row.get("version") or 1)
    conn.execute(
        sa.update(versions)
        .where(sa.and_(versions.c.content_block_id == row["id"], versions.c.version == current_version))
        .values(meta=meta)
    )


def downgrade() -> None:
    # Intentionally no-op: removing thumbnails would overwrite user edits.
    return
