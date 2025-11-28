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

## Backend - Cart & Checkout
- [x] Cart + CartItem models + migrations.
- [x] Guest cart support (session_id).
- [x] GET /cart (guest or user).
- [x] POST /cart/items add.
- [x] PATCH /cart/items/{id} update qty.
- [x] DELETE /cart/items/{id} remove.
- [x] Stock validation in cart endpoints.
- [x] Merge guest cart into user cart on login.

## Backend - Orders, Payment, Addresses
- [x] Address model + migration; CRUD /me/addresses.
- [x] Order + OrderItem models + migrations.
- [ ] Service to build order from cart (price snapshot).
- [ ] Stripe integration: PaymentIntent create, return client secret.
- [ ] Stripe webhook for payment succeeded/failed; update status.
- [ ] GET /me/orders and /me/orders/{id}.
- [ ] Admin order list/filter + status/tracking update.

## Backend - CMS & Content
- [ ] ContentBlock model + migration.
- [ ] Seed default blocks (home hero, about, FAQ, shipping/returns, care).
- [ ] GET /content/{key} public.
- [ ] Admin edit content blocks; validate markdown/HTML safety.

## Backend - Email & Notifications
- [ ] Email settings (SMTP).
- [ ] Generic email service (text + HTML).
- [ ] Order confirmation email.
- [ ] Password reset email + one-time token flow.
- [ ] Logging/error handling around email sending.
- [ ] Background task for sending emails.

## Backend - Security, Observability, Testing
- [ ] CORS config for dev/prod.
- [ ] Rate limiting on login/register/password reset.
- [ ] Validate file types/sizes for uploads.
- [ ] Structured logging with request ID.
- [ ] Health/readiness endpoints.
- [ ] Pytest suite for services (auth, catalog, cart, checkout).
- [ ] Integration tests against temp Postgres.
- [ ] mypy type-checking and fixes.

## Frontend - Shell & Shared
- [ ] Scaffold Angular app with routing + strict TS.
- [ ] Tailwind CSS and design tokens.
- [ ] Main layout (header/footer/responsive nav).
- [ ] Shared components: button, input, card, modal, toast.
- [ ] Global error handling / boundary route.
- [ ] API service layer + interceptors.

## Frontend - Storefront
- [ ] Homepage hero with "Shop now" CTA.
- [ ] Featured products grid on homepage.
- [ ] Category listing with grid + pagination.
- [ ] Filter sidebar (category, price range, tags).
- [ ] Search bar hitting /products.
- [ ] Product card component (image, name, price, stock badge).
- [ ] Product detail page with gallery, variants, quantity/add-to-cart.
- [ ] Handmade uniqueness note.

## Frontend - Cart & Checkout
- [ ] Cart page/drawer with quantities and totals.
- [ ] Update quantity/remove items; stock error messaging.
- [ ] Checkout stepper: login/guest, shipping address, payment (Stripe).
- [ ] Order summary during checkout.
- [ ] Success page with order summary + continue shopping.

## Frontend - Auth & Account
- [ ] Login page with validation.
- [ ] Registration page.
- [ ] Password reset request + reset form.
- [ ] Account dashboard (profile, address book, order history, order detail).

## Frontend - Admin Dashboard
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
