"""Full-branch tests for the theme migration-consistency sub-gate.

Covers every happy path AND every FAIL-LOUD branch: multiple heads, wrong head,
missing tables, missing/wrong seed row, and a non-empty autogenerate diff (the
model/migration drift signal).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from scripts.deploy import theme_migration_consistency as mod


@pytest.fixture
def migrated_connection():
    """A fresh in-memory SQLite connection with the theme migration applied."""
    engine = sa.create_engine("sqlite://")
    migration = mod.load_theme_migration()
    with engine.connect() as connection:
        mod.apply_theme_migration(connection, migration)
        connection.commit()
        yield connection
    engine.dispose()


# --- run() / main(): the real end-to-end happy path -------------------------


def test_run_returns_expected_head():
    assert mod.run() == mod.EXPECTED_HEAD


def test_main_success_returns_zero(capsys):
    assert mod.main() == 0
    out = capsys.readouterr().out
    assert "SUCCESS: theme-migration-consistency" in out


def test_main_failure_returns_one(monkeypatch, capsys):
    def _boom() -> str:
        raise mod.GateFailure("boom reason")

    monkeypatch.setattr(mod, "run", _boom)
    assert mod.main() == 1
    err = capsys.readouterr().err
    assert "FAILED: theme-migration-consistency" in err
    assert "boom reason" in err


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


# --- check_single_head: happy + both failure branches -----------------------


def test_check_single_head_happy():
    script = SimpleNamespace(get_heads=lambda: (mod.EXPECTED_HEAD,))
    assert mod.check_single_head(script) == mod.EXPECTED_HEAD


def test_check_single_head_multiple_heads():
    script = SimpleNamespace(get_heads=lambda: ("a_head", "b_head"))
    with pytest.raises(mod.GateFailure, match="exactly one migration head"):
        mod.check_single_head(script)


def test_check_single_head_wrong_head():
    script = SimpleNamespace(get_heads=lambda: ("9999_other",))
    with pytest.raises(mod.GateFailure, match="no longer the tip"):
        mod.check_single_head(script)


# --- verify_tables_present: happy + missing branch --------------------------


def test_verify_tables_present_happy(migrated_connection):
    mod.verify_tables_present(migrated_connection)  # no raise


def test_verify_tables_present_missing():
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        with pytest.raises(mod.GateFailure, match="did not create table"):
            mod.verify_tables_present(connection)
    engine.dispose()


# --- verify_default_seed: happy + None + wrong-row branches -----------------


def test_verify_default_seed_happy(migrated_connection):
    mod.verify_default_seed(migrated_connection)  # no raise


def test_verify_default_seed_missing_row(migrated_connection):
    migrated_connection.execute(sa.text("DELETE FROM themes"))
    with pytest.raises(mod.GateFailure, match="did not seed the default theme"):
        mod.verify_default_seed(migrated_connection)


def test_verify_default_seed_wrong_status(migrated_connection):
    migrated_connection.execute(sa.text("UPDATE themes SET status = 'draft'"))
    with pytest.raises(mod.GateFailure, match="expected status='published'"):
        mod.verify_default_seed(migrated_connection)


# --- check_models_match_migration: happy + non-empty-diff branch ------------


def test_check_models_match_migration_happy(migrated_connection):
    from app.models import Base

    mod.check_models_match_migration(migrated_connection, Base.metadata)  # no raise


def test_check_models_match_migration_detects_drift(migrated_connection):
    # A metadata that models `themes` with a phantom extra column the migration
    # never created — the exact "changed a model without a migration" signature.
    drift = sa.MetaData()
    sa.Table(
        "themes",
        drift,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("phantom_new_column", sa.String(), nullable=True),
    )
    with pytest.raises(mod.GateFailure, match="autogenerate produced a"):
        mod.check_models_match_migration(migrated_connection, drift)


def test_load_script_directory_single_head():
    script = mod.load_script_directory()
    assert mod.check_single_head(script) == mod.EXPECTED_HEAD
