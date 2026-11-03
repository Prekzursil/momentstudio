# R4-i18n-ro — Romanian locale + bilingual EN/RO UI pitfalls

## Verified clean (do not re-audit)

**Key parity is REAL, not just equal counts** — 4634 leaves, `EN\RO = 0`, `RO\EN = 0`, 0 type
mismatches, **0 placeholder mismatches**. **0 cedilla contamination** (all 2737 diacritic values use
comma-below `ș U+0219`/`ț U+021B`). **Font subsets cover RO** — `cinzel-latin.woff2` has â/î,
`cinzel-latin-ext.woff2` has ă/ș/ț/Ș/Ț, each `unicode-range` routed to the file that holds the
glyph. **Storefront search IS diacritic-folded** (`catalog.py:75-83`); see F6.

## P1 F1 — `LOCALE_ID` never set to `ro`; 143 `| date:` + 81 `| number` render en-US
**almost-certain (90-99%) · reproduced.** `grep -rn "LOCALE_ID\|registerLocaleData" frontend/src`
→ **0 hits**; `app.config.ts:23-53` never provides it, so Angular's default `en-US` applies
regardless of `currentLang`. `curl "http://localhost:4202/blog?lang=ro"` → Romanian
chrome, post date **`Jul 26, 2026`** (RO: `26 iul. 2026`). Same class: `account.state.ts:2139`,
`admin.component.ts:12448` (bare `toLocaleString()` → *host OS* locale),
`tickets.component.ts:418`. **Fix:** `registerLocaleData(localeRo,'ro')`; `LOCALE_ID` injects once,
so re-provide per SSR request and use a locale-reactive `localizedDate` pipe client-side.

## P1 F2 — RON prices bypass `Intl`: `24.00 RON`, and no thousands grouping in either language
**almost-certain (90-99%) · reproduced.** `localized-currency.pipe.ts:16-19` returns
`` `${value.toFixed(2)} RON` ``, and :52-54 routes **RON only** to that locale-blind branch while
every other currency gets `Intl.NumberFormat`. RO home renders `24.00 RON`; `Intl('ro-RO')` gives `24,00 RON`, and 1234.5 →
`1.234,50 RON` vs the app's `1234.50 RON` (**no grouping at all, even in EN**). Ad-hoc repeats at
`admin-coupons.component.ts:3274`, `admin-segments.component.ts:382`, `checkout.component.ts:1265`.
**Fix:** delete `formatRon`; route RON through `getFormatter(loc,'RON',2,2)`.

## P1 F3 — SSR ships `<html lang="en">` on fully-Romanian pages
**almost-certain (90-99%) · reproduced.** `language.service.ts:60-68` guards on the **global**
`document` (undefined under SSR) so it no-ops server-side; `index.html:1` hardcodes `lang="en"`;
`server.ts` has no language handling. `curl "…/?lang=ro"` → `<html lang="en">` on
a page whose `<title>` and body are Romanian (72 diacritics) — a WCAG 3.1.1 failure that also
contradicts the page's own `hreflang="ro"`.
**Fix:** inject `DOCUMENT`, not global `document`; set it in the server render.
**F3b (P2):** `seo-head-links.service.ts:71-78` prefers `location.origin` over configured
`appConfig.publicBaseUrl`, so behind the `infra-ssr-edge-1` nginx alternates emit
`href="http://localhost/?lang=ro"` — port stripped, `http://` behind TLS. Invert on the server.

## P1 F4 — Product search never matches Romanian product names
**likely (55-80%) · code-confirmed; no RO seed rows exist to execute against.**
`catalog.py:2151-2222`: `list_products_with_filters` takes `lang` and eagerly loads
`ProductTranslation` *for display*, but the predicate (:2220-2222) matches only base
`Product.name/short_description/long_description`, so a shopper typing the Romanian name on the
card gets zero results; `sort=name_asc` (:2246) sorts the base English name too.
**Fix:** outer-join `ProductTranslation` on the active lang, OR the normalized expression over it,
sort on `coalesce(translation.name, Product.name)`.

