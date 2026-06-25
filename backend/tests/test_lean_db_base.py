"""Lean coverage for ``app.db.base``.

The ``uuid_pk`` factory builds a UUID primary-key column. Exercising it on a
real declarative model proves the ``mapped_column`` body executes and produces a
usable, ``default``-bearing primary-key column whose value is a generated UUID.
"""

import uuid

from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped

from app.db.base import Base, uuid_pk


def test_uuid_pk_builds_uuid_primary_key_column() -> None:
    class _Widget(Base):
        __tablename__ = "_lean_db_base_widget"

        id: Mapped[uuid.UUID] = uuid_pk()

    column = inspect(_Widget).columns["id"]

    assert column.primary_key is True
    assert isinstance(column.type, UUID)
    assert column.type.as_uuid is True
    # The factory wires ``default=uuid.uuid4`` so a fresh instance gets a UUID.
    generated = column.default.arg(None)
    assert isinstance(generated, uuid.UUID)
