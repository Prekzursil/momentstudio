# S2-i18n-parity — i18n key parity + hardcoded user-facing strings

Method: two purpose-written scripts (kept outside the repo per the read-only contract — paths in
EVIDENCE): a flatten/set-difference parity checker over `frontend/src/assets/i18n/{en,ro}.json`,
and a **quote-aware** Angular template tokenizer over all 234 non-spec `.ts` + 2 `.html` files in
`frontend/src`. Quote-awareness matters: a naive `<[^>]*>` tag regex mis-splits on `>` inside
`*ngIf="x > 0"` and inflates the literal count by ~40%. Ranked by user visibility.

**Key parity is clean, and I am not manufacturing a finding.** EN and RO each flatten to 4634 leaf
keys with a **0-key set difference in both directions**, 0 type mismatches, 0 empty values, 0
`{{token}}` interpolation drift. That is enforced, not luck: `npm run i18n:check`
(`frontend/scripts/check-i18n.mjs`) is a **blocking** CI step (`.github/workflows/frontend.yml:54`).
Every finding below sits in a class that gate structurally cannot see.

---

### P1 — Three storefront routes have ZERO i18n wiring
**almost-certain (90-99%) — `grep -c translate` = 0 in each file; reproduced live against SSR.**

| Route | File | Literals |
|---|---|---|
| `/**` (404) | `not-found.component.ts:11-32` — `imports: [RouterLink, ButtonComponent]`, no `TranslateModule` | 6 |
| `/error` | `error.component.ts:11-33` — same | 8 |
| `/receipt/:token` | `receipt.component.ts` | 27 |

There is no `notFound`, `error`, or `receipt` namespace in `en.json` at all, so a language switch
cannot rescue them. Live: `curl localhost:4202/definitely-not-a-real-page-xyz` returns `Page not
found` / `The page you are looking for doesn't exist…` / `Contact support` verbatim. On the receipt
some labels are manually bilingual (`Product / Produs`, `Status / Stare`) — a deliberate printable
artefact — but `Qty`, `Unit`, `Download PDF`, `Back home`, `Loading…` and *"Full details are
available only to the order owner or an admin."* are English-**only** inside that paired document.
These are the pages a lost or post-purchase RO customer lands on.
**Fix:** add `notFound.*` / `errorPage.*` / `receipt.*`; import `TranslateModule`; bind via the pipe.

### P1 — Every RO SEO meta description is diacritic-stripped (8/8)
**almost-certain — measured with a high-precision marker set; rendered value confirmed live.**

`ro.json → meta.descriptions.{home,shop,blog,blog_post,page,product,about,contact}` contain **zero**
Romanian diacritics: *"Descopera arta ceramica lucrata manual, colectii recomandate si noutati…"*.
This is an island, not a file style — a marker set of always-diacritic-bearing words (`si`,
`informatii`, `optiuni`, `noutati`, `citeste`, `exploreaza`, `descopera`, `afla`, `foloseste`, …)
matches **exactly 12 strings in the whole 4634-key file**: these 8, plus `page.exploreMore(Copy)`
and `product.exploreMore(Copy)`. **Zero** admin strings match; the rest of RO is correct
("Pagina a fost salvată", "Nu am putut încărca paginile"). So the defect is two features authored
without diacritics, not a convention.

Impact: this is the literal string Google prints in the RO SERP snippet for all eight top-level
page types. **Fix:** rewrite those 12 (Descoperă, Explorează, Citește, Află, Contactează,
Folosește, și, informații, opțiuni, noutăți, povești, secțiuni).

