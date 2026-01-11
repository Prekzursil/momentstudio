"""guest checkout support

Revision ID: 0049
Revises: 0048
Create Date: 2026-01-11
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("carts") as batch:
        batch.add_column(sa.Column("guest_email", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("guest_email_verification_token", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("guest_email_verification_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("guest_email_verified_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("addresses") as batch:
        batch.alter_column("user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("customer_email", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("customer_name", sa.String(length=255), nullable=True))
        batch.alter_column("user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE orders
            SET customer_email = u.email,
                customer_name = COALESCE(u.name, u.email)
            FROM users u
            WHERE orders.user_id = u.id
            """
        )
    else:
        op.execute(
            """
            UPDATE orders
            SET customer_email = (SELECT email FROM users WHERE users.id = orders.user_id),
                customer_name = COALESCE((SELECT name FROM users WHERE users.id = orders.user_id), (SELECT email FROM users WHERE users.id = orders.user_id))
            """
        )

    with op.batch_alter_table("orders") as batch:
        batch.alter_column("customer_email", existing_type=sa.String(length=255), nullable=False)
        batch.alter_column("customer_name", existing_type=sa.String(length=255), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("orders") as batch:
        batch.alter_column("user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
        batch.drop_column("customer_name")
        batch.drop_column("customer_email")

    with op.batch_alter_table("addresses") as batch:
        batch.alter_column("user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    with op.batch_alter_table("carts") as batch:
        batch.drop_column("guest_email_verified_at")
        batch.drop_column("guest_email_verification_expires_at")
        batch.drop_column("guest_email_verification_token")
        batch.drop_column("guest_email")

