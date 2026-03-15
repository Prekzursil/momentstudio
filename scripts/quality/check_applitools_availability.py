from __future__ import absolute_import
from __future__ import annotations

import os
from http.client import HTTPConnection, HTTPSConnection, HTTPException
from pathlib import Path
from urllib.parse import ParseResult, urlparse

DEFAULT_APPLITOOLS_SERVER = "https://eyesapi.applitools.com"
RENDERINFO_PATH = "/api/sessions/renderinfo"


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
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def resolve_probe_target(server_url: str) -> tuple[str, str, str] | None:
    parsed = urlparse(server_url)
    scheme = (parsed.scheme or "https").lower()
    if scheme not in {"http", "https"}:
        return None

    host = parsed.netloc or parsed.path
    if not host:
        return None

    base_path = parsed.path.rstrip("/") if parsed.netloc else ""
    request_path = f"{base_path}/api/sessions/renderinfo" if base_path else "/api/sessions/renderinfo"
    return scheme, host, request_path



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
    server_url = os.environ.get("APPLITOOLS_SERVER_URL") or "https://eyesapi.applitools.com"
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

