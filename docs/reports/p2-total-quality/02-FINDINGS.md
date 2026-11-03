# momentstudio P2 — Findings Register

Append-only. Every finding needs: severity, evidence, repro, and a confidence band from
`almost-certain (90-99%) · likely (55-80%) · even (~50%) · unlikely (20-45%) · remote (1-10%)`.
`UNVERIFIED` tags sit **inline, adjacent to the claim** — never only in a trailing section.

Severity: **P0** data-loss/security/revenue-blocking · **P1** broken function · **P2** degraded UX/a11y ·
**P3** polish.

---

## F-001 — Alembic migration chain is Postgres-only; fails hard on SQLite

- **Severity:** P1 (blocks any non-Postgres environment; migrations are unverified outside PG)
- **Confidence:** almost-certain (90-99%) — observed executing.
- **Evidence:** `alembic upgrade head` against `sqlite+aiosqlite` aborts:
  `sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) near "ALTER": syntax error`
  `[SQL: ALTER TABLE products ALTER COLUMN is_deleted DROP DEFAULT]`
  Same command against Postgres 16 in compose: **exit 0**.
- **Why it hid:** the entire backend test suite builds schema with `Base.metadata.create_all`,
  never by running migrations. So migration correctness has **no automated coverage at all** —
  a migration could be broken for Postgres too and CI would stay green.
- **Impact:** local/dev/test environments cannot use SQLite; more importantly the *migration chain
  itself is untested*, which is how production migrations break.
- **Proposed fix:** (a) make the offending ops dialect-aware (skip `DROP DEFAULT` on SQLite via
  `op.get_bind().dialect.name`), AND (b) add a CI job that runs `alembic upgrade head` +
  `downgrade` against a real Postgres service — testing the chain, not just the models.

## F-002 — Dev compose cannot exercise SSR, but production runs SSR

- **Severity:** P1 (an entire production rendering path had zero local or CI coverage)
- **Confidence:** almost-certain (90-99%) — read from both compose files.
- **Evidence:** `infra/docker-compose.yml` frontend → `frontend/Dockerfile` (nginx serving
  `dist/app/browser`, static SPA). `infra/prod/docker-compose.yml:155` frontend-ssr →
  `frontend/Dockerfile.ssr` (`node dist/app/server/main.js`). Confirmed at runtime: every route on
  `:4201` returned a byte-identical 10,525-byte shell (`<title>momentstudio</title>`), i.e. the SPA
  fallback, not server-rendered content.
- **Impact:** SEO (crawlers receive an empty shell), no-FOUC behavior, and the **P1a WU6 SSR
  head-inline theme sink** were all unverifiable locally and unexercised by `compose-smoke` CI.
- **Fix (applied this program):** added `infra/docker-compose.ssr.yml` + `infra/ssr-edge.conf` —
  a prod-faithful SSR stack on `:4202` (edge proxy mirrors prod Caddy routing: `/api/v1/*`→backend,
  `/*`→SSR node). Follow-up: extend `compose-smoke` CI to smoke the SSR variant too.

## F-003 — `/api/v1/openapi.json` times out (>10s, twice; also >3min via app import)

- **Severity:** P2 — **UNVERIFIED root cause**; the schema endpoint did not respond within 10s on two
  separate attempts, and importing `app.main` in a fresh process exceeded 3 minutes.
- **Confidence:** likely (55-80%) that something is genuinely slow (schema generation over a large
  route set, or import-time work); **UNVERIFIED** whether this affects normal request paths —
  `/api/v1/health` and `/docs` both returned 200 promptly, so the running server is healthy.
- **Settling experiment:** time `GET /openapi.json` inside the container with a 120s budget, and
  profile `python -X importtime -c "import app.main"` to separate import cost from schema cost.
- **Why it matters if real:** slow import-time work delays cold starts and worker restarts.

## F-004 — Capture harness recorded 132 logged-out pages as valid admin evidence (HARNESS DEFECT)

- **Severity:** P0 **against the audit itself** (not a product bug) — it silently substituted the
  public homepage for gated screens, and the aggregate was indistinguishable from a clean result.
- **Confidence:** almost-certain (90-99%) — measured, then fixed and re-measured.
- **How it surfaced:** the first triage reported only **11 axe violations across 552 cells**. That is
  implausibly low, so the detector was validated instead of believed. Validation showed
  `finalUrl=/` for 132 of 216 gated cells: `/admin` rendered real content, essentially every
  `/admin/*` and `/account/*` cell rendered the **homepage or `/login`**.
- **Root cause (probed, not assumed):** refresh-token **replay**, not parallelism. Two logins for the
  same user were probed and produce independent, mutually-valid sessions — so workers do not evict
  each other. The defect was reusing ONE saved `storageState` for every browser context: each
  context re-sends the same refresh token, and the backend rotates-and-revokes on first use
  (`backend/app/api/v1/auth.py:1191,1239-1242` — `replaced_by_jti`, `refresh_token_rotation_grace_seconds`),
  so contexts after the first got `401 /api/v1/auth/refresh` → logout → redirect.
