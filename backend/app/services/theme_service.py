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
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import SessionLocal
from app.models.theme import Theme, ThemeStatus, ThemeVersion
from app.services import audit_chain as audit_chain_service
from app.services import theme_contrast
from app.services.theme_derive import derive_tokens
from app.services.theme_validation import validate_token

logger = logging.getLogger("app.services.theme")

# The theme-doc schema version stamped on every theme/snapshot from the first
# write. The runtime upcaster is deferred to P2; P1a only needs the FIELD.
DEFAULT_SCHEMA_VERSION = 1

# Size caps for a mutating save (defence-in-depth alongside the WU2 validator):
# a theme doc is a small, curated token map, so an oversized payload is rejected
# before it reaches storage. MAX_TOKEN_COUNT comfortably clears the editable
# vocabulary; MAX_TOKEN_VALUE_LENGTH bounds a single value (a ``clamp()`` type
# scale is the longest legitimate one).
MAX_TOKEN_COUNT = 128
MAX_TOKEN_VALUE_LENGTH = 256


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


def compiled_defaults() -> dict[str, str]:
    """The canonical compiled-default EDITABLE set the contrast gate merges under.

    A thin alias of :func:`default_theme_tokens` under the name the WU4b publish /
    rollback contrast gate reads: the gate merges the submitted (possibly partial)
    editable tokens OVER this set, then derives, so no primary pairing is ever
    skipped for an absent endpoint.
    """

    return default_theme_tokens()


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
    # The stored document is the SOURCE-OF-TRUTH primaries (+ fonts / spacing);
    # the fourteen shade / state tokens are recomputed on read via ``derive_tokens``
    # so every consumer sees the full effective, contrast-safe token set.
    return ResolvedTheme(
        tokens=derive_tokens(dict(theme.tokens)),
        version=theme.version,
        schema_version=theme.schema_version,
        status=theme.status,
        published_at=theme.published_at,
        updated_at=theme.updated_at,
    )


def _resolved_from_version(snapshot: ThemeVersion) -> ResolvedTheme:
    return ResolvedTheme(
        tokens=derive_tokens(dict(snapshot.tokens)),
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


# --------------------------------------------------------------------------- #
# WU4b — mutate surface: draft-save / atomic publish / rollback / reset
#
# Built on the DERIVE-AWARE base: the stored document is always the EDITABLE
# source-of-truth (the nine primary colours + curated fonts / sizes / spacing).
# The fourteen shade / state tokens are NEVER stored — they are recomputed by
# ``theme_derive.derive_tokens`` on every read (``_resolved_from_*``) and before
# the contrast gate. Because the WU2 validator only knows the editable keys, a
# draft-save that tries to set a derived key (e.g. ``--surface-inverse-hover``)
# hard-rejects (422) — the fix that eliminates the white-on-white bypass class.
# --------------------------------------------------------------------------- #
async def next_version(session: AsyncSession) -> int:
    """Return the next monotonic version number across all theme snapshots."""
    current = await session.scalar(select(func.max(ThemeVersion.version)))
    return (current or 0) + 1


async def _get_singleton_theme(session: AsyncSession) -> Theme | None:
    return (await session.execute(select(Theme).limit(1))).scalar_one_or_none()


async def _latest_draft_version(session: AsyncSession) -> ThemeVersion | None:
    return (
        await session.execute(
            select(ThemeVersion)
            .where(ThemeVersion.status == ThemeStatus.draft)
            .order_by(ThemeVersion.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


def _revalidate_tokens(tokens: dict[str, str]) -> dict[str, str]:
    """Server-side WU2 revalidation — never trust the client.

    Returns the accepted editable token map, or raises 413 (oversized) / 422 (any
    token failing the closed name registry / per-type value allowlist / CSS-safe
    encoder). A DERIVED key (shade / on-colour) is absent from the registry, so it
    lands in ``invalid`` and forces a 422 — an admin can never persist one.
    """
    if len(tokens) > MAX_TOKEN_COUNT:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Too many tokens (max {MAX_TOKEN_COUNT})",
        )
    invalid: list[str] = []
    accepted: dict[str, str] = {}
    for name, value in tokens.items():
        if len(value) > MAX_TOKEN_VALUE_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"Token value too long (max {MAX_TOKEN_VALUE_LENGTH})",
            )
        result = validate_token(name, value)
        if not result.ok:
            invalid.append(name)
        else:
            accepted[name] = result.value
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "invalid-tokens", "invalid": invalid},
        )
    return accepted


def _reject_failing_contrast(editable_tokens: dict[str, str]) -> None:
    """Raise 422 if any primary pairing fails WCAG AA over the DERIVED set (B9).

    The gate runs over ``derive_tokens`` of :func:`compiled_defaults` MERGED-UNDER
    the submitted editable tokens (submitted overrides default). Deriving first
    yields the exact effective set the SSR sink renders — every shade / state
    token computed from the primaries and every absent primary falling back to
    its compiled default — so no pairing is skipped for an omitted endpoint. The
    ON-COLOURS (``--text-inverse`` / ``--text-onmedia``) are contrast-derived and
    therefore never gated: they cannot fail (white-on-white is unreachable).
    """
    effective = derive_tokens({**compiled_defaults(), **editable_tokens})
    failures = theme_contrast.evaluate_contrast(effective)
    if not failures:
        return
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={
            "error": "contrast",
            "failures": [
                {
                    "pairing": f.id,
                    "foreground": f.foreground,
                    "background": f.background,
                    "ratio": round(f.ratio, 4),
                    "target": f.target,
                    "size": f.size,
                }
                for f in failures
            ],
        },
    )


