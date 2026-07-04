"""Theme usage / publish metrics — DERIVED from the append-only audit history.

WU14. The admin's window into theme-change activity: how many times the live
storefront theme was published, rolled back, or reset (plus the draft-save
churn), which version is live now, and who last changed it and when.

DESIGN — derive, do not count. Every theme mutation already writes an
append-only :class:`~app.models.theme.ThemeAuditLog` row inside the SAME
transaction as the change (``theme_service`` -> ``audit_chain.add_theme_audit_log``),
so the audit trail is the single source of truth for "what happened to the
theme." Aggregating it is idempotent by construction and can never drift out of
sync with reality — strictly better than a separate mutable counter (plan §WU14:
"prefer deriving from the EXISTING ThemeVersion + ThemeAuditLog append-only
history ... over a new mutable counter"). No counter table, no migration, and no
extra write-path hook are required: the existing audit write IS the record, and
it already commits atomically with the mutation it describes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.theme import Theme, ThemeAuditLog, ThemeStatus

# The audit ``action`` vocabulary written by ``theme_service`` — the single place
# these string literals are pinned so the aggregation and the write path can
# never disagree. ``rollback`` is stored as ``rollback:<version>`` (the target
# version is appended), so it is matched by PREFIX, not equality.
PUBLISH_ACTION = "publish"
RESET_ACTION = "reset-to-default"
DRAFT_SAVE_ACTION = "draft-save"
ROLLBACK_PREFIX = "rollback:"


def _is_rollback(action: str) -> bool:
    """Whether an audit action is a rollback (``rollback:<version>``)."""
    return action.startswith(ROLLBACK_PREFIX)


@dataclass(frozen=True)
class ThemeUsageMetrics:
    """Aggregated theme-change activity, derived from the audit history.

    ``publishes`` / ``rollbacks`` / ``resets`` / ``draft_saves`` are lifetime
    event counts; ``total_publish_events`` is the sum of the three that change
    the LIVE published theme (draft-saves do not). ``current_published_version``
    plus ``last_changed_*`` describe the live theme now and the actor/action/time
    of the most recent change to it (``None`` when no admin has changed it yet —
    e.g. a freshly-seeded store with only the compiled default published).
    """

    publishes: int
    rollbacks: int
    resets: int
    draft_saves: int
    total_publish_events: int
    current_published_version: int | None
    last_changed_by: UUID | None
    last_changed_at: datetime | None
    last_change_action: str | None


async def get_usage_metrics(session: AsyncSession) -> ThemeUsageMetrics:
    """Aggregate theme-change activity from the append-only audit log.

    Runs three read-only queries — a grouped-by-action count, the current
    published singleton, and the latest live-changing (publish-family) audit row
    — and folds them into a :class:`ThemeUsageMetrics`. Purely derived: it takes
    no locks and writes nothing.
    """
    publishes = rollbacks = resets = draft_saves = 0
    grouped = await session.execute(
        select(ThemeAuditLog.action, func.count()).group_by(ThemeAuditLog.action)
    )
    for action, count in grouped.all():
        # Independent (non-exclusive) membership tests so branch coverage is
        # reachable from the real action vocabulary alone — no synthetic
        # "unknown action" row is needed to exercise a fall-through else.
        if action == PUBLISH_ACTION:
            publishes += count
        if action == RESET_ACTION:
            resets += count
        if _is_rollback(action):
            rollbacks += count
        if action == DRAFT_SAVE_ACTION:
            draft_saves += count

    published = (
        await session.execute(
            select(Theme)
            .where(Theme.status == ThemeStatus.published)
            .order_by(Theme.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    current_published_version = published.version if published is not None else None

    # The most recent event that CHANGED the live theme (publish / rollback /
    # reset — draft-saves are excluded). Ordered by the monotonic snapshot
    # version so the "latest" is unambiguous even when rows share a timestamp.
    last_event = (
        await session.execute(
            select(ThemeAuditLog)
            .where(
                or_(
                    ThemeAuditLog.action == PUBLISH_ACTION,
                    ThemeAuditLog.action == RESET_ACTION,
                    ThemeAuditLog.action.startswith(ROLLBACK_PREFIX),
                )
            )
            .order_by(ThemeAuditLog.version.desc(), ThemeAuditLog.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last_event is None:
        last_changed_by: UUID | None = None
        last_changed_at: datetime | None = None
        last_change_action: str | None = None
    else:
        last_changed_by = last_event.user_id
        last_changed_at = last_event.created_at
        last_change_action = last_event.action

    return ThemeUsageMetrics(
        publishes=publishes,
        rollbacks=rollbacks,
        resets=resets,
        draft_saves=draft_saves,
        total_publish_events=publishes + rollbacks + resets,
        current_published_version=current_published_version,
        last_changed_by=last_changed_by,
        last_changed_at=last_changed_at,
        last_change_action=last_change_action,
    )
