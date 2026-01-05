# TODO / Roadmap

Below is a structured checklist you can turn into issues.

## Project & Infra
- [x] Initialize monorepo with `backend/`, `frontend/`, `infra/`.
- [x] Add `docker-compose.yml` for API, frontend, Postgres.
- [x] Add backend `.env.example` (DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*, FRONTEND_ORIGIN).
- [x] Add frontend `.env.example` (API_BASE_URL, STRIPE_PUBLISHABLE_KEY, APP_ENV).
- [x] Add `.gitignore` for Python, Node, env files, build artifacts.
- [x] GitHub Actions for backend (lint, tests, type-checks).
- [x] GitHub Actions for frontend (lint, tests, build).
- [x] CONTRIBUTING.md with branching, commit style, runbook.
- [x] ARCHITECTURE.md with high-level design and data flow.
- [x] CI: add deployment/release job (e.g., container build + push) once runtime code lands.

## Backend - Core & Auth
- [x] Scaffold FastAPI app with versioned `/api/v1` router.
- [x] Settings via `pydantic-settings`.
- [x] SQLAlchemy engine/session for Postgres.
- [x] User model + Alembic migration.
- [x] Password hashing/verification.
- [x] Auth endpoints: register, login (access+refresh), refresh, logout.
- [x] JWT guard dependency + role guard for admin.
- [x] Tests for auth flows (register/login/refresh/invalid creds).
- [x] HTTP-only refresh token cookie issued on login/refresh and cleared on logout.

## Backend - Catalog & Products
- [x] Category model + migration.
- [x] Product model + migration.
- [x] ProductImage model + migration.
- [x] (Optional) ProductVariant model + migration.
- [x] GET /categories (public).
- [x] GET /products with pagination, search, category, price filters.
- [x] GET /products/{slug} detail.
- [x] Admin create/update product endpoints.
- [x] Admin soft-delete product.
- [x] Admin product image upload/delete.
- [x] Image storage service (local first, S3-ready).
- [x] Seed example products/categories for dev.
- [x] SKU generation and uniqueness enforcement.
- [x] Slug collision handling and validator.
- [x] Product status enums (draft/published/archived).
- [x] Track publish date and last_modified.
- [x] Bulk price/stock update endpoint for admins.
- [x] Product labels/tags schema and filters.
- [x] Product option schema (color/size) without variants.
- [x] Admin product duplication/cloning.
- [x] Product reviews model + moderation queue.
- [x] Average rating + review count on product list/detail.
- [x] Related products/recommendations service (rule-based).
- [x] Recently viewed products service (per session).
- [x] Admin export products CSV.
- [x] Admin import products CSV with dry-run validation.
- [x] Product slug history/redirects on slug change.
- [x] Server-side pagination metadata (total pages/items).
- [x] Sort options: newest, price asc/desc, name asc/desc.
- [x] Backorder/preorder flag + estimated restock date.
- [x] Per-product shipping dimensions/weight fields.
- [x] Per-product metadata for SEO (meta title/description).
- [x] Rich text/markdown validation for product descriptions.
- [x] Admin audit log for product mutations.
- [x] Price and currency validation helpers.
- [x] Product feed (JSON/CSV) for marketing channels.
- [x] Featured collection endpoints.

## Backend - Cart & Checkout
- [x] Cart + CartItem models + migrations.
- [x] Guest cart support (session_id).
- [x] GET /cart (guest or user).
- [x] POST /cart/items add.
- [x] PATCH /cart/items/{id} update qty.
- [x] DELETE /cart/items/{id} remove.
- [x] Stock validation in cart endpoints.
- [x] Merge guest cart into user cart on login.
- [x] Max quantity per item enforcement.
- [x] Reserve stock on checkout start (optional).
- [x] Cart subtotal/tax/shipping calculation helper.
- [x] Promo code model + validation hook.
- [x] Abandoned cart job (email reminder) scaffold.
- [x] Cart item note (gift message) support.
- [x] Cart cleanup job for stale guest carts.
- [x] Variant selection validation (options match product).
- [x] Cart analytics events (add/remove/update).