async def save_draft(
    session: AsyncSession, tokens: dict[str, str], *, user_id: UUID | None
) -> ResolvedTheme:
    """Save the singleton draft: revalidate (WU2) -> upsert snapshot -> audit.

    The theme is a single global draft (B7), so a save UPDATES the one existing
    draft snapshot in place when present, else creates it. Either way it stamps
    ``created_by_user_id`` and writes an append-only ``draft-save`` audit entry on
    the same hash-chain (brief §8: every theme-change recorded), in one commit.
    Only the editable tokens are stored; the derived set is recomputed on read.
    """
    theme = await _get_singleton_theme(session)
    if theme is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    accepted = _revalidate_tokens(tokens)

    draft = await _latest_draft_version(session)
    if draft is None:
        draft = ThemeVersion(
            theme_id=theme.id,
            version=await next_version(session),
            schema_version=theme.schema_version,
            tokens=accepted,
            status=ThemeStatus.draft,
            created_by_user_id=user_id,
            published_at=None,
        )
        session.add(draft)
    else:
        draft.tokens = accepted
        draft.created_by_user_id = user_id
    await session.flush()

    await audit_chain_service.add_theme_audit_log(
        session,
        theme_version_id=draft.id,
        action="draft-save",
        version=draft.version,
        user_id=user_id,
    )
    await session.commit()
    return _resolved_from_version(draft)


def _apply_published(
    theme: Theme, snapshot: ThemeVersion, tokens: dict[str, str], now: datetime
) -> None:
    """Point the singleton at a published snapshot's editable tokens (in-txn)."""
    theme.tokens = dict(tokens)
    theme.version = snapshot.version
    theme.status = ThemeStatus.published
    theme.published_at = now


async def publish(
    session: AsyncSession, *, user_id: UUID | None, expected_version: int | None
) -> ResolvedTheme:
    """Atomically publish the current draft (mirrors ``content.upsert_block``).

    Promotes the singleton draft to published in one transaction: the
    ``expected_version`` staleness guard (409, reusing content.py's mechanism),
    the server-side contrast gate over the DERIVED effective set (422, B9), the
    pointer flip, and the append-only audit write all commit together —
    all-or-nothing.
    """
    theme = await _get_singleton_theme(session)
    if theme is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    if expected_version is not None and theme.version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Theme has changed (expected version {expected_version}, "
                f"found {theme.version})"
            ),
        )
    draft = await _latest_draft_version(session)
    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No draft changes to publish",
        )
    _reject_failing_contrast(dict(draft.tokens))

    now = datetime.now(timezone.utc)
    draft.status = ThemeStatus.published
    draft.published_at = now
    _apply_published(theme, draft, draft.tokens, now)
    await session.flush()
    await audit_chain_service.add_theme_audit_log(
        session,
        theme_version_id=draft.id,
        action="publish",
        version=draft.version,
        user_id=user_id,
    )
    await session.commit()
    return _resolved_from_version(draft)


async def _publish_snapshot(
    session: AsyncSession,
    theme: Theme,
    tokens: dict[str, str],
    *,
    action: str,
    user_id: UUID | None,
) -> ResolvedTheme:
    """Force-publish ``tokens`` as a NEW published snapshot (rollback / reset)."""
    now = datetime.now(timezone.utc)
    snapshot = ThemeVersion(
        theme_id=theme.id,
        version=await next_version(session),
        schema_version=theme.schema_version,
        tokens=dict(tokens),
        status=ThemeStatus.published,
        created_by_user_id=user_id,
        published_at=now,
    )
    session.add(snapshot)
    _apply_published(theme, snapshot, tokens, now)
    await session.flush()
    await audit_chain_service.add_theme_audit_log(
        session,
        theme_version_id=snapshot.id,
        action=action,
        version=snapshot.version,
        user_id=user_id,
    )
    await session.commit()
    return _resolved_from_version(snapshot)


async def rollback(
    session: AsyncSession, version: int, *, user_id: UUID | None
) -> ResolvedTheme:
    """Wholesale-restore a prior PUBLISHED snapshot as a new published one (R4-B9).

    Two hard guards close the rollback-bypass hole:

    * The target must be a ``status == published`` snapshot. A draft or unknown
      ``version`` is a hard 404 — you can only restore something that was itself
      gated and shipped, never promote an ungated draft by rolling "back" to it.
    * The restored editable tokens are re-derived and re-run through the contrast
      gate before force-publishing (defence-in-depth: a snapshot that predates the
      gate, or was tampered with at rest, cannot go live failing WCAG AA).
    """
    theme = await _get_singleton_theme(session)
    if theme is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    target = (
        await session.execute(
            select(ThemeVersion)
            .where(ThemeVersion.version == version)
            .where(ThemeVersion.status == ThemeStatus.published)
            .limit(1)
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme version not found"
        )
    _reject_failing_contrast(dict(target.tokens))
    return await _publish_snapshot(
        session, theme, target.tokens, action=f"rollback:{version}", user_id=user_id
    )


async def reset_to_default(
    session: AsyncSession, *, user_id: UUID | None
) -> ResolvedTheme:
    """Panic reset (CB2): force-publish the seeded compiled defaults, audited.

    Runs the full audited publish path (snapshot -> pointer flip -> append-only
    ``reset-to-default`` audit -> single commit) but BYPASSES the staleness 409 —
    a reset from a broken/stale view must never fail on a stale-version check. The
    compiled defaults are the known-safe set, so the contrast gate is a no-op and
    is not re-run here.
    """
    theme = await _get_singleton_theme(session)
    if theme is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    return await _publish_snapshot(
        session,
        theme,
        default_theme_tokens(),
        action="reset-to-default",
        user_id=user_id,
    )
