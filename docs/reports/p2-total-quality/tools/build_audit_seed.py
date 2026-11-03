"""Generate the `audit` seed profile: rich, deterministic, edge-case-dense.

Why (P2 decision D8): the shipped `adrianaart` profile has **3 categories and 2
products**. An audit run against it cannot see pagination, table density, long-name
truncation, zero-stock affordances, empty states, or RO text expansion — the defects most
likely to be shipped are invisible because the data is too small and too tidy.

Two concrete evidence defects this fixes:
  * every seed image points at `https://example.com/...`, so **210 of 552** captured cells
    logged `net::ERR_BLOCKED_BY_ORB` and the screenshots contain NO product imagery. Visual
    review of any product surface was therefore reviewing empty boxes. This profile uses
    asset paths the app really serves (verified 200 before writing).
  * with 2 products nothing paginates, so no list/table/grid was ever exercised at depth.

Deterministic by construction: every value derives from the row index, so two runs produce
byte-identical JSON and an e2e assertion written against it stays valid. No randomness.

The `audit` profile is ADDITIVE — `adrianaart` (the real brand data) is left untouched.

Usage:
  python build_audit_seed.py [--base http://localhost:4202] [--products 210] [--no-verify]
then inside the backend container:
  python -m app.cli seed-data --profile audit
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from decimal import Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = REPO / "backend" / "app" / "seed_profiles" / "audit"
SRC_PROFILE = REPO / "backend" / "app" / "seed_profiles" / "adrianaart"

# Asset paths the frontend genuinely serves (verified against the running app below).
# Rotated across products so cards/grids render real pixels instead of broken-image boxes.
IMAGE_POOL = [
    "/assets/home/banner_image-640.webp",
    "/assets/home/banner_image-960.webp",
    "/assets/home/banner_image-1280.webp",
    "/assets/home/banner_image-640.jpg",
    "/assets/brand/momentstudio-flower.png",
]

# A deliberately-unresolvable image, so "broken image" is ONE controlled edge case rather
# than the state of the entire catalogue.
BROKEN_IMAGE = "/assets/home/this-image-does-not-exist-on-purpose.webp"

CATEGORIES = [
    {"slug": "cups", "name": "Cups & Mugs", "description": "Handmade cups and mugs."},
    {"slug": "bowls", "name": "Bowls", "description": "Wheel-thrown stoneware bowls."},
    {"slug": "plates", "name": "Plates", "description": "Dinner and side plates."},
    {"slug": "vases", "name": "Vases", "description": "Sculptural and functional vases."},
    {"slug": "gifts", "name": "Gift Sets", "description": "Curated gift sets."},
    # Deliberately left with ZERO products: the only way to exercise the category
    # empty state, which no amount of extra products will ever reveal.
    {"slug": "archive", "name": "Archive", "description": "Retired pieces. Intentionally empty."},
]

STOCKED_CATEGORIES = [c["slug"] for c in CATEGORIES if c["slug"] != "archive"]

GLAZES = ["Matte White", "Celadon", "Ash", "Cobalt", "Oxblood", "Sand", "Ink", "Moss"]
FORMS = ["Cup", "Mug", "Bowl", "Plate", "Vase", "Tumbler", "Beaker", "Dish"]


def _img(url: str, alt: str, order: int = 1) -> dict:
    return {"url": url, "alt_text": alt, "sort_order": order}


def edge_case_products() -> list[dict]:
    """One product per named edge case. Slugs are stable so tests can target them."""
    long_name = (
        "Extraordinarily Long Product Name For Truncation Testing — "
        "Hand-Thrown Stoneware Vessel With An Unreasonably Descriptive Title "
        "That Should Wrap Or Ellipsize Rather Than Break The Grid"
    )
    return [
        {
            "slug": "edge-long-name",
            "name": long_name,  # 178 chars: does the card/table truncate or blow out?
            "category_slug": "cups",
            "short_description": "A name long enough to break naive layouts.",
            "long_description": "Checks truncation, wrapping and table column behaviour.",
            "base_price": "42.00", "currency": "RON", "stock_quantity": 4,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[0], "Long-named cup")],
            "variants": [],
        },
        {
            "slug": "edge-diacritics",
            # Romanian diacritics + the ș/ț that are commonly mangled by bad encoding.
            "name": "Ceașcă cu Farfurioară — Glazură Îmbrăcată în Cenușă",
            "category_slug": "cups",
            "short_description": "Ceașcă din gresie, glazurată manual, cu accente de cenușă.",
            "long_description": "Verifică redarea diacriticelor românești (ă â î ș ț Ă Â Î Ș Ț) "
                                "și expansiunea textului RO față de EN.",
            "base_price": "38.50", "currency": "RON", "stock_quantity": 7,
            "is_featured": True,
            "images": [_img(IMAGE_POOL[1], "Ceașcă cu farfurioară")],
            "variants": [{"name": "Mică", "additional_price_delta": "0.00", "stock_quantity": 3},
                         {"name": "Mare", "additional_price_delta": "6.50", "stock_quantity": 4}],
        },
        {
            "slug": "edge-unicode",
            "name": "陶器 Teacup ✿ 茶碗 — mixed-script title",
            "category_slug": "cups",
            "short_description": "CJK + symbol + Latin in one string.",
            "long_description": "Checks font fallback, line-height and any byte-vs-char length logic.",
            "base_price": "55.00", "currency": "RON", "stock_quantity": 2,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[2], "陶器 teacup")],
            "variants": [],
        },
        {
            "slug": "edge-zero-stock",
            "name": "Sold Out Ash Bowl",
            "category_slug": "bowls",
            "short_description": "Out of stock on purpose.",
            "long_description": "Add-to-cart must be disabled and clearly labelled, not silently fail.",
            "base_price": "64.00", "currency": "RON", "stock_quantity": 0,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[3], "Sold out bowl")],
            "variants": [],
        },
        {
            "slug": "edge-zero-stock-variant",
            "name": "Partly Sold Out Plate Set",
            "category_slug": "plates",
            "short_description": "In stock overall, one variant exhausted.",
            "long_description": "The variant picker must disable the exhausted option only.",
            "base_price": "88.00", "currency": "RON", "stock_quantity": 3,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[0], "Plate set")],
            "variants": [{"name": "Set of 2", "additional_price_delta": "0.00", "stock_quantity": 3},
                         {"name": "Set of 4", "additional_price_delta": "70.00", "stock_quantity": 0}],
        },
        {
            "slug": "edge-no-image",
            "name": "Piece With No Photograph",
            "category_slug": "vases",
            "short_description": "Deliberately has zero images.",
            "long_description": "The card must show a real placeholder, not a broken box or 0-height gap.",
            "base_price": "120.00", "currency": "RON", "stock_quantity": 5,
            "is_featured": False,
            "images": [],
            "variants": [],
        },
        {
            "slug": "edge-broken-image",
            "name": "Piece With A Broken Image URL",
            "category_slug": "vases",
            "short_description": "Image URL deliberately 404s.",
            "long_description": "Exercises the <img> error path: alt text must remain readable.",
            "base_price": "132.00", "currency": "RON", "stock_quantity": 5,
            "is_featured": False,
            "images": [_img(BROKEN_IMAGE, "Intentionally missing photograph")],
            "variants": [],
        },
        {
            "slug": "edge-price-minimum",
            "name": "One Bani Test Piece",
            "category_slug": "gifts",
            "short_description": "Smallest representable price.",
            "long_description": "Checks currency formatting and rounding at the low bound.",
            "base_price": "0.01", "currency": "RON", "stock_quantity": 9,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[1], "Tiny price piece")],
            "variants": [],
        },
        {
            "slug": "edge-price-maximum",
            "name": "Museum Commission",
            "category_slug": "gifts",
            "short_description": "Very large price.",
            "long_description": "Checks thousands separators and column width at the high bound.",
            "base_price": "99999.99", "currency": "RON", "stock_quantity": 1,
            "is_featured": True,
            "images": [_img(IMAGE_POOL[2], "Museum commission")],
            "variants": [],
        },
        {
            "slug": "edge-html-in-name",
            # NOT an attack on anyone else's system: this is the app's own escaping test.
            # If this renders as markup rather than text, the app has an XSS sink.
            "name": "Escaping Test <script>alert(1)</script> & <b>bold</b>",
            "category_slug": "gifts",
            "short_description": "Angle brackets and ampersands in a product name.",
            "long_description": "Must render as literal text everywhere: card, detail, cart, admin table, order email.",
            "base_price": "31.00", "currency": "RON", "stock_quantity": 6,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[3], "Escaping test piece")],
            "variants": [],
        },
        {
            "slug": "edge-long-description",
            "name": "Verbose Provenance Vase",
            "category_slug": "vases",
            "short_description": "Short description is short; the long one is very long.",
            "long_description": " ".join(
                f"Paragraph {i}: wheel-thrown stoneware, reduction-fired, with a layered "
                "glaze that shifts from oxide-rich rust to pale celadon across the shoulder."
                for i in range(1, 41)
            ),
            "base_price": "210.00", "currency": "RON", "stock_quantity": 2,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[0], "Verbose vase")],
            "variants": [],
        },
        {
            "slug": "edge-many-variants",
            "name": "Twelve Glaze Sampler",
            "category_slug": "bowls",
            "short_description": "Twelve variants — stresses the variant picker.",
            "long_description": "A picker that renders 12 options must stay usable at 375px wide.",
            "base_price": "45.00", "currency": "RON", "stock_quantity": 24,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[1], "Glaze sampler")],
            "variants": [
                {"name": f"{g} {n}", "additional_price_delta": f"{n * 2}.00", "stock_quantity": n}
                for n, g in enumerate(GLAZES + GLAZES[:4], start=1)
            ],
        },
        {
            "slug": "edge-single-char-name",
            "name": "Ω",
            "category_slug": "bowls",
            "short_description": "One-character name.",
            "long_description": "Checks minimum-width layout and any name-initial avatar logic.",
            "base_price": "19.00", "currency": "RON", "stock_quantity": 8,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[2], "Omega bowl")],
            "variants": [],
        },
        {
            "slug": "edge-many-images",
            "name": "Gallery Piece With Ten Images",
            "category_slug": "plates",
            "short_description": "Ten images — stresses the gallery/thumbnail strip.",
            "long_description": "Checks thumbnail overflow, keyboard navigation and lazy-loading.",
            "base_price": "76.00", "currency": "RON", "stock_quantity": 4,
            "is_featured": False,
            "images": [_img(IMAGE_POOL[i % len(IMAGE_POOL)], f"Gallery view {i + 1}", i + 1)
                       for i in range(10)],
            "variants": [],
        },
    ]


def bulk_products(count: int) -> list[dict]:
    """Deterministic filler so lists, grids, tables and pagination are exercised."""
    out: list[dict] = []
    for i in range(count):
        cat = STOCKED_CATEGORIES[i % len(STOCKED_CATEGORIES)]
        glaze = GLAZES[i % len(GLAZES)]
        form = FORMS[i % len(FORMS)]
        # Price spread across a realistic range, deterministic from the index.
        price = Decimal(18) + (Decimal(i % 47) * Decimal("3.50"))
        # A repeating stock pattern that includes 0 and 1 so low-stock and out-of-stock
        # affordances appear throughout the catalogue, not only in the edge-case block.
        stock = [0, 1, 2, 3, 5, 8, 12, 20][i % 8]
        out.append({
            "slug": f"catalog-{i + 1:03d}-{glaze.lower().replace(' ', '-')}-{form.lower()}",
            "name": f"{glaze} {form} No. {i + 1}",
            "category_slug": cat,
            "short_description": f"{glaze} glaze on a wheel-thrown {form.lower()}.",
            "long_description": (
                f"Piece {i + 1} of the audit catalogue. {glaze} glaze, reduction-fired, "
                f"finished by hand. Included so list, grid and table surfaces are exercised "
                f"at realistic depth."
            ),
            "base_price": f"{price:.2f}",
            "currency": "RON",
            "stock_quantity": stock,
            "is_featured": i % 37 == 0,
            "images": [_img(IMAGE_POOL[i % len(IMAGE_POOL)], f"{glaze} {form} No. {i + 1}")],
            "variants": (
                [{"name": "Small", "additional_price_delta": "0.00", "stock_quantity": max(stock - 1, 0)},
                 {"name": "Large", "additional_price_delta": "8.00", "stock_quantity": max(stock // 2, 0)}]
                if i % 3 == 0 else []
            ),
        })
    return out


def verify_images(base: str) -> list[str]:
    """Refuse to ship a seed whose images do not load — that is the bug being fixed."""
    problems = []
    for url in IMAGE_POOL:
        try:
            req = urllib.request.Request(base.rstrip("/") + url, method="GET")
            with urllib.request.urlopen(req, timeout=20) as r:
                ctype = r.headers.get("Content-Type", "")
                if r.status != 200 or not ctype.startswith("image/"):
                    problems.append(f"{url} -> {r.status} {ctype}")
        except Exception as exc:
            problems.append(f"{url} -> {type(exc).__name__}: {exc}")
    # The broken one must genuinely be broken, or the edge case is fake.
    try:
        with urllib.request.urlopen(base.rstrip("/") + BROKEN_IMAGE, timeout=20) as r:
            body = r.read(400)
            if r.status == 200 and r.headers.get("Content-Type", "").startswith("image/"):
                problems.append(f"{BROKEN_IMAGE} unexpectedly RESOLVES as an image")
            elif b"<!DOCTYPE html" in body or b"<html" in body:
                # The SPA catch-all answers 200 text/html for unknown paths, so the <img>
                # still fails to decode. That is a valid broken-image edge case; note it.
                print(f"  note: {BROKEN_IMAGE} returns the SPA shell (200 text/html) — "
                      "the <img> still fails to decode, so the edge case holds")
    except Exception:
        pass  # a 404 is exactly what this entry is for
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:4202")
    ap.add_argument("--products", type=int, default=210)
    ap.add_argument("--no-verify", action="store_true")
    a = ap.parse_args()

    if not a.no_verify:
        problems = verify_images(a.base)
        if problems:
            for p in problems:
                print(f"  IMAGE PROBLEM: {p}")
            print("FAILED:p2-audit-seed image verification failed — a seed with dead images "
                  "reproduces the very defect it exists to fix")
            return 1
        print(f"  image verification: all {len(IMAGE_POOL)} pool images return 200 image/*")

    edges = edge_case_products()
    bulk = bulk_products(max(0, a.products - len(edges)))
    products = edges + bulk

    slugs = [p["slug"] for p in products]
    if len(slugs) != len(set(slugs)):
        dupes = sorted({s for s in slugs if slugs.count(s) > 1})
        print(f"FAILED:p2-audit-seed duplicate slugs: {dupes[:5]}")
        return 1
    known = {c["slug"] for c in CATEGORIES}
    bad_cat = sorted({p["category_slug"] for p in products} - known)
    if bad_cat:
        print(f"FAILED:p2-audit-seed products reference unknown categories: {bad_cat}")
        return 1
    if any(p["category_slug"] == "archive" for p in products):
        print("FAILED:p2-audit-seed 'archive' must stay empty (it is the empty-state fixture)")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog = {"categories": CATEGORIES, "products": products}
    (OUT_DIR / "catalog.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # content_blocks.json is mandatory for a profile to load. Reuse the real brand blocks
    # (same keys the app looks up) so no surface silently loses its content, and copy the
    # legal markdown they reference.
    src_blocks = json.loads((SRC_PROFILE / "content_blocks.json").read_text(encoding="utf-8"))
    (OUT_DIR / "content_blocks.json").write_text(
        json.dumps(src_blocks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    legal_src = SRC_PROFILE / "legal"
    if legal_src.is_dir():
        (OUT_DIR / "legal").mkdir(exist_ok=True)
        for md in legal_src.glob("*.md"):
            (OUT_DIR / "legal" / md.name).write_text(
                md.read_text(encoding="utf-8"), encoding="utf-8")

    stock0 = sum(1 for p in products if p["stock_quantity"] == 0)
    per_cat: dict[str, int] = {}
    for p in products:
        per_cat[p["category_slug"]] = per_cat.get(p["category_slug"], 0) + 1
    print(f"  categories: {len(CATEGORIES)} (empty-state fixture: 'archive' with 0 products)")
    print(f"  products:   {len(products)}  ({len(edges)} named edge cases + {len(bulk)} bulk)")
    print(f"  per category: {per_cat}")
    print(f"  zero-stock products: {stock0}   featured: {sum(1 for p in products if p['is_featured'])}")
    print(f"  variants total: {sum(len(p['variants']) for p in products)}   "
          f"images total: {sum(len(p['images']) for p in products)}")
    print(f"  wrote {OUT_DIR / 'catalog.json'} and content_blocks.json (+legal)")
    print("SUCCESS:p2-audit-seed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
