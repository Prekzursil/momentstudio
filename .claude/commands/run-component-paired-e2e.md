---
name: run-component-paired-e2e
description: LaneOuter for coverage WUs — map component path to Playwright files; Case A green / Case B outer:blocked; never invent credentials.
allowed_tools: ["Bash", "Read", "Grep", "Glob"]
---

# /run-component-paired-e2e

Invoked by `/add-100-percent-behavioral-test-coverage-for-component` at **LaneOuter**. Do not invent a second outer procedure.

## Invoke

```bash
cd frontend && npx playwright test <files> --project=chromium
```

Env: `E2E_BASE_URL` (default `http://localhost:4200`). Stack must be up — do not silent-skip.

## Path-prefix → matrix-row → OUTER files

Longest matching prefix under `frontend/src/app/pages/` (then `shared/`, `core/`). Unmatched specialty → `smoke.spec.ts` only + receipt note `outer:smoke-default`.

| Path prefix | Row | OUTER files |
| --- | --- | --- |
| `pages/about/`, `pages/contact/`, `pages/page/`, `pages/blog/` | public | `seo-public-routes.spec.ts`, `smoke.spec.ts` |
| `pages/home/`, `pages/shop/`, `pages/product/` | shop | `smoke.spec.ts`, `product-navigation.spec.ts`, `wishlist.spec.ts`, `coupons.spec.ts` |
| `pages/cart/`, `pages/tickets/`, `pages/newsletter/`, `pages/offline/`, `pages/receipt/`, `pages/not-found/`, `pages/error/` | utility | `smoke.spec.ts`, `seo-public-routes.spec.ts` |
| `pages/account/`, `pages/auth/` | account | `accessibility-keyboard.spec.ts`, `smoke.spec.ts` (+ fixture auth; no invented creds) |
| `pages/checkout/` | checkout | `checkout-stripe.spec.ts`, `checkout-cod.spec.ts`, `checkout-paypal.spec.ts`, `payment-returns.spec.ts`, `legal-consent.spec.ts`, `paypal.spec.ts` — **never golden**; owner exception required to enqueue |
| `pages/admin/` | admin | `admin-cms.spec.ts`, `admin-dashboard-freeze.spec.ts` |
| `shared/`, `core/` | shared | `smoke.spec.ts` only + note |
| `frontend/src/app/layout/` (and other non-pages/shared/core) | smoke-default | `smoke.spec.ts` only + `outer:smoke-default` |
| (any WU when `visual_pair_required`) | visual gate | `applitools-core-routes.spec.ts`, `chromatic/*` **or** mandatory `outer:blocked` if secrets missing |

## LANE_OUTER DoD

**Case A — visual secrets present (or visual_pair not required):**

- Mapped Playwright (+ visual pair when required) exit 0 → `OUTER-STATUS: green`
- Auth/payment fixtures missing/untrusted → `outer:blocked` or WU stop; never invent credentials

**Case B — `visual_pair_required` and Chromatic or Applitools secret missing:**

- Still run mapped **non-visual** specs when stack is up (fail ⇒ OUTER fail, not silent skip)
- Set `OUTER-STATUS: outer:blocked` `blocker_id=visual_secrets` — **never** `green` by omitting visual
- Playwright `test.skip` / CI skip-as-note for missing visual keys = blocked, not pass

Silent skip **forbidden**. Redact tokens/keys in receipts (presence-only / `[REDACTED]`).

## Both-states (OUTER)

| State | Condition | Verdict |
| --- | --- | --- |
| A | secrets+contexts present; mapped specs pass | `OUTER-STATUS: green` |
| B | secrets/contexts absent (`visual_pair_required`) | `OUTER-STATUS: outer:blocked` `blocker_id=visual_secrets` |
| C | silent skip / claim visual green without secrets | **FORBIDDEN** |

## Matrix SSOT

See [`docs/plans/2026-09-04-component-coverage-e2e-matrix.md`](../../docs/plans/2026-09-04-component-coverage-e2e-matrix.md).
