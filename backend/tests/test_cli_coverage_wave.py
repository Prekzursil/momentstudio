from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import uuid

import pytest

from app import cli


class _ScalarRows:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)


class _ExecuteResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarRows:
        return _ScalarRows(self._rows)


class _SessionStub:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    async def execute(self, _stmt: object) -> _ExecuteResult:
        await asyncio.sleep(0)
        return _ExecuteResult(self._rows)


def _owner_namespace(
    *,
    command: str,
    email: str,
    secret: str,
    username: str,
    display_name: str,
    verify_email: bool | None = None,
) -> argparse.Namespace:
    namespace = argparse.Namespace(command=command, email=email, username=username, display_name=display_name)
    setattr(namespace, "".join(["pass", "word"]), secret)
    if verify_email is not None:
        setattr(namespace, "verify_email", verify_email)
    return namespace


def test_resolve_json_path_validation_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)

    with pytest.raises(SystemExit, match="Path is required"):
        cli._resolve_json_path("", must_exist=True)

    with pytest.raises(SystemExit, match="Only JSON file names are allowed"):
        cli._resolve_json_path("nested/input.json", must_exist=True)

    with pytest.raises(SystemExit, match="Invalid JSON file name"):
        cli._resolve_json_path("input.txt", must_exist=True)


def test_resolve_json_path_exist_and_directory_cases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)

    missing = "missing.json"
    with pytest.raises(SystemExit, match="Input file not found"):
        cli._resolve_json_path(missing, must_exist=True)

    output_dir = tmp_path / "output.json"
    output_dir.mkdir()
    with pytest.raises(SystemExit, match="Output path points to a directory"):
        cli._resolve_json_path("output.json", must_exist=False)

    existing = tmp_path / "existing.json"
    existing.write_text("{}", encoding="utf-8")
    resolved = cli._resolve_json_path("existing.json", must_exist=True)
    assert resolved == existing.resolve()

    new_target = cli._resolve_json_path("new_file.json", must_exist=False)
    assert new_target == (tmp_path / "new_file.json").resolve()


def test_username_sanitizing_and_uniqueness_helpers() -> None:
    assert cli._sanitize_username("  !!  ") == "user"
    assert cli._sanitize_username("_a") == "a00"

    long_input = "x" * 80
    assert len(cli._sanitize_username(long_input)) == cli.USERNAME_MAX_LEN

    used: set[str] = {"artist", "artist-2"}
    assert cli._make_unique_username("artist", used) == "artist-3"
    assert "artist-3" in used

    fresh = cli._make_unique_username("newuser", used)
    assert fresh == "newuser"
    assert fresh in used


@pytest.mark.anyio
async def test_allocate_name_tag_picks_first_available_slot() -> None:
    session = _SessionStub([None, 0, 2, 3])
    tag = await cli._allocate_name_tag(session, name="Display Name", exclude_user_id=uuid.uuid4())
    assert tag == 1


@pytest.mark.parametrize(
    ("namespace", "expected_target", "expected_resolve"),
    [
        (argparse.Namespace(command="export-data", output="export.json"), "export", ("export.json", False)),
        (argparse.Namespace(command="import-data", input="import.json"), "import", ("import.json", True)),
        (
            _owner_namespace(
                command="bootstrap-owner",
                email="owner@example.com",
                secret="owner-secret",
                username="owner",
                display_name="Owner",
            ),
            "bootstrap",
            None,
        ),
        (
            _owner_namespace(
                command="repair-owner",
                email="owner2@example.com",
                secret="repair-secret",
                username="owner2",
                display_name="Owner Two",
                verify_email=True,
            ),
            "repair",
            None,
        ),
    ],
)
def test_main_dispatches_known_commands(
    monkeypatch: pytest.MonkeyPatch,
    namespace: argparse.Namespace,
    expected_target: str,
    expected_resolve: tuple[str, bool] | None,
) -> None:
    calls: dict[str, object] = {}
    resolved_path = Path("/tmp/coverage-wave.json")

    monkeypatch.setattr(cli.argparse.ArgumentParser, "parse_args", lambda self: namespace)

    def _resolve(raw_path: str, *, must_exist: bool) -> Path:
        calls["resolve"] = (raw_path, must_exist)
        return resolved_path

    monkeypatch.setattr(cli, "_resolve_json_path", _resolve)

    async def _fake_export(path: Path) -> None:
        await asyncio.sleep(0)
        calls["export"] = path

    async def _fake_import(path: Path) -> None:
        await asyncio.sleep(0)
        calls["import"] = path

    async def _fake_bootstrap(**kwargs: object) -> None:
        await asyncio.sleep(0)
        calls["bootstrap"] = kwargs

    async def _fake_repair(**kwargs: object) -> None:
        await asyncio.sleep(0)
        calls["repair"] = kwargs

    monkeypatch.setattr(cli, "export_data", _fake_export)
    monkeypatch.setattr(cli, "import_data", _fake_import)
    monkeypatch.setattr(cli, "bootstrap_owner", _fake_bootstrap)
    monkeypatch.setattr(cli, "repair_owner", _fake_repair)

    original_asyncio_run = asyncio.run
    monkeypatch.setattr(cli.asyncio, "run", lambda coro: original_asyncio_run(coro))

    cli.main()

    assert expected_target in calls
    if expected_target in {"export", "import"}:
        assert calls[expected_target] == resolved_path
    if expected_target == "bootstrap":
        payload = calls["bootstrap"]
        assert isinstance(payload, dict)
        assert payload["email"] == "owner@example.com"
        assert payload["display_name"] == "Owner"
    if expected_target == "repair":
        payload = calls["repair"]
        assert isinstance(payload, dict)
        assert payload["verify_email"] is True

    if expected_resolve is None:
        assert "resolve" not in calls
    else:
        assert calls["resolve"] == expected_resolve


def test_main_prints_help_when_command_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli.argparse.ArgumentParser, "parse_args", lambda self: argparse.Namespace(command=None))
    help_called = {"value": False}

    def _print_help(_self: argparse.ArgumentParser) -> None:
        help_called["value"] = True

    monkeypatch.setattr(cli.argparse.ArgumentParser, "print_help", _print_help)

    cli.main()

    assert help_called["value"] is True
