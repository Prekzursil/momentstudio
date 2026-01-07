"""usernames and alias history

Revision ID: 0037
Revises: 0036
Create Date: 2026-01-07
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import re
import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


USERNAME_MAX_LEN = 30
USERNAME_MIN_LEN = 3
USERNAME_ALLOWED_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _sanitize_username(raw: str) -> str:
    candidate = USERNAME_ALLOWED_RE.sub("-", (raw or "").strip())
    candidate = candidate.strip("._-")
    if not candidate:
        candidate = "user"
    if not candidate[0].isalnum():
        candidate = f"u{candidate}"
    candidate = candidate[:USERNAME_MAX_LEN]
    while len(candidate) < USERNAME_MIN_LEN:
        candidate = f"{candidate}0"
        candidate = candidate[:USERNAME_MAX_LEN]
    return candidate


def _make_unique_username(base: str, used: set[str]) -> str:
    base = base[:USERNAME_MAX_LEN]
    if base not in used:
        used.add(base)
        return base
    suffix_num = 2
    while True:
        suffix = f"-{suffix_num}"
        trimmed = base[: USERNAME_MAX_LEN - len(suffix)]
        candidate = f"{trimmed}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        suffix_num += 1


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(length=USERNAME_MAX_LEN), nullable=True))
    op.add_column("users", sa.Column("name_tag", sa.Integer(), nullable=True))

    op.create_table(
        "user_username_history",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("username", sa.String(length=USERNAME_MAX_LEN), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_username_history_user_id", "user_username_history", ["user_id"])

    op.create_table(
        "user_display_name_history",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("name_tag", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_display_name_history_user_id", "user_display_name_history", ["user_id"])

    conn = op.get_bind()

    users = sa.table(
        "users",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("email", sa.String()),
        sa.column("name", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("username", sa.String()),
        sa.column("name_tag", sa.Integer()),
    )
    username_history = sa.table(
        "user_username_history",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("user_id", sa.UUID(as_uuid=True)),
        sa.column("username", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    name_history = sa.table(
        "user_display_name_history",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("user_id", sa.UUID(as_uuid=True)),
        sa.column("name", sa.String()),
        sa.column("name_tag", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    rows = conn.execute(
        sa.select(users.c.id, users.c.email, users.c.name, users.c.created_at).order_by(users.c.created_at, users.c.id)
    ).all()

    used_usernames: set[str] = set()
    next_tag_by_name: dict[str, int] = {}
    username_history_rows: list[dict[str, object]] = []
    name_history_rows: list[dict[str, object]] = []
    now = datetime.now(timezone.utc)

    for user_id, email, name, created_at in rows:
        local_part = str(email or "").split("@")[0]
        base_username = _sanitize_username(local_part)
        username_value = _make_unique_username(base_username, used_usernames)

        display_name = (str(name or "")).strip()
        if not display_name:
            display_name = username_value
        display_name = display_name[:255]

        name_tag_value = next_tag_by_name.get(display_name, 0)
        next_tag_by_name[display_name] = name_tag_value + 1

        conn.execute(
            sa.update(users)
            .where(users.c.id == user_id)
            .values(username=username_value, name=display_name, name_tag=name_tag_value)
        )

        timestamp = created_at or now
        username_history_rows.append(
            {"id": uuid.uuid4(), "user_id": user_id, "username": username_value, "created_at": timestamp}
        )
        name_history_rows.append(
            {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "name": display_name,
                "name_tag": name_tag_value,
                "created_at": timestamp,
            }
        )

    if username_history_rows:
        conn.execute(sa.insert(username_history), username_history_rows)
    if name_history_rows:
        conn.execute(sa.insert(name_history), name_history_rows)

    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_unique_constraint("uq_users_name_name_tag", "users", ["name", "name_tag"])
    op.alter_column("users", "username", nullable=False)
    op.alter_column("users", "name_tag", nullable=False, server_default="0")


def downgrade() -> None:
    op.alter_column("users", "name_tag", server_default=None)
    op.drop_constraint("uq_users_name_name_tag", "users", type_="unique")
    op.drop_index("ix_users_username", table_name="users")

    op.drop_index("ix_user_display_name_history_user_id", table_name="user_display_name_history")
    op.drop_table("user_display_name_history")
    op.drop_index("ix_user_username_history_user_id", table_name="user_username_history")
    op.drop_table("user_username_history")

    op.drop_column("users", "name_tag")
    op.drop_column("users", "username")

