# S3-error-resilience — Error handling, empty/loading states, and offline behaviour

Static audit of `frontend/src/app` (361 TS files, 650 non-spec `.subscribe(` sites), plus two live
API probes. **Baseline is better than expected**: a brace-balanced scan shows **631 of 650
subscribes carry an `error:` callback**, `app-loading-state`/`app-skeleton` are used on ~35
components, and `shop`/`blog-list`/`account-*`/`tickets` all have designed empty states. The
defects below are the gaps in that mostly-good coverage, ranked by how likely a real user hits them.

## Route/component → missing state (ranked)

| # | Route / component | Missing | Likelihood |
|---|---|---|---|
| 1 | **global** (`app.config.ts`) | no `ErrorHandler` at all | every JS crash |
| 2 | `**` → `not-found`, `/error` | i18n (hardcoded EN) | every dead link, RO users |
| 3 | `/tickets` | error state (error renders as *empty*) | any API blip |
| 4 | `/product/:slug`, product-card | wishlist error path | any 4xx on ♥ |
| 5 | `/account/wishlist` bulk remove | real error path (false success) | bulk action |
| 6 | all forms (app-wide) | server-field mapping; 422 array unguarded | 422 responses |
| 7 | PWA / `/offline` | API caching, `SwUpdate` | offline visit, post-deploy |

---

### P1 · almost-certain — No Angular `ErrorHandler`: uncaught errors are console-only, invisible to users *and* to Sentry

`app.config.ts:22-57` registers no `ErrorHandler`. `shared/error-handler.service.ts` implements
exactly the right behaviour (network/401/404/5xx → toast, else Sentry) but is **dead code** — a repo
grep finds it only in its own file and spec. `package.json:47` ships `@sentry/browser`, **not
`@sentry/angular`**, so `Sentry.createErrorHandler()` is not wired either.

Consequence chain: the app runs on zone.js (`polyfills.ts:1`), so NgZone routes every in-zone
exception (click handler, lifecycle hook, template expression) to Angular's *default* `ErrorHandler`,
which only `console.error`s and does **not** rethrow. `window.onerror` therefore never fires, so
`admin-client-error-logger.service.ts:33` never sees it and `captureException` is never called. The
`/error` route (`app.routes.ts:547`) is never navigated to (zero references). Net: a crashing button
looks dead, no toast, no Sentry event, no backend log. The orphaned `errors.unexpected.*` /
`errors.unauthorized.*` i18n keys confirm this was meant to be wired.

**Fix:** `{ provide: ErrorHandler, useClass: AppErrorHandler }` delegating to the existing
`ErrorHandlerService.handle()`; add `@sentry/angular` and chain `createErrorHandler()`; add
`withNavigationErrorHandler(() => router.parseUrl('/error'))` so lazy-chunk/route failures land on
the designed page.

### P2 · almost-certain — 404 and error pages are hardcoded English on a bilingual site

`pages/not-found/not-found.component.ts:12-33` and `pages/error/error.component.ts:12-34` contain
zero `translate` usages (verified by `grep -c translate` → `0`, `0`), unlike the offline page which
is fully translated. `not-found` is the `**` catch-all (`app.routes.ts:553`), so **every** mistyped
URL, stale link and expired share link shows "Page not found / Browse shop" to a Romanian shopper.
**Fix:** add `TranslateModule` + keys (mirror `pwa.*`, which exist in both `en.json`/`ro.json`).

### P2 · almost-certain — `/tickets`: a failed load renders the "you have no tickets" empty state

`pages/tickets/tickets.component.ts:336-340` toasts and clears `loading` but never sets an error
flag; `tickets()` stays `[]`, so the template branch at `:73` (`!loading() && tickets().length === 0`)
paints `tickets.empty`. A customer with open tickets is told they have none. Line `:345`
(`error: () => this.orders.set([])`) silently blanks the order dropdown too.
`account-coupons.component.ts:38-48` shows the correct three-way pattern to copy.
**Fix:** add an `error` signal and gate the empty branch on `!error()`.

### P2 · almost-certain — Wishlist writes fail silently; bulk remove reports false success

`product.component.ts:833` and `:845`, and `product-card.component.ts:342`/`:354`, pass **only**
`next:` to `.subscribe({…})`. `wishlist.service.ts:84-92` adds no `catchError`. On any 4xx the heart
does not toggle, no toast fires (the interceptor bus only emits for status 0 and 5xx —
`http.interceptor.ts:192`), and the user just clicks again. Worse, `account-wishlist.component.ts:242`
swallows each item with `catchError(() => of(undefined))` and then unconditionally calls
`removeLocal(id)` + `toast.success` — items vanish locally, reappear on reload.
**Fix:** add `error:` branches with `wishlist.*.errorTitle` toasts; in the bulk path capture per-item
outcomes and only `removeLocal` the successes.

