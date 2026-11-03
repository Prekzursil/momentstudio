# S4-perf-bundle — Bundle budget, lazy-loading and Core Web Vitals risk (static)

**Revision note.** An earlier pass of this lane measured `frontend/dist/app/browser` and correctly
flagged it as a **development** build, leaving production sizing `UNVERIFIED`. This revision settles
that: the **production** artifact is live in `infra-frontend-1` / served through `infra-ssr-edge-1`
(content-hashed, minified, `vendorChunk:false`), so all byte figures below are **measured production
bytes over the wire**, with `gzip -9` applied to the served body. Three prior claims are corrected
in place (marked **CORRECTED**). Do not re-measure `frontend/dist/app/browser` — it is a stale dev
build (Jul 4, `.js.map`, unhashed, separate `vendor.js`).

## Measured production baseline (`:4202`, `:4201`)

| initial file | raw B | gzip B |
|---|---|---|
| `main.cd1c5b703f2c161c.js` | 1,105,739 | 306,327 |
| `polyfills.9c9ce2430ec60ceb.js` | 35,585 | 12,594 |
| `runtime.1b34086ced382f5b.js` | 4,794 | 2,707 |
| `styles.f26ca13fd870a904.css` | 102,526 | 15,892 |
| **initial total** | **1,248,644 (1219.4 KiB)** | **337,520 (329.6 KiB)** |

75 JS files, 5,708,412 B total. Biggest lazy chunks: `5970…` 1,238,888 B (admin), `5058…` 456,231 B.

---

### P1 · almost-certain — Initial JS is 2.1× the landing target and the budget is 2.4% from tripping
**CORRECTED** (prior pass: "budgets ~4× too loose", dev bytes). Initial JS = 1,146,118 B raw /
**314.1 KiB gz** vs the `<150 kb gz` landing target. `angular.json:44-48` sets `initial`
warn 1250kb / error 1300kb; measured initial JS+CSS is 1219.4 KiB — **30.6 KiB (2.4%) under the
warning**. So the gate is simultaneously ~8× looser than the perf target *and* about to fire. No
Lighthouse/CWV/bundle job exists in any of the 32 workflows, and `@codecov/bundle-analyzer@1.9.1` is
installed but wired to nothing.
**Fix.** Lazy-load the eager routes (next finding), then ratchet `initial` to ~700kb error and add a
gzip-aware or Lighthouse-CI assertion on `/`, `/shop`, `/product/:slug`.

### P1 · almost-certain — Six routes are eager and land in `main.js`
`app.routes.ts:2-7` statically imports Home, NotFound, Error, Shop, About, Contact and binds them
with `component:` (`:37,40,47,51,52,548,554`); the other 66 entries use `loadComponent`/
`loadChildren`. Source-map attribution of the eager chunk: `shop.component.ts` 167,310 B,
`home.component.ts` 82,386 B, `header.component.ts` 61,309 B, `contact.component.ts` 35,915 B,
`about.component.ts` 12,820 B (unminified source bytes). A visitor on `/` parses Shop + Contact +
About before first paint.
**Fix.** `loadComponent` for Shop/About/Contact/Error; keep Home (dominant entry) and 404 eager.

### P1 · almost-certain — `marked` + `dompurify` ship in the initial bundle
`core/markdown.service.ts:2-5` statically imports both into an `@Injectable({providedIn:'root'})`
service that eager `home.component.ts:15`, `contact.component.ts:12`, `about.component.ts:13` inject.
Fingerprinting the **served prod** `main.js`: `Marked`×10, `DOMPurify`×3, and **zero** hits for
`leaflet`/`hljs`/`toastui`/`libphonenumber`/`Sentry`.
**Fix.** Make `render()` async behind `await import('marked')` / `import('dompurify')` — the pattern
`core/sentry.ts:26`, `account.state.ts:2483`, `locker-picker.component.ts:311` already use.

### P1 · almost-certain — The hero preload never matches the painted image, and fires on every route
`src/index.html:6-13` preloads `as="image"`, JPEG-only `imagesrcset`, **no `type`**,
`imagesizes="(min-width:1024px) 1152px, 100vw"`, `fetchpriority="high"`. The rendered hero
(`banner-block.component.ts:49-70`) is a `<picture>` whose AVIF source wins:
`banner_image-960.avif` = **73,606 B** at `sizes="(min-width:1024px) 680px, 100vw"`. The preload
resolves to `banner_image.jpeg` = **288,557 B** — a different URL, fetched at high priority and
discarded. **New:** even in a non-AVIF browser the `sizes` mismatch (1152px vs 680px) selects 1280w
vs 640w, so it mismatches *either way*. And because it lives in the static shell, SSR emits it on
`/shop`, `/cart`, `/admin/*` too (verified on `/shop` and `/cart`).
**Fix.** Emit the preload from `server.ts` for the home route only, with `type="image/avif"`, the
AVIF `imagesrcset`, and `imagesizes` copied from `splitSizes()`.

