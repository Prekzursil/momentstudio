# TODO / Roadmap

Below is a structured checklist you can turn into issues. Nothing is marked done yet.

## Project & Infra
- [ ] Initialize monorepo with `backend/`, `frontend/`, `infra/`.
- [ ] Add `docker-compose.yml` for API, frontend, Postgres.
- [ ] Add backend `.env.example` (DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*, FRONTEND_ORIGIN).
- [ ] Add frontend `.env.example` (API_BASE_URL, STRIPE_PUBLISHABLE_KEY, APP_ENV).
- [ ] Add `.gitignore` for Python, Node, env files, build artifacts.
- [ ] GitHub Actions for backend (lint, tests, type-checks).
- [ ] GitHub Actions for frontend (lint, tests, build).
- [ ] CONTRIBUTING.md with branching, commit style, runbook.
- [ ] ARCHITECTURE.md with high-level design and data flow.

## Backend – Core & Auth
- [ ] Scaffold FastAPI app with versioned `/api/v1` router.
- [ ] Settings via `pydantic-settings`.
- [ ] SQLAlchemy engine/session for Postgres.
- [ ] User model + Alembic migration.
- [ ] Password hashing/verification.
- [ ] Auth endpoints: register, login (access+refresh), refresh, logout.
- [ ] JWT guard dependency + role guard for admin.
- [ ] Tests for auth flows (register/login/refresh/invalid creds).

## Backend – Catalog & Products
- [ ] Category model + migration.
- [ ] Product model + migration.
- [ ] ProductImage model + migration.
- [ ] (Optional) ProductVariant model + migration.
- [ ] GET /categories (public).
- [ ] GET /products with pagination, search, category, price filters.
- [ ] GET /products/{slug} detail.
- [ ] Admin create/update product endpoints.
- [ ] Admin soft-delete product.
- [ ] Admin product image upload/delete.
- [ ] Image storage service (local first, S3-ready).
- [ ] Seed example products/categories for dev.

## Backend – Cart & Checkout
- [ ] Cart + CartItem models + migrations.
- [ ] Guest cart support (session_id).
- [ ] GET /cart (guest or user).
- [ ] POST /cart/items add.
- [ ] PATCH /cart/items/{id} update qty.
- [ ] DELETE /cart/items/{id} remove.
- [ ] Stock validation in cart endpoints.
- [ ] Merge guest cart into user cart on login.

## Backend – Orders, Payment, Addresses
- [ ] Address model + migration; CRUD /me/addresses.
- [ ] Order + OrderItem models + migrations.
- [ ] Service to build order from cart (price snapshot).
- [ ] Stripe integration: PaymentIntent create, return client secret.
- [ ] Stripe webhook for payment succeeded/failed; update status.
- [ ] GET /me/orders and /me/orders/{id}.
- [ ] Admin order list/filter + status/tracking update.

## Backend – CMS & Content
- [ ] ContentBlock model + migration.
- [ ] Seed default blocks (home hero, about, FAQ, shipping/returns, care).
- [ ] GET /content/{key} public.
- [ ] Admin edit content blocks; validate markdown/HTML safety.

## Backend – Email & Notifications
- [ ] Email settings (SMTP).
- [ ] Generic email service (text + HTML).
- [ ] Order confirmation email.
- [ ] Password reset email + one-time token flow.
- [ ] Logging/error handling around email sending.
- [ ] Background task for sending emails.

## Backend – Security, Observability, Testing
- [ ] CORS config for dev/prod.
- [ ] Rate limiting on login/register/password reset.
- [ ] Validate file types/sizes for uploads.
- [ ] Structured logging with request ID.
- [ ] Health/readiness endpoints.
- [ ] Pytest suite for services (auth, catalog, cart, checkout).
- [ ] Integration tests against temp Postgres.
- [ ] mypy type-checking and fixes.

## Frontend – Shell & Shared
- [ ] Scaffold Angular app with routing + strict TS.
- [ ] Tailwind CSS and design tokens.
- [ ] Main layout (header/footer/responsive nav).
- [ ] Shared components: button, input, card, modal, toast.
- [ ] Global error handling / boundary route.
- [ ] API service layer + interceptors.

## Frontend – Storefront
- [ ] Homepage hero with “Shop now” CTA.
- [ ] Featured products grid on homepage.
- [ ] Category listing with grid + pagination.
- [ ] Filter sidebar (category, price range, tags).
- [ ] Search bar hitting /products.
- [ ] Product card component (image, name, price, stock badge).
- [ ] Product detail page with gallery, variants, quantity/add-to-cart.
- [ ] Handmade uniqueness note.

## Frontend – Cart & Checkout
- [ ] Cart page/drawer with quantities and totals.
- [ ] Update quantity/remove items; stock error messaging.
- [ ] Checkout stepper: login/guest, shipping address, payment (Stripe).
- [ ] Order summary during checkout.
- [ ] Success page with order summary + continue shopping.

## Frontend – Auth & Account
- [ ] Login page with validation.
- [ ] Registration page.
- [ ] Password reset request + reset form.
- [ ] Account dashboard (profile, address book, order history, order detail).

## Frontend – Admin Dashboard
- [ ] /admin layout with sidebar + guard.
- [ ] Product list table (sort/search).
- [ ] Product create/edit form (slug, category, price, stock, description, images, variants).
- [ ] Admin orders list with filters + order detail/status update.
- [ ] Content editor for hero and static pages.
- [ ] Basic user list (view customers, promote/demote admins).

## UX, Performance, SEO & Accessibility
- [ ] Mobile-first responsive design across pages.
- [ ] Loading skeletons/spinners for lists and details.
- [ ] Toast notifications for key actions.
- [ ] Image optimization (srcset/lazy loading/modern formats).
- [ ] SEO meta tags per page; Open Graph; sitemap/robots.
- [ ] Lighthouse perf + accessibility fixes.
- [ ] Keyboard navigation, contrast, accessible labels.