### P2 — `<html lang="en">` even when SSR renders Romanian
**almost-certain — reproduced.** `curl "localhost:4202/?lang=ro"` returns Romanian body copy
(`Magazin` ×5) but `<html lang="en">`, alongside its own
`<link rel="alternate" hreflang="ro" href="…/?lang=ro">`. Root cause:
`language.service.ts:60-63` `applyDocumentLanguage()` early-returns on
`typeof document === 'undefined'`, which is true under `@angular/platform-server` — and the
`/* istanbul ignore next -- SSR guard: document is always defined in the browser */` comment above
it encodes the wrong assumption as a coverage exemption. WCAG 2.2 SC 3.1.1 failure; a `lang`
vs `hreflang` conflict on the URL the site itself nominates as Romanian.
**Fix:** inject `DOCUMENT` from `@angular/common` (populated on the server) instead of the global;
delete the istanbul exemption and cover the SSR path.

### P2 — Confirmation sentinels are locale-coupled (latent lockout)
**almost-certain (static). likely (55-80%) that it breaks the day RO is translated.**

The placeholder is translated but the guard compares to a hard-coded English literal:
`account-privacy.component.ts:199` renders `account.privacy.deletion.confirmPlaceholder` while
`:229` requires `=== 'DELETE'`. Same for `PURGE` (`admin-dashboard.component.ts:2575` / `:4370`),
`TRANSFER` (`:2624`), and `admin-users.component.ts:1788`. This works **only because** those five
RO values happen to be byte-identical to EN — an untranslated string is load-bearing, and a
well-meaning translator pass (`DELETE`→`ȘTERGE`) permanently bricks account deletion and audit
purge. **Fix:** compare against `translate.instant(<sameKey>)`, or render the required token via
interpolation (`"Tastează {{token}} pentru confirmare"`) against a non-localised constant.

### P2 — `MissingTranslationHandler` disguises missing keys as plausible English
**almost-certain.** `core/missing-translation.handler.ts:33-39` humanises the key leaf
(`checkout.deliveryEstimate` → `"Delivery estimate"`) plus 18 hard-coded English fallbacks (`:4-21`).
A missing RO key therefore never renders a detectable marker — it renders a convincing English
label. That defeats browser-based i18n QA and any visual sweep, and is why the set-difference gate
is currently the *only* thing between this app and silent drift.
**Fix:** return `⟦${key}⟧` in non-production builds; keep the humanised fallback in production but
`console.warn` + emit a Sentry breadcrumb.

### P2 — Duplicate sibling keys silently collapsed by `JSON.parse`
**almost-certain — reproduced with `object_pairs_hook`.** `adminUi.site.pages.success` and
`.errors` are each declared **twice**: `en.json:3135-3136`, again at `:3243`/`:3245` (RO identical
lines). The parser keeps the last, so authored `"Page saved."` / `"Could not save the page." `/
`"Could not load the page."` are dead; the legal-page editor
(`admin.component.ts:15461`, `:15555`) shows generic `"Content saved."` / `"Could not load pages."`.
Raw declared 4636 → parsed 4634. `check-i18n.mjs` cannot see it because it `JSON.parse`s first
(`:53`). Today's discard set is copy-only, but the next duplicate that is *not* a superset will
delete keys with CI green.

### P2 — Checkout H1 and six RO `<title>`s still read "Checkout"
**almost-certain — contradicted by the file's own register.** `checkout.title` = `'Checkout'` in
both locales and is the page H1 (`checkout.component.ts:164`, `[titleKey]="'checkout.title'"`);
same for `meta.titles.checkout`, `checkout_stripe|paypal|netopia` and the two `_mock` variants. Not
a loanword choice — `ro.json` itself says **"Finalizarea comenzii a eșuat."**
(`checkout.checkoutFailed`). **Fix:** `"Finalizare comandă"`.

### P3 — SSR can never see a returning user's chosen locale
**almost-certain (mechanism), likely (55-80%) that the flash is perceptible.** `setLanguage()`
persists only to `localStorage` (`language.service.ts:44-46`); **no cookie is written anywhere**
(the only `document.cookie` writer is `recently-viewed.service.ts:127`), and SSR reads no
`Accept-Language` (`REQUEST` is injected nowhere in `frontend/src`). So a RO user who explicitly
picked Romanian still gets an English server render on **every** cold load, flipping after
hydration. `curl -H 'Accept-Language: ro-RO'` and `curl -b 'lang=ro'` both return `Magazin` ×0.
**Fix:** mirror the choice into a `lang` cookie and resolve locale server-side as
`?lang=` → cookie → `Accept-Language`; `ServerTranslateLoader` already supports `'ro'` (`:24-27`).