## P2 F5 — RO plural handled as an en-style binary; `few`/`other` and the "de" rule absent
**almost-certain (90-99%) · reproduced.** CLDR gives Romanian **three** cardinals: `one`(1),
`few`(0, n%100 in 1..19), `other` — and `other` additionally requires **"de"** before the noun.
ngx-translate 17 ships no ICU plural (`ngx-translate-messageformat-compiler` absent).
(a) Binary selector: `account.state.ts:1756-1757` / `account-orders.component.ts:182-183` do
`count===1 ? .one : .many`; `ro.json:707-708` → "20 produse" where RO needs "20 **de** produse".
(b) No selector: `ro.json:937` renders live as **`Pagina 1 din 1 · 1 postări`** — wrong at n=1
("1 postare") *and* n≥20; 94 count-bearing keys share the shape. **Fix:** ICU compiler, or a
`plural` pipe over `Intl.PluralRules(lang)` picking `.one/.few/.other`.

## P2 F6 — Admin search is not diacritic-folded (asymmetric with the storefront)
**almost-certain (90-99%) · code-confirmed.** `admin_dashboard.py:2093-2095,2206-2208` use raw
`Product.name.ilike(...)`; user lookups at 2123/2593/2686/2777/3966 use `func.lower()` with no
folding — `cana` misses `Cană ceramică`, `Ionita` misses `Ioniță`.
`grep -r unaccent backend/` → 0 hits. **Fix:** reuse `_normalized_search_expr`, or install
`unaccent` and index it.

## P2 F7 — 14 Romanian strings shipped **without diacritics**, incl. `<meta name="description">`
**almost-certain (90-99%) · reproduced.** `route-seo-defaults.ts:23-51` (8) and
`seo-copy-fallback.service.ts:21-53` (6) hold ASCII Romanian — "Exploreaza", "Descopera",
"compara optiuni", "gaseste", "si". Live, the RO home ships
`content="Descopera arta ceramica lucrata manual, colectii recomandate si noutati…"` and
`/blog?lang=ro` renders that intro directly above correctly-accented `ro.json` copy.
**Fix:** rewrite all 14; CI-lint any RO literal matching `\b(si|sa|cu|din|pentru)\b` also
matches `[ăâîșț]`.

## P2 F8 — Hardcoded English inside the Romanian UI
**almost-certain (90-99%) · reproduced.** `app.component.ts:35,37` "Skip to main content";
`header.component.ts:107,129` "Search", `:120` "Open navigation", `:137` "Cart" — all appear
verbatim in the RO SSR body. Worse, `admin/shared/dam-asset-library.component.ts` (2526 lines) has
**62 hardcoded visible strings and zero `| translate` calls**.
**Fix:** extract to both files; lint bare text nodes and `aria-label` literals.

## P3 F11 — 16.5% measured expansion; risk sits in short labels
**likely (55-80%) · metrics measured, on-screen overflow NOT visually confirmed** (deferred to the running
capture sweep; do not start a second Chromium fleet). EN 94,758 → RO 110,388 chars
(**+16.5%**, inside the W3C band); risk sits in the 2419 short (≤15 ch) labels —
`FAQ`→`Întrebări frecvente` (3→19, **+533%**), `Checkout`→`Finalizează comanda`,
`Privacy Policy`→`Politica de confidențialitate` (footer) — against 227
`truncate`/`line-clamp-1`/`overflow-hidden` sites and fixed `w-[120px]`/`w-[200px]` admin columns
(`admin-products.component.ts:1115,1128,1749`). **Experiment:** re-run the sweep at `?lang=ro`,
diff `scrollWidth > clientWidth` vs EN.

## P3 F9/F10/F12 — smaller items
- **F9 (almost-certain):** 17 `meta.titles.*` identical in both files (`ro.json:34`) → English
  `<title>` on `/blog?lang=ro`. Brand-only ones are fine; `checkout`/`newsletter`/`offline` are
  not. Same residue: `Export/Import CSV`, `Status:`, `Fraud:`.
