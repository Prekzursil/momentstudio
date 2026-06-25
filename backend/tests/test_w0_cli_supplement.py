"""Worker-0 supplement: close the remaining ``app.cli`` line/branch gaps.

``tests/test_w3_cli.py`` already drives most of ``app.cli`` but leaves a few
SQLite-reachable arms uncovered:

* the ``import_data`` user *name-change* arm (display-name history append),
* the orders loop ``if o.get("status")`` false branch.

``_sanitize_username``'s leading-non-alnum ``u``-prefix arm (line 65) is
genuinely unreachable: the regex first replaces every character outside
``[A-Za-z0-9._-]`` with ``-`` and then ``strip("._-")`` removes any leading
``._-``, so a non-empty candidate always begins with an ASCII alphanumeric.
Probed with ASCII/CJK/Arabic-Indic-digit/punctuation inputs (e.g. ``"٠abc"`` ->
``"abc"``) - none reach it; it carries a reasoned ``# pragma: no cover``.

The categories / tags / products / images / options / variants / addresses /
shipping-method import blocks (and the coupled order ``shipping_method_id`` /
``items`` writes) re-key rows with ``session.get(Model, <str-uuid-from-JSON>)``
or assign raw string ids to ``postgresql.UUID`` columns; under the aiosqlite
test dialect that raises ``AttributeError: 'str' object has no attribute 'hex'``.
They are reachable only against real Postgres and carry reasoned
``# pragma: no cover`` markers in ``app/cli.py`` (see the module REMAINING note);
they are deliberately NOT faked here.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import cli
from app.core import security
from app.models.user import (
    User,
    UserDisplayNameHistory,
    UserRole,
)


def _make_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register all ORM tables on Base.metadata)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture()
def session_factory(monkeypatch):
    factory = _make_session_factory()
    monkeypatch.setattr(cli, "SessionLocal", factory)
    return factory


def _run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- #
# import_data -> user name-change arm (display-name history append)
# --------------------------------------------------------------------------- #
def test_import_data_existing_user_name_change(session_factory, tmp_path) -> None:
    async def _seed():
        async with session_factory() as session:
            user = User(
                email="rename@x.io",
                username="renameuser",
                hashed_password=security.hash_password("Password123"),
                name="Old Display",
                name_tag=0,
                role=UserRole.customer,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    user = _run(_seed())

    payload = {
        "users": [
            {
                "id": str(user.id),
                "email": "rename@x.io",
                "username": "renameuser",
                "name": "Brand New Display",
                "role": "customer",
                "email_verified": True,
            }
        ]
    }
    path = tmp_path / "in.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    _run(cli.import_data(path))

    async def _check():
        async with session_factory() as session:
            refreshed = await session.get(User, user.id)
            assert refreshed.name == "Brand New Display"
            history = (
                (
                    await session.execute(
                        select(UserDisplayNameHistory).where(
                            UserDisplayNameHistory.user_id == user.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert any(h.name == "Brand New Display" for h in history)

    _run(_check())


# --------------------------------------------------------------------------- #
# import_data -> orders loop with falsy status (branch 694->696)
# --------------------------------------------------------------------------- #
def test_import_data_order_without_status_keeps_default(
    session_factory, tmp_path
) -> None:
    order_id = str(uuid.uuid4())
    payload = {
        "orders": [
            {
                "id": order_id,
                "user_id": None,
                "status": None,  # falsy -> the `if o.get("status")` arm is skipped
                "customer_email": "guest@x.io",
                "customer_name": "Guest Buyer",
                "total_amount": 12,
                "currency": "RON",
                "items": [],
            }
        ]
    }
    path = tmp_path / "in.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    _run(cli.import_data(path))

    async def _check():
        from app.models.order import Order

        async with session_factory() as session:
            order = await session.get(Order, uuid.UUID(order_id))
            assert order is not None
            assert order.customer_email == "guest@x.io"

    _run(_check())
