from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


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


def probe(server_url: str, api_key: str) -> str:
    url = f"{server_url.rstrip('/')}/api/sessions/renderinfo"
    request = urllib.request.Request(url, headers={"X-Api-Key": api_key})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return str(response.getcode())
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception:
        return "000"


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