- **Fix:** (a) a pristine login per gated cell; (b) a **hard auth assertion** — a gated route landing
  on `/` or `/login` now fails the cell loudly and any occurrence fails the whole run; (c) re-login
  and retry once, so genuine expiry self-heals but a real failure still fails.
- **Both-states validation** (the detector was tested against a known-broken state, per
  `single-signal-verification` §3b): password removed → **6/6 cells flagged**, `FAILED:` marker
  emitted; real login → **24/24 clean**. A probe silent in both states measures nothing.
- **Lesson for the rest of this program:** every gated-surface metric is only as trustworthy as the
  proof that the page was actually reached. Re-capture result: **228/228 authenticated, 0 authFailed**.
- **Measured cost of the defect** — what the audit would have reported vs. the truth:

  | metric | broken sweep (would have shipped) | valid sweep |
  |---|---|---|
  | axe violation instances | 11 | **107** |
  | distinct failing rules | 3 | 6 |
  | **critical**-impact instances | **0** | **72** |
  | horizontal-overflow cells | 32 | 48 |
  | worst-scoring routes | mostly storefront | **6 of the top 8 are admin/account** |
  | console-error routes | 40 | 8 (the 40 was largely 401 noise *caused by* the defect) |

  A 9.7× undercount, and it would have reported **zero critical a11y defects** on an app that has 72.
  `triage.py` now refuses to stay quiet: it prints gated coverage and exits non-zero on any
  auth-failed cell.

## F-005 — Every SSR canonical / `og:url` / hreflang emits the wrong origin (`http://localhost`)

- **Severity:** **P0** (SEO/revenue — production HTML would advertise `localhost` as the canonical
  origin, which de-indexes the real domain).
- **Confidence:** almost-certain (90-99%) — **independently confirmed by direct HTTP probe**, not
  only by agent report. Two independent signals agree (mechanical triage flagged 57 suspicious
  canonicals across the sweep; lane R1 found the code path).
- **Evidence (my own probe against `:4202`):**
  - `/shop` → `<link rel="canonical" href="http://localhost/shop">`
  - `/` → `<meta property="og:url" content="http://localhost/">`
- **Mechanism (lane R1, code-anchored):** `seo-head-links.service.ts:71-82` derives the origin from
  `document.defaultView.location.origin`; the `publicBaseUrl` fallback is dead code.
- **Fix direction:** derive the origin server-side from configuration, never from the render host.

## F-006 — `/shop?page=2` cross-canonicalizes to `/shop` (paginated pages not indexable)

- **Severity:** P1. **Confidence:** almost-certain — probed: `/shop?page=2` emits canonical `/shop`.
- Google states explicitly that cross-canonicalizing pagination prevents pages 2+ from being indexed.
- **Mechanism (R1):** `shop.component.ts:2516-2518` drops the `page` param when building canonical.

## F-007 — `/robots.txt` returns HTTP 200 `text/html` (the app shell)

- **Severity:** P1. **Confidence:** almost-certain — probed: `200 text/html; charset=utf-8`, body
  begins `<!DOCTYPE html><html lang="en" ...`. No crawl directives, no `Sitemap:` line.
- Same class as the already-known `/sitemap.xml` defect → both are the SPA catch-all swallowing a
  crawler-contract path. Fix them together with an express-level route ahead of the Angular handler.

## F-008 — Product / BreadcrumbList JSON-LD absent from server-rendered HTML

