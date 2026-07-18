"""add theme documents (themes, theme_versions, theme_audit_log)

Revision ID: 0159_add_theme_docs
Revises: 0158_sameday_sync_canary_fields
Create Date: 2026-07-04
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.services.theme_service import DEFAULT_SCHEMA_VERSION, default_theme_tokens

# revision identifiers, used by Alembic.
revision: str = "0159_add_theme_docs"
down_revision: str | Sequence[str] | None = "0158_sameday_sync_canary_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    is_postgres = conn.dialect.name == "postgresql"
    uuid_type = postgresql.UUID(as_uuid=True) if is_postgres else sa.String()

    theme_status = postgresql.ENUM(
        "draft", "published", name="themestatus", create_type=False
    )
    theme_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "themes",
        sa.Column("id", uuid_type, primary_key=True, nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("tokens", sa.JSON(), nullable=False),
        sa.Column("status", theme_status, nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "theme_versions",
        sa.Column("id", uuid_type, primary_key=True, nullable=False),
        sa.Column(
            "theme_id",
            uuid_type,
            sa.ForeignKey("themes.id"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("tokens", sa.JSON(), nullable=False),
        sa.Column("status", theme_status, nullable=False),
        sa.Column(
            "created_by_user_id",
            uuid_type,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "theme_audit_log",
        sa.Column("id", uuid_type, primary_key=True, nullable=False),
        sa.Column(
            "theme_version_id",
            uuid_type,
            sa.ForeignKey("theme_versions.id"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("user_id", uuid_type, nullable=True),
        sa.Column("chain_prev_hash", sa.String(length=64), nullable=True),
        sa.Column("chain_hash", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    _seed_default_theme(conn, is_postgres, theme_status)


def _seed_default_theme(conn, is_postgres, theme_status) -> None:  # type: ignore[no-untyped-def]
    """Idempotent existence-checked seed of the singleton default theme.

    Reuses the same compiled defaults as ``ensure_default_theme`` so the
    migration (deploy) and ``create_all`` (test) paths produce an identical row.
    Mirrors the idempotent seed pattern in ``0135_seed_optional_site_content``.
    """

    themes = sa.table(
        "themes",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("schema_version", sa.Integer()),
        sa.column("tokens", sa.JSON()),
        sa.column("status", theme_status),
        sa.column("version", sa.Integer()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    versions = sa.table(
        "theme_versions",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("theme_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("schema_version", sa.Integer()),
        sa.column("tokens", sa.JSON()),
        sa.column("status", theme_status),
        sa.column("created_by_user_id", sa.UUID(as_uuid=True)),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    exists = conn.execute(sa.select(themes.c.id).limit(1)).first()
    if exists:
        return

    def status_value(value: str) -> sa.ColumnElement:
        if is_postgres:
            return sa.cast(sa.literal(value), theme_status)
        return sa.literal(value)

    now = datetime.now(timezone.utc)
    tokens = default_theme_tokens()
    theme_id = uuid.uuid4()
    conn.execute(
        sa.insert(themes).values(
            id=theme_id,
            schema_version=DEFAULT_SCHEMA_VERSION,
            tokens=tokens,
            status=status_value("published"),
            version=1,
            published_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    conn.execute(
        sa.insert(versions).values(
            id=uuid.uuid4(),
            theme_id=theme_id,
            version=1,
            schema_version=DEFAULT_SCHEMA_VERSION,
            tokens=tokens,
            status=status_value("published"),
            created_by_user_id=None,
            published_at=now,
            created_at=now,
        )
    )


def downgrade() -> None:
    op.drop_table("theme_audit_log")
    op.drop_table("theme_versions")
    op.drop_table("themes")
    theme_status = postgresql.ENUM(
        "draft", "published", name="themestatus", create_type=False
    )
    theme_status.drop(op.get_bind(), checkfirst=True)