## Backend - Orders, Payment, Addresses
- [x] Address model + migration; CRUD /me/addresses.
- [x] Order + OrderItem models + migrations.
- [x] Service to build order from cart (price snapshot).
- [x] Stripe integration: PaymentIntent create, return client secret.
- [x] Stripe webhook for payment succeeded/failed; update status.
- [x] GET /orders and /orders/{id}.
- [x] Admin order list/filter + status/tracking update.
- [x] Order status enums and transitions (pending/paid/shipped/cancelled/refunded).
- [x] Order reference code generator.
- [x] Shipping method model (flat-rate, weight-based).
- [x] Tax calculation strategy (basic rules).
- [x] Payment failure retry flow.
- [x] Refund endpoint stub (manual).
- [x] Order timeline/audit log (status changes, notes).
- [x] Packing slip/invoice PDF stub.
- [x] Order item fulfillment tracking (shipped qty).
- [x] Capture/void support for Stripe intents.
- [x] Admin order export CSV.
- [x] Reorder endpoint (copy past order to cart).
- [x] Address validation hook (country/postal rules).

## Backend - CMS & Content
- [x] ContentBlock model + migration.
- [x] Seed default blocks (home hero, about, FAQ, shipping/returns, care).
- [x] GET /content/{key} public.
- [x] Admin edit content blocks; validate markdown/HTML safety.
- [x] Content versioning with draft/publish states.
- [x] Image uploads for content blocks.
- [x] Rich text sanitization rules.
- [x] Homepage layout blocks (hero, grid, testimonials).
- [x] FAQ ordering/priorities.
- [x] Admin preview endpoint with token.
- [x] Content change audit log.
- [x] Static page slugs for SEO (about/faq/shipping/returns/care).

## Backend - Email & Notifications
- [x] Email settings (SMTP).
- [x] Generic email service (text + HTML).
- [x] Order confirmation email.
- [x] Password reset email + one-time token flow.
- [x] Logging/error handling around email sending.
- [x] Background task for sending emails.
- [x] Shipping update email (with tracking link).
- [x] Delivery confirmation email.
- [x] Cart abandonment email template.
- [x] Product back-in-stock notification flow.
- [x] Admin alert on low stock thresholds.
- [x] Error alerting to Slack/email (critical exceptions).
- [x] Template system for emails with variables.
- [x] Email preview endpoint (dev-only).
- [x] Rate limiting for email sends per user/session.

## Backend - Security, Observability, Testing
- [x] CORS config for dev/prod.
- [x] Rate limiting on login/register/password reset.
- [x] Validate file types/sizes for uploads.
- [x] Structured logging with request ID.
- [x] Health/readiness endpoints.
- [x] Pytest suite for services (auth, catalog, cart, checkout).
- [x] Integration tests against in-memory SQLite (API/service flows).
- [x] mypy type-checking and fixes.
- [x] CI smoke test hitting health/readiness.
- [x] API rate limit tests.
- [x] Structured logging format (JSON) toggle.
- [x] Request ID propagation to logs.
- [x] Secure password reset tokens (expiry, blacklist).
- [x] JWT rotation and blacklist on logout.
- [x] Content Security Policy headers.
- [x] HTTPS/secure cookies config for production.
- [x] Audit log middleware (user + IP).
- [x] Request/response logging with PII redaction.
- [x] Slow query logging and performance metrics.
- [x] Lint/type-check jobs extended (mypy, ruff).
- [x] Load testing plan (k6/locust) and scripts.
- [x] SQL injection and XSS validation tests.
- [x] Dependency vulnerability scanning (pip/npm).
- [x] Backpressure handling (429) for expensive endpoints.
- [x] Maintenance mode toggle.