- **F10 (almost-certain, executed):** `catalog.py:2063-2065` `slugify` keeps any `isalnum()`, so
  `"Cană ceramică albastră"` → `/products/can%C4%83-ceramic%C4%83-…`, diverging from
  `_normalize_search_text`. **Fix:** NFKD-fold first, redirect issued slugs.
- **F12 (likely 55-80%):** `infra-db-1` is `en_US.utf8`, folding ă/â/î/ș/ț onto base letters; RO
  orders them as distinct letters after the base, so `ORDER BY name` is subtly wrong.
  **Fix if needed:** `COLLATE "ro-RO-x-icu"`.

---

## EVIDENCE

1. Flatten-diff over `frontend/src/assets/i18n/{en,ro}.json` → `en keys 4634 ro keys 4634 /
   in EN not RO: 0 / in RO not EN: 0 / TYPE MISMATCH 0 / CEDILLA count: 0 /
   PLACEHOLDER MISMATCH 0 / total EN chars 94758 RO chars 110388 expansion 16.5%`
2. `curl -s "http://localhost:4202/?lang=ro"` → `<html lang="en" data-beasties-container>`;
   `<title>momentstudio | Magazin de ceramică artizanală</title>`; body `White Glazed Cup … 24.00
   RON`; `Skip to main content` / `Search` / `Open navigation` / `Cart`;
   `<meta name="description" content="Descopera arta ceramica lucrata manual, …">`;
   `<link rel="alternate" hreflang="ro" href="http://localhost/?lang=ro">`
3. `curl -s "http://localhost:4202/blog?lang=ro"` → `Jul 26, 2026 · 1 min citire` and
   `Pagina 1 din 1 · 1 postări`
4. `node -e` → `ro-RO 1.234,50 RON | 24,00 RON` vs app `1234.50 RON`;
   `ro plural: 1=one 2=few 19=few 20=other 101=few`; `ro date 09.03.2026 | en 3/9/2026`;
   `docker exec infra-db-1 psql -Atc "select datname,datcollate…"` → `adrianaart|en_US.utf8`
5. `localized-currency.pipe.ts:16-19,52-54` · `language.service.ts:60-68` ·
   `seo-head-links.service.ts:71-78` · `route-seo-defaults.ts:23-51` ·
   `seo-copy-fallback.service.ts:21-53` · `app.component.ts:35,37` ·
   `header.component.ts:107,120,129,137` · `account.state.ts:1756-1757` ·
   `account-orders.component.ts:182-183` · `ro.json:34,707-708,926,937` ·
   `backend/app/services/catalog.py:75-83,2063-2065,2220-2222,2246` ·
   `backend/app/api/v1/admin_dashboard.py:2093-2095,2206-2208` ·
   `grep -rn "LOCALE_ID\|registerLocaleData" frontend/src` → 0 · `grep -r unaccent backend/` → 0
6. External: CLDR Language Plural Rules — Romanian `one` / `few`(n%100 in 1..19) / `other`
   (unicode.org/cldr/charts/46/supplemental/language_plural_rules.html#ro); CLDR `ro-RO` number
   pattern `#,##0.00 ¤` (group `.`, decimal `,`, currency suffixed); W3C "Text size in translation"
   (w3.org/International/articles/article-text-size — short UI strings expand most); W3C "Declaring
   language in HTML" + WCAG 2.2 SC 3.1.1; Unicode 3.0 added U+0218-U+021B (Romanian = comma-below,
   not cedilla); Angular `registerLocaleData`/`LOCALE_ID`; ngx-translate needs
   `ngx-translate-messageformat-compiler` for ICU plurals; PostgreSQL `unaccent`.

SUCCESS:R4-i18n-ro 12 findings (4 P1 / 4 P2 / 4 P3); en/ro key parity is genuinely clean (4634=4634, zero key/placeholder drift) but locale BEHAVIOUR is not — no LOCALE_ID so RO pages show `Jul 26, 2026`, RON bypasses Intl (`24.00 RON`), SSR ships `<html lang="en">` on Romanian pages, product search ignores ProductTranslation, and Romanian's three-form plural is modelled as an en-style binary (`1 postări` live).
