"""Sub-gate 1 — theme migration-consistency check (P1a WU15).

The classic "did someone change a model without writing a migration?" gate,
scoped to the P1a theme tables (``themes`` / ``theme_versions`` /
``theme_audit_log``). It proves three invariants and FAILS LOUD on any breach:

1. **Single, known head** — the Alembic script tree has exactly one head and it
   is ``0159_add_theme_docs`` (a second head means two un-merged branches shipped;
   a different head means the theme migration is no longer the tip and the gate's
   assumptions are stale).
2. **Applies cleanly on a fresh DB** — running the theme migration's ``upgrade()``
   against a brand-new database creates all three theme tables and idempotently
   seeds the singleton *published* default theme row.
3. **Models match the migration (no autogenerate diff)** — Alembic's autogenerate
   engine (``compare_metadata``), scoped to the theme tables, reports ZERO
   operations between the migrated schema and ``Base.metadata``. A non-empty diff
   is the signature of a model column/table added (or removed) without a matching
   migration.

Dialect note: the check runs on in-memory SQLite (the repo's DB-test convention —
migrations are never run over the full chain at test time; see ``backend/tests``).
The migration's own ``is_postgres`` branch renders SQLite-safe types, and the
migrated schema and the model metadata are compared on the SAME dialect, so the
comparison is free of the cross-dialect (UUID-vs-VARCHAR) false positives that
plague a naive Postgres-model-vs-SQLite-DB diff. ``compare_type=False`` is set
deliberately: the migration intentionally downgrades ``postgresql.UUID`` to
``sa.String`` on non-Postgres backends, so type comparison would false-positive;
the STRUCTURAL diff (added/removed tables, columns, nullability, FKs, indexes) is
the signal that catches real model/migration drift.

A production Postgres autogenerate check over the FULL schema is the natural CI
complement (``alembic check`` against the Postgres service); this gate is the
fast, self-contained, service-free signal that runs anywhere.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
ALEMBIC_DIR = BACKEND_DIR / "alembic"
THEME_MIGRATION = ALEMBIC_DIR / "versions" / "0159_add_theme_docs.py"

EXPECTED_HEAD = "0159_add_theme_docs"
THEME_TABLES = frozenset({"themes", "theme_versions", "theme_audit_log"})


class GateFailure(RuntimeError):
    """A deploy-gate invariant was violated; the message is the loud reason."""


def _ensure_backend_on_path() -> None:
    """Put ``backend/`` on ``sys.path`` so ``import app...`` resolves (idempotent)."""
    backend = str(BACKEND_DIR)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def load_script_directory(
    ini_path: Path = ALEMBIC_INI, script_location: Path = ALEMBIC_DIR
) -> ScriptDirectory:
    """Build the Alembic ``ScriptDirectory`` for the backend migration tree."""
    cfg = Config(str(ini_path))
    cfg.set_main_option("script_location", str(script_location))
    return ScriptDirectory.from_config(cfg)


def check_single_head(script: ScriptDirectory, expected: str = EXPECTED_HEAD) -> str:
    """Assert the tree has exactly one head and it is ``expected``; return it."""
    heads = tuple(script.get_heads())
    if len(heads) != 1:
        raise GateFailure(
            "expected exactly one migration head, found "
            f"{len(heads)}: {sorted(heads)} — un-merged migration branches shipped"
        )
    head = heads[0]
    if head != expected:
        raise GateFailure(
            f"migration head is {head!r}, expected {expected!r} — the theme "
            "migration is no longer the tip; re-pin the gate or add the missing "
            "migration"
        )
    return head


def load_theme_migration(path: Path = THEME_MIGRATION) -> ModuleType:
    """Import the theme migration module by file path (outside the package tree)."""
    spec = importlib.util.spec_from_file_location("theme_migration_0159", str(path))
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise GateFailure(f"cannot load theme migration module at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def apply_theme_migration(connection: sa.Connection, migration: ModuleType) -> None:
    """Run the migration's ``upgrade()`` against ``connection`` via a bound op ctx."""
    ctx = MigrationContext.configure(connection)
    with Operations.context(ctx):
        migration.upgrade()


def verify_tables_present(
    connection: sa.Connection, expected: frozenset[str] = THEME_TABLES
) -> None:
    """Assert every expected theme table now exists in the migrated schema."""
    present = set(sa.inspect(connection).get_table_names())
    missing = sorted(set(expected) - present)
    if missing:
        raise GateFailure(
            f"theme migration did not create table(s): {missing} — the migration "
            "failed to apply cleanly"
        )


def verify_default_seed(connection: sa.Connection) -> None:
    """Assert the migration seeded exactly the singleton *published* v1 default."""
    row = connection.execute(sa.text("SELECT status, version FROM themes")).first()
    if row is None:
        raise GateFailure(
            "theme migration did not seed the default theme row — a fresh deploy "
            "would render unstyled"
        )
    status, version = row
    if status != "published" or version != 1:
        raise GateFailure(
            f"seeded default theme is status={status!r} version={version}, "
            "expected status='published' version=1"
        )


def theme_metadata_diff(connection: sa.Connection, metadata: sa.MetaData) -> list[Any]:
    """Autogenerate diff between the migrated schema and ``metadata`` (theme scope)."""

    def include_object(
        obj: Any, name: str | None, type_: str, reflected: bool, compare_to: Any
    ) -> bool:
        if type_ == "table":
            return name in THEME_TABLES
        return True

    ctx = MigrationContext.configure(
        connection,
        opts={
            "target_metadata": metadata,
            "compare_type": False,
            "include_object": include_object,
        },
    )
    return compare_metadata(ctx, metadata)


def check_models_match_migration(
    connection: sa.Connection, metadata: sa.MetaData
) -> None:
    """Fail loud if the theme-scoped autogenerate diff is non-empty."""
    diffs = theme_metadata_diff(connection, metadata)
    if diffs:
        rendered = "\n".join(f"  - {diff}" for diff in diffs)
        raise GateFailure(
            "models diverge from the theme migration (autogenerate produced a "
            "non-empty diff) — someone changed a theme model without a matching "
            f"migration:\n{rendered}"
        )


def run() -> str:
    """Run all three sub-checks on a fresh in-memory DB; return the verified head."""
    _ensure_backend_on_path()
    from app.models import Base  # noqa: PLC0415 — register ORM metadata lazily

    script = load_script_directory()
    head = check_single_head(script)
    migration = load_theme_migration()

    engine = sa.create_engine("sqlite://")
    try:
        with engine.connect() as connection:
            apply_theme_migration(connection, migration)
            connection.commit()
            verify_tables_present(connection)
            verify_default_seed(connection)
            check_models_match_migration(connection, Base.metadata)
    finally:
        engine.dispose()
    return head


def main() -> int:
    """CLI entrypoint: 0 on success, 1 (loud stderr) on any invariant breach."""
    try:
        head = run()
    except GateFailure as exc:
        print(f"FAILED: theme-migration-consistency\n{exc}", file=sys.stderr)
        return 1
    print(
        "SUCCESS: theme-migration-consistency "
        f"(head={head}, models match migration, default seed OK)"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess/CI
    raise SystemExit(main())
