# Project Backlog

## High priority
- [ ] Establish monorepo structure (backend/frontend/infra) with initial scaffolding.
- [ ] Add docker-compose.yml for API, frontend, and Postgres services.
- [ ] Provide .env.example files for backend (DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*, FRONTEND_ORIGIN) and frontend (API_BASE_URL, STRIPE_PUBLISHABLE_KEY, APP_ENV).
- [ ] Configure .gitignore for Python, Node, env files, and build artifacts.
- [ ] Set up thorough GitHub Actions CI/CD (backend lint/test/type-check, frontend lint/test/build, coverage gating).
- [ ] Add CONTRIBUTING.md covering branching strategy, commit style, and local workflows.
- [ ] Add ARCHITECTURE.md describing modules and data flow.
- [ ] Scaffold FastAPI app with /api/v1 router and settings via pydantic-settings.
- [ ] Configure SQLAlchemy engine/session management and Alembic integration for Postgres.
- [ ] Create User model and initial migration.
- [ ] Implement password hashing/verification and JWT-based auth (access + refresh in HTTP-only cookies).
- [ ] Add auth endpoints: register, login, refresh, logout.
- [ ] Add auth guards for authenticated users and admin-only routes.
- [ ] Add backend auth tests (register/login/refresh/invalid credentials).

## Medium priority
- [ ] Create catalog models/migrations: Category, Product, ProductImage, optional ProductVariant.
- [ ] Public catalog endpoints with pagination, search, category filter, and price range filter.
- [ ] Admin product CRUD with soft delete, image upload/delete, and optional variants.
- [ ] Cart + CartItem models with guest cart support and merge-on-login behavior.
- [ ] Stock validation in cart operations and add/update/remove endpoints.
- [ ] Order + OrderItem models and service to build orders from carts (price snapshot).
- [ ] Integrate Stripe PaymentIntent + webhook handling; expose checkout/confirmation endpoints.
- [ ] Address CRUD endpoints (/me/addresses) and order history (/me/orders, /me/orders/{id}).
- [ ] ContentBlock model, seed content (home hero, about, FAQ, shipping/returns, care), and public/admin content endpoints.
- [ ] Email service with SMTP settings, templates for order confirmation and password reset, background sending with logging.
- [ ] Security/observability: CORS config, rate limiting for auth flows, structured logging with request IDs, health/readiness endpoints.
- [ ] Backend quality gates: ruff/black/isort formatting, mypy type-checking, pytest suites for catalog/cart/checkout flows.
- [ ] Pagination and sorting for list endpoints (products, orders, users).
- [ ] Task queue abstraction for heavier background jobs (emails, webhooks) to replace in-process tasks.
- [ ] Account deletion and data export flow for privacy compliance.

## Low priority
- [ ] Scaffold Angular app with strict TS, routing, and Tailwind base tokens.
- [ ] Shared UI components (button, input, card, modal, toast/notification center).
- [ ] API service layer with interceptors and global error boundary.
- [ ] Storefront UI: home hero + featured grid, category listing with filters/search, product detail with gallery/variants, add-to-cart.
- [ ] Cart and checkout UI (guest cart, stepper with Stripe card element, success page).
- [ ] Auth/account UI (login/register/reset, profile update, address book, order history/detail).
- [ ] Admin UI (product table/search/sort, product form with images/variants, orders list/detail, content editor, user list).
- [ ] UX/SEO/accessibility improvements (responsive design, skeletons, meta/Open Graph tags, sitemap/robots, keyboard navigation, contrast and labels).
- [ ] Dockerized full stack and infra docs for local and deployment.
- [ ] End-to-end tests (Playwright) for auth, browse, cart/checkout, and admin edit flows.
- [ ] Load/stress tests for critical endpoints (catalog list, register/cart/checkout, recommendations).
- [ ] "Favorite events"/watchlist-style feature for products to save items.
- [ ] Recommendation explanation UI (“Because you viewed X”, “Similar tags: Y”).
