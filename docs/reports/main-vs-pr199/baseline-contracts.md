# Main vs PR #199 Baseline Contracts

Date: 2026-02-16  
Baseline PR: `#199` (`fix: return 200 for netopia webhook errors`)  
Baseline merge commit: `5e3b438520a023ae2f3d1ce3b27fa772e10aa627`  
Baseline merged at: `2026-02-12T22:06:26Z`

## PR #199 Intent (source of truth)

From PR body and changed files:

- `backend/app/api/v1/payments.py`
- `backend/tests/test_netopia_webhook.py`
- `.github/workflows/compose-smoke.yml`
- `frontend/e2e/checkout-stripe.spec.ts`
- `frontend/e2e/checkout-paypal.spec.ts`
- `frontend/src/app/pages/checkout/checkout.component.ts`
- `frontend/src/app/pages/blog/blog-list.component.ts`

Primary intent:

1. Netopia webhook must always return HTTP 200 with ack payload, including validation failures.
2. Checkout payment flows (Stripe and PayPal mock paths) must be covered in CI compose smoke.
3. No schema migrations or breaking API contract removals.

## Must-Not-Regress Contracts

### Payments / Netopia

1. `POST /api/v1/payments/netopia/webhook` responds with status `200` for:
   - missing verification token
   - invalid signature
   - invalid payload
   - unexpected internal processing errors
2. Ack payload shape remains consistent (`errorType`, `errorCode`, `errorMessage` semantics).
3. Processing safety remains intact: order state transitions happen only after valid signature verification.

Evidence references:

- `backend/app/api/v1/payments.py`
- `backend/tests/test_netopia_webhook.py`

### Checkout CI Contract

1. Compose smoke includes Playwright checkout specs for Stripe + PayPal.
2. Checkout success/failure paths remain executable end-to-end in CI.

Evidence references:

- `.github/workflows/compose-smoke.yml`
- `frontend/e2e/checkout-stripe.spec.ts`
- `frontend/e2e/checkout-paypal.spec.ts`

### Operational Contract

1. Mainline required checks relevant to PR #199 baseline continue to pass:
   - `Backend CI / backend`
   - `Backend CI / backend-postgres`
   - `Frontend CI / frontend`
   - `Docker Compose Smoke / compose-smoke`
   - `CodeQL`

Evidence references:

- Recent `main` runs for commit `dd589b6adcfcc295b14f0c9cae71abb949d1dbf7`

