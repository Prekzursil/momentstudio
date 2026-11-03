"""S2-i18n-parity check (2): user-facing literal text in Angular templates that never
passes through the translate pipe / TranslateService.

Scans inline `template: \\`...\\`` blocks in non-spec .ts components plus any .html files.
Emits file:line for each hit.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / "frontend" / "src" / "app"

TEMPLATE_RE = re.compile(r"template:\s*`", re.S)

# text nodes: >TEXT<  where TEXT has letters and no interpolation
TEXTNODE_RE = re.compile(r">([^<>{}@]+)<")
# translatable attributes carrying a literal
ATTR_RE = re.compile(
    r"(?<![\[\(\w-])(placeholder|title|alt|aria-label|label)\s*=\s*\"([^\"{}<>]+)\""
)

SKIP_TEXT = re.compile(
    r"^[\s\d\W]*$"          # no letters
    r"|^(px|rem|em|%|RON|EUR|USD|ID|OK|CSV|PDF|URL|SEO|API|·|—|–|\||/|,)$",
    re.I,
)

# things that are clearly not prose
NOISE = re.compile(
    r"^(true|false|null|undefined|none|auto|inherit|block|flex|grid|div|span)$", re.I
)


def iter_templates(path: Path):
    """Yield (start_line, template_text) for each inline template in a .ts file."""
    txt = path.read_text(encoding="utf-8", errors="replace")
    for m in TEMPLATE_RE.finditer(txt):
        i = m.end()
        depth = 0
        j = i
        while j < len(txt):
            c = txt[j]
            if c == "\\":
                j += 2
                continue
            if c == "$" and j + 1 < len(txt) and txt[j + 1] == "{":
                depth += 1
                j += 2
                continue
            if c == "}" and depth:
                depth -= 1
            elif c == "`" and depth == 0:
                break
            j += 1
        start_line = txt.count("\n", 0, i) + 1
        yield start_line, txt[i:j]


def looks_userfacing(s: str) -> bool:
    t = s.strip()
    if len(t) < 3:
        return False
    if SKIP_TEXT.match(t) or NOISE.match(t):
        return False
    letters = re.findall(r"[A-Za-zÀ-ɏ]{2,}", t)
    if not letters:
        return False
    # ignore css-ish / identifier-ish blobs
    if re.fullmatch(r"[a-z0-9_\-\.]+", t):
        return False
    if t.startswith(("http", "//", "#", ".", "&")):
        return False
    if "&nbsp;" in t and len(letters) == 0:
        return False
    return True


def main():
    files = [
        p
        for p in SRC.rglob("*.ts")
        if not p.name.endswith(".spec.ts") and "test" not in p.name
    ]
    files += list(SRC.rglob("*.html"))

    hits = []
    for p in sorted(files):
        blocks = []
        if p.suffix == ".html":
            blocks = [(1, p.read_text(encoding="utf-8", errors="replace"))]
        else:
            blocks = list(iter_templates(p))
        for start_line, tpl in blocks:
            lines = tpl.split("\n")
            for off, line in enumerate(lines):
                ln = start_line + off
                if "translate" in line:
                    continue
                for m in TEXTNODE_RE.finditer(line):
                    txt = m.group(1)
                    if "|" in txt or "{{" in txt:
                        continue
                    if looks_userfacing(txt):
                        hits.append((p, ln, "TEXT", txt.strip()))
                for m in ATTR_RE.finditer(line):
                    attr, val = m.group(1), m.group(2)
                    if looks_userfacing(val):
                        hits.append((p, ln, f"ATTR:{attr}", val.strip()))

    rel = lambda p: str(p.relative_to(ROOT)).replace("\\", "/")  # noqa: E731

    # split storefront vs admin by path
    store, admin, other = [], [], []
    for h in hits:
        r = rel(h[0])
        (admin if "/admin" in r else store if "/pages/" in r or "/layout/" in r or "/shared/" in r else other).append(h)

    for label, group in (("STOREFRONT/SHARED", store), ("ADMIN", admin), ("OTHER", other)):
        print(f"\n===== {label}: {len(group)} hits")
        for p, ln, kind, txt in group:
            print(f"  {rel(p)}:{ln}  [{kind}] {txt!r}")

    print(f"\nTOTAL hardcoded-literal hits: {len(hits)} "
          f"(storefront={len(store)} admin={len(admin)} other={len(other)})")


if __name__ == "__main__":
    main()
