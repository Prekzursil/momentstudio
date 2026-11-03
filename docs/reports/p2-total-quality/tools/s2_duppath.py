"""Print the exact dotted PATH of duplicate sibling keys + both values, with line numbers."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
I18N = ROOT / "frontend" / "src" / "assets" / "i18n"


def walk(items_stack, name):
    """Re-parse tracking a path stack via a decoder that records order."""
    txt = (I18N / name).read_text(encoding="utf-8")
    findings = []
    stack = []

    class Rec(dict):
        pass

    def hook(items):
        counts = {}
        for k, _ in items:
            counts[k] = counts.get(k, 0) + 1
        d = dict(items)
        dups = {k: c for k, c in counts.items() if c > 1}
        if dups:
            # identify the object by its unique sibling keys so we can locate it
            findings.append((sorted(d.keys()), dups, [(k, v) for k, v in items if k in dups]))
        return d

    json.loads(txt, object_pairs_hook=hook)
    return findings, txt


for name in ("en.json", "ro.json"):
    findings, txt = walk(None, name)
    print(f"=== {name}")
    for sibs, dups, pairs in findings:
        print(f"  object with sibling keys {sibs}")
        print(f"  duplicated: {dups}")
        for k, v in pairs:
            print(f"    {k} -> {json.dumps(v, ensure_ascii=False)}")
        # find the object path by locating a distinctive sibling in the raw text
        print()
    # locate the dup textually: find every line index of the distinctive siblings
    for sibs, dups, pairs in findings:
        distinct = [s for s in sibs if s not in ("errors", "success", "title", "hint")]
        if distinct:
            probe = f'"{distinct[0]}"'
            lines = [i + 1 for i, ln in enumerate(txt.splitlines()) if probe in ln]
            print(f"  locator sibling {probe} at lines {lines}")
    print()
