# R1-ssr-seo — Angular 21 SSR + SEO correctness for the momentstudio storefront

Method: external primary sources (angular.dev, Google Search Central, angular-cli source) + live
reproduction against the running SSR origin `http://localhost:4202`. Every finding below was
**observed**, not inferred, unless tagged otherwise.

---

## P0-1 — Every SSR canonical / og:url / hreflang emits the origin `http://localhost`
**Confidence: almost-certain (90-99%)** — reproduced on 5 distinct routes.

**What.** SSR-rendered HTML declares `<link rel="canonical" href="http://localhost/shop">`,
`og:url` and all three `hreflang` alternates on the same bogus origin. The *same document* carries
static JSON-LD saying `"url": "https://momentstudio.ro"` — self-contradictory.

**Why.** `frontend/src/app/core/seo-head-links.service.ts:71-82` `currentOrigin()` reads
`document.defaultView.location.origin` first. Under `platform-server` that resolves to the render
container's location, never the public host. The `appConfig.publicBaseUrl` fallback at :78-82 is
annotated `istanbul ignore next -- ... unreachable`, so it is dead on the server path.

**Impact.** Google fetches server HTML first. A cross-origin canonical to a non-resolvable host is
a documented deindexing footgun; Google says a JS-set canonical must equal the HTML one — here
neither is right. hreflang is structurally correct (bidirectional, self-referencing, `x-default`)
but every URL is unusable, so all annotations are discarded.

**Fix.** Make origin resolution platform-aware: on the server take `appConfig.publicBaseUrl`, or
derive it from the `REQUEST` token (`X-Forwarded-Proto`/`X-Forwarded-Host`) with `publicBaseUrl` as
the floor. Delete the `istanbul ignore` and add an SSR test asserting the origin is not `localhost`.

## P1-2 — Product and BreadcrumbList JSON-LD are absent from server-rendered HTML
**Confidence: almost-certain (90-99%)** — `/products/white-cup` SSR HTML contains only the two
static `index.html` blocks (Organization, WebSite); zero `Product`, `Offer`, `BreadcrumbList`.

**Why.** `product.component.ts:882-883` early-returns on `typeof document === 'undefined'` (true
under platform-server, which does not set a global `document`), and :917-919 build breadcrumb URLs
from bare `window.location.origin` / `.href`, which would throw server-side regardless. The
component bypasses the SSR-safe `StructuredDataService` that shop/blog/home already use.

**Impact.** The single highest-value SEO asset on an e-commerce site — price/availability/rating
merchant rich results — depends on Googlebot's second-wave render queue rather than the initial
HTML. Non-Google crawlers and social/AI scrapers see nothing.

**Fix.** Route the product schema through `StructuredDataService.setRouteSchemas([...])` (it injects
via the `DOCUMENT` token and works on the server) and build breadcrumb `item` URLs from the same
canonical helper as P0-1.

## P1-3 — Legacy build pipeline: no `ServerRoute` / `RenderMode` surface, nothing prerendered
**Confidence: almost-certain (90-99%)**

