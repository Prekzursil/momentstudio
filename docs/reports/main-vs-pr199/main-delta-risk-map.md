# Main Delta Risk Map (`5e3b438..dd589b6`)

Date: 2026-02-16

Current `main` (`dd589b6`) is 95 commits ahead of PR #199 baseline.

## Delta Size

- Files changed since baseline: `188`
- Broad area counts:
  - payments: `3`
  - shipping: `16`
  - media/dam: `16`
  - checkout/auth: `2`
  - frontend route/components/e2e: `38`
  - infra/ci/scripts: `54`
  - governance/docs/policy: `16`

## High-Risk Areas and Deterministic Scenario Mapping

1. Payments and checkout return/capture paths  
   Why high-risk: direct overlap with PR #199 contract; provider-mode branching can diverge in dev vs CI.  
   Validation mapping:
   - `backend/tests/test_netopia_webhook.py`
   - `backend/tests/test_checkout_flow.py`
   - `frontend/src/app/pages/checkout/checkout.component.spec.ts`

2. Shipping lockers (Fan Courier + Sameday mirror)  
   Why high-risk: significant post-199 architecture change (mirror ingestion, status/canary, city endpoint).  
   Validation mapping:
   - `backend/tests/test_shipping_lockers_api.py`
   - `backend/tests/test_lockers_official_selection.py`
   - `backend/tests/test_sameday_easybox_mirror.py`
   - `frontend/src/app/shared/locker-picker.component.spec.ts`

3. Media/DAM/admin asset workflows  
   Why high-risk: large schema + workflow additions after baseline.  
   Validation mapping:
   - `backend/tests/test_media_dam_api.py`
   - `frontend/src/app/pages/admin/shared/dam-asset-library.component.spec.ts`
   - `frontend/src/app/pages/admin/shared/asset-library.component.spec.ts`

4. Storefront render and auth/session edges  
   Why high-risk: route and shell changes plus periodic audit-driven fixes.  
   Validation mapping:
   - `frontend/src/app/pages/shop/shop.component.spec.ts`
   - `frontend/src/app/pages/product/product.component.spec.ts`
   - `frontend/src/app/pages/blog/blog-list.component.spec.ts`
   - `frontend/src/app/pages/blog/blog-post.component.spec.ts`
   - production safe probes (`/`, `/shop`, `/contact`, `/blog`, `/api/v1/auth/*`)

## Preliminary Risk Classification

- Confirmed code regressions before remediation: none at S1/S2.
- Confirmed parity traps before remediation:
  - payment test expectation was provider-dependent (mock vs providers mode mismatch).
  - dev locker defaults could make Fan/Sameday appear down by configuration, not by code defect.