### P2 · likely — 422 bodies are arrays; no server error is ever mapped to a form field

`backend/app/main.py:124-132` returns `{"detail": [ {...} ], "code": "validation_error"}`.
**Reproduced live** (see EVIDENCE). `setErrors(` appears **zero** times app-wide, and ~180 sites do
`err?.error?.detail || <fallback>`; the array is truthy, so it bypasses the fallback and renders via
`{{ }}` as `[object Object]`. Guarded correctly at `login.component.ts:338-341` and
`register.component.ts:651-654`; unguarded at `cms-form-block.component.ts:310`/`:353`,
`newsletter-confirm.component.ts:115`, `two-factor.component.ts:149`,
`password-reset.component.ts:152`, `google-callback.component.ts:96`,
`legal-consent-modal.component.ts:309`, `cart.component.ts:1045`/`:1062`.
**Fix:** one `normalizeApiError(err)` helper in `shared/http-error.ts` that flattens
`detail[].loc/.msg` to a string map, plus a `applyServerErrors(form, map)` that calls `setErrors`.

### P2 · likely — PWA offline experience is app-shell only; no update channel

`ngsw-config.json` has **no `dataGroups`** → zero API caching, so offline every page renders empty
plus a network toast; and **no `SwUpdate`/`versionUpdates` consumer exists anywhere** (grep: 0 hits),
so a long SPA session keeps stale JS after a deploy with no "reload to update" prompt and no
`ChunkLoadError` recovery (worse in non-prod, where `provideServiceWorker` is disabled by
`app.config.ts:26`). `/offline` is reachable only via the header badge (`header.component.ts:146`);
nothing auto-navigates there. **Fix:** add a `performance`/`freshness` `dataGroups` entry for
`/api/v1/(products|content)/**`, and an `SwUpdate.versionUpdates` → toast-with-reload action.

### P3 · likely — three smaller gaps
(a) `AdminClientErrorLoggerService` only reports when the URL starts with `/admin` **and** the role is
staff (`:39`, `:44-51`) — storefront JS errors reach no backend log. (b) `FormMessagesService` is dead
code with hardcoded English strings; `receipt.component.ts:61`/`:358` likewise ("Loading…",
"Missing receipt token."). (c) No HTTP `timeout()` outside the checkout/payment-return paths
(`checkout.component.ts:1490`, `*-return.component.ts`) — a hung upstream spins forever.
Aside: `app-config.ts:51-53` defaults `sentrySendDefaultPii: true` with 25% session replay — a
GDPR review item for the privacy lane, inert while `sentryDsn` is empty.

---

## EVIDENCE

1. `frontend/src/app/app.config.ts:22-57` — provider array; no `ErrorHandler` entry.
   Repo grep `ErrorHandlerService` (non-spec) → only `frontend/src/app/shared/error-handler.service.ts:8`.
2. Brace-balanced scan of 361 non-spec TS files: `total subscribes: 650  without error handler: 62`;
   after filtering router/`onLangChange` sources, **19 are HTTP calls** (list in §P2 above).
3. Live probe (SSR origin, API proxy):
   `curl -s "http://localhost:4202/api/v1/blog/posts?page=0"` →
   `{"detail":[{"type":"greater_than_equal","loc":["query","page"],...}],"code":"validation_error"}`
   and `POST /api/v1/auth/password-reset/request {"email":"notanemail"}` → HTTP **422**, `detail` array.
4. `grep -c translate frontend/src/app/pages/not-found/not-found.component.ts` → `0`;
   same for `pages/error/error.component.ts`. `pwa.offlineTitle` etc. present in both `en.json` and `ro.json`.
5. `grep -rn "SwUpdate|versionUpdates|setErrors\(|withNavigationErrorHandler" frontend/src/app` → **no matches**;
   `frontend/ngsw-config.json` contains `assetGroups` only (no `dataGroups`, no `navigationUrls`).

SUCCESS:S3-error-resilience 1 P1 (no Angular ErrorHandler — crashes invisible to users and Sentry, /error route dead), 5 P2 (untranslated 404/error pages, tickets error-renders-as-empty, silent wishlist writes + false-success bulk, unmapped 422 arrays, PWA has no data cache or update channel), 3 P3; baseline coverage is strong at 631/650 subscribes handled.
