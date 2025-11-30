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
- [x] GET /me/orders and /me/orders/{id}.
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
- [x] Integration tests against temp Postgres.
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
- [x] Global error handling / boundary route.
- [ ] API service layer + interceptors.
- [ ] Theme tokens (spacing, typography, colors).
- [ ] Dark/light mode toggle.
- [ ] Form validation utilities (error messages, async validation).
- [ ] Toast/snackbar service and global overlay.
- [ ] Loading spinner/skeleton components.
- [ ] Page-level breadcrumb component.
- [ ] Accessible modal focus trapping.
- [ ] IntersectionObserver-based lazy image component.
- [ ] Global HTTP error handler (401/403/500).
- [ ] Responsive nav drawer with keyboard navigation.
- [ ] Route guards for auth/admin.
- [ ] ESLint/Prettier strict config.

## Frontend - Storefront
- [ ] Homepage hero with "Shop now" CTA.
- [ ] Featured products grid on homepage.
- [ ] Category listing with grid + pagination.
- [ ] Filter sidebar (category, price range, tags).
- [ ] Search bar hitting /products.
- [ ] Product card component (image, name, price, stock badge).
- [ ] Product detail page with gallery, variants, quantity/add-to-cart.
- [ ] Handmade uniqueness note.
- [ ] Sort controls (price/name/newest).
- [ ] Price range slider.
- [ ] Tag/label pills (featured/new/limited).
- [ ] Product gallery zoom/lightbox.
- [ ] Persist filters in query params.
- [ ] Empty state for product lists.
- [ ] Error state/retry for product lists.
- [ ] Breadcrumbs for category/product pages.
- [ ] Recently viewed carousel.
- [ ] Localized currency display.
- [ ] SEO meta tags per product/category.

## Frontend - Cart & Checkout
- [ ] Cart page/drawer with quantities and totals.
- [ ] Update quantity/remove items; stock error messaging.
- [ ] Checkout stepper: login/guest, shipping address, payment (Stripe).
- [ ] Order summary during checkout.
- [ ] Success page with order summary + continue shopping.
- [ ] Guest cart persistence in localStorage.
- [ ] Apply promo code UI.
- [ ] Shipping method selection UI.
- [ ] Address form with validation and country selector.
- [ ] Payment form with Stripe elements.
- [ ] Checkout error states and retry.
- [ ] Save address checkbox for checkout.
- [ ] Order confirmation page with next steps.
- [ ] Cart mini-icon badge with item count.
- [ ] Edge cases: out-of-stock and price changes during checkout.

## Frontend - Auth & Account
- [ ] Login page with validation.
- [ ] Registration page.
- [ ] Password reset request + reset form.
- [ ] Account dashboard (profile, address book, order history, order detail).
- [ ] Change password form.
- [ ] Email verification flow UI.
- [ ] Address book CRUD UI.
- [ ] Order history pagination + filters.
- [ ] Saved payment method placeholder.
- [ ] Profile avatar upload (optional).
- [ ] Session timeout/logout messaging.
- [ ] 2FA toggle (placeholder).

## Frontend - Admin Dashboard
- [ ] /admin layout with sidebar + guard.
- [ ] Product list table (sort/search).
- [ ] Product create/edit form (slug, category, price, stock, description, images, variants).
- [ ] Admin orders list with filters + order detail/status update.
- [ ] Content editor for hero and static pages.
- [ ] Basic user list (view customers, promote/demote admins).
- [ ] Bulk product actions (activate/deactivate, delete).
- [ ] Product image reorder UI.
- [ ] Category CRUD UI with drag-and-drop ordering.
- [ ] Order status update with timeline view.
- [ ] Coupon/promo management UI.
- [ ] Content preview/publish controls.
- [ ] Admin activity audit view.
- [ ] Admin login session management (force logout).
- [ ] Inventory low-stock dashboard.
- [ ] Sales analytics dashboard (GMV, AOV).

## UX, Performance, SEO & Accessibility
- [ ] Mobile-first responsive design across pages.
- [ ] Loading skeletons/spinners for lists and details.
- [ ] Toast notifications for key actions.
- [ ] Image optimization (srcset/lazy loading/modern formats).
- [ ] SEO meta tags per page; Open Graph; sitemap/robots.
- [ ] Lighthouse perf + accessibility fixes.
- [ ] Keyboard navigation, contrast, accessible labels.
- [ ] Prefetch critical API calls on navigation.
- [ ] Asset compression and caching headers guidance.
- [ ] ARIA labels for form controls and buttons.
- [ ] Focus styles consistent across components.
- [ ] Skip-to-content link.
- [ ] Motion-reduced animations option.
- [ ] 404/500 error pages with helpful actions.
- [ ] Structured data (JSON-LD) for products.
- [ ] Breadcrumb structured data for SEO.
- [ ] Perf budget and bundle analysis (Angular).

