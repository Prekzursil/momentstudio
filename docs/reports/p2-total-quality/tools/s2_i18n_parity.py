"""S2-i18n-parity: deterministic EN/RO key-parity + value-quality check.

Read-only. Prints a machine-checkable report to stdout.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
I18N = ROOT / "frontend" / "src" / "assets" / "i18n"


def flatten(obj, prefix=""):
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(flatten(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = obj
    return out


def main():
    en_raw = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    ro_raw = json.loads((I18N / "ro.json").read_text(encoding="utf-8"))
    en = flatten(en_raw)
    ro = flatten(ro_raw)

    print(f"EN leaf keys: {len(en)}")
    print(f"RO leaf keys: {len(ro)}")

    ek, rk = set(en), set(ro)
    missing_in_ro = sorted(ek - rk)
    missing_in_en = sorted(rk - ek)
    print(f"\n== MISSING IN RO (present EN, absent RO): {len(missing_in_ro)}")
    for k in missing_in_ro:
        print(f"  EN-ONLY  {k} = {en[k]!r}")
    print(f"\n== MISSING IN EN (present RO, absent EN): {len(missing_in_en)}")
    for k in missing_in_en:
        print(f"  RO-ONLY  {k} = {ro[k]!r}")

    common = sorted(ek & rk)

    # type mismatches
    tmm = [k for k in common if type(en[k]) is not type(ro[k])]
    print(f"\n== TYPE MISMATCH: {len(tmm)}")
    for k in tmm:
        print(f"  TYPE {k}: EN={type(en[k]).__name__} RO={type(ro[k]).__name__}")

    # empty values
    empty_en = [k for k in en if isinstance(en[k], str) and en[k].strip() == ""]
    empty_ro = [k for k in ro if isinstance(ro[k], str) and ro[k].strip() == ""]
    print(f"\n== EMPTY EN VALUES: {len(empty_en)}")
    for k in empty_en:
        print(f"  EMPTY-EN {k}")
    print(f"== EMPTY RO VALUES: {len(empty_ro)}")
    for k in empty_ro:
        print(f"  EMPTY-RO {k}")

    # interpolation placeholder parity {{x}}
    ph = re.compile(r"\{\{\s*([^}]*?)\s*\}\}")
    ph_bad = []
    for k in common:
        a, b = en[k], ro[k]
        if isinstance(a, str) and isinstance(b, str):
            sa, sb = sorted(ph.findall(a)), sorted(ph.findall(b))
            if sa != sb:
                ph_bad.append((k, sa, sb))
    print(f"\n== PLACEHOLDER MISMATCH: {len(ph_bad)}")
    for k, sa, sb in ph_bad:
        print(f"  PLACEHOLDER {k}: EN={sa} RO={sb}")
        print(f"      EN={en[k]!r}")
        print(f"      RO={ro[k]!r}")

    # identical values where translation expected
    ROMANIAN_HINT = set("ăâîșşțţĂÂÎȘŞȚŢ")
    STOP = {
        "email", "e-mail", "ok", "id", "url", "pdf", "sms", "seo", "api", "ai",
        "logo", "total", "status", "info", "meniu", "admin", "cookie", "cookies",
        "audio", "video", "gdpr", "iban", "vat", "tva", "cif", "cui", "sr",
    }

    def looks_translatable(s):
        if not isinstance(s, str):
            return False
        t = s.strip()
        if len(t) < 4:
            return False
        if t.lower() in STOP:
            return False
        # must contain at least one alphabetic run of >=4 letters
        words = re.findall(r"[A-Za-zÀ-ɏ]{2,}", t)
        if not words:
            return False
        if len(t) <= 12 and len(words) == 1 and t.lower() in STOP:
            return False
        # pure placeholder / pure symbol / url / path
        if re.fullmatch(r"[\W\d\s]+", t):
            return False
        if t.startswith(("http://", "https://", "/", "#", "+", "@")):
            return False
        if re.fullmatch(r"\{\{[^}]+\}\}", t):
            return False
        return True

    ident = []
    for k in common:
        a, b = en[k], ro[k]
        if isinstance(a, str) and a == b and looks_translatable(a):
            ident.append(k)
    # split: identical AND no Romanian diacritic anywhere => strongest signal
    print(f"\n== IDENTICAL EN==RO (translatable-looking): {len(ident)}")
    # group by top-2 namespace for readability
    from collections import Counter
    ns = Counter(".".join(k.split(".")[:2]) for k in ident)
    print("  -- by namespace (top 40):")
    for n, c in ns.most_common(40):
        print(f"     {c:5d}  {n}")
    print("  -- full list:")
    for k in ident:
        print(f"  IDENT {k} = {en[k]!r}")

    # sentence-like identical (>=3 words) = highest visibility
    sent = [k for k in ident if len(re.findall(r"[A-Za-zÀ-ɏ]{2,}", en[k])) >= 3]
    print(f"\n== IDENTICAL SENTENCE-LIKE (>=3 words): {len(sent)}")
    for k in sent:
        print(f"  IDENT-SENT {k} = {en[k]!r}")

    # RO values that contain zero Romanian diacritics AND are >=5 words (possible untranslated prose)
    long_no_diac = []
    for k in common:
        b = ro[k]
        if isinstance(b, str) and len(re.findall(r"[A-Za-zÀ-ɏ]{2,}", b)) >= 6:
            if not (set(b) & ROMANIAN_HINT):
                long_no_diac.append(k)
    print(f"\n== RO long strings with NO Romanian diacritics: {len(long_no_diac)}")
    for k in long_no_diac[:200]:
        print(f"  NODIAC {k} = {ro[k]!r}")

    # duplicate-key detection in raw JSON text (json.loads silently keeps last)
    for name in ("en.json", "ro.json"):
        txt = (I18N / name).read_text(encoding="utf-8")
        pairs = []

        def hook(items):
            seen = {}
            for kk, vv in items:
                if kk in seen:
                    pairs.append(kk)
                seen[kk] = vv
            return seen

        json.loads(txt, object_pairs_hook=hook)
        print(f"\n== DUPLICATE SIBLING KEYS in {name}: {len(pairs)} -> {sorted(set(pairs))[:50]}")

    print("\nSUMMARY "
          f"en={len(en)} ro={len(ro)} en_only={len(missing_in_ro)} ro_only={len(missing_in_en)} "
          f"type_mismatch={len(tmm)} empty_en={len(empty_en)} empty_ro={len(empty_ro)} "
          f"placeholder_mismatch={len(ph_bad)} identical={len(ident)} identical_sentences={len(sent)}")


if __name__ == "__main__":
    main()
