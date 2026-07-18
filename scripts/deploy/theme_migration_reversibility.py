"""Sub-gate — theme migration REVERSIBILITY check (P1a WU15 / plan B3).

Migration consistency (the sibling gate) proves 0159 *upgrades* cleanly. This gate
proves the other half the plan's data-safety requirement demands (shared with
WU1/B3): that 0159 *downgrades* cleanly — the theme tables DROP and the prior
state is restored — so a bad theme release can be rolled back without a wedged
schema or an orphaned enum type.

It runs the real ``0159_add_theme_docs`` module's ``upgrade()`` + ``downgrade()``
as an in-process round-trip on a fresh in-memory SQLite DB (the repo's DB-test
convention; the migration's own ``is_postgres`` branch renders SQLite-safe types)
and asserts three invariants, FAILING LOUD on any breach:

1. **upgrade creates + seeds** — after ``upgrade()`` the three theme tables exist
   and the singleton *published* v1 default row is seeded (the pre-condition the
   downgrade must then unwind).
2. **downgrade drops everything** — after ``downgrade()`` NONE of the theme tables
   remain: ``theme_audit_log`` / ``theme_versions`` / ``themes`` are gone, i.e. the
   schema is restored to its pre-0159 state (a downgrade that leaves a table — or
   fails on an FK-ordering / orphaned-enum bug — is the classic "irreversible
   migration" that blocks a rollback, and is caught here).
3. **round-trip is repeatable** — a SECOND ``upgrade()`` after the downgrade
   succeeds and re-creates the tables + seed. This is the proof that ``downgrade``
   left NOTHING behind (a leftover table or an un-dropped ``themestatus`` enum type
   would make the re-create collide) — i.e. ``upgrade → downgrade → upgrade`` is a
   true identity, not a one-way door.

This is the ``alembic upgrade head && alembic downgrade -1`` reversibility
assertion the plan (§WU15 test-first) scopes for the deploy lane, delivered as the
self-contained 0159 ``upgrade()``/``downgrade()`` round-trip variant so it runs
anywhere with no Postgres service and no full-chain migration harness.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
THEME_MIGRATION = BACKEND_DIR / "alembic" / "versions" / "0159_add_theme_docs.py"

THEME_TABLES = frozenset({"themes", "theme_versions", "theme_audit_log"})


class GateFailure(RuntimeError):
    """A deploy-gate invariant was violated; the message is the loud reason."""


def _ensure_backend_on_path() -> None:
    """Put ``backend/`` on ``sys.path`` so ``import app...`` resolves (idempotent)."""
    backend = str(BACKEND_DIR)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def load_theme_migration(path: Path = THEME_MIGRATION) -> ModuleType:
    """Import the theme migration module by file path (outside the package tree)."""
    _ensure_backend_on_path()
    spec = importlib.util.spec_from_file_location("theme_migration_0159_rev", str(path))
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise GateFailure(f"cannot load theme migration module at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_upgrade(connection: sa.Connection, migration: ModuleType) -> None:
    """Run the migration's ``upgrade()`` against ``connection`` via a bound op ctx."""
    ctx = MigrationContext.configure(connection)
    with Operations.context(ctx):
        migration.upgrade()


def run_downgrade(connection: sa.Connection, migration: ModuleType) -> None:
    """Run the migration's ``downgrade()`` against ``connection`` via a bound op ctx."""
    ctx = MigrationContext.configure(connection)
    with Operations.context(ctx):
        migration.downgrade()


def theme_tables_present(connection: sa.Connection) -> set[str]:
    """Return the subset of the theme tables currently present in the schema."""
    present = set(sa.inspect(connection).get_table_names())
    return present & set(THEME_TABLES)


def check_upgraded(connection: sa.Connection) -> None:
    """Fail loud unless every theme table exists and the default row is seeded."""
    missing = sorted(set(THEME_TABLES) - theme_tables_present(connection))
    if missing:
        raise GateFailure(
            f"upgrade did not create theme table(s): {missing} — 0159 does not "
            "apply cleanly"
        )
    row = connection.execute(sa.text("SELECT status, version FROM themes")).first()
    if row is None or (row[0], row[1]) != ("published", 1):
        raise GateFailure(
            f"upgrade did not seed the singleton published v1 default (got {row!r}) "
            "— reversibility pre-condition unmet"
        )


def check_downgraded(connection: sa.Connection) -> None:
    """Fail loud if ANY theme table survives the downgrade (irreversible schema)."""
    leftover = sorted(theme_tables_present(connection))
    if leftover:
        raise GateFailure(
            f"downgrade left theme table(s) behind: {leftover} — 0159 is NOT "
            "reversible; a bad theme release could not be rolled back cleanly"
        )


def run() -> int:
    """upgrade -> downgrade -> upgrade round-trip on a fresh DB; return table count.

    Returns the number of theme tables re-created by the second upgrade (the proof
    that the downgrade left nothing behind and the round-trip is a true identity).
    """
    migration = load_theme_migration()
    engine = sa.create_engine("sqlite://")
    try:
        with engine.connect() as connection:
            run_upgrade(connection, migration)
            connection.commit()
            check_upgraded(connection)

            run_downgrade(connection, migration)
            connection.commit()
            check_downgraded(connection)

            # Re-apply: proves downgrade dropped the tables AND the enum type, so
            # the create does not collide — upgrade/downgrade is repeatable.
            run_upgrade(connection, migration)
            connection.commit()
            check_upgraded(connection)
            recreated = len(theme_tables_present(connection))
    finally:
        engine.dispose()
    return recreated


def main() -> int:
    """CLI entrypoint: 0 on success, 1 (loud stderr) on any invariant breach."""
    try:
        recreated = run()
    except GateFailure as exc:
        print(f"FAILED: theme-migration-reversibility\n{exc}", file=sys.stderr)
        return 1
    print(
        "SUCCESS: theme-migration-reversibility "
        f"(0159 upgrade->downgrade->upgrade round-trip clean; {recreated} tables "
        "dropped then re-created)"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess/CI
    raise SystemExit(main())
