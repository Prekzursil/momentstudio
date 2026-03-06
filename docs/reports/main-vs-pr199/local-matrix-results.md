# Local Verification Matrix Results

Date: 2026-02-16

## Matrix Definition

Backend matrix (same scenario set in two provider modes):

- `backend/tests/test_netopia_webhook.py`
- `backend/tests/test_checkout_flow.py`
- `backend/tests/test_shipping_lockers_api.py`
- `backend/tests/test_lockers_official_selection.py`
- `backend/tests/test_sameday_easybox_mirror.py`
- `backend/tests/test_media_dam_api.py`

Frontend targeted specs:

- `checkout.component.spec.ts`
- `locker-picker.component.spec.ts`
- `dam-asset-library.component.spec.ts`
- `asset-library.component.spec.ts`
- `admin-ops.component.spec.ts`
- `product.component.spec.ts`
- `shop.component.spec.ts`
- `blog-list.component.spec.ts`
- `blog-post.component.spec.ts`
- `contact.component.spec.ts`

Build/config checks:

- `npm -C frontend run build`
- `docker compose -f infra/docker-compose.yml config`

## Results

### Backend (pre-fix observation)

`PAYMENTS_PROVIDER=mock`:

- `37 passed, 1 failed`  
- failure: `test_authenticated_checkout_paypal_flow_requires_auth_to_capture`  
- reason: assertion assumed providers-mode capture ID (`CAPTURE-1`) while mock mode produced `paypal_mock_capture_*`.

`PAYMENTS_PROVIDER=providers`:

- `38 passed`

Classification:

- environment parity mismatch (not a production behavior regression).

### Backend (after remediation)

Matrix rerun after test hardening:

- `PAYMENTS_PROVIDER=mock`: `38 passed`
- `PAYMENTS_PROVIDER=providers`: `38 passed`

Warnings remain (non-blocking):

- intermittent `aiosqlite` thread shutdown warnings in tests using in-memory sqlite event loops.

### Frontend

Targeted spec run:

- `37 SUCCESS`

Production build:

- success

Compose config:

- success

## Interpretation

1. PR #199 baseline contracts remain intact on current `main`.
2. No S1/S2 local regressions were confirmed.
3. Two parity traps were addressed:
   - providers-vs-mock test assertion ambiguity.
   - dev locker defaults that could make shipping look broken.
