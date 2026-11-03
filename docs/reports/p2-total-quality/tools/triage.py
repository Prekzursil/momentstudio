"""Mechanical triage over the P2 capture cells.

Deterministic aggregation ONLY (fan-out-contract C4: set-membership, counting and
grouping get an algorithm — LLM judgement is reserved for "does this matter", never
for "are these the same"). Produces the ranked defect inventory that drives the fix
waves, plus a per-route worst-score table for the redesign selection (D3).

Usage: python triage.py [--artifacts <dir>] [--out <dir>]
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

DEFAULT_ART = Path(os.path.expanduser("~/.claude/p2-artifacts/ssr"))
DEFAULT_OUT = Path(__file__).resolve().parent.parent

# WCAG 2.2 SC 2.5.8 minimum target size.
MIN_TARGET = 24


def load_cells(art: Path) -> list[dict]:
    cells = []
    for f in sorted((art / "cells").glob("*.json")):
        try:
            cells.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception as exc:
            cells.append({"_load_error": f"{f.name}: {exc}"})
    return cells


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", default=str(DEFAULT_ART))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    a = ap.parse_args()
    art, out = Path(a.artifacts), Path(a.out)

    cells = load_cells(art)
    good = [c for c in cells if c.get("ok")]
    bad = [c for c in cells if not c.get("ok")]

    # Gated-surface coverage gate. A logged-out capture of an admin route yields
    # homepage numbers that look CLEAN once aggregated — the first run recorded 132 of
    # them and the triage read as "admin is fine" (F-004). Never aggregate silently
    # over that again: report gated coverage explicitly and refuse to be quiet about it.
    gated = [c for c in cells if c.get("auth") and c.get("auth") != "anon"]
    auth_failed = [c for c in gated if c.get("authFailed")]
    coverage = {
        "gated_cells": len(gated),
        "gated_captured_authenticated": sum(1 for c in gated if c.get("authOk")),
        "gated_auth_failed": len(auth_failed),
        "gated_routes_covered": len({c["route"] for c in gated if c.get("authOk")}),
        "anon_cells": len(cells) - len(gated),
    }

    axe_rules: Counter = Counter()
    axe_impact: Counter = Counter()
    axe_by_route: defaultdict = defaultdict(Counter)
    axe_examples: dict = {}
    unscanned = 0

    console_by_route: defaultdict = defaultdict(set)
    pageerr_by_route: defaultdict = defaultdict(set)
    failed_req: defaultdict = defaultdict(set)
    overflow: list = []
    small_targets: defaultdict = defaultdict(int)
    small_target_examples: dict = {}
    missing_alt: defaultdict = defaultdict(int)
    missing_dims: defaultdict = defaultdict(int)
    no_h1: set = set()
    multi_h1: set = set()
    seo_missing_desc: set = set()
    seo_bad_canonical: dict = {}
    slow: list = []
    redirects: dict = {}
    theme_missing: set = set()
    empty_pages: list = []

    for c in good:
        route, vp, theme = c.get("route"), c.get("viewport"), c.get("theme")
        key = route
        m = c.get("metrics") or {}

        axe = c.get("axe") or {}
        if not axe.get("available"):
            unscanned += 1
        for v in axe.get("violations", []) or []:
            axe_rules[v["id"]] += 1
            axe_impact[v.get("impact") or "unknown"] += 1
            axe_by_route[key][v["id"]] += 1
            axe_examples.setdefault(v["id"], {
                "help": v.get("help"), "impact": v.get("impact"),
                "route": route, "viewport": vp, "theme": theme,
                "target": (v.get("nodes") or [{}])[0].get("target"),
                "html": (v.get("nodes") or [{}])[0].get("html"),
            })

        for e in c.get("consoleErrors") or []:
            console_by_route[key].add(e[:160])
        for e in c.get("pageErrors") or []:
            pageerr_by_route[key].add(e[:160])
        for r in c.get("failedRequests") or []:
            failed_req[key].add(f"{r.get('status', r.get('err',''))} {r.get('url','')[:110]}")

        lay = m.get("layout") or {}
        if (lay.get("overflowX") or 0) > 2:
            overflow.append({"route": route, "viewport": vp, "theme": theme,
                             "overflowX": lay["overflowX"],
                             "samples": (lay.get("overflowing") or [])[:3]})

        q = m.get("a11yQuick") or {}
        if q.get("smallTapTargets"):
            small_targets[key] = max(small_targets[key], q["smallTapTargets"])
            small_target_examples.setdefault(key, q.get("smallTapTargetSamples") or [])
        if q.get("imagesMissingAlt"):
            missing_alt[key] = max(missing_alt[key], q["imagesMissingAlt"])
        if q.get("imagesMissingDimensions"):
            missing_dims[key] = max(missing_dims[key], q["imagesMissingDimensions"])

        counts = m.get("counts") or {}
        if counts.get("h1", 0) == 0:
            no_h1.add(key)
        elif counts.get("h1", 0) > 1:
            multi_h1.add(key)
        if (m.get("textLen") or 0) < 120:
            empty_pages.append({"route": route, "viewport": vp, "theme": theme,
                                "textLen": m.get("textLen")})

        seo = m.get("seo") or {}
        if not seo.get("metaDescription"):
            seo_missing_desc.add(key)
        can = seo.get("canonical") or ""
        if can and ("localhost" in can or can.rstrip("/").endswith("//")):
            seo_bad_canonical[key] = can

        perf = m.get("perf") or {}
        fcp = perf.get("first-contentful-paint")
        if fcp and fcp > 1500:
            slow.append({"route": route, "viewport": vp, "theme": theme, "fcp": fcp,
                         "dcl": perf.get("domContentLoaded")})

        if c.get("redirected"):
            redirects[key] = c.get("finalUrl")

        tk = m.get("themeTokens") or {}
        if not tk.get("hasMsTheme"):
            theme_missing.add(key)

    def top(d, n=25):
        return sorted(d.items(), key=lambda kv: -(kv[1] if isinstance(kv[1], int) else len(kv[1])))[:n]

    # Per-route severity score -> drives redesign selection (D3: evidence-driven).
    route_score: defaultdict = defaultdict(int)
    for r, rules in axe_by_route.items():
        route_score[r] += sum(rules.values()) * 3
    for r, s in small_targets.items():
        route_score[r] += min(s, 40)
    for o in overflow:
        route_score[o["route"]] += 5
    for r in console_by_route:
        route_score[r] += 4 * len(console_by_route[r])
    for r in pageerr_by_route:
        route_score[r] += 8 * len(pageerr_by_route[r])
    for r in no_h1:
        route_score[r] += 3
    for r in seo_missing_desc:
        route_score[r] += 2

    report = {
        "gated_coverage": coverage,
        "totals": {
            "cells": len(cells), "ok": len(good), "failed": len(bad),
            "routes": len({c.get("route") for c in good}),
            "axe_violation_instances": sum(axe_rules.values()),
            "distinct_axe_rules": len(axe_rules),
            "cells_without_axe_scan": unscanned,
        },
        "axe_by_rule": dict(axe_rules.most_common()),
        "axe_by_impact": dict(axe_impact),
        "axe_examples": axe_examples,
        "routes_with_page_errors": {k: sorted(v) for k, v in pageerr_by_route.items()},
        "routes_with_console_errors": {k: sorted(v)[:6] for k, v in list(console_by_route.items())[:40]},
        "failed_requests_by_route": {k: sorted(v)[:8] for k, v in list(failed_req.items())[:40]},
        "horizontal_overflow": overflow[:60],
        "small_tap_targets": dict(top(small_targets, 40)),
        "small_tap_target_examples": {k: v[:4] for k, v in list(small_target_examples.items())[:15]},
        "images_missing_alt": dict(top(missing_alt, 30)),
        "images_missing_dimensions": dict(top(missing_dims, 30)),
        "routes_without_h1": sorted(no_h1),
        "routes_multiple_h1": sorted(multi_h1),
        "seo_missing_meta_description": sorted(seo_missing_desc),
        "seo_suspicious_canonical": seo_bad_canonical,
        "slow_first_paint": sorted(slow, key=lambda x: -x["fcp"])[:30],
        "redirects": redirects,
        "routes_missing_theme_style": sorted(theme_missing),
        "near_empty_renders": empty_pages[:40],
        "route_severity_ranking": [
            {"route": r, "score": s} for r, s in sorted(route_score.items(), key=lambda kv: -kv[1])[:40]
        ],
        "failed_cells": [{"route": c.get("route"), "viewport": c.get("viewport"),
                          "theme": c.get("theme"), "error": c.get("error")} for c in bad][:30],
    }

    out.mkdir(parents=True, exist_ok=True)
    (out / "03-TRIAGE.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    t = report["totals"]
    print(f"cells={t['cells']} ok={t['ok']} failed={t['failed']} routes={t['routes']}")
    print(f"axe: {t['axe_violation_instances']} instances across {t['distinct_axe_rules']} rules "
          f"(unscanned cells: {t['cells_without_axe_scan']})")
    print("top axe rules:", list(report["axe_by_rule"].items())[:8])
    print("impact:", report["axe_by_impact"])
    print(f"page-error routes: {len(report['routes_with_page_errors'])} | "
          f"console-error routes: {len(console_by_route)} | "
          f"overflow cells: {len(overflow)} | no-h1 routes: {len(no_h1)}")
    print(f"missing meta-desc: {len(seo_missing_desc)} | suspicious canonical: {len(seo_bad_canonical)} | "
          f"near-empty renders: {len(empty_pages)}")
    print("worst routes:", [r["route"] for r in report["route_severity_ranking"][:8]])
    print(f"gated coverage: {coverage['gated_captured_authenticated']}/{coverage['gated_cells']} cells "
          f"authenticated across {coverage['gated_routes_covered']} routes "
          f"(auth-failed: {coverage['gated_auth_failed']})")
    print(f"\nwrote {out / '03-TRIAGE.json'}")
    if auth_failed:
        print(f"FAILED:p2-triage {len(auth_failed)} gated cells captured logged-out — "
              "their numbers describe the PUBLIC page; re-capture before using this report")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