## Frontend - Shell & Shared
- [x] Scaffold Angular app with routing + strict TS.
- [x] Tailwind CSS and design tokens.
- [x] Main layout (header/footer/responsive nav).
- [x] Shared components: button, input, card, modal, toast.
- [x] Fix shared standalone components missing `NgIf` imports so buttons/labels render correctly.
- [x] Header: improve theme/language control layout and add a global product search field.
- [x] Footer: remove year suffix from tagline and replace Pinterest link with Facebook.
- [x] Frontend: add `/about` route rendering CMS `page.about` content.
- [x] Header: make theme/language dropdown options readable in dark mode.
- [x] Header: avoid search/nav overlap on medium screens (use nav drawer + show search on wide screens).
- [x] Header: keep product search accessible on windowed/small screens (show search at `lg`, provide a search overlay below `lg`).
- [x] UI: hide admin CTA/nav items unless the signed-in user is an admin.
- [x] Global error handling / boundary route.
- [x] API service layer + interceptors.
- [x] Theme tokens (spacing, typography, colors).
- [x] Dark/light mode toggle.
- [x] Respect system `prefers-color-scheme` by default and keep theme state in localStorage (light/dark/system).
- [x] Add header theme switcher (light/dark/system) that updates the document root class and tokens in real time.
- [x] Audit shared components/layout for dark-mode contrast (backgrounds, borders, text, cards, inputs, modals, toasts) and fix any hardcoded light colors.
- [x] Add unit/e2e checks for theme switching (default follows system; toggle persists across reloads).
- [x] Form validation utilities (error messages, async validation).
- [x] Toast/snackbar service and global overlay.
- [x] Loading spinner/skeleton components.
- [x] Page-level breadcrumb component.
- [x] Accessible modal focus trapping.
- [x] IntersectionObserver-based lazy image component.
- [x] Global HTTP error handler (401/403/500).
- [x] Responsive nav drawer with keyboard navigation.
- [x] Route guards for auth/admin.
- [x] ESLint/Prettier strict config.

## Frontend - Storefront
- [x] Homepage hero with "Shop now" CTA.
- [x] Featured products grid on homepage.
- [x] Category listing with grid + pagination.
- [x] Filter sidebar (category, price range, tags).
- [x] Shop: prevent price range sliders overflowing the sidebar (stack vertically).
- [x] Search bar hitting /products.
- [x] Product card component (image, name, price, stock badge).
- [x] Product detail page with gallery, variants, quantity/add-to-cart.
- [x] Handmade uniqueness note.
- [x] Sort controls (price/name/newest).
- [x] Price range slider.
- [x] Tag/label pills (featured/new/limited).
- [x] Product gallery zoom/lightbox.
- [x] Persist filters in query params.
- [x] Empty state for product lists.
- [x] Error state/retry for product lists.
- [x] Breadcrumbs for category/product pages.
- [x] Recently viewed carousel.
- [x] Localized currency display.
- [x] SEO meta tags per product/category.

## Frontend - Cart & Checkout
- [x] Cart page/drawer with quantities and totals.
- [x] Update quantity/remove items; stock error messaging.
- [x] Checkout stepper: login/guest, shipping address, payment (Stripe).
- [x] Order summary during checkout.
- [x] Success page with order summary + continue shopping.
- [x] Guest cart persistence in localStorage.
- [x] Apply promo code UI.
- [x] Shipping method selection UI.
- [x] Address form with validation and country selector.
- [x] Payment form with Stripe elements.
- [x] Checkout error states and retry.
- [x] Save address checkbox for checkout.
- [x] Order confirmation page with next steps.
- [x] Cart mini-icon badge with item count.
- [x] Edge cases: out-of-stock and price changes during checkout.
- [x] Checkout totals driven by backend shipping/promo validation (no hardcoded amounts).
- [x] Send set-password email flow for guest checkouts that create an account.
- [x] Frontend cart/checkout tests (unit + e2e) against backend cart/payment intent APIs.
- [x] Ensure frontend CI runs with Angular toolchain/Chrome to cover cart/checkout flows.
- [x] Wire cart state to backend cart APIs (load/add/update/remove) instead of local-only.
- [x] Replace checkout payment placeholder with Stripe Elements + PaymentIntent from backend.
- [x] Submit checkout to backend to create order, validate stock/pricing, and handle failures.
- [x] Use backend shipping methods and promo validation instead of hardcoded values.
- [x] Persist/save checkout address via backend (guest or user) and reuse on account.
- [x] Add guest checkout API (session-based cart, guest address capture, optional account creation).
- [x] Tests: guest checkout with promo + shipping validates PaymentIntent amount and queues set-password email.
- [x] Tests: cart sync returns product metadata (name/slug/image/currency) and totals reflect shipping/promo.
- [x] Tests: payment intent amount derived from backend totals (seeded cart).
- [x] Frontend test: Checkout component calls /cart/sync, /payments/intent, /orders/guest-checkout with shipping_method_id/promo/create_account and handles errors/retry.
- [x] Frontend test: CartStore add/remove via backend merges quantities and is resilient to errors.
- [x] Frontend test: ProductComponent “Add to cart” posts to backend and shows toast (mock CartStore).
- [x] E2E: guest checkout (add cart → sync → apply promo/shipping → mock pay → confirm order) with CHROME_BIN headless and --no-sandbox.