## Internationalization & Localization (RO/EN)
- [ ] Pick frontend i18n strategy (Angular i18n vs ngx-translate) and set up RO/EN language switching.
- [ ] Base translation files for `en` and `ro` (navigation, footer, auth, cart, checkout, admin).
- [ ] Language toggle in header with persisted choice (localStorage/cookie).
- [ ] Store preferred language on user profile and default to it after login.
- [ ] Internationalize storefront text (home, shop, product detail, cart, checkout, account).
- [ ] RO/EN translations for validation/error messages in forms (login, register, checkout, admin).
- [ ] Internationalize admin dashboard labels/messages.
- [ ] `product_translations` (or JSONB) for localized product name/short/long description per language.
- [ ] `category_translations` (or JSONB) for localized category name/description per language.
- [ ] Localized content blocks for static pages (About, FAQ, Shipping, etc.).
- [ ] Content API supports `lang` query param with sensible fallbacks and `Accept-Language` defaults.
- [ ] Localize email templates (order confirmation, password reset) into RO/EN based on user preference.
- [ ] Localized SEO meta tags per language (home, category, product, about).
- [ ] Tests rendering pages in RO/EN to verify translations/directionality.

## Auth – Google OAuth & Account Linking
- [ ] Add Google identity fields to `User` (google_sub, google_email, google_picture_url) + migration.
- [ ] Settings for Google OAuth client ID/secret, redirect URI, allowed domains.
- [ ] `/auth/google/start` builds consent URL and redirects.
- [ ] `/auth/google/callback` exchanges code, fetches profile, maps to local user.
- [ ] Handle email collision: prompt linking instead of duplicate creation when email matches existing user.
- [ ] Google login when `google_sub` exists issues standard access/refresh tokens.
- [ ] `/auth/google/link` for logged-in users to link Google (password confirmation).
- [ ] `/auth/google/unlink` to disconnect Google profile (must retain password).
- [ ] Validation to prevent linking a Google account already linked elsewhere.
- [ ] Frontend login/register “Continue with Google” flow and callback handling.
- [ ] Account settings “Connected accounts” section with link/unlink actions.
- [ ] Log security events for linking/unlinking and first-time Google logins.
- [ ] Unit tests for Google OAuth flows (happy path, link existing, conflicting emails, unlink).
- [ ] README docs for Google OAuth setup/testing (console steps, redirect URLs).

## Admin Dashboard – CMS & UX Enhancements
- [ ] Admin UI for editing homepage hero per language (headline, subtitle, CTA, hero image).
- [ ] Admin UI for managing Collections (named groups of products to feature).
- [ ] Drag-and-drop ordering for homepage sections (hero, collections, bestsellers, new arrivals).
- [ ] Admin UI for global assets (logo, favicon, social preview image).
- [ ] SEO settings in admin to set meta title/description per page per language.
- [ ] WYSIWYG/markdown editor for About/FAQ/Shipping content with RO/EN tabs.
- [ ] Live preview mode in admin for page changes before publishing.
- [ ] Version metadata (“last updated by/at”) for content blocks.
- [ ] Admin dashboard overview with key metrics (open orders, recent orders, low-stock, sales last 30d).
- [ ] Admin tools for inline/bulk stock editing in product table.
- [ ] Duplicate product action in admin (clone with images, mark draft).
- [ ] Admin controls for bestseller/highlight badges on storefront cards.
- [ ] Scheduling for product publish/unpublish; show upcoming scheduled products.
- [ ] Admin maintenance mode toggle (customer-facing maintenance page, admin bypass).
- [ ] Admin audit log page listing important events (login, product changes, content updates, Google linking).

## Data Portability & Backups (Extended)
- [ ] CLI command `python -m app.cli export-data` exporting users (no passwords), products, categories, orders, addresses to JSON.
- [ ] CLI command `import-data` to bootstrap a new DB from JSON exports with idempotent upserts.
- [ ] Infra helper script to archive DB dump + JSON exports + media into timestamped `.tar.gz`.
- [ ] Document “Move to a new server” flow in README (restore DB/media, run migrations, import as needed).
- [ ] Example cron/systemd timer config for scheduled backups in production.
- [ ] `check-backup` script to restore latest backup into disposable Docker container and hit `/api/v1/health`.
- [ ] Admin-triggered “Download my data” export endpoint with auth/logging.

## Media & File Handling Improvements
- [ ] `storage.save_upload` generates unique filenames (UUID + extension) to avoid collisions/traversal.
- [ ] Server-side validation for uploaded image type and size across endpoints.
- [ ] Thumbnail/preview generation for product images (small/medium/large).
- [ ] Store relative media paths and derive full URLs via MEDIA_ROOT/CDN base.
- [ ] Script to scan for orphaned media files and delete/archive safely.
- [ ] Ensure product/image deletes remove files from disk/S3 and log the operation.

## Bugs / Technical Debt / Misc Features
- [ ] Config option to enforce Decimal end-to-end for prices; tests for exact totals.
- [ ] Pagination metadata (total items/pages) in product list API responses.
- [ ] Standardize error response format across APIs.
- [ ] Structured logging around cart/checkout (cart id, user id, request id).
- [ ] Rate limiting on `/auth/login`, `/auth/register`, `/auth/google/*` with consistent 429 response.
- [ ] Wishlist/save-for-later feature per user.
- [ ] Recently viewed products widget using cookie/localStorage list (storefront).
- [ ] Integration test covering register → login → add to cart → checkout (mock payment) → see order.
- [ ] Smoke test for Google OAuth using mocked Google endpoint.
- [ ] Metrics counters for signups, logins, failed logins, orders created, payment failures.
- [ ] robots.txt and sitemap.xml generation (with i18n URLs).
- [ ] Per-language canonical URLs for product pages.
- [ ] Document “local-only dev” mode (SQLite + local media + Stripe test) and “prod-like” mode (Postgres + S3 + SMTP).