### P3 — 257 hardcoded literals, concentrated in five components
`dam-asset-library.component.ts` **165** (zero translate wiring — a whole admin surface),
`receipt.component.ts` 27, `admin.component.ts` 18 (`:6706` "Publish at", `:6727` "Bestseller",
`:7626-7666` order detail, `:7787/7815` "No history yet."), `admin-ops.component.ts` 10 (DAM
telemetry, plus `damTelemetryError.set('Failed to load DAM telemetry.')` at `:1588`),
`theme-live-preview.component.ts` 8. Storefront stragglers: `product.component.ts:198` `({{n}}
left)` and `:456` `Close`; `banner-block.component.ts:89,143`. `/offline` is the sharpest
illustration — `offline.component.ts:19-23` puts four buttons in one row, two via `| translate`,
two as `label="Browse shop"` / `label="Read blog"` (keys `nav.shop`/`nav.blog` already exist).

### P3 — Accessible names are English-only sitewide
`app.component.ts:35,37` `Skip to main content` (*visible* on keyboard focus);
`header.component.ts:75,104-137,376` `aria-label`/`sr-only` `Search`, `Open navigation`, `Cart`,
`Header controls`, plus the concatenated `'Cart with ' + cartCount() + ' items'` (also
unpluralisable in RO); `footer.component.ts:65,343`. Counted as user-facing: an `sr-only` span *is*
content for AT users.

### Ruled out / corrected
- **176-219 identical EN==RO values are mostly legitimate** — brand names, Romanian-valid loanwords
  (`Card`, `Catalog`, `Contact`, `Public`, `Standard`, `Subtotal`, `Newsletter`), design tokens
  (`16px (1rem)`). Genuine leftovers beyond `checkout.title`: `adminUi.products.view.active`
  (→`Activ`), `…users.roles.fulfillment`, `…fx.eurPerRon`/`usdPerRon` (`per`→`pe`),
  `…blog.revisions.rollback`, `…orders.tracking`, `…orders.tags.resetColor`, `…uiPreset.title`,
  and `Export CSV`×5 / `Import CSV`×2 (RO wants the imperative `Exportă`/`Importă`, matching
  `Continuă`/`Reîncearcă` in the same file). All admin — **P3, likely (55-80%)** a native reviewer
  agrees on the full list.
- **Correction to my own first probe.** I initially read `?lang=ro` as *not* honoured by SSR and
  nearly filed a P1. My grep pattern (`>(Shop|Magazin|Cart)<`) matched only the *hardcoded* English
  `Cart` sr-only span and missed the translated nav. A byte-count re-probe shows SSR **does** honour
  `?lang=ro` (`Magazin` ×5). Only the header-and-cookie paths are unnegotiated (P3 above). Recorded
  because the failure mode — a too-narrow grep reading as a null result — would recur.

### Consolidated gate fix (strengthen, never weaken)
Extend the already-blocking `check-i18n.mjs` with four passes it lacks: (a) duplicate-sibling
detection via a pairs-preserving parse — **hard fail**; (b) the template-literal scan, with a
reviewed allowlist seeded at today's 257 so it ratchets down and cannot regress — hard fail on
*increase* (the `core-literal-allowlist.json` pattern in `check-core-literals.mjs` is the
precedent); (c) `{{token}}` parity — hard fail; (d) identical-EN==RO and diacritic-marker reports —
warn-only.

---

## EVIDENCE

