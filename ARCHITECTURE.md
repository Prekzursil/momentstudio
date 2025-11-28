# Architecture Overview

AdrianaArt is a monorepo with a FastAPI backend, Angular frontend, and lightweight infra for local/dev deployments. The stack favors clear boundaries between HTTP/API, domain logic, persistence, and presentation.

## Monorepo layout

- `backend/`: FastAPI app, domain models, services, migrations, tests.
- `frontend/`: Angular 18 storefront and admin UI with shared design tokens/components.
- `infra/`: Docker Compose for local stack (Postgres, backend, frontend) and future deployment tooling.

## Backend (FastAPI + PostgreSQL)

- **Entrypoint**: `app.main:app` mounts a versioned `/api/v1` router.
- **Configuration**: `pydantic-settings` reads environment (`DATABASE_URL`, `SECRET_KEY`, `STRIPE_SECRET_KEY`, `SMTP_*`, `FRONTEND_ORIGIN`).
- **Persistence**: SQLAlchemy engine/session factory; Alembic migrations track schema.
- **Auth**:
  - Users stored with salted password hashes.
  - JWT-based sessions (access + refresh) issued at login/refresh; stored in HTTP-only cookies.
  - Dependency-based guards for authenticated + role-gated routes (e.g., admin).
- **Domain slices**:
  - Catalog: categories, products, product images/variants; search/pagination filters.
  - Cart/checkout: carts keyed by user or guest session; merges guest cart on login; stock validated on write.
  - Orders/payments: order builder snapshots prices; Stripe PaymentIntent for payments; webhooks reconcile status.
  - Content: editable content blocks for hero/about/faq/shipping/care.
  - Email: SMTP-backed service for transactional emails (order confirmation, password reset).
- **Cross-cutting**: structured logging with request IDs, CORS config, rate limiting on auth endpoints, file-type/size validation for uploads.
- **Testing**: pytest suite with factory helpers and integration tests against a temporary Postgres (e.g., testcontainers).

### Backend request/data flow (example: checkout)

1. Frontend collects cart + address and calls `POST /api/v1/checkout` (or order builder).
2. FastAPI handler pulls user/guest session, validates stock via services, builds an Order snapshot, and creates a Stripe PaymentIntent.
3. PaymentIntent client secret returned to frontend; frontend confirms payment via Stripe JS.
4. Stripe webhook hits `/api/v1/webhooks/stripe`, verifying signature; order status updated (Paid/Failed).
5. Background task (or immediate) triggers order confirmation email.

## Frontend (Angular 18 + Tailwind)

- **Shell**: App component provides layout, header/footer, and responsive navigation.
- **Routing**: Lazy-loaded feature routes for catalog, product detail, cart/checkout, auth/account, and admin.
- **State/data**:
  - Services using Angular `HttpClient` for API calls; interceptors for auth cookies, loading/error handling.
  - Signals/observables for client state (cart, user session, feature flags).
  - LocalStorage used to persist guest carts/session IDs and merge with server carts after login.
- **UI**:
  - Shared primitives (button/input/card/modal/toast) with Tailwind design tokens.
  - Storefront components for hero, featured grid, product cards/detail, filters, and search.
  - Admin area with guarded routes and tables/forms for products, orders, content, and users.
- **Error handling**: global error boundary/route guard surfaces toasts, friendly fallback pages, and retries where safe.

### Frontend -> Backend flows

- **Browsing**: `/products` with pagination/filter params; product detail fetched by slug; images served from backend/S3-compatible storage.
- **Cart**: guest cart stored locally and synced via `/cart`; server validates stock on add/update/delete.
- **Auth**: login/register/reset forms call auth endpoints; refresh tokens handled via interceptor; logout clears cookies + local state.
- **Admin**: guarded routes call admin-prefixed APIs for product/order/content CRUD; uploads validated client-side before send.

## Infra & CI/CD

- **Local dev**: `docker compose up --build` runs Postgres, backend, and frontend with hot reload (once Dockerfiles exist).
- **Environment parity**: `.env.example` files document required settings for each service.
- **CI (existing)**: GitHub Actions run backend lint/tests/type-check and frontend lint/tests/build.
- **CI (planned)**: deployment/release workflow to build/push containers and publish artifacts once runtime code lands.

## Observability & security (planned)

- Structured JSON logs with request IDs for traceability.
- Basic metrics (request latency/error rate) via ASGI middleware; health/readiness endpoints for Kubernetes/compose.
- Input validation via Pydantic schemas; strict CORS for production origins; rate limiting on auth-sensitive routes; upload validation to prevent malicious files.
