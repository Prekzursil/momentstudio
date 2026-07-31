"""Exhaustive repo-wide scan for the defect CLASSES the axe sweep sampled.

Why an algorithm and not agents (fan-out-contract C4): "which elements have an
aria-label on a non-interactive wrapper" is set membership over a token list. A
deterministic scanner answers it exactly, in seconds, for every template — where a
fan-out of agents samples, disagrees with itself, and (measured previously) errs 86%
accurate with 100% of the errors pointing the same dangerous way. Agents are reserved
for "does this matter", never for "are these the same".

The axe sweep found 107 violation instances across 552 rendered cells. Those are
INSTANCES on the routes that happened to be captured; this scanner finds the SOURCE
sites, including on states the sweep never reached (modals, error branches, admin
sections behind a tab).

DETECTOR CONTROL (single-signal-verification §3): a scanner that finds nothing looks
exactly like a clean repo. So each pattern declares a known-present witness taken from
the axe output, and the run FAILS if its witness is not found — proving the detector can
see what it claims to look for before its silence is trusted.

Usage: python scan_patterns.py [--repo <root>] [--json <out>]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Elements that cannot own an aria-label: ARIA forbids naming a generic role, so the
# name is dropped by AT and the labelled control stays nameless (axe: aria-prohibited-attr
# on the wrapper, select-name / label on the control inside it).
GENERIC_TAGS = (
    "div", "span", "p", "section", "article", "header", "footer", "main",
    "aside", "li", "ul", "ol", "td", "tr", "tbody", "table", "form", "label",
)

CLASS_ATTR = re.compile(r'''class\s*=\s*(["'])(.*?)\1''', re.S)


def templates(repo: Path) -> list[Path]:
    src = repo / "frontend" / "src"
    return sorted(p for p in src.rglob("*.html") if ".spec." not in p.name)


def ts_with_inline_templates(repo: Path) -> list[Path]:
    src = repo / "frontend" / "src"
    return sorted(p for p in src.rglob("*.ts") if ".spec." not in p.name)


def line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1


def open_tags(text: str):
    """Yield (tag, attrs, start_index) for every opening tag."""
    for m in re.finditer(r"<([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>\"']|\"[^\"]*\"|'[^']*')*)>", text):
        yield m.group(1).lower(), m.group(2), m.start()


def scan_file(path: Path, text: str) -> list[dict]:
    out: list[dict] = []

    def hit(pattern: str, tag: str, idx: int, detail: str, snippet: str) -> None:
        out.append({
            "pattern": pattern,
            "file": str(path).replace("\\", "/"),
            "line": line_of(text, idx),
            "tag": tag,
            "detail": detail,
            "snippet": " ".join(snippet.split())[:180],
        })

    for tag, attrs, idx in open_tags(text):
        low = attrs.lower()
        classes = " ".join(m.group(2) for m in CLASS_ATTR.finditer(attrs))
        cls = set(classes.split())

        # A1 — aria-label on a generic element with no role: the accessible name is
        # discarded, and any control nested inside is left unnamed.
        if tag in GENERIC_TAGS and "aria-label" in low and "role=" not in low.replace(" ", ""):
            # The name may be a literal OR an Angular binding ([attr.aria-label]="expr").
            # A binding's rendered text lives in the i18n catalogue, never in the template,
            # so report the expression — chasing the literal yields "?" and hides the site.
            name = re.search(r'''(?<!\.)aria-label\s*=\s*(["'])(.*?)\1''', attrs, re.S)
            bound = re.search(r'''\[attr\.aria-label\]\s*=\s*(["'])(.*?)\1''', attrs, re.S)
            label = (name.group(2) if name else None) or (
                f"(bound) {bound.group(2)}" if bound else "(dynamic)"
            )
            hit("aria-label-on-generic", tag, idx,
                f'aria-label={label[:70]!r} on <{tag}> with no role', attrs)

        # A2 — a scroll container with no keyboard access (WCAG 2.1.1); axe:
        # scrollable-region-focusable. tabindex="0" makes it focusable/scrollable by key.
        if any(c.startswith(("overflow-x-auto", "overflow-y-auto", "overflow-auto", "overflow-scroll",
                             "overflow-x-scroll", "overflow-y-scroll")) for c in cls):
            if "tabindex" not in low:
                hit("scroll-container-no-tabindex", tag, idx,
                    "scrollable container without tabindex (keyboard users cannot scroll it)", attrs)

        # A3 — light-only colour utility with no dark: counterpart of the same property.
        # This is how text-slate-700 survives into dark theme and fails contrast.
        for prop, prefix in (("text", "text-"), ("bg", "bg-"), ("border", "border-")):
            lights = [c for c in cls
                      if c.startswith(prefix) and not c.startswith("dark:")
                      and re.search(r"-(slate|gray|zinc|neutral|stone|white|black)(-\d{2,3})?$", c)]
            if lights and not any(c.startswith(f"dark:{prefix}") for c in cls):
                hit(f"light-only-{prop}", tag, idx,
                    f"{', '.join(sorted(lights)[:3])} with no dark:{prefix}* counterpart", attrs)

        # A4 — a link distinguished from body text by colour alone (axe: link-in-text-block).
        # hover:underline does not help a non-hovering or keyboard user reading the text.
        if tag == "a":
            coloured = any(re.match(r"^text-(indigo|blue|sky|violet|purple|emerald|rose)-\d{2,3}$", c) for c in cls)
            always_underlined = "underline" in cls
            if coloured and not always_underlined:
                hit("link-colour-only", tag, idx,
                    "link coloured but not underlined at rest"
                    + (" (hover:underline only)" if any(c.endswith(":underline") for c in cls) else ""),
                    attrs)

        # A5 — image without alt, or without intrinsic dimensions (CLS).
        # An Angular BOUND attribute satisfies the requirement at runtime, and its source
        # form is `[alt]="expr"` / `[attr.alt]="expr"` — neither of which contains the
        # substring "alt=" (the `]` sits between). A naive `"alt=" not in attrs` therefore
        # flags 78 correctly-bound images: measured, and it inflated this pattern from ~1
        # real site to 79 before the binding-aware check below replaced it.
        def has_attr(name: str) -> bool:
            return bool(re.search(rf"(?:^|\s)(?:\[?(?:attr\.)?{name}\]?|\[\({name}\)\])\s*=", attrs, re.I))

        if tag == "img":
            if not has_attr("alt"):
                hit("img-no-alt", tag, idx, "<img> with no alt attribute (literal or bound)", attrs)
            # Intrinsic width/height only matter for CLS if the layout box is not ALREADY
            # deterministic from CSS. `class="h-8 w-8"` / `size-8` / `aspect-square` fixes
            # the box, so flagging those is noise: it inflated this pattern to 78 sites of
            # which most were already shift-proof. Only an image with a free-floating box
            # can actually shift the page.
            fixed_h = any(re.match(r"^(h|size|max-h|min-h)-", c) or c.startswith("aspect-") for c in cls)
            fixed_w = any(re.match(r"^(w|size|max-w|min-w)-", c) or c.startswith("aspect-") for c in cls)
            css_boxed = fixed_h and fixed_w
            if not (has_attr("width") and has_attr("height")) and not css_boxed:
                missing = [n for n in ("width", "height") if not has_attr(n)]
                hit("img-no-dimensions", tag, idx,
                    f"<img> missing {'+'.join(missing)} and no fixed CSS box (layout shift)", attrs)

    return out


# Each pattern must prove it can see a node the axe run already reported, or its silence
# is worthless. A witness is (file substring, line, what to expect) taken from the axe
# output in 03-TRIAGE.json and then traced back to source.
#
# NOTE on the first witness: axe reported `div[aria-label="Account section selector"]`,
# but that literal is NOT in any template — it is `account.aria.sectionSelect` in
# assets/i18n/en.json:243, applied via [attr.aria-label]. A witness must therefore be a
# SOURCE anchor, not a rendered string; the first version of this control failed for that
# reason and briefly looked like a scanner bug.
WITNESSES = {
    "aria-label-on-generic": ("account/account.component.ts", 114),
    "scroll-container-no-tabindex": ("overflow-x-auto", None),
    "light-only-text": ("text-slate-", None),
    "link-colour-only": ("text-indigo-", None),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=str(Path(__file__).resolve().parents[4]))
    ap.add_argument("--json", default=str(Path(__file__).resolve().parent.parent / "04-PATTERN-SCAN.json"))
    a = ap.parse_args()
    repo = Path(a.repo)

    files = templates(repo) + ts_with_inline_templates(repo)
    if not files:
        print(f"FAILED:p2-pattern-scan no templates found under {repo}/frontend/src")
        return 1

    hits: list[dict] = []
    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "<" not in text:
            continue
        hits.extend(scan_file(p, text))

    by_pattern: dict[str, list[dict]] = {}
    for h in hits:
        by_pattern.setdefault(h["pattern"], []).append(h)

    # Detector control — refuse to report a clean result the scanner could not have earned.
    broken = []
    for pattern, (witness, line) in WITNESSES.items():
        found = by_pattern.get(pattern, [])
        if not found:
            broken.append(f"{pattern}: ZERO hits (witness {witness!r} should exist)")
        elif line is not None:
            # Anchored witness: the flagged opening tag may sit a few lines above the
            # attribute axe pointed at, so allow a small window.
            near = [h for h in found if witness in h["file"] and abs(h["line"] - line) <= 4]
            if not near:
                broken.append(f"{pattern}: {len(found)} hits but none at {witness}:~{line}")
        elif not any(witness in h["snippet"] or witness in h["detail"] for h in found):
            broken.append(f"{pattern}: {len(found)} hits but none contain the witness {witness!r}")

    files_by_pattern = {k: len({h["file"] for h in v}) for k, v in by_pattern.items()}
    report = {
        "repo": str(repo).replace("\\", "/"),
        "files_scanned": len(files),
        "totals": {k: len(v) for k, v in sorted(by_pattern.items(), key=lambda kv: -len(kv[1]))},
        "files_affected": files_by_pattern,
        "detector_control": {"witnesses": WITNESSES, "problems": broken},
        "hits": by_pattern,
    }
    Path(a.json).write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"scanned {len(files)} template/component files")
    for k, v in report["totals"].items():
        print(f"  {k:<32} {v:>5} sites across {files_by_pattern[k]:>3} files")
    print(f"\nwrote {a.json}")
    if broken:
        for b in broken:
            print(f"  DETECTOR PROBLEM: {b}")
        print("FAILED:p2-pattern-scan detector control failed — do not trust these counts")
        return 1
    print("detector control: all witnesses found (the scanner can see what it looks for)")
    print("SUCCESS:p2-pattern-scan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
