"""Merge every P2 evidence source into ONE ranked fix backlog.

Sources, in descending trust order:
  1. Workflow FINAL results (`--final <json>`) — findings already paired with an
     adversarial verdict (survived / overclaim / refuted). Highest trust: a claim that
     survived a skeptic is worth more than a claim nobody challenged.
  2. Workflow journals — schema-validated per-agent findings (typed severity, confidence,
     evidence, repro, fix). Used when no verdict exists yet.
  3. 04-PATTERN-SCAN.json — exhaustive mechanical source-site inventory.
  4. 02-FINDINGS.md F-ids — the orchestrator's own probe-confirmed findings.

Dedup is deliberately MECHANICAL (fan-out-contract C4): normalise the title to a token
set and group. It will not catch two differently-worded descriptions of one defect — that
residual is disclosed in the output rather than papered over, because a scanner that
silently over-merged would hide real defects.

Usage: python consolidate.py [--final <workflow-result.json> ...]
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent
WF_ROOT = Path.home() / ".claude/projects/C--Users-Prekzursil/61596a7f-5f2a-4603-ad89-cb0b296145eb/subagents/workflows"
RUNS = ["wf_ac804e66-229", "wf_3ceeb6d3-925", "wf_05e062ac-99c"]

SEV_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
STOP = {"the", "a", "an", "is", "are", "on", "in", "of", "to", "and", "or", "no", "not",
        "with", "for", "that", "this", "it", "at", "by", "from", "has", "have", "but"}


def norm_key(title: str) -> str:
    """Token-set key: order- and punctuation-insensitive, stopwords dropped."""
    words = re.findall(r"[a-z0-9./_-]+", (title or "").lower())
    keep = [w for w in words if w not in STOP and len(w) > 2]
    return " ".join(sorted(set(keep))[:12])


def anchors(text: str) -> list[str]:
    """file:line style anchors, which are what a fix actually needs."""
    return sorted(set(re.findall(r"[\w./-]+\.(?:ts|py|html|json|yml|mjs):\d+", text or "")))


def load_journals() -> list[dict]:
    out: list[dict] = []
    for run in RUNS:
        p = WF_ROOT / run / "journal.jsonl"
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") != "result":
                continue
            r = d.get("result")
            if not isinstance(r, dict):
                continue
            label = d.get("label") or ""
            # Wave B shape: per-route findings.
            if isinstance(r.get("findings"), list):
                for f in r["findings"]:
                    if isinstance(f, dict) and f.get("title"):
                        out.append({**f, "source": f"route:{r.get('route', label)}", "run": run})
            # Wave A shape: per-lane topFindings.
            if isinstance(r.get("topFindings"), list):
                for f in r["topFindings"]:
                    if isinstance(f, dict) and f.get("title"):
                        out.append({**f, "source": f"lane:{r.get('unit', label)}", "run": run})
    return out


def load_finals(paths: list[str]) -> list[dict]:
    out: list[dict] = []
    for raw in paths:
        p = Path(raw)
        if not p.exists():
            print(f"  WARNING: --final {raw} does not exist; skipped")
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"  WARNING: --final {raw} is not JSON ({exc}); skipped")
            continue
        for bucket, verdict in (("survived", "SURVIVED"), ("overclaims", "OVERCLAIM"),
                                ("seriousUnverified", "UNVERIFIED"), ("minor", "UNCHALLENGED")):
            for f in data.get(bucket) or []:
                if isinstance(f, dict) and f.get("title"):
                    out.append({**f, "verdictLabel": verdict,
                                "source": f"route:{f.get('route', '?')}", "run": "final"})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", action="append", default=[])
    a = ap.parse_args()

    finals = load_finals(a.final)
    journal = load_journals()

    # A finding present in a final result supersedes its journal copy (it carries a verdict).
    final_keys = {norm_key(f["title"]) for f in finals}
    merged = finals + [f for f in journal if norm_key(f["title"]) not in final_keys]

    groups: dict[str, list[dict]] = defaultdict(list)
    for f in merged:
        groups[norm_key(f["title"])].append(f)

    items = []
    for key, fs in groups.items():
        sev = min((f.get("severity") or "P3" for f in fs), key=lambda s: SEV_ORDER.get(s, 3))
        verdicts = {f.get("verdictLabel") for f in fs if f.get("verdictLabel")}
        blob = " ".join(f"{f.get('evidence','')} {f.get('repro','')} {f.get('fix','')}" for f in fs)
        items.append({
            "severity": sev,
            "title": max((f["title"] for f in fs), key=len),
            "sources": sorted({f["source"] for f in fs}),
            "reportCount": len(fs),
            "verdicts": sorted(verdicts) or ["UNCHALLENGED"],
            "confidence": next((f.get("confidence") for f in fs if f.get("confidence")), None),
            "unverified": any(f.get("unverified") for f in fs),
            "anchors": anchors(blob)[:6],
            "fix": next((f.get("fix") for f in fs if f.get("fix")), None),
            "evidence": next((f.get("evidence") for f in fs if f.get("evidence")), None),
            "repro": next((f.get("repro") for f in fs if f.get("repro")), None),
            "key": key,
        })

    # Rank: severity, then corroboration (independent reports), then anchor richness.
    items.sort(key=lambda i: (SEV_ORDER.get(i["severity"], 3),
                              -i["reportCount"], -len(i["anchors"])))

    # SECOND, INDEPENDENT dedup signal: items citing the same file:line.
    #
    # The title token-set key alone reported ZERO overlap across 198 findings, which was a
    # detector weakness, not a clean result: the anchor signal immediately found the same
    # 368px admin overflow filed twice, and one H1 focus-ring defect filed as both P2 and
    # P3. But shared anchor is NOT proof of sameness — at
    # admin-content-layout.component.ts:61 one item is a dark-theme contrast failure and
    # the other is missing aria-pressed semantics. Two real defects, one line.
    #
    # So: CLUSTER, never auto-merge. Merging would silently delete a defect (the exact
    # failure mode this program keeps finding). A cluster is a FIX UNIT — whoever edits
    # that line must satisfy every member — and the severity disagreements are surfaced
    # rather than resolved by fiat.
    clusters = []
    by_anchor: dict[str, list[int]] = defaultdict(list)
    for idx, i in enumerate(items):
        for anc in i["anchors"]:
            by_anchor[anc].append(idx)
    for anc, idxs in sorted(by_anchor.items()):
        if len(idxs) < 2:
            continue
        members = [items[k] for k in idxs]
        sevs = sorted({m["severity"] for m in members})
        clusters.append({
            "anchor": anc,
            "members": len(members),
            "severities": sevs,
            "severity_disagreement": len(sevs) > 1,
            "titles": [m["title"] for m in members],
        })
        for k in idxs:
            items[k].setdefault("fix_clusters", []).append(anc)

    scan_path = OUT_DIR / "04-PATTERN-SCAN.json"
    scan = json.loads(scan_path.read_text(encoding="utf-8")) if scan_path.exists() else {}

    by_sev: dict[str, int] = defaultdict(int)
    for i in items:
        by_sev[i["severity"]] += 1
    multi = [i for i in items if i["reportCount"] > 1]

    report = {
        "totals": {
            "raw_findings": len(merged),
            "deduped_items": len(items),
            "by_severity": dict(sorted(by_sev.items())),
            "same_title_reported_twice": len(multi),
            "with_file_anchors": sum(1 for i in items if i["anchors"]),
            "carrying_unverified": sum(1 for i in items if i["unverified"]),
            "fix_clusters": len(clusters),
            "items_in_a_cluster": sum(1 for i in items if i.get("fix_clusters")),
            "clusters_with_severity_disagreement": sum(1 for c in clusters if c["severity_disagreement"]),
        },
        "fix_clusters": clusters,
        "verdict_mix": {v: sum(1 for i in items if v in i["verdicts"])
                        for v in ("SURVIVED", "OVERCLAIM", "UNVERIFIED", "UNCHALLENGED")},
        "mechanical_pattern_sites": scan.get("totals", {}),
        "dedup_caveat": (
            "NOTHING is auto-merged. Two signals are reported separately: (a) identical "
            "normalised title token-sets, and (b) shared file:line anchors, which are "
            "grouped into `fix_clusters`. Shared anchor does NOT imply the same defect — one "
            "line can carry a contrast failure and a missing-ARIA failure independently — so "
            "a cluster is a FIX UNIT to satisfy in full, not a duplicate to collapse. "
            "Severity disagreements inside a cluster are flagged, not resolved."
        ),
        "items": items,
    }
    (OUT_DIR / "05-BACKLOG.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = ["# momentstudio P2 — consolidated fix backlog", "",
             f"Raw findings merged: **{len(merged)}** → deduped items: **{len(items)}**  ",
             f"By severity: {dict(sorted(by_sev.items()))}  ",
             f"Corroborated by 2+ independent sources: **{len(multi)}**  ",
             f"Verdict mix: {report['verdict_mix']}", "",
             "> " + report["dedup_caveat"], ""]
    for sev in ("P0", "P1", "P2", "P3"):
        chunk = [i for i in items if i["severity"] == sev]
        if not chunk:
            continue
        lines += [f"## {sev} — {len(chunk)} items", ""]
        for i in chunk:
            flag = " ⚠UNVERIFIED" if i["unverified"] else ""
            lines.append(f"- **{i['title']}**{flag}")
            lines.append(f"  - verdict: {', '.join(i['verdicts'])} · reports: {i['reportCount']} "
                         f"· sources: {', '.join(i['sources'][:4])}")
            if i["confidence"]:
                lines.append(f"  - confidence: {i['confidence']}")
            if i["anchors"]:
                lines.append(f"  - anchors: {', '.join(i['anchors'])}")
            if i["fix"]:
                lines.append(f"  - fix: {i['fix'][:300]}")
        lines.append("")
    (OUT_DIR / "05-BACKLOG.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"  raw findings: {len(merged)}  ->  deduped items: {len(items)}")
    print(f"  by severity: {dict(sorted(by_sev.items()))}")
    print(f"  same-title twice: {len(multi)}   fix clusters: {len(clusters)}   with anchors: "
          f"{report['totals']['with_file_anchors']}")
    print(f"  verdict mix: {report['verdict_mix']}")
    print(f"  wrote {OUT_DIR / '05-BACKLOG.json'} and 05-BACKLOG.md")
    print("SUCCESS:p2-consolidate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