## Frontend - Auth & Account
- [x] Login page with validation.
- [x] Registration page.
- [x] Password reset request + reset form.
- [x] Account dashboard (profile, address book, order history, order detail).
- [x] Change password form.
- [x] Email verification flow UI.
- [x] Address book CRUD UI.
- [x] Order history pagination + filters.
- [x] Saved payment method placeholder.
- [x] Profile avatar upload (optional).
- [x] Session timeout/logout messaging.
- [x] Wire login/register/password reset flows to backend auth endpoints (replace mocks).
- [x] Fetch real profile, addresses, and order history from backend; replace account dashboard mock data.
- [x] Implement avatar upload wired to storage backend.
- [x] Add backend email verification tokens/endpoints + frontend resend/confirm wiring.
- [x] Implement saved payment methods (Stripe setup intents) and wire UI add/remove card.
- [x] Client/session idle-timeout handling (auto logout + messaging).
- [x] Replace address prompt UX with form/modal wired to address CRUD APIs.
- [x] Integrate Stripe Elements card entry UI instead of manual payment_method prompts.

## Frontend - Admin Dashboard
- [x] /admin layout with sidebar + guard.
- [x] Product list table (sort/search).
- [x] Product create/edit form (slug, category, price, stock, description, images, variants).
- [x] Admin orders list with filters + order detail/status update.
- [x] Content editor for hero and static pages.
- [x] Basic user list (view customers, promote/demote admins).
- [x] Bulk product actions (activate/deactivate, delete).
- [x] Product image reorder UI.
- [x] Category CRUD UI with drag-and-drop ordering.
- [x] Order status update with timeline view.
- [x] Coupon/promo management UI.
- [x] Content preview/publish controls.
- [x] Admin activity audit view.
- [x] Admin login session management (force logout).
- [x] Inventory low-stock dashboard.
- [x] Sales analytics dashboard (GMV, AOV).
- [x] Wire admin dashboard widgets to backend (products/orders/users/content/coupons) and remove mock data.
- [x] Connect admin audit log to backend audit endpoints.
- [x] Connect admin session force-logout to backend session management.
- [x] Calculate low-stock and sales analytics from real backend metrics instead of mock data.
- [x] Backend tests: admin dashboard endpoints (summary, lists, audit, maintenance, category reorder, sitemap/robots/feed, session revoke, user role, image reorder).
- [x] Frontend tests: AdminService/admin component for order status, coupon add/toggle, category reorder drag/drop, maintenance toggle (mock HTTP).
- [x] E2E smoke: admin login → dashboard → change order status → toggle maintenance → reorder category → upload/delete product image.
- [x] Backend tests: admin filters/coupons/audit/image reorder/low-stock with sqlite override.
- [x] Frontend tests: AdminService + admin component flows (sessions revoke, role update, low-stock, coupons, maintenance get/set, category reorder drag-drop).
- [x] E2E: admin flow create coupon → apply to order (mock payment) + verify dashboard reflects coupon usage.

## UX, Performance, SEO & Accessibility
- [x] Mobile-first responsive design across pages(full mobile compatibility).
- [x] Loading skeletons/spinners for lists and details.
- [x] Toast notifications for key actions.
- [x] Image optimization (srcset/lazy loading/modern formats).
- [x] SEO meta tags per page; Open Graph; sitemap/robots.
- [x] Lighthouse perf + accessibility fixes.
- [x] Keyboard navigation, contrast, accessible labels.
- [x] Prefetch critical API calls on navigation.
- [x] Asset compression and caching headers guidance.
- [x] ARIA labels for form controls and buttons.
- [x] Focus styles consistent across components.
- [x] Skip-to-content link.
- [x] Motion-reduced animations option.
- [x] 404/500 error pages with helpful actions.
- [x] Structured data (JSON-LD) for products.
- [x] Breadcrumb structured data for SEO.
- [x] Perf budget and bundle analysis (Angular).

