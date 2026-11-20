"""Build the concrete route inventory for the P2 audit sweep.

Deterministic (fan-out-contract C4: a mechanical question gets an algorithm, not an
LLM judgement).

Two authoritative sources, because neither alone is complete:
  1. The backend sitemap (``/api/v1/sitemap.xml``) — real, publicly reachable
     storefront URLs as the app itself advertises them.
  2. ``app.routes.ts`` — parsed with a REAL scanner (string/comment aware) to pick up
     admin + authenticated routes, which never appear in a public sitemap.

A previous naive line-regex version produced garbage (`/contact/account/...`,
zero admin routes) because brace depth was counted without skipping braces inside
strings and comments. That parser was discarded, not patched — this one tracks
depth with a character scanner and is validated by assertions at the end.
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ROUTES_TS = REPO / "frontend" / "src" / "app" / "app.routes.ts"
CATALOG = REPO / "backend" / "app" / "seed_profiles" / "adrianaart" / "catalog.json"
OUT = Path(__file__).resolve().parent.parent / "routes.json"
SITEMAP = "http://localhost:4201/api/v1/sitemap.xml"

SKIP_SEGMENTS = {"**", "logout"}
SKIP_SUBSTR = ("auth/callback", "auth/logout", "/mock/")


def scan_route_paths(src: str) -> list[str]:
    """Return full route paths, honouring `children:` nesting.

    Character scanner: tracks `{}`/`[]` depth while skipping line comments, block
    comments, and single/double/backtick string literals (escapes included), so
    braces inside `import('./x')`, regexes or copy never corrupt the depth count.
    """
    depth = 0
    i = 0
    n = len(src)
    events: list[tuple[int, str]] = []  # (depth_at_declaration, segment)
    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            i = src.find("\n", i)
            if i < 0:
                break
            continue
        if ch == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            i = (j + 2) if j >= 0 else n
            continue
        if ch in "'\"`":
            quote = ch
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == quote:
                    break
                j += 1
            # A `path:` declaration is the only string we care about; detect it by
            # looking back at the preceding non-space characters.
            back = src[max(0, i - 24):i]
            if re.search(r"path\s*:\s*$", back):
                events.append((depth, src[i + 1:j]))
            i = j + 1
            continue
        if ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        i += 1

    # Rebuild ancestry: a segment declared at depth d is a child of the most recent
    # segment declared at a strictly smaller depth.
    full: list[str] = []
    stack: list[tuple[int, str]] = []
    for d, seg in events:
        while stack and stack[-1][0] >= d:
            stack.pop()
        prefix = "/".join(s for _, s in stack if s)
        path = "/".join(x for x in (prefix, seg) if x)
        full.append(path)
        stack.append((d, seg))
    return full


def fetch_sitemap_urls() -> list[str]:
    try:
        with urllib.request.urlopen(SITEMAP, timeout=25) as r:
            xml = r.read().decode("utf-8", "replace")
    except Exception as exc:  # fail loud, not silent — the caller reports it
        print(f"  WARNING: sitemap fetch failed ({exc}); relying on the route table only")
        return []
    return [re.sub(r"^https?://[^/]+", "", u) or "/" for u in re.findall(r"<loc>([^<]+)</loc>", xml)]


def load_slugs() -> dict[str, list[str]]:
    try:
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
    except Exception:
        return {"product": [], "category": []}
    return {
        "product": [p["slug"] for p in data.get("products", []) if p.get("slug")],
        "category": [c["slug"] for c in data.get("categories", []) if c.get("slug")],
    }


def expand_params(path: str, slugs: dict[str, list[str]]) -> str | None:
    if ":" not in path:
        return path
    product = slugs["product"][0] if slugs["product"] else None
    category = slugs["category"][0] if slugs["category"] else None
    out = path
    for seg in re.findall(r":([A-Za-z0-9_]+)", path):
        low = seg.lower()
        if "categor" in path.lower() or low in ("category", "categoryslug"):
            val = category or "cups"
        elif low.endswith("id"):
            val = "1"
        else:
            val = product or "white-cup"
        out = out.replace(f":{seg}", val)
    return out


def classify(path: str) -> tuple[str, str]:
    p = path.strip("/")
    if p.startswith("admin"):
        return "admin", "owner"
    if p.startswith(("account", "receipt", "tickets", "orders")):
        return "storefront", "user"
    return "storefront", "anon"


def main() -> int:
    slugs = load_slugs()
    seen: dict[str, dict] = {}

    def add(url: str, origin: str, parameterised: bool = False) -> None:
        url = "/" + url.strip("/") if url.strip("/") else "/"
        if any(s in url for s in SKIP_SUBSTR):
            return
        if url in seen:
            seen[url]["origin"] = f"{seen[url]['origin']}+{origin}"
            return
        surface, auth = classify(url)
        seen[url] = {"url": url, "surface": surface, "auth": auth,
                     "parameterised": parameterised, "origin": origin}

    for u in fetch_sitemap_urls():
        add(u, "sitemap")

    for raw in scan_route_paths(ROUTES_TS.read_text(encoding="utf-8")):
        p = raw.strip("/")
        if not p or p in SKIP_SEGMENTS or "**" in p:
            continue
        concrete = expand_params(p, slugs)
        if concrete:
            add(concrete, "routes.ts", parameterised=":" in p)

    routes = sorted(seen.values(), key=lambda r: (r["surface"], r["url"]))
    summary = {
        "total": len(routes),
        "storefront": sum(1 for r in routes if r["surface"] == "storefront"),
        "admin": sum(1 for r in routes if r["surface"] == "admin"),
        "needs_auth": sum(1 for r in routes if r["auth"] != "anon"),
        "from_sitemap": sum(1 for r in routes if "sitemap" in r["origin"]),
    }

    # Validation — a silently-wrong inventory would mis-aim the whole audit.
    problems = []
    if summary["admin"] == 0:
        problems.append("no admin routes parsed (parser regression?)")
    bad = [r["url"] for r in routes if re.search(r"/(contact|about)/(admin|account)/", r["url"])]
    if bad:
        problems.append(f"implausible nesting, e.g. {bad[:3]}")
    if any(":" in r["url"] for r in routes):
        problems.append("unresolved :param left in a URL")

    OUT.write_text(json.dumps({"summary": summary, "problems": problems, "routes": routes},
                              indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print("PROBLEMS:", problems or "none")
    print(f"wrote {OUT}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