```
$ python ~/.claude/tmp/s2b_parity.py
EN leaf keys: 4634   RO leaf keys: 4634
=== KEYS IN EN MISSING FROM RO: 0 ===        === KEYS IN RO MISSING FROM EN: 0 ===
=== TYPE MISMATCHES: 0 ===                   === EMPTY EN VALUES: 0 ===  === EMPTY RO VALUES: 0 ===
=== INTERPOLATION TOKEN MISMATCH: 0 ===
=== IDENTICAL EN==RO STRING VALUES: 219 ===  (multi-word 57, single-token 162)

$ python ~/.claude/tmp/s2b_dup.py
en.json duplicate sibling keys: 2      ro.json duplicate sibling keys: 2
  DUP en.json :: 'success' first={'save':'Page saved.'} last={'save':'Content saved.','created':'Page created.'}
  DUP en.json :: 'errors'  first={'save':'Could not save the page.','load':'Could not load the page.'}
                           last={'load':'Could not load pages.','save':'Could not save content.',…}
  → en.json:3135-3136 (dead) vs en.json:3243,:3245 (served); ro.json same lines.
```

```
$ python ~/.claude/tmp/s2b_hard2.py     # cleaned tally by file (EN/RO/RON/px/km excluded)
  165 app/pages/admin/shared/dam-asset-library.component.ts     27 app/pages/receipt/receipt.component.ts
   18 app/pages/admin/admin.component.ts                        10 app/pages/admin/ops/admin-ops.component.ts
    8 app/pages/admin/theme/theme-live-preview.component.ts       4 app/pages/error/error.component.ts
    4 stripe-mock   4 paypal-mock   4 layout/header               3 app/pages/not-found/not-found.component.ts
    2 shared/banner-block   2 pages/product/product               1 app/app.component.ts
$ grep -c translate  dam-asset-library:0  receipt:0  error:0  not-found:0  theme-live-preview:0
```

```
$ curl -s http://localhost:4202/definitely-not-a-real-page-xyz | grep -o …
Page not found / Contact support / Skip to main content
The page you are looking for doesn't exist. Try heading back home or search the shop.

$ curl -s "localhost:4202/?lang=ro"                       -> Magazin ×5, <html lang="en"
$ curl -s "localhost:4202/?lang=en"                       -> Magazin ×0, <html lang="en"
$ curl -s -H "Accept-Language: ro-RO,ro;q=0.9" localhost:4202/  -> Magazin ×0
$ curl -s -b "lang=ro"                          localhost:4202/  -> Magazin ×0
  both responses carry hreflang="ro" href="http://localhost/?lang=ro"
```

```
$ high-precision diacritic marker scan over all 4634 ro.json values -> TOTAL: 12
  meta.descriptions.{home,shop,blog,blog_post,page,product,about,contact}   (8/8)
  page.exploreMore, page.exploreMoreCopy, product.exploreMore, product.exploreMoreCopy   (4/4)
  admin matches: 0

ro.json : checkout.title = "Checkout"   |   checkout.checkoutFailed = "Finalizarea comenzii a eșuat."
ro.json : meta.titles.checkout = "Checkout | momentstudio"
frontend/src/app/pages/checkout/checkout.component.ts:164   [titleKey]="'checkout.title'"
```

```
account-privacy.component.ts:199   [placeholder]="'account.privacy.deletion.confirmPlaceholder' | translate"
account-privacy.component.ts:229   account.deletionConfirmText.trim().toUpperCase() !== 'DELETE'
admin-dashboard.component.ts:4370  (this.auditRetentionConfirm||'').trim().toUpperCase() === 'PURGE'
admin-users.component.ts:1788      if (confirm !== 'DELETE')
core/missing-translation.handler.ts:33-39   leaf.replace(/[_-]+/g,' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2') → English pseudo-label
core/language.service.ts:44-46     localStorage.setItem('lang', lang)   # no cookie anywhere
core/language.service.ts:60-63     if (typeof document === 'undefined') return;   # SSR no-op
core/server-translate.loader.ts:24-27  normalizeLang() supports 'ro' — never requested server-side
scripts/check-i18n.mjs:53          JSON.parse(...)  # duplicates already collapsed
.github/workflows/frontend.yml:54  "i18n key check" → npm run i18n:check   (blocking)
```