## Internationalization & Localization (RO/EN)
- [x] Pick frontend i18n strategy (Angular i18n vs ngx-translate) and set up RO/EN language switching.
- [x] Base translation files for `en` and `ro` (navigation, footer, auth, cart, checkout, admin).
- [x] Language toggle in header with persisted choice (localStorage/cookie).
- [x] Store preferred language on user profile and default to it after login.
- [x] Internationalize storefront text (home, shop, product detail, cart, checkout, account) – frontend strings wired to i18n.
- [x] Internationalize storefront shell text for home + shop pages (partial storefront i18n).
- [x] RO/EN translations for validation/error messages in forms (login, register, checkout, admin).
- [x] Internationalize admin dashboard labels/messages.
- [x] `product_translations` (or JSONB) for localized product name/short/long description per language.
- [x] `category_translations` (or JSONB) for localized category name/description per language.
- [x] Localized content blocks for static pages (About, FAQ, Shipping, etc.).
- [x] Content API supports `lang` query param with sensible fallbacks and `Accept-Language` defaults.
- [x] Localize email templates (order confirmation, password reset) into RO/EN based on user preference.
- [x] Localized SEO meta tags per language (home, category, product, about).
- [x] Tests rendering pages in RO/EN to verify translations/directionality.

## Auth – Google OAuth & Account Linking
- [x] Add Google identity fields to `User` (google_sub, google_email, google_picture_url) + migration.
- [x] Settings for Google OAuth client ID/secret, redirect URI, allowed domains.
- [x] `/auth/google/start` builds consent URL and redirects.
- [x] `/auth/google/callback` exchanges code, fetches profile, maps to local user.
- [x] Handle email collision: prompt linking instead of duplicate creation when email matches existing user.
- [x] Google login when `google_sub` exists issues standard access/refresh tokens.
- [x] `/auth/google/link` for logged-in users to link Google (password confirmation).
- [x] `/auth/google/unlink` to disconnect Google profile (must retain password).
- [x] Validation to prevent linking a Google account already linked elsewhere.
- [x] Frontend login/register “Continue with Google” flow and callback handling.
- [x] Account settings “Connected accounts” section with link/unlink actions.
- [x] Log security events for linking/unlinking and first-time Google logins.
- [x] Unit tests for Google OAuth flows (happy path, link existing, conflicting emails, unlink).
- [x] README docs for Google OAuth setup/testing (console steps, redirect URLs).

## Admin Dashboard – CMS & UX Enhancements
- [x] Admin UI for editing homepage hero per language (headline, subtitle, CTA, hero image).
- [x] Admin UI for managing Collections (named groups of products to feature).
- [x] Drag-and-drop ordering for homepage sections (hero, collections, bestsellers, new arrivals).
- [x] Admin UI for global assets (logo, favicon, social preview image).
- [x] SEO settings in admin to set meta title/description per page per language.
- [x] WYSIWYG/markdown editor for About/FAQ/Shipping content with RO/EN tabs.
- [x] Live preview mode in admin for page changes before publishing.
- [x] Version metadata (“last updated by/at”) for content blocks.
- [x] Admin dashboard overview with key metrics (open orders, recent orders, low-stock, sales last 30d).
- [x] Admin tools for inline/bulk stock editing in product table.
- [x] Duplicate product action in admin (clone with images, mark draft).
- [x] Admin controls for bestseller/highlight badges on storefront cards.
- [x] Scheduling for product publish/unpublish; show upcoming scheduled products.
- [x] Admin maintenance mode toggle (customer-facing maintenance page, admin bypass).
- [x] Admin audit log page listing important events (login, product changes, content updates, Google linking).

## Data Portability & Backups (Extended)
- [x] CLI command `python -m app.cli export-data` exporting users (no passwords), products, categories, orders, addresses to JSON.
- [x] CLI command `import-data` to bootstrap a new DB from JSON exports with idempotent upserts.
- [x] Infra helper script to archive DB dump + JSON exports + media into timestamped `.tar.gz`.
- [x] Document “Move to a new server” flow in README (restore DB/media, run migrations, import as needed).
- [x] Example cron/systemd timer config for scheduled backups in production.
- [x] `check-backup` script to restore latest backup into disposable Docker container and hit `/api/v1/health`.
- [x] Admin-triggered “Download my data” export endpoint with auth/logging.

