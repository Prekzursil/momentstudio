from __future__ import absolute_import

import os
from http.client import HTTPConnection, HTTPSConnection, HTTPException
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import ParseResult, urlparse

DEFAULT_APPLITOOLS_SERVER = "https://eyesapi.applitools.com"
RENDERINFO_PATH = "/api/sessions/renderinfo"
DEFAULT_ALLOWED_HOSTS = frozenset({"eyesapi.applitools.com"})


def is_dependabot_origin() -> bool:
    actor = os.environ.get("GITHUB_ACTOR_NAME", "").strip()
    author = os.environ.get("PULL_REQUEST_AUTHOR", "").strip()
    head_ref = os.environ.get("PULL_REQUEST_HEAD_REF", "").strip()
    return (
        actor == "dependabot[bot]"
        or author == "dependabot[bot]"
        or head_ref.startswith("dependabot/")
    )


def write_output(name: str, value: str) -> None:
    github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if not github_output:
        return
    path = Path(github_output)
    if not is_safe_github_output_path(path):
        return
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def is_safe_github_output_path(path: Path) -> bool:
    runner_temp = os.environ.get("RUNNER_TEMP", "").strip()
    if not runner_temp:
        # Outside Actions, skip writing outputs entirely.
        return False
    try:
        temp_root = Path(runner_temp).resolve(strict=True)
        resolved = path.resolve(strict=False)
    except OSError:
        return False
    return resolved == temp_root or temp_root in resolved.parents


def normalize_scheme(parsed: ParseResult) -> Optional[str]:
    scheme = (parsed.scheme or "https").lower()
    if scheme in {"http", "https"}:
        return scheme
    return None


def resolve_host(parsed: ParseResult) -> str:
    return parsed.netloc or parsed.path


def resolve_base_path(parsed: ParseResult) -> str:
    if not parsed.netloc:
        return ""
    return parsed.path.rstrip("/")


def build_request_path(base_path: str) -> str:
    if not base_path:
        return RENDERINFO_PATH
    return f"{base_path}{RENDERINFO_PATH}"


def resolve_probe_target(server_url: str) -> Optional[Tuple[str, str, str]]:
    parsed = urlparse(server_url)
    scheme = normalize_scheme(parsed)
    if scheme is None:
        return None

    host = resolve_host(parsed)
    if not host:
        return None
    if not is_allowed_host(host):
        return None

    return scheme, host, build_request_path(resolve_base_path(parsed))


def is_allowed_host(host: str) -> bool:
    hostname = host.split(":", 1)[0].strip().lower()
    if not hostname:
        return False
    return hostname in DEFAULT_ALLOWED_HOSTS


def probe(server_url: str, api_key: str) -> str:
    target = resolve_probe_target(server_url)
    if target is None:
        return "000"

    scheme, host, request_path = target
    connection_cls = HTTPSConnection if scheme == "https" else HTTPConnection
    connection = connection_cls(host, timeout=20)
    try:
        connection.request("GET", request_path, headers={"X-Api-Key": api_key})
        return str(connection.getresponse().status)
    except (HTTPException, OSError):
        return "000"
    finally:
        connection.close()


def fail(message: str) -> int:
    print(message)
    return 1


def skip(message: str) -> int:
    write_output("available", "false")
    print(message)
    return 0


def main() -> int:
    api_key = os.environ.get("APPLITOOLS_API_KEY", "").strip()
    server_url = os.environ.get("APPLITOOLS_SERVER_URL") or DEFAULT_APPLITOOLS_SERVER
    dependabot_origin = is_dependabot_origin()

    if not api_key:
        if dependabot_origin:
            return skip("Skipping Applitools for Dependabot because APPLITOOLS_API_KEY is unavailable in this context.")
        return fail("APPLITOOLS_API_KEY is not configured for this repository.")

    status = probe(server_url, api_key)
    if status == "200":
        write_output("available", "true")
        return 0

    if dependabot_origin:
        return skip(f"Skipping Applitools for Dependabot because credentials/server validation failed with HTTP {status}.")
    return fail(f"Applitools credentials/server validation failed with HTTP {status}.")


if __name__ == "__main__":
    raise SystemExit(main())