`angular.json` uses `@angular-devkit/build-angular:browser` + `:server`, and `src/server.ts:47`
uses `CommonEngine`. Angular's own source marks it `@deprecated Use AngularNodeAppEngine or
AngularAppEngine instead. Deprecated since v22`; the webpack `browser` builder has been deprecated
since v17/18. Repo is on `@angular/core` 21.2.18 — one major from removal.

Consequence today (not just future risk): there is no `app.routes.server.ts` (confirmed absent), so
per-route `RenderMode.Prerender|Server|Client` is impossible, and `prerender.routes` is `[]`.
All 92 routes pay full request-time SSR, including 23 admin routes that should be `RenderMode.Client`
and static legal/`/pages/*` routes that should be prerendered. `scripts/render-mode-guard.mjs:1-19`
documents this as intentional; it is a real constraint, not a comment.

**Fix.** Migrate to `@angular/build:application` + `ssr.entry` + `outputMode: "server"`, add
`app.routes.server.ts`: `Prerender` for `/about`, `/contact`, `/pages/*`; `Server` for `/`, `/shop*`,
`/products/*`, `/blog*`; `Client` for `/admin/**`, `/account/**`, `/checkout`. The theme-injection
invariant the guard protects survives — `Server` routes still traverse the express handler.

## P1-4 — Paginated listings cross-canonicalize to page 1
**Confidence: almost-certain (90-99%)** — `/shop?page=2` → `canonical http://localhost/shop`.

`shop.component.ts:2516-2518` passes only `sub` into the canonical query, dropping `page`. Google
states this explicitly causes pages 2+ to not be indexed and "good content to be lost". Folding
`sort=`/filter params to `/shop` is correct; folding `page` is not. **Fix:** include `page` when >1
so each paginated URL self-canonicalizes.

## P1-5 — `/robots.txt` returns HTTP 200 `text/html` (the app shell)
**Confidence: almost-certain (90-99%)** — measured `status=200 type=text/html size=56559`. No
`robots.txt` exists in `frontend/src/assets/`. Distinct from the known `/sitemap.xml` defect.

Crawlers get no directives at all, and there is no `Sitemap:` line pointing at the real
`/api/v1/sitemap.xml`. **Fix:** serve a static `robots.txt` from `src/server.ts` *before* the
catch-all handler, and reverse-proxy `/sitemap.xml` → the API sitemap at the conventional path.

## P2-6 — `<html lang>` stays `"en"` on Romanian pages
**Confidence: almost-certain (90-99%)** — `/shop?lang=ro` renders `<title>Magazin ceramică lucrată
manual…</title>` inside `<html lang="en">`. No `og:locale` / `og:locale:alternate` anywhere.
**Fix:** set `documentElement.lang` alongside the canonical update; add the `og:locale` pair.

## P2-7 — 23 admin routes return HTTP 200 with `index,follow` and home-page content
**Confidence: likely (55-80%)** on the mechanism, almost-certain on the observation.
`/admin/products` → 200, `<title>momentstudio | Handcrafted ceramics storefront</title>`,
`robots content="index,follow,max-image-preview:large"`, `canonical http://localhost/`. `app.routes.ts:342`
*does* declare `robots: NOINDEX_ROBOTS`, but `adminGuard` denies activation server-side so
`RouteRobotsService.resolvePolicy` never reaches that node and falls back to `DEFAULT_ROBOTS`
(`route-robots.service.ts:5`). Control: `/cart`, `/checkout`, `/login` correctly emit
`noindex,nofollow`. Result is 23 duplicate/soft-404 URLs. **Fix:** emit `X-Robots-Tag: noindex` from
express for `/admin/*` — guard-independent — and/or return 404/302 for admin paths on the SSR host.

## P2-8 — Product schema gaps (blocked behind P1-2)
`offers` lacks `url` and `priceValidUntil`; `aggregateRating` lacks `bestRating`/`worstRating` and
can emit `ratingValue: 0` (`product.component.ts:905-911`). **Fix while fixing P1-2.**

## P2-9 — Home hero is preloaded `fetchpriority="high"` on *every* route (LCP contention)
`src/index.html:6-13` preloads `assets/home/banner_image.jpeg`; confirmed present in `/shop` SSR
HTML where it is never rendered. A high-priority fetch for an unused image competes with the real
LCP candidate. **Fix:** move the preload into the home route (or emit it conditionally in
`server.ts` by path).

## P3-10 — Sitemap and canonical derive their origin from two independent sources
Sitemap `<loc>` values are `http://localhost:4201/...` (backend env) while canonicals come from the
browser `location` (P0-1) — a third origin. Even after P0-1 these can drift. **UNVERIFIED** whether
production config aligns them; settled by diffing `PUBLIC_BASE_URL` (backend) against
`appConfig.publicBaseUrl` (frontend) in the prod env. **Fix:** one shared origin constant.

**Compliant / no action:** hydration is real and healthy (`ng-server-context="ssr"`, `ngh`
attributes present) with `provideClientHydration(withEventReplay())` at `app.config.ts:53`; robots
policy is correct on cart/checkout/login; hreflang *shape* (self-ref + reciprocal + `x-default`) is
correct. `withIncrementalHydration()` is an available upgrade, not a defect.

---

## EVIDENCE
- `frontend/src/app/core/seo-head-links.service.ts:71-82` — `currentOrigin()` prefers
  `document.defaultView.location.origin`; `publicBaseUrl` fallback marked unreachable.
- Reproduction: `curl -s http://localhost:4202/shop | grep '<link rel="canonical"'` →
  `<link rel="canonical" href="http://localhost/shop">`; `/`, `/about`, `/products/white-cup`,
  `/admin/products` identical pattern. `/robots.txt` → `status=200 type=text/html size=56559`.
- `frontend/src/app/pages/product/product.component.ts:882-883, 917-919` — `typeof document ===
  'undefined'` early return + `window.location.*`; SSR HTML of `/products/white-cup` yields only
  `"@type": "Organization"` and `"@type": "WebSite"` (2 `application/ld+json` blocks).
- `@deprecated Use AngularNodeAppEngine or AngularAppEngine instead. Deprecated since v22` —
  https://github.com/angular/angular-cli/blob/main/packages/angular/ssr/node/src/common-engine/common-engine.ts
  ; render modes: https://angular.dev/guide/ssr ; builder deprecation:
  https://angular.dev/tools/cli/build-system-migration
- Google Search Central: pagination —
  https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading
  ; hreflang must be fully-qualified + reciprocal + self-referencing —
  https://developers.google.com/search/docs/specialty/international/localized-versions ; JS-set
  canonical must equal the HTML one —
  https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics ;
  Product required props —
  https://developers.google.com/search/docs/appearance/structured-data/product-snippet

*Detector note: the `tool-sentinel` hook flagged all five `WebFetch` calls as FAILED on "exit code
200" — that is HTTP 200, a false positive; each returned substantive content, and the two
load-bearing claims (CommonEngine deprecation, pagination guidance) were each corroborated by a
second, mechanically different probe (raw source file read; independent WebSearch).*

SUCCESS:R1-ssr-seo 10 findings (1 P0, 4 P1, 4 P2, 1 P3) — SSR canonicals emit `http://localhost` sitewide, product JSON-LD never server-rendered, legacy CommonEngine pipeline blocks per-route render modes, page-2 cross-canonicalization, `/robots.txt` returns HTML.
