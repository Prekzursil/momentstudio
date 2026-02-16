"""add sameday easybox mirror tables

Revision ID: 0156_sameday_easybox_mirror
Revises: 0155_media_job_retry_policy_overrides
Create Date: 2026-02-18 03:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0156_sameday_easybox_mirror"
down_revision: str | Sequence[str] | None = "0155_media_job_retry_policy_overrides"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _provider_enum() -> sa.Enum:
    bind = op.get_bind()
    backend = (bind.dialect.name or "").lower()
    if backend == "postgresql":
        return sa.Enum("sameday", name="shippinglockerprovider")
    return sa.Enum("sameday", name="shippinglockerprovider", native_enum=False)


def _status_enum() -> sa.Enum:
    bind = op.get_bind()
    backend = (bind.dialect.name or "").lower()
    if backend == "postgresql":
        return sa.Enum("running", "success", "failed", name="shippinglockersyncstatus")
    return sa.Enum("running", "success", "failed", name="shippinglockersyncstatus", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "shipping_lockers_mirror",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", _provider_enum(), nullable=False, server_default="sameday"),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("county", sa.String(length=120), nullable=True),
        sa.Column("postal_code", sa.String(length=32), nullable=True),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("source_payload_json", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "external_id",
            name="uq_shipping_lockers_mirror_provider_external",
        ),
    )
    op.create_index("ix_shipping_lockers_mirror_provider", "shipping_lockers_mirror", ["provider"], unique=False)
    op.create_index("ix_shipping_lockers_mirror_city", "shipping_lockers_mirror", ["city"], unique=False)
    op.create_index("ix_shipping_lockers_mirror_is_active", "shipping_lockers_mirror", ["is_active"], unique=False)
    op.create_index("ix_shipping_lockers_mirror_lat", "shipping_lockers_mirror", ["lat"], unique=False)
    op.create_index("ix_shipping_lockers_mirror_lng", "shipping_lockers_mirror", ["lng"], unique=False)
    op.create_index("ix_shipping_lockers_mirror_last_seen_at", "shipping_lockers_mirror", ["last_seen_at"], unique=False)
    op.create_index(
        "ix_shipping_lockers_mirror_provider_city",
        "shipping_lockers_mirror",
        ["provider", "city"],
        unique=False,
    )
    op.create_index(
        "ix_shipping_lockers_mirror_provider_is_active",
        "shipping_lockers_mirror",
        ["provider", "is_active"],
        unique=False,
    )

    op.create_table(
        "shipping_locker_sync_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", _provider_enum(), nullable=False, server_default="sameday"),
        sa.Column("status", _status_enum(), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("upserted_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deactivated_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("source_url_used", sa.String(length=512), nullable=True),
        sa.Column("payload_hash", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shipping_locker_sync_runs_provider", "shipping_locker_sync_runs", ["provider"], unique=False)
    op.create_index("ix_shipping_locker_sync_runs_status", "shipping_locker_sync_runs", ["status"], unique=False)
    op.create_index("ix_shipping_locker_sync_runs_started_at", "shipping_locker_sync_runs", ["started_at"], unique=False)
    op.create_index(
        "ix_shipping_locker_sync_runs_provider_started_at",
        "shipping_locker_sync_runs",
        ["provider", "started_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_shipping_locker_sync_runs_provider_started_at", table_name="shipping_locker_sync_runs")
    op.drop_index("ix_shipping_locker_sync_runs_started_at", table_name="shipping_locker_sync_runs")
    op.drop_index("ix_shipping_locker_sync_runs_status", table_name="shipping_locker_sync_runs")
    op.drop_index("ix_shipping_locker_sync_runs_provider", table_name="shipping_locker_sync_runs")
    op.drop_table("shipping_locker_sync_runs")

    op.drop_index("ix_shipping_lockers_mirror_provider_is_active", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_provider_city", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_last_seen_at", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_lng", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_lat", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_is_active", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_city", table_name="shipping_lockers_mirror")
    op.drop_index("ix_shipping_lockers_mirror_provider", table_name="shipping_lockers_mirror")
    op.drop_table("shipping_lockers_mirror")
