"""Lean-gate unit coverage for the ``audit_chain`` service.

Exercises the canonical-JSON/hash helpers and all three ``add_*_audit_log``
entry points with the hash chain both disabled (default) and enabled (linked
prev/tail hashes), plus the chain-state create-then-reuse path.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from app.core.config import settings
from app.models.audit import AuditChainState
from app.services import audit_chain

from tests.conftest import make_memory_session_factory


# --------------------------------------------------------------------------- #
# pure helpers                                                                 #
# --------------------------------------------------------------------------- #
def test_canonical_json_is_stable_and_sorted() -> None:
    assert audit_chain._canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'
    # default=str handles non-serializable values.
    out = audit_chain._canonical_json({"id": uuid4()})
    assert out.startswith('{"id":"')


def test_hash_bytes_changes_with_prev_and_material() -> None:
    h1 = audit_chain._hash_bytes("", "x")
    h2 = audit_chain._hash_bytes("prev", "x")
    h3 = audit_chain._hash_bytes("", "y")
    assert len({h1, h2, h3}) == 3
    assert len(h1) == 64


def test_hash_chain_enabled_reads_setting() -> None:
    prev = getattr(settings, "audit_hash_chain_enabled", False)
    settings.audit_hash_chain_enabled = True
    try:
        assert audit_chain.hash_chain_enabled() is True
    finally:
        settings.audit_hash_chain_enabled = prev


# --------------------------------------------------------------------------- #
# add_*_audit_log — disabled chain                                            #
# --------------------------------------------------------------------------- #
def test_add_logs_without_chain() -> None:
    factory = make_memory_session_factory()
    prev = getattr(settings, "audit_hash_chain_enabled", False)
    settings.audit_hash_chain_enabled = False

    async def flow() -> None:
        async with factory() as session:
            p = await audit_chain.add_product_audit_log(
                session,
                product_id=uuid4(),
                action="create",
                user_id=None,
                payload=None,
            )
            c = await audit_chain.add_content_audit_log(
                session,
                content_block_id=uuid4(),
                action="publish",
                version=1,
                user_id=None,
            )
            a = await audit_chain.add_admin_audit_log(
                session,
                action="login",
                actor_user_id=None,
                subject_user_id=None,
                data=None,
            )
            await session.commit()
            assert p.chain_hash is None
            assert c.chain_hash is None
            assert a.chain_hash is None

    try:
        asyncio.run(flow())
    finally:
        settings.audit_hash_chain_enabled = prev


# --------------------------------------------------------------------------- #
# add_*_audit_log — enabled chain                                             #
# --------------------------------------------------------------------------- #
def test_add_logs_with_chain_links_hashes() -> None:
    factory = make_memory_session_factory()
    prev = getattr(settings, "audit_hash_chain_enabled", False)
    settings.audit_hash_chain_enabled = True

    async def flow() -> None:
        async with factory() as session:
            pid = uuid4()
            uid = uuid4()
            first = await audit_chain.add_product_audit_log(
                session,
                product_id=pid,
                action="create",
                user_id=uid,
                payload="{}",
            )
            second = await audit_chain.add_product_audit_log(
                session,
                product_id=pid,
                action="update",
                user_id=uid,
                payload="{}",
            )
            await session.commit()

            # First entry has no prev; second links to first's hash.
            assert first.chain_prev_hash is None
            assert first.chain_hash is not None
            assert second.chain_prev_hash == first.chain_hash
            assert second.chain_hash != first.chain_hash

            # The chain-state row was created and updated to the latest tail.
            state = await session.get(AuditChainState, "product")
            assert state is not None and state.tail_hash == second.chain_hash

            # Content + admin chains run with non-null actors/subjects.
            c = await audit_chain.add_content_audit_log(
                session,
                content_block_id=uuid4(),
                action="publish",
                version=2,
                user_id=uid,
            )
            a = await audit_chain.add_admin_audit_log(
                session,
                action="ban",
                actor_user_id=uid,
                subject_user_id=uuid4(),
                data={"reason": "spam"},
            )
            await session.commit()
            assert c.chain_hash is not None
            assert a.chain_hash is not None

    try:
        asyncio.run(flow())
    finally:
        settings.audit_hash_chain_enabled = prev
