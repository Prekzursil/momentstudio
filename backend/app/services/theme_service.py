"""Theme document service — default-seed + (later WUs) resolve/save.

WU1 lands only the idempotent default-seed helper. ``ensure_default_theme`` is
the single reusable seed path invoked BOTH at FastAPI startup (so every
environment — including the ``create_all`` test app that never runs migrations —
has the row) AND inside the Alembic migration (which imports the same compiled
defaults for its ``sa.text`` INSERT). This guarantees a published default theme
under both the real-migration path and the test ``create_all`` path.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import SessionLocal
from app.models.theme import Theme, ThemeStatus, ThemeVersion

logger = logging.getLogger("app.services.theme")

# The theme-doc schema version stamped on every theme/snapshot from the first
# write. The runtime upcaster is deferred to P2; P1a only needs the FIELD.
DEFAULT_SCHEMA_VERSION = 1


def default_theme_tokens() -> dict[str, str]:
    """Compiled default tokens derived from today's ``styles.css``.

    Values use the frozen WU0 wire format (spike memo §4): Tailwind-consumed
    colors as bare space-separated ``R G B`` channel triplets, literal colors as
    CSS color literals, fonts as curated-enum family strings, and type/space as
    numeric+unit. A fresh deploy renders identically to today. WU3 freezes the
    final Design-owned palette; this is the compiled-default baseline WU1 seeds.
    """

    return {
        # Tailwind-consumed colors — R G B channel triplets (slate-mono +
        # indigo-accent identity; WU0 memo §1A).
        "--background": "255 255 255",  # bg-white
        "--surface": "241 245 249",  # slate-100
        "--surface-inverse": "15 23 42",  # slate-900
        "--text": "51 65 85",  # slate-700
        "--text-heading": "15 23 42",  # slate-900
        "--text-muted": "100 116 139",  # slate-500
        "--border": "226 232 240",  # slate-200
        "--accent": "79 70 229",  # indigo-600
        "--overlay": "0 0 0",  # black scrim
        # Literal-type colors — consumed as raw var(--token, <literal>).
        "--shadow-color": "rgb(15 23 42 / 8%)",  # .shadow-soft elevation
        # Fonts — curated-enum family strings (WU0 memo §1B).
        "--font-body": "Inter",
        "--font-heading": "Cinzel",
        # Type scale — numeric+unit (drives the :root font-size clamp).
        "--font-size-base": "clamp(15px, 1.2vw + 12px, 18px)",
    }


async def ensure_default_theme(session: AsyncSession) -> Theme:
    """Idempotently seed the singleton default theme + its v1 snapshot.

    Existence-checked (mirrors the idempotent seeds in ``0039``/``0045``/
    ``0077``/``0135`` — NOT the non-idempotent ``0017`` INSERT): if any theme
    row exists, return it unchanged; otherwise create the published default
    plus its version-1 snapshot. Callers own the surrounding transaction/commit.
    """

    existing = (await session.execute(select(Theme).limit(1))).scalar_one_or_none()
    if existing is not None:
        return existing

    now = datetime.now(timezone.utc)
    theme = Theme(
        schema_version=DEFAULT_SCHEMA_VERSION,
        tokens=default_theme_tokens(),
        status=ThemeStatus.published,
        version=1,
        published_at=now,
    )
    session.add(theme)
    await session.flush()

    snapshot = ThemeVersion(
        theme_id=theme.id,
        version=1,
        schema_version=DEFAULT_SCHEMA_VERSION,
        tokens=default_theme_tokens(),
        status=ThemeStatus.published,
        created_by_user_id=None,
        published_at=now,
    )
    session.add(snapshot)
    await session.flush()
    return theme


async def seed_default_theme_on_startup(
    session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
) -> bool:
    """Seed the default theme at FastAPI startup, tolerant of an unmigrated DB.

    Production runs Alembic migrations before the app boots, so the ``themes``
    table exists and the idempotent :func:`ensure_default_theme` lands the
    default row. In an environment where the theme schema is not yet present
    (e.g. a bare app harness that never ran migrations), the seed is SKIPPED —
    migrations own schema creation — rather than crashing startup. Returns
    ``True`` when the row was ensured, ``False`` when the seed was skipped.
    """

    async with session_factory() as session:
        try:
            await ensure_default_theme(session)
            await session.commit()
        except SQLAlchemyError:
            await session.rollback()
            logger.warning(
                "skipping default-theme seed: theme schema not available "
                "(migrations own schema creation)"
            )
            return False
    return True


@dataclass(frozen=True)
class ResolvedTheme:
    """Read-only projection of a theme document for the resolve/read API.

    Uniform shape for a resolved theme regardless of whether it originated from
    the singleton :class:`Theme` row (published/live) or a :class:`ThemeVersion`
    snapshot (draft), so the WU4a read endpoints serialize one consistent
    schema.
    """

    tokens: dict[str, str]
    version: int
    schema_version: int
    status: ThemeStatus
    published_at: datetime | None
    updated_at: datetime | None


def _resolved_from_theme(theme: Theme) -> ResolvedTheme:
    return ResolvedTheme(
        tokens=dict(theme.tokens),
        version=theme.version,
        schema_version=theme.schema_version,
        status=theme.status,
        published_at=theme.published_at,
        updated_at=theme.updated_at,
    )


def _resolved_from_version(snapshot: ThemeVersion) -> ResolvedTheme:
    return ResolvedTheme(
        tokens=dict(snapshot.tokens),
        version=snapshot.version,
        schema_version=snapshot.schema_version,
        status=snapshot.status,
        published_at=snapshot.published_at,
        updated_at=snapshot.created_at,
    )


async def resolve_published_tokens(session: AsyncSession) -> ResolvedTheme | None:
    """Return the current published (live/SSR) theme, or ``None`` if none exists.

    The storefront is a single global theme (singleton :class:`Theme` row); the
    published document is what ``server.ts`` reads at request time (WU6). Returns
    ``None`` when no published theme is present so the SSR consumer can fall back
    to compiled defaults (WU6) rather than fail.
    """

    theme = (
        await session.execute(
            select(Theme)
            .where(Theme.status == ThemeStatus.published)
            .order_by(Theme.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if theme is None:
        return None
    return _resolved_from_theme(theme)


async def get_draft(session: AsyncSession) -> ResolvedTheme | None:
    """Return the current editable draft for the admin theme editor.

    The theme is a single global draft per store (plan §WU1/B7). Returns the
    latest ``draft`` snapshot when one has been saved (WU4b ``PUT /theme/draft``);
    before any draft exists, falls back to the published baseline so the editor
    always opens on the live document. ``None`` only when neither exists.
    """

    draft = (
        await session.execute(
            select(ThemeVersion)
            .where(ThemeVersion.status == ThemeStatus.draft)
            .order_by(ThemeVersion.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if draft is not None:
        return _resolved_from_version(draft)
    return await resolve_published_tokens(session)


async def list_versions(session: AsyncSession) -> list[ThemeVersion]:
    """Return the theme version history, newest first.

    The browsable list the WU12 preview-before-restore flow and the WU4b
    rollback endpoint consume.
    """

    result = await session.execute(
        select(ThemeVersion).order_by(ThemeVersion.version.desc())
    )
    return list(result.scalars().all())
