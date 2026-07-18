"""WU1 — theme-doc data model + seed + audit-chain coverage.

Exercises the ``Theme``/``ThemeVersion``/``ThemeAuditLog`` models under the
in-memory SQLite ``create_all`` path (NO migrations), the idempotent
``ensure_default_theme`` seed, the startup-seed wrapper's present/absent-schema
branches, and ``audit_chain.add_theme_audit_log`` with the hash chain both
disabled and enabled.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from sqlalchemy import func, select

from app.core.config import settings
from app.models.audit import AuditChainState
from app.models.theme import Theme, ThemeStatus, ThemeVersion
from app.services import audit_chain, theme_service

from tests.conftest import make_memory_session_factory


# --------------------------------------------------------------------------- #
# model round-trip                                                            #
# --------------------------------------------------------------------------- #
def test_theme_model_round_trip() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            theme = Theme(
                schema_version=1,
                tokens={"--accent": "79 70 229"},
                status=ThemeStatus.published,
                version=1,
            )
            session.add(theme)
            await session.flush()

            snapshot = ThemeVersion(
                theme_id=theme.id,
                version=1,
                schema_version=1,
                tokens={"--accent": "79 70 229"},
                status=ThemeStatus.published,
                created_by_user_id=None,
            )
            session.add(snapshot)
            await session.commit()

            read = (
                await session.execute(select(Theme).where(Theme.id == theme.id))
            ).scalar_one()
            assert read.tokens == {"--accent": "79 70 229"}
            assert read.status is ThemeStatus.published
            assert read.schema_version == 1
            assert len(read.versions) == 1
            assert read.versions[0].tokens == {"--accent": "79 70 229"}
            assert read.versions[0].created_by_user_id is None

    asyncio.run(flow())


# --------------------------------------------------------------------------- #
# ensure_default_theme — idempotency + schema-version stamp                   #
# --------------------------------------------------------------------------- #
def test_ensure_default_theme_is_idempotent() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            first = await theme_service.ensure_default_theme(session)
            await session.commit()
            second = await theme_service.ensure_default_theme(session)
            await session.commit()

            assert first.id == second.id
            count = (
                await session.execute(select(func.count()).select_from(Theme))
            ).scalar_one()
            assert count == 1
            version_count = (
                await session.execute(select(func.count()).select_from(ThemeVersion))
            ).scalar_one()
            assert version_count == 1

    asyncio.run(flow())


def test_ensure_default_theme_stamps_schema_version_and_defaults() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            theme = await theme_service.ensure_default_theme(session)
            await session.commit()

            assert theme.schema_version == theme_service.DEFAULT_SCHEMA_VERSION
            assert theme.status is ThemeStatus.published
            assert theme.published_at is not None
            # Compiled defaults use the frozen WU0 wire format.
            assert theme.tokens["--accent"] == "79 70 229"
            assert theme.tokens["--font-body"] == "Inter"
            snapshot = (await session.execute(select(ThemeVersion))).scalar_one()
            assert snapshot.schema_version == theme_service.DEFAULT_SCHEMA_VERSION
            assert snapshot.tokens == theme_service.default_theme_tokens()

    asyncio.run(flow())


def test_seeded_theme_factory_fixture(seeded_theme_factory) -> None:
    """The shared conftest fixture yields a factory with the default row present."""

    async def flow() -> None:
        async with seeded_theme_factory() as session:
            count = (
                await session.execute(select(func.count()).select_from(Theme))
            ).scalar_one()
            assert count == 1

    asyncio.run(flow())


# --------------------------------------------------------------------------- #
# seed_default_theme_on_startup — present vs absent schema                     #
# --------------------------------------------------------------------------- #
def test_startup_seed_succeeds_when_schema_present() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        seeded = await theme_service.seed_default_theme_on_startup(factory)
        assert seeded is True
        async with factory() as session:
            count = (
                await session.execute(select(func.count()).select_from(Theme))
            ).scalar_one()
            assert count == 1

    asyncio.run(flow())


def test_startup_seed_skips_when_schema_absent() -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    # A bare engine with NO tables created — mirrors an unmigrated environment.
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def flow() -> None:
        seeded = await theme_service.seed_default_theme_on_startup(factory)
        assert seeded is False

    asyncio.run(flow())


# --------------------------------------------------------------------------- #
# add_theme_audit_log — hash chain disabled + enabled                         #
# --------------------------------------------------------------------------- #
def test_add_theme_audit_log_without_chain() -> None:
    factory = make_memory_session_factory()
    prev = getattr(settings, "audit_hash_chain_enabled", False)
    settings.audit_hash_chain_enabled = False

    async def flow() -> None:
        async with factory() as session:
            theme = await theme_service.ensure_default_theme(session)
            await session.flush()
            snapshot = (await session.execute(select(ThemeVersion))).scalar_one()
            entry = await audit_chain.add_theme_audit_log(
                session,
                theme_version_id=snapshot.id,
                action="publish",
                version=theme.version,
                user_id=None,
            )
            await session.commit()
            assert entry.chain_hash is None
            assert entry.chain_prev_hash is None

    try:
        asyncio.run(flow())
    finally:
        settings.audit_hash_chain_enabled = prev


def test_add_theme_audit_log_with_chain_links_hashes() -> None:
    factory = make_memory_session_factory()
    prev = getattr(settings, "audit_hash_chain_enabled", False)
    settings.audit_hash_chain_enabled = True

    async def flow() -> None:
        async with factory() as session:
            await theme_service.ensure_default_theme(session)
            await session.flush()
            snapshot = (await session.execute(select(ThemeVersion))).scalar_one()
            uid = uuid4()
            first = await audit_chain.add_theme_audit_log(
                session,
                theme_version_id=snapshot.id,
                action="publish",
                version=1,
                user_id=uid,
            )
            second = await audit_chain.add_theme_audit_log(
                session,
                theme_version_id=snapshot.id,
                action="rollback",
                version=2,
                user_id=None,
            )
            await session.commit()

            assert first.chain_prev_hash is None
            assert first.chain_hash is not None
            assert second.chain_prev_hash == first.chain_hash
            assert second.chain_hash != first.chain_hash

            state = await session.get(AuditChainState, "theme")
            assert state is not None and state.tail_hash == second.chain_hash

    try:
        asyncio.run(flow())
    finally:
        settings.audit_hash_chain_enabled = prev
