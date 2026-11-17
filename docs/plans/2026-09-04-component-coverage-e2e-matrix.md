# Component Coverage ↔ Playwright E2E Matrix (2026-09-04)

Deterministic path-prefix → row → OUTER files for coverage WUs. Paired command: `.claude/commands/run-component-paired-e2e.md`. Coverage command: `.claude/commands/add-100-percent-behavioral-test-coverage-for-component.md`.

**Golden first WU:** `about` or `contact` only. Checkout-first golden is invalid.

## Path lookup

Longest matching prefix under `frontend/src/app/pages/` (then `frontend/src/app/shared/`, `frontend/src/app/core/`). Specialty unmatched → `smoke.spec.ts` only + `outer:smoke-default`.

| Path prefix | Row | OUTER files |
| --- | --- | --- |
| `pages/about/`, `pages/contact/`, `pages/page/`, `pages/blog/` | public | `seo-public-routes.spec.ts`, `smoke.spec.ts` |
| `pages/home/`, `pages/shop/`, `pages/product/` | shop | `smoke.spec.ts`, `product-navigation.spec.ts`, `wishlist.spec.ts`, `coupons.spec.ts` |
| `pages/cart/`, `pages/tickets/`, `pages/newsletter/`, `pages/offline/`, `pages/receipt/`, `pages/not-found/`, `pages/error/` | utility | `smoke.spec.ts`, `seo-public-routes.spec.ts` |
| `pages/account/`, `pages/auth/` | account | `accessibility-keyboard.spec.ts`, `smoke.spec.ts` (+ fixture auth; no invented creds) |
| `pages/checkout/` | checkout | `checkout-stripe.spec.ts`, `checkout-cod.spec.ts`, `checkout-paypal.spec.ts`, `payment-returns.spec.ts`, `legal-consent.spec.ts`, `paypal.spec.ts` — never golden; owner exception required |
| `pages/admin/` | admin | `admin-cms.spec.ts`, `admin-dashboard-freeze.spec.ts` |
| `shared/`, `core/` | shared | `smoke.spec.ts` only + note |
| (any WU when `visual_pair_required`) | visual gate | `applitools-core-routes.spec.ts`, `chromatic/*` **or** mandatory `outer:blocked` if secrets missing |
| `frontend/src/app/layout/` (and other non-pages/shared/core) | smoke-default | `smoke.spec.ts` only + `outer:smoke-default` |

Area notes: shop includes wishlist/coupons; checkout includes paypal; visual never silent-skip.

## Both-states proofs

### INNER

| State | Condition | Verdict |
| --- | --- | --- |
| A | `GITHUB_BASE_REF` set + covered PR-added executable `frontend/src` lines | INNER pass |
| B | `GITHUB_BASE_REF` set + uncovered new branch | INNER fail |
| C | unset `GITHUB_BASE_REF` / gate skipped (script exit 0) | **NOT** INNER-green — fail / re-run with base |

### LANE_OUTER

| State | Condition | Verdict |
| --- | --- | --- |
| A | secrets+contexts present; mapped specs pass | `OUTER-STATUS: green` |
| B | secrets/contexts absent (`visual_pair_required`) | `OUTER-STATUS: outer:blocked` `blocker_id=visual_secrets` (draft OK after REPO_VERIFY) |
| C | silent skip / claim Chromatic-Applitools green without secrets | **FORBIDDEN** |

### REPO_VERIFY

| State | Condition | Verdict |
| --- | --- | --- |
| A | `make verify` exit 0 | `REPO-VERIFY: pass` (needed for done) |
| B | `make verify` fail | blocks done even if INNER+OUTER green |

## Invoke

```bash
cd frontend && npx playwright test <files> --project=chromium
```

`E2E_BASE_URL` default `http://localhost:4200`. Stack must be up.

## Substrate default

Cursor Cloud Linux Tier 0 trusted checkout. WSL2 not required for docs-phase coverage WUs.
