"""Create local-first DAM foundation tables and backfill legacy content images.

Revision ID: 0152
Revises: 0151
Create Date: 2026-02-15
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0152"
down_revision: str | None = "0151"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


media_asset_type = postgresql.ENUM("image", "video", "document", name="mediaassettype", create_type=False)
media_asset_status = postgresql.ENUM(
    "draft",
    "approved",
    "rejected",
    "archived",
    "trashed",
    name="mediaassetstatus",
    create_type=False,
)
media_visibility = postgresql.ENUM("public", "private", name="mediavisibility", create_type=False)
media_job_type = postgresql.ENUM(
    "ingest",
    "variant",
    "edit",
    "ai_tag",
    "duplicate_scan",
    name="mediajobtype",
    create_type=False,
)
media_job_status = postgresql.ENUM(
    "queued",
    "processing",
    "completed",
    "failed",
    name="mediajobstatus",
    create_type=False,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def upgrade() -> None:
    bind = op.get_bind()

    media_asset_type.create(bind, checkfirst=True)
    media_asset_status.create(bind, checkfirst=True)
    media_visibility.create(bind, checkfirst=True)
    media_job_type.create(bind, checkfirst=True)
    media_job_status.create(bind, checkfirst=True)

    op.create_table(
        "media_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_type", media_asset_type, nullable=False),
        sa.Column("status", media_asset_status, nullable=False, server_default="draft"),
        sa.Column("visibility", media_visibility, nullable=False, server_default="private"),
        sa.Column("source_kind", sa.String(length=64), nullable=False, server_default="upload"),
        sa.Column("source_ref", sa.String(length=255), nullable=True),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("public_url", sa.String(length=512), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column("perceptual_hash", sa.String(length=64), nullable=True),
        sa.Column("dedupe_group", sa.String(length=64), nullable=True),
        sa.Column("rights_license", sa.String(length=120), nullable=True),
        sa.Column("rights_owner", sa.String(length=255), nullable=True),
        sa.Column("rights_notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trashed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("storage_key"),
        sa.UniqueConstraint("public_url"),
    )
    op.create_index(op.f("ix_media_assets_asset_type"), "media_assets", ["asset_type"], unique=False)
    op.create_index(op.f("ix_media_assets_status"), "media_assets", ["status"], unique=False)
    op.create_index(op.f("ix_media_assets_visibility"), "media_assets", ["visibility"], unique=False)
    op.create_index(op.f("ix_media_assets_source_kind"), "media_assets", ["source_kind"], unique=False)
    op.create_index(op.f("ix_media_assets_source_ref"), "media_assets", ["source_ref"], unique=False)
    op.create_index(op.f("ix_media_assets_checksum_sha256"), "media_assets", ["checksum_sha256"], unique=False)
    op.create_index(op.f("ix_media_assets_perceptual_hash"), "media_assets", ["perceptual_hash"], unique=False)
    op.create_index(op.f("ix_media_assets_dedupe_group"), "media_assets", ["dedupe_group"], unique=False)
    op.create_index(op.f("ix_media_assets_created_by_user_id"), "media_assets", ["created_by_user_id"], unique=False)
    op.create_index(op.f("ix_media_assets_approved_by_user_id"), "media_assets", ["approved_by_user_id"], unique=False)
    op.create_index(op.f("ix_media_assets_trashed_at"), "media_assets", ["trashed_at"], unique=False)

    op.create_table(
        "media_asset_i18n",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("alt_text", sa.String(length=255), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("asset_id", "lang", name="uq_media_asset_i18n_asset_lang"),
    )
    op.create_index(op.f("ix_media_asset_i18n_asset_id"), "media_asset_i18n", ["asset_id"], unique=False)
    op.create_index(op.f("ix_media_asset_i18n_lang"), "media_asset_i18n", ["lang"], unique=False)

    op.create_table(
        "media_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("value"),
    )
    op.create_index(op.f("ix_media_tags_value"), "media_tags", ["value"], unique=False)

    op.create_table(
        "media_asset_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["media_tags.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("asset_id", "tag_id", name="uq_media_asset_tags_asset_tag"),
    )
    op.create_index(op.f("ix_media_asset_tags_asset_id"), "media_asset_tags", ["asset_id"], unique=False)
    op.create_index(op.f("ix_media_asset_tags_tag_id"), "media_asset_tags", ["tag_id"], unique=False)

    op.create_table(
        "media_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile", sa.String(length=64), nullable=False),
        sa.Column("format", sa.String(length=24), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("public_url", sa.String(length=512), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("asset_id", "profile", name="uq_media_variant_asset_profile"),
    )
    op.create_index(op.f("ix_media_variants_asset_id"), "media_variants", ["asset_id"], unique=False)
    op.create_index(op.f("ix_media_variants_profile"), "media_variants", ["profile"], unique=False)

    op.create_table(
        "media_usage_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("source_key", sa.String(length=255), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=True),
        sa.Column("field_path", sa.String(length=255), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "asset_id",
            "source_type",
            "source_key",
            "field_path",
            "lang",
            name="uq_media_usage_edges_asset_source",
        ),
    )
    op.create_index(op.f("ix_media_usage_edges_asset_id"), "media_usage_edges", ["asset_id"], unique=False)
    op.create_index(op.f("ix_media_usage_edges_source_type"), "media_usage_edges", ["source_type"], unique=False)
    op.create_index(op.f("ix_media_usage_edges_source_key"), "media_usage_edges", ["source_key"], unique=False)
    op.create_index(op.f("ix_media_usage_edges_source_id"), "media_usage_edges", ["source_id"], unique=False)
    op.create_index(op.f("ix_media_usage_edges_lang"), "media_usage_edges", ["lang"], unique=False)

    op.create_table(
        "media_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("job_type", media_job_type, nullable=False),
        sa.Column("status", media_job_status, nullable=False, server_default="queued"),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("progress_pct", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(length=120), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(op.f("ix_media_jobs_asset_id"), "media_jobs", ["asset_id"], unique=False)
    op.create_index(op.f("ix_media_jobs_job_type"), "media_jobs", ["job_type"], unique=False)
    op.create_index(op.f("ix_media_jobs_status"), "media_jobs", ["status"], unique=False)

    op.create_table(
        "media_collections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=190), nullable=False),
        sa.Column("visibility", media_visibility, nullable=False, server_default="private"),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_media_collections_slug"), "media_collections", ["slug"], unique=False)
    op.create_index(op.f("ix_media_collections_visibility"), "media_collections", ["visibility"], unique=False)

    op.create_table(
        "media_collection_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["media_collections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("collection_id", "asset_id", name="uq_media_collection_items_collection_asset"),
    )
    op.create_index(op.f("ix_media_collection_items_collection_id"), "media_collection_items", ["collection_id"], unique=False)
    op.create_index(op.f("ix_media_collection_items_asset_id"), "media_collection_items", ["asset_id"], unique=False)

    op.create_table(
        "media_approval_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", media_asset_status, nullable=True),
        sa.Column("to_status", media_asset_status, nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(op.f("ix_media_approval_events_asset_id"), "media_approval_events", ["asset_id"], unique=False)

    _backfill_legacy_content_images()


def _backfill_legacy_content_images() -> None:
    conn = op.get_bind()
    now = _now()

    content_images = sa.table(
        "content_images",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("content_block_id", postgresql.UUID(as_uuid=True)),
        sa.column("url", sa.String()),
        sa.column("alt_text", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
    )
    content_image_tags = sa.table(
        "content_image_tags",
        sa.column("content_image_id", postgresql.UUID(as_uuid=True)),
        sa.column("tag", sa.String()),
    )
    media_assets = sa.table(
        "media_assets",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("asset_type", sa.String()),
        sa.column("status", sa.String()),
        sa.column("visibility", sa.String()),
        sa.column("source_kind", sa.String()),
        sa.column("source_ref", sa.String()),
        sa.column("storage_key", sa.String()),
        sa.column("public_url", sa.String()),
        sa.column("original_filename", sa.String()),
        sa.column("mime_type", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("approved_at", sa.DateTime(timezone=True)),
    )
    media_asset_i18n = sa.table(
        "media_asset_i18n",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("asset_id", postgresql.UUID(as_uuid=True)),
        sa.column("lang", sa.String()),
        sa.column("alt_text", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    media_tags = sa.table(
        "media_tags",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("value", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    media_asset_tags = sa.table(
        "media_asset_tags",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("asset_id", postgresql.UUID(as_uuid=True)),
        sa.column("tag_id", postgresql.UUID(as_uuid=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    media_usage_edges = sa.table(
        "media_usage_edges",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("asset_id", postgresql.UUID(as_uuid=True)),
        sa.column("source_type", sa.String()),
        sa.column("source_key", sa.String()),
        sa.column("source_id", sa.String()),
        sa.column("field_path", sa.String()),
        sa.column("lang", sa.String()),
        sa.column("last_seen_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    block_key_rows = conn.execute(sa.select(content_blocks.c.id, content_blocks.c.key)).all()
    block_key_by_id = {row[0]: row[1] for row in block_key_rows}

    rows = conn.execute(
        sa.select(
            content_images.c.id,
            content_images.c.content_block_id,
            content_images.c.url,
            content_images.c.alt_text,
            content_images.c.created_at,
        )
    ).all()
    if not rows:
        return

    tag_rows = conn.execute(
        sa.select(content_image_tags.c.content_image_id, content_image_tags.c.tag)
    ).all()
    tags_by_image: dict[uuid.UUID, set[str]] = {}
    for image_id, tag_value in tag_rows:
        normalized = str(tag_value or "").strip().lower()
        if not normalized:
            continue
        tags_by_image.setdefault(image_id, set()).add(normalized)

    tag_ids: dict[str, uuid.UUID] = {}
    existing_tags = conn.execute(sa.select(media_tags.c.id, media_tags.c.value)).all()
    for tag_id, value in existing_tags:
        tag_ids[str(value)] = tag_id

    asset_id_by_url: dict[str, uuid.UUID] = {}
    inserted_asset_tag_keys: set[tuple[uuid.UUID, uuid.UUID]] = set()
    inserted_usage_keys: set[tuple[uuid.UUID, str, str, str, str | None]] = set()

    for image_id, block_id, url, alt_text, created_at in rows:
        public_url = str(url or "").strip()
        if not public_url.startswith("/media/"):
            continue
        if public_url in asset_id_by_url:
            asset_id = asset_id_by_url[public_url]
        else:
            asset_id = uuid.uuid4()
            storage_key = public_url.removeprefix("/media/")
            created_ts = created_at or now
            conn.execute(
                sa.insert(media_assets).values(
                    id=asset_id,
                    asset_type="image",
                    status="approved",
                    visibility="public",
                    source_kind="legacy_content_image",
                    source_ref=str(image_id),
                    storage_key=storage_key,
                    public_url=public_url,
                    original_filename=storage_key.split("/")[-1],
                    mime_type=None,
                    created_at=created_ts,
                    updated_at=created_ts,
                    approved_at=created_ts,
                )
            )
            if alt_text:
                conn.execute(
                    sa.insert(media_asset_i18n).values(
                        id=uuid.uuid4(),
                        asset_id=asset_id,
                        lang="en",
                        alt_text=str(alt_text)[:255],
                        created_at=created_ts,
                        updated_at=created_ts,
                    )
                )
                conn.execute(
                    sa.insert(media_asset_i18n).values(
                        id=uuid.uuid4(),
                        asset_id=asset_id,
                        lang="ro",
                        alt_text=str(alt_text)[:255],
                        created_at=created_ts,
                        updated_at=created_ts,
                    )
                )
            asset_id_by_url[public_url] = asset_id

        for tag_value in sorted(tags_by_image.get(image_id, set())):
            tag_id = tag_ids.get(tag_value)
            if tag_id is None:
                tag_id = uuid.uuid4()
                conn.execute(
                    sa.insert(media_tags).values(
                        id=tag_id,
                        value=tag_value,
                        created_at=now,
                    )
                )
                tag_ids[tag_value] = tag_id
            relation_key = (asset_id, tag_id)
            if relation_key not in inserted_asset_tag_keys:
                inserted_asset_tag_keys.add(relation_key)
                conn.execute(
                    sa.insert(media_asset_tags).values(
                        id=uuid.uuid4(),
                        asset_id=asset_id,
                        tag_id=tag_id,
                        created_at=now,
                    )
                )

        block_key = str(block_key_by_id.get(block_id) or "")
        if block_key:
            edge_key = (asset_id, "content_block", block_key, "images[]", None)
            if edge_key not in inserted_usage_keys:
                inserted_usage_keys.add(edge_key)
                conn.execute(
                    sa.insert(media_usage_edges).values(
                        id=uuid.uuid4(),
                        asset_id=asset_id,
                        source_type="content_block",
                        source_key=block_key,
                        source_id=str(block_id),
                        field_path="images[]",
                        lang=None,
                        last_seen_at=now,
                        created_at=now,
                    )
                )


def downgrade() -> None:
    op.drop_index(op.f("ix_media_approval_events_asset_id"), table_name="media_approval_events")
    op.drop_table("media_approval_events")

    op.drop_index(op.f("ix_media_collection_items_asset_id"), table_name="media_collection_items")
    op.drop_index(op.f("ix_media_collection_items_collection_id"), table_name="media_collection_items")
    op.drop_table("media_collection_items")

    op.drop_index(op.f("ix_media_collections_visibility"), table_name="media_collections")
    op.drop_index(op.f("ix_media_collections_slug"), table_name="media_collections")
    op.drop_table("media_collections")

    op.drop_index(op.f("ix_media_jobs_status"), table_name="media_jobs")
    op.drop_index(op.f("ix_media_jobs_job_type"), table_name="media_jobs")
    op.drop_index(op.f("ix_media_jobs_asset_id"), table_name="media_jobs")
    op.drop_table("media_jobs")

    op.drop_index(op.f("ix_media_usage_edges_lang"), table_name="media_usage_edges")
    op.drop_index(op.f("ix_media_usage_edges_source_id"), table_name="media_usage_edges")
    op.drop_index(op.f("ix_media_usage_edges_source_key"), table_name="media_usage_edges")
    op.drop_index(op.f("ix_media_usage_edges_source_type"), table_name="media_usage_edges")
    op.drop_index(op.f("ix_media_usage_edges_asset_id"), table_name="media_usage_edges")
    op.drop_table("media_usage_edges")

    op.drop_index(op.f("ix_media_variants_profile"), table_name="media_variants")
    op.drop_index(op.f("ix_media_variants_asset_id"), table_name="media_variants")
    op.drop_table("media_variants")

    op.drop_index(op.f("ix_media_asset_tags_tag_id"), table_name="media_asset_tags")
    op.drop_index(op.f("ix_media_asset_tags_asset_id"), table_name="media_asset_tags")
    op.drop_table("media_asset_tags")

    op.drop_index(op.f("ix_media_tags_value"), table_name="media_tags")
    op.drop_table("media_tags")

    op.drop_index(op.f("ix_media_asset_i18n_lang"), table_name="media_asset_i18n")
    op.drop_index(op.f("ix_media_asset_i18n_asset_id"), table_name="media_asset_i18n")
    op.drop_table("media_asset_i18n")

    op.drop_index(op.f("ix_media_assets_trashed_at"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_approved_by_user_id"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_created_by_user_id"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_dedupe_group"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_perceptual_hash"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_checksum_sha256"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_source_ref"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_source_kind"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_visibility"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_status"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_asset_type"), table_name="media_assets")
    op.drop_table("media_assets")

    media_job_status.drop(op.get_bind(), checkfirst=True)
    media_job_type.drop(op.get_bind(), checkfirst=True)
    media_visibility.drop(op.get_bind(), checkfirst=True)
    media_asset_status.drop(op.get_bind(), checkfirst=True)
    media_asset_type.drop(op.get_bind(), checkfirst=True)
