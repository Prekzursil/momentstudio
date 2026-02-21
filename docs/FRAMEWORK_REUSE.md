# Framework Reuse Contract

This document defines how to reuse this monorepo as a base framework for new branded deployments while keeping diffs small and upgrades predictable.

## 1) Core Reusable Modules

Use these modules as the stable base, then customize via profile/env values and brand assets before changing code.

### Backend APIs (reusable by default)

- **Versioned API surface**: `/api/v1` route contract and health checks.
- **Core commerce domains**: catalog, cart, checkout, orders/payments, content blocks, auth/account.
- **Platform services**: migrations (Alembic), settings/profile loading, email delivery, webhook handlers, rate limits, request tracing.
- **Ops surfaces**: admin/owner operational endpoints (sync jobs, maintenance helpers) where already present.

### Frontend shells (reusable by default)

- **Storefront shell**: public browsing, product detail, cart/checkout, account entry points.
- **Account shell**: authenticated customer area for profile/order history flows.
- **Admin shell**: protected admin routes for catalog/orders/content/ops workflows.
- **Shared UI/core**: common layout primitives, shared services/interceptors, localization resources, design tokens.

### Admin/storefront boundaries (must remain explicit)

- Keep **storefront/account/admin** routing and access boundaries separate.
- Do not mix admin-only workflows into storefront routes/components.
- Reuse shared primitives/services only when they do not violate role boundaries.
- Backend admin/owner endpoints stay role-gated and are consumed only from admin shell.

## 2) Required Profile Inputs

A consumer repo should define a profile (env + seed values) with these required keys before first release.

### Identity and market

- **brand**: display name, visual assets, contact identity.
- **domain**: canonical hostnames/origins for frontend and API.
- **locales**: default locale and enabled locales (at least RO/EN when preserving current baseline).

### Legal/content seed

- **legal seed**: terms, privacy, return/refund, shipping/cookies content blocks and publish policy.

### Commerce toggles

- **payments toggles**: enabled providers (e.g., mock/Stripe/PayPal/COD/Netopia scaffold) per environment.
- **courier toggles**: enabled logistics integrations/fallback behavior (locker/mirror/fallback switches).

### Operational profile

- environment profile split for development vs production-like mode.
- observability keys (error reporting, analytics opt-in behavior) per environment.
- admin bootstrap identity for first owner account.

## 3) Bootstrap Steps for a New Repo (Minimal Diffs)

1. **Create from template/fork preserving monorepo layout** (`backend/`, `frontend/`, `infra/`, `docs/`).
2. **Initialize local profile files** using the existing bootstrap/switch flow:
   - `./scripts/env/bootstrap.sh`
   - `make env-dev`
3. **Set required profile inputs** (brand/domain/locales/legal/payment/courier toggles) in profile/env + seed data only.
4. **Apply DB migrations + seed baseline data** and bootstrap owner/admin account.
5. **Swap brand assets/content** first (logos/text/translations), avoiding API/shell rewrites.
6. **Run verification gates** (see checklist below) in source repo and consumer repo.
7. **Only then introduce code deltas** for intentional product-specific behavior.

Minimal-diff rule of thumb:

- Prefer env/profile/seed/content overrides over code edits.
- Preserve API versioning and shell boundaries unless the consumer explicitly accepts a breaking fork.

## 4) Compatibility Promises and Profile-Key Migration Expectations

### Compatibility promises

The framework maintains these cross-version expectations for consumers:

- Stable high-level module boundaries: backend API core, storefront/account/admin shells, infra profile split.
- Backward-compatible evolution for profile-based configuration whenever possible.
- Existing verification contracts remain reusable (`make verify` + repo checks), with additive checks preferred over replacements.

### Migration expectations for profile keys

When profile keys change across versions:

- Use **additive-first** migrations (introduce new key, keep old key temporarily).
- Provide a documented deprecation window and default/fallback behavior.
- Include explicit rename/removal notes in release docs.
- Require consumer repos to update profile keys before removing deprecated aliases.
- Treat removal of a previously required key as a breaking change requiring migration notes.

## 5) Verification Checklist (Source + Consumer)

Run this for both the source framework repo and each consumer repo.

### A. Source framework repo verification

1. Sync env/profile and dependencies.
2. Run canonical contract:
   - `make verify`
3. Confirm no boundary regressions:
   - storefront/account/admin route separation intact.
   - admin-only APIs remain role-gated.
4. Confirm profile compatibility notes exist for any key changes.

### B. Consumer repo verification

1. Populate all required profile inputs (brand/domain/locales/legal/payment/courier).
2. Bootstrap local env + migrations + owner account.
3. Run canonical contract:
   - `make verify`
4. Execute smoke checks for:
   - storefront browse/cart/checkout,
   - account auth/order history,
   - admin catalog/orders/content/ops,
   - enabled payment/courier paths.
5. Record any consumer-specific overrides and confirm they are intentional, minimal, and documented.

## Change Governance

- Default release risk for profile-only onboarding docs: `risk:low`.
- Escalate to human-reviewed rollout notes when touching auth/payments/security-sensitive behavior.
- Include rollback notes for any payments/auth/security-sensitive migration.