## Media & File Handling Improvements
- [x] `storage.save_upload` generates unique filenames (UUID + extension) to avoid collisions/traversal.
- [x] Server-side validation for uploaded image type and size across endpoints.
- [x] Store relative media paths and derive full URLs via MEDIA_ROOT/CDN base.
- [x] Thumbnail/preview generation for product images (small/medium/large).
- [x] Script to scan for orphaned media files and delete/archive safely.
- [x] Ensure product/image deletes remove files from disk/S3 and log the operation.

## Bugs / Technical Debt / Misc Features
- [x] Config option to enforce Decimal end-to-end for prices; tests for exact totals.
- [x] Pagination metadata (total items/pages) in product list API responses.
- [x] Standardize error response format across APIs.
- [x] Structured logging around cart/checkout (cart id, user id, request id).
- [x] Rate limiting on `/auth/login`, `/auth/register`, `/auth/google/*` with consistent 429 response.
- [x] Wishlist/save-for-later feature per user.
- [x] Recently viewed products widget using cookie/localStorage list (storefront).
- [x] Integration test covering register → login → add to cart → checkout (mock payment) → see order.
- [x] Smoke test for Google OAuth using mocked Google endpoint.
- [x] Metrics counters for signups, logins, failed logins, orders created, payment failures.
- [x] robots.txt and sitemap.xml generation (with i18n URLs).
- [x] Per-language canonical URLs for product pages.
- [x] Document “local-only dev” mode (SQLite + local media + Stripe test) and “prod-like” mode (Postgres + S3 + SMTP).
- [x] Fix theme switching to override system (Tailwind `darkMode: 'class'`) and sync `color-scheme` to match selected theme.
- [x] UX: prevent toast notifications from blocking interactions and dedupe repeated error toasts.
- [x] UX: make Stripe CardElement readable in dark mode and update styles on theme changes (checkout + account).
- [x] Perf: fix account idle-timer event listener cleanup (avoid leaking listeners with `.bind(this)`).
- [x] Follow-up: set `<meta name="theme-color">` dynamically based on selected theme (mobile address bar).
- [x] Follow-up: add early theme bootstrap in `frontend/src/index.html` to avoid flash of incorrect theme on load.

## Backlog (New ideas inspired by Event Link)

### High priority
- [x] Docker: add `frontend/Dockerfile` + `frontend/.dockerignore` and make `infra/docker-compose.yml` work out of the box.
- [x] Frontend: generate runtime config from env (API_BASE_URL/STRIPE_PUBLISHABLE_KEY/APP_ENV) and remove hardcoded API base URL.
- [x] Frontend: add Angular dev-server proxy configuration (`proxy.conf.json`) for `/api` and `/media` in local dev.
- [x] Docs: document Docker-based local dev flow in `infra/README.md` (ports, URLs, CORS expectations, Stripe webhook tunnelling).
- [x] DX: introduce `pre-commit` config (Black/Ruff + Prettier/ESLint) and reference it in CONTRIBUTING.md.
- [x] DX: add top-level `Makefile` shortcuts (`make dev`, `make test`, `make lint`, `make docker-up`).
- [x] CI: add Docker Compose build + smoke test (backend health/readiness + frontend HTTP 200).
- [x] DX: ignore runtime/generated artifacts (`uploads/`, `backend/uploads/`, `frontend/src/assets/app-config.js`, `*:Zone.Identifier`) to keep the working tree clean.
- [x] Tests: extend full checkout flow test to verify orders can be fetched via `/orders` and `/orders/{id}` after checkout.

### Medium priority
- [x] Backend: replace deprecated `imghdr` usage with Pillow-based file type detection and add tests.
- [x] Payments: add tests for Stripe webhook signature validation (STRIPE_WEBHOOK_SECRET), including invalid signatures.
- [x] Payments: add webhook idempotency (store processed event IDs) to avoid double-processing.
- [x] Infra: add docker-compose healthchecks and `depends_on` conditions (db → backend → frontend).
- [x] Frontend: add Wishlist UI (product list/detail + account) and wire it to the backend wishlist endpoints.
- [x] Testing: run core API flows against Postgres (Docker) in CI to catch SQL dialect issues.

### Low priority
- [x] Docs: reconcile `README.md` and `start.sh`/`start.bat` with the actual tooling (pip/npm), env vars, and docker-compose location.
- [x] Observability: add optional Sentry wiring (backend + frontend) gated by env vars.
- [x] Performance: add ETag/Cache-Control guidance for catalog endpoints and media assets (CDN-friendly).