### P1 · almost-certain — SSR serves unhashed runtime config + i18n with a 1-year immutable cache
`src/server.ts:47-51` is `express.static(distFolder, { maxAge:'1y' })` with no per-path override, so
`/assets/app-config.js` (API base URL, Clarity id, appEnv) and `/assets/i18n/*.json` return
`Cache-Control: public, max-age=31536000` — neither is content-hashed. Production is
Caddy → `frontend-ssr:4000` (`infra/prod/Caddyfile:44-56`, no cache override), so this header reaches
real browsers. The nginx SPA path deliberately no-stores `app-config.js`
(`frontend/nginx/default.conf:15-18`); the SSR path lost that guard.
**Impact.** After a deploy, returning visitors keep stale config/translations for up to a year with
no bust path. **Fix.** `no-store` for `app-config.js`, `max-age=300, must-revalidate` for i18n,
`1y, immutable` only for hashed filenames.

### P2 · almost-certain — 230 KB translation file on the client path; 67% of it is admin strings
`assets/i18n/en.json` = 229,994 B (ro 250,748 B); `adminUi` alone = 125,335 B (**67%**). Fetched by
`provideTranslateHttpLoader` (`app.config.ts:49-52`) on the client and **not** in TransferState — the
SSR `ng-state` payload is only 6,719 B. **Fix.** Split `adminUi.*` into an admin-route-only bundle;
add the translation GET to the hydration transfer cache.

### P2 · likely — The service worker prefetches every chunk, including the 1.24 MB admin bundle
`ngsw-config.json:4-11` uses `installMode:"prefetch"` for `"/*.js"` → all 75 chunks, 5,708,412 B raw,
downloaded for anonymous shoppers. **Fix.** Prefetch `main|polyfills|runtime|styles` only; `lazy` for
the rest.

### P2 · likely — CLS: 27 `<img>` sites lack both intrinsic dimensions and a CSS aspect ratio
**CORRECTED** (prior pass: "78 of 85"). 85 `<img>` total, 78 lack literal `width`/`height`, but most
carry a Tailwind `aspect-*` / `h-N` class that reserves space (the hero is `aspect-[5/4]`,
`banner-block.component.ts:245-254`; the header logo is `h-8 sm:h-10`). Excluding those leaves **27**
genuine risks, and the storefront ones are CMS-driven images of unknown ratio: `home.component.ts`
(3), `cms-global-section-blocks.component.ts` (3), `cms-page-blocks.component.ts` (2),
`about.component.ts`, `page.component.ts`, `blog-post.component.ts` lightbox. Only **7 of 85** use
`ngSrc`; 28 have no `loading` attribute.
**Fix.** Adopt `NgOptimizedImage` for CMS blocks (or persist intrinsic dimensions on the media
record) and add `loading="lazy"` below the fold.

### P2 · likely — No `preconnect` for third-party origins
`clarity.service.ts:93-99` injects `https://www.clarity.ms/tag/<id>` and
`captcha-turnstile.component.ts` injects `https://challenges.cloudflare.com/...`. Both are runtime-
injected and non-blocking (good), but DNS+TLS starts only then; `index.html` has one resource hint
(the image preload) and no `preconnect`. **Fix.** `preconnect` to `clarity.ms`; Turnstile on captcha
routes only.

### P3 · almost-certain — Fonts: Cinzel is right, `Inter` is declared but never shipped
`styles.css:5-46` self-hosts Cinzel 400/600 woff2, `font-display: swap`, `unicode-range` split
(25,904 + 14,540 B) — correct, better than a Google Fonts link. Gaps: no `<link rel=preload>` for the
woff2, and no `size-adjust`/`ascent-override` fallback metrics, so the Georgia→Cinzel swap reflows
headings. And `--font-body: Inter, …` (`styles.css:456`, `tailwind.config.cjs:27`) has **no
`@font-face` and no external link**; `assets/fonts/` holds only the Cinzel files and prod CSP is
`font-src 'self' data:` — body text always renders `system-ui`. Zero bytes, but the shipped
typography is not the designed typography. **Fix.** Preload `cinzel-latin.woff2`, add metric
overrides, then either self-host a subset Inter or drop it from the stack.

