"""Full-branch tests for the theme migration-reversibility sub-gate.

Covers the real 0159 upgrade->downgrade->upgrade round-trip happy path AND every
FAIL-LOUD branch: un-applied upgrade, un-seeded upgrade, and a downgrade that
leaves a table behind (the irreversible-migration signal).
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from scripts.deploy import theme_migration_reversibility as mod


@pytest.fixture
def migration():
    return mod.load_theme_migration()


@pytest.fixture
def upgraded_connection(migration):
    """A fresh in-memory SQLite connection with 0159 ``upgrade()`` applied."""
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        mod.run_upgrade(connection, migration)
        connection.commit()
        yield connection
    engine.dispose()


# --- run() / main(): real end-to-end round-trip -----------------------------


def test_run_round_trip_recreates_all_tables():
    assert mod.run() == len(mod.THEME_TABLES)


def test_main_success_returns_zero(capsys):
    assert mod.main() == 0
    assert "SUCCESS: theme-migration-reversibility" in capsys.readouterr().out


def test_main_failure_returns_one(monkeypatch, capsys):
    def _boom() -> int:
        raise mod.GateFailure("boom reverse")

    monkeypatch.setattr(mod, "run", _boom)
    assert mod.main() == 1
    err = capsys.readouterr().err
    assert "FAILED: theme-migration-reversibility" in err
    assert "boom reverse" in err


# --- _ensure_backend_on_path: both branches ---------------------------------


def test_ensure_backend_on_path_inserts_then_idempotent():
    import sys

    backend = str(mod.BACKEND_DIR)
    original = list(sys.path)
    try:
        sys.path[:] = [p for p in sys.path if p != backend]
        mod._ensure_backend_on_path()  # not-present branch: inserts
        assert backend in sys.path
        snapshot = list(sys.path)
        mod._ensure_backend_on_path()  # already-present branch: no change
        assert list(sys.path) == snapshot
    finally:
        sys.path[:] = original


# --- theme_tables_present ----------------------------------------------------


def test_theme_tables_present_after_upgrade(upgraded_connection):
    assert mod.theme_tables_present(upgraded_connection) == set(mod.THEME_TABLES)


def test_theme_tables_present_empty_on_bare_db():
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        assert mod.theme_tables_present(connection) == set()
    engine.dispose()


# --- check_upgraded: happy + missing-table + bad-seed branches --------------


def test_check_upgraded_happy(upgraded_connection):
    mod.check_upgraded(upgraded_connection)  # no raise


def test_check_upgraded_missing_tables():
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        with pytest.raises(mod.GateFailure, match="did not create theme table"):
            mod.check_upgraded(connection)
    engine.dispose()


def test_check_upgraded_bad_seed(upgraded_connection):
    upgraded_connection.execute(sa.text("DELETE FROM themes"))
    with pytest.raises(mod.GateFailure, match="did not seed the singleton"):
        mod.check_upgraded(upgraded_connection)


# --- check_downgraded: happy (empty) + leftover branch ----------------------


def test_check_downgraded_happy_when_empty():
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        mod.check_downgraded(connection)  # no raise — no theme tables
    engine.dispose()


def test_check_downgraded_detects_leftover_table(upgraded_connection):
    # Tables still present (a downgrade that failed to drop them) must be caught.
    with pytest.raises(mod.GateFailure, match="left theme table"):
        mod.check_downgraded(upgraded_connection)


# --- run_downgrade actually drops the tables --------------------------------


def test_run_downgrade_drops_tables(upgraded_connection, migration):
    mod.run_downgrade(upgraded_connection, migration)
    upgraded_connection.commit()
    assert mod.theme_tables_present(upgraded_connection) == set()
