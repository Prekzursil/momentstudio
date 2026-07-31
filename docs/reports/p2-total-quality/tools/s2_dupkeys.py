"""Locate duplicate sibling keys in the i18n JSON and report what json.loads discards."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
I18N = ROOT / "frontend" / "src" / "assets" / "i18n"


def report(name):
    txt = (I18N / name).read_text(encoding="utf-8")
    hits = []

    path = []

    def hook(items):
        seen = {}
        dups = [k for k, _ in items if (k in seen) or seen.setdefault(k, 0)]
        # recompute properly
        counts = {}
        for k, _ in items:
            counts[k] = counts.get(k, 0) + 1
        for k, c in counts.items():
            if c > 1:
                firsts = [v for kk, v in items if kk == k]
                hits.append((k, c, firsts))
        return dict(items)

    json.loads(txt, object_pairs_hook=hook)

    print(f"### {name}")
    for k, c, vals in hits:
        print(f"  key '{k}' appears {c}x in the SAME object")
        for i, v in enumerate(vals):
            keys = sorted(v.keys()) if isinstance(v, dict) else v
            print(f"    occurrence {i+1}: {len(v) if isinstance(v, dict) else 'scalar'} subkeys -> {keys}")
        kept = vals[-1]
        lost = set()
        for v in vals[:-1]:
            if isinstance(v, dict) and isinstance(kept, dict):
                lost |= set(v.keys()) - set(kept.keys())
        print(f"    >>> SILENTLY DISCARDED subkeys: {sorted(lost)}")

    # line numbers
    lines = txt.splitlines()
    for k, _, _ in hits:
        needle = f'"{k}": {{'
        nums = [i + 1 for i, ln in enumerate(lines) if ln.strip().startswith(f'"{k}"')]
        print(f"  line numbers for '\"{k}\"': {nums}")
    print()


for f in ("en.json", "ro.json"):
    report(f)