### P3 · almost-certain — Compose/dev origins serve **no** compression (measurement hazard)
`curl -H 'Accept-Encoding: gzip'` on `:4201` and `:4202` returns no `Content-Encoding`;
`frontend/nginx/default.conf` never enables `gzip`, `ssr-edge.conf` is a bare proxy, and `server.ts`
adds no `compression()`. Prod is safe (`infra/prod/Caddyfile:13` `encode zstd gzip`), but any
Lighthouse run against `:4201`/`:4202` overstates transfer ~3.6× (1.08 MB vs 299 KiB for `main.js`).
**Fix.** Enable gzip/brotli in the compose nginx so local CWV numbers are comparable to prod.

### P3 · likely — Remaining initial-bundle trims
`angular.json:14` `polyfills:["zone.js"]` with no `provideZonelessChangeDetection` anywhere → 35,585 B
raw / 12,594 B gz of initial payload. **Zero `@defer` blocks** in the entire app.
`provideAnimations()` (`app.config.ts:25`) is eager rather than `provideAnimationsAsync()`.
`core/admin.service.ts` (18,367 source bytes) is attributed to the eager chunk. Two small blocking
head scripts, `app-config.js` (706 B) + `theme-bootstrap.js` (1,030 B) — inline them to save two
round-trips (theme-bootstrap must stay pre-paint). Anonymous cold loads also fire
`auth.ensureAuthenticated()` → `POST /auth/refresh` from the constructor (`app.component.ts:94`,
`auth.service.ts:735-739`), one extra critical-path round-trip.

### Positive control — do not regress
Heavy-dep isolation is genuinely good: **leaflet** (`locker-picker.component.ts:311`, own chunk),
**@nuintun/qrcode** (`account.state.ts:2483`), **@sentry/browser** (`core/sentry.ts:26`),
**libphonenumber-js** (`shared/phone.ts`, lazy-only), **highlight.js** (per-language `lib/core` inside
the lazy `blog-post` chunk), **@toast-ui/editor** (admin-only). Critical CSS is inlined by beasties
(27,637 B in `<head>`) with the async `media="print"` + `<noscript>` pattern — correct.

---

## EVIDENCE

1. `for f in main.cd1c5b703f2c161c.js polyfills… runtime… styles…; do curl -s :4202/$f | wc -c; curl -s :4202/$f | gzip -9 -c | wc -c; done` →
   `main 1105739/306327 · polyfills 35585/12594 · runtime 4794/2707 · styles 102526/15892`. Budget
   `frontend/angular.json:44-48` `initial` warn `1250kb`(=1,280,000 B) vs measured 1,248,644 B → 31,356 B headroom.
2. `frontend/src/index.html:6-13` (JPEG `imagesrcset`, `imagesizes` 1152px, no `type`) vs
   `curl -s :4202/ | grep -oE '<source[^>]*>'` → `srcset="…banner_image-960.avif 960w…" sizes="(min-width: 1024px) 680px, 100vw"`;
   `banner_image.jpeg` 288,557 B vs `banner_image-960.avif` 73,606 B;
   `curl -s :4202/shop | grep -c 'preload.*banner_image.jpeg'` → `1`.
3. `curl -sI :4202/assets/app-config.js` and `…/assets/i18n/en.json` → `Cache-Control: public, max-age=31536000`;
   source `frontend/src/server.ts:47-51`; contrast `frontend/nginx/default.conf:15-18` (`no-store`);
   prod route `infra/prod/Caddyfile:44-56`.
4. `python json` over `src/assets/i18n/en.json` → total 229,994 B, `adminUi` 125,335 B (67%);
   `curl -s :4202/ | re('id="ng-state"')` → 6,719 B (no translation transfer cache).
5. `docker exec infra-frontend-1 ls -S /usr/share/nginx/html/*.js` → `5970… 1238888`, `main… 1105739`,
   `5058… 456231`; `du -cb *.js` → 5,708,412 B / 75 files; `ngsw-config.json:4-11` `installMode:"prefetch"`, `/*.js`.
6. `curl -sI -H 'Accept-Encoding: gzip' :4202/main….js` → no `Content-Encoding` (Content-Length 1105739);
   `infra/prod/Caddyfile:13` `encode zstd gzip`. Image scan (regex over all non-spec `.ts`/`.html` under
   `frontend/src/app`): 85 `<img>`, 78 without `width=`/`ngSrc`, **27** without dimensions *and* without an
   `aspect-*`/`h-N` class, 28 without `loading`, 7 with `ngSrc`.
   `grep -rl 'lighthouse|bundle-analyzer|budgets' .github/workflows/` → 0 hits.

SUCCESS:S4-perf-bundle prod re-measured (supersedes the dev-build pass): initial 314 KiB gz = 2.1x the target with the budget 2.4% from tripping; hero preload burns 289 KB the browser never uses and fires on every route; SSR pins unhashed config+i18n for a year; CLS count corrected 78 -> 27.