- **Severity:** P1 (rich results depend on Googlebot's unreliable second-wave render).
- **Confidence:** almost-certain — probed `/products/white-cup`: **2** `application/ld+json` blocks
  present, **0** containing `"Product"` (both are the static `index.html` blocks).
- **Mechanism (R1):** `product.component.ts:882-883` early-returns when `typeof document === 'undefined'`.

## F-009 — `<html lang>` stays `en` on Romanian pages

- **Severity:** P2 (a11y SC 3.1.1 + i18n/SEO). **Confidence:** almost-certain — probed
  `/shop?lang=ro` → `<html lang="en">` while the rendered title is Romanian. No `og:locale`.

## F-010 — Empty cart still renders shipping + estimated-total lines

- **Severity:** P2 (trust/clarity at the conversion point). **Confidence:** likely (55-80%).
- Probed `/checkout`: `Your cart is empty`, `Shipping` and `Estimated total` all co-occur in the
  same document — **UNVERIFIED** whether the amount really reads `20.00 RON`, because the value sits
  in a sibling node my label regex did not capture. Settling experiment: assert the rendered text of
  the shipping row's value element on an empty cart in the e2e suite.

## F-011 — 16 Playwright e2e specs exist; 11 run in NO workflow and none can block a merge

- **Severity:** P1 (process defect — the flows most expensive to break are unguarded).
- **Confidence:** almost-certain (90-99%) — read from the workflow files and the live branch
  protection API, two independent sources.
- **Evidence:**
  - `gh api repos/:owner/:repo/branches/main/protection` → required contexts = **`["quality / quality"]`**, exactly one.
  - Three workflows invoke Playwright, none of them the required check: `applitools-visual.yml`
    (`applitools-core-routes`), `chromatic-playwright.yml` (`e2e:chromatic`), and `compose-smoke.yml`
    (`checkout-stripe`, `checkout-paypal`, `smoke`, `seo-public-routes`, `admin-dashboard-freeze`).
  - So `accessibility-keyboard`, `admin-cms`, `checkout-cod`, `coupons`, `legal-consent`,
    `payment-returns`, `paypal`, `product-navigation`, `wishlist` — **9 of the 15 spec files** — are
    executed by nothing.
  - `compose-smoke.yml` even carries a comment conceding the rest should run "locally or in a
    separate workflow".
- **CORRECTION (self-refuted):** an earlier draft of this finding said "11 of 16 specs run nowhere"
  and listed `smoke`, `seo-public-routes` and `admin-dashboard-freeze` among them. That was an
  **overclaim caused by my own truncated grep** (`head -2` cut the later `npm run e2e` lines in
  `compose-smoke.yml`). The correctly-scoped count is **9 of 15**. The load-bearing half of the
  finding is unaffected: no e2e workflow is a required context, so none of them can block a merge.
- **Consequence:** a regression in checkout, admin CMS or keyboard a11y cannot fail a PR. This is why
  D6 (permanent e2e in CI) is a program deliverable rather than a nice-to-have.
- **Fix direction:** run the functional suite against the SSR-faithful compose stack in a job that is
  added to the required contexts, and add one regression spec per confirmed finding.
- **Baseline measured, but CONFOUNDED — see F-014.** The suite was run and 8 of 27 tests fail, but
  that number cannot currently be attributed to product defects (my local database had drifted).
  No product-defect claim is made from it.

## F-012 — Repo-wide source-site inventory for the sampled a11y/CLS defect classes

- **Severity:** mixed (see per-pattern rows). **Confidence:** almost-certain (90-99%) for the counts —
  produced by a deterministic scanner (`tools/scan_patterns.py`) over all **236** template/component
  files, with a detector control that fails the run unless it can see nodes axe already proved exist.
- **Why a scanner and not agents:** set membership over a class-token list is mechanical
  (fan-out-contract C4). The axe sweep found 107 *instances* on the 552 captured cells; the scanner
  finds the **source sites**, including states the sweep never reached (modals, error branches,
  admin tabs behind a click).

  | pattern | sites | files | what it means |
  |---|---|---|---|
  | `scroll-container-no-tabindex` | 58 | 21 | `overflow-*-auto` with no `tabindex` → keyboard users cannot scroll it (WCAG 2.1.1) |
  | `link-colour-only` | 51 | 26 | link coloured but not underlined at rest (`hover:underline` only) → WCAG 1.4.1 |
  | `img-no-dimensions` | 24 | 11 | no intrinsic `width`/`height` **and** no fixed CSS box → real CLS risk |
  | `light-only-text` | 22 | 13 | e.g. `text-slate-700` with no `dark:text-*` → the dark-theme contrast failures |
  | `aria-label-on-generic` | 19 | 6 | `aria-label` on a role-less `<div>`/`<section>` → name discarded; any nested control left unnamed |
  | `light-only-border` | 2 | 2 | same class as above, border colour |
  | `light-only-bg` | 1 | 1 | same class as above, background colour |
  | `img-no-alt` | 1 | 1 | genuinely missing alt (literal or bound) |

- **Two overclaims I found and killed in my own scanner before reporting** (recorded because the
  first numbers were wrong, not silently deleted):
  1. `img-no-alt` first read **79**. Angular's bound form `[alt]="expr"` does not contain the
     substring `alt=`, so 78 correctly-labelled images were flagged. Binding-aware check → **1**.
  2. `img-no-dimensions` first read **78**. An image with `class="h-8 w-8"` already has a
     deterministic layout box and cannot shift the page; flagging it is noise. CSS-box check → **24**.
- **Detector control history:** the control initially failed with "19 hits but none contain the
  witness". That was the *witness* being wrong, not the scanner — axe reported the rendered string
  `aria-label="Account section selector"`, which exists only as `assets/i18n/en.json:243`
  (`account.aria.sectionSelect`) and is applied via `[attr.aria-label]`, so it can never appear in a
  template. The scanner had correctly flagged `app/pages/account/account.component.ts:114`. Witnesses
  are now **source anchors**. Negative control also passes: on a hand-written correct file (labelled,
  `tabindex`, `alt`+dimensions, `underline`, `dark:` variants) the scanner emits **zero** hits.

## F-013 — 210 of 552 captured cells contain NO product imagery (seed points at example.com)

- **Severity:** P1 **against the audit** (an evidence defect, like F-004), plus a P3 against the repo
  (the shipped seed advertises unreachable image hosts).
- **Confidence:** almost-certain (90-99%) — counted mechanically over the cell JSONs.
- **Evidence:** every image in `backend/app/seed_profiles/adrianaart/catalog.json` points at
  `https://example.com/images/...`. The browser blocked them all
  (`net::ERR_BLOCKED_BY_ORB`), and **210 / 552** cells recorded such a failed request.
- **Why it matters:** any visual judgement about a product card, grid, gallery or thumbnail strip was
  made against empty boxes. Layout, aspect-ratio, object-fit, alt-text fallback and CLS behaviour on
  product surfaces were therefore **not actually reviewed**, even though screenshots existed and
  looked plausible. Same failure shape as F-004: the artifact was present, so nothing looked wrong.
- **Fix (built):** `tools/build_audit_seed.py` generates a new **`audit`** seed profile using asset
  paths the app really serves, and REFUSES to write the profile unless every pool image returns
  `200 image/*` (a seed with dead images would reproduce the defect it exists to fix). `adrianaart`
  (real brand data) is left untouched.
- **Consequence for this program:** the product-bearing routes must be **re-captured** against the
  `audit` seed before any visual/redesign conclusion about them is trusted. Recorded as an open item,
  not silently absorbed.

## F-014 — The e2e baseline is confounded by local database drift; 8 failures NOT attributable to product defects

- **Severity:** N/A — this is a retraction/scoping note about my own measurement, kept because the
  earlier wording was wider than the evidence.
- **What I measured:** full suite against the SSR stack `:4202` → **8 failed / 17 passed / 2 skipped**.
- **Three hypotheses tested and the first two REFUTED:**
  1. *"SSR breaks these flows"* — **refuted**: the same specs fail against `:4201` (static SPA) too.
  2. *"CI passes because it uses `--workers=1` and I used 2"* — **refuted**: re-running with
     `--workers=1` against `:4201`, i.e. CI's exact configuration, still gave 8 failed / 3 passed.
  3. **Database state drift — supported.** After two failed hypotheses I stopped guessing and read
     the actual errors (AGENTS.md §4b two-strikes). `checkout-helpers.ts:182` fails at
     `expect(page.getByText(product.name)).toBeVisible()` on `/cart`: the helper seeds an **anonymous**
     cart, then calls `loginUi()`, so it depends on guest-cart merging. My database had accumulated
     **66 carts, 8 cart items and 5 orders** from the 552-cell sweep and earlier e2e runs.
- **Verified NOT the cause** (so these are ruled out, not merely unconsidered): payments really are in
  mock mode (`settings.payments_provider = mock`), stock is healthy (`white-cup` 10, `blue-bowl` 6),
  and the product name the spec expects (`White Glazed Cup`) **is** the name in the database.
- **One genuine finding did fall out of the triage:** `accessibility-keyboard.spec.ts:111` looks for
  `getByLabel('Search orders')`, which exists **nowhere** in the frontend — the catalogue has
  `adminUi.orders.search = 'Search'`. So that spec is **stale**, and separately a bare accessible name
  of `"Search"` is ambiguous on a page that also has tag-search and global-search fields (WCAG 2.4.6
  concern, P3). Both are real; neither is what the failure count implied.
- **Next step (required before any e2e-derived claim):** reset to a clean deterministic database with
  the `audit` profile, then re-run. Only that run is a citable baseline.
- **UNVERIFIED inline:** whether the app's login flow calls `POST /api/v1/cart/merge` at all is not
  yet checked; if it does not, guest-cart loss on login would be a genuine P0 revenue defect rather
  than drift. Settling experiment: clean database, seed one anonymous cart, log in, assert the cart
  still contains the item.

---

## Environment established (Phase 0) — verified facts for all agents

| Fact | Value |
|---|---|
| Static SPA (base compose) | `http://localhost:4201` — nginx, proxies `/api/v1/*` → backend |
| **SSR app (prod-faithful)** | `http://localhost:4202` — audit PRIMARY target |
| Backend | not host-published; reached via the proxies above. Internal `/api/v1/health` = 200 |
| DB | Postgres 16 (compose), migrated + seeded with `adrianaart` profile |
| Admin owner | `owner@local.test` / username `owner` (LOCAL throwaway, container-only DB) |
| Payments | `PAYMENTS_PROVIDER=mock` → checkout is safe to drive end-to-end |
| Login endpoint | `POST /api/v1/auth/login` → 200 verified |
