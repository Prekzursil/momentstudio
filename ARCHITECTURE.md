# Architecture Overview

AdrianaArt is a monorepo with a FastAPI backend, Angular frontend, and lightweight infra for local and CI environments. The stack favors clear boundaries between HTTP/API, domain logic, persistence, and presentation.

## Monorepo layout

- `backend/`: FastAPI app, domain models, services, migrations, tests.
- `frontend/`: Angular 18 storefront and admin UI with shared design tokens and components.
- `infra/`: Docker Compose for local stack (Postgres, backend, frontend) and future deployment tooling.

## Backend (FastAPI + PostgreSQL)

- Entrypoint: `app.main:app` will mount a versioned `/api/v1` router.
- Configuration: `pydantic-settings` reads environment variables like `DATABASE_URL`, `SECRET_KEY`, `STRIPE_SECRET_KEY`, `SMTP_*`, `FRONTEND_ORIGIN`.
- Persistence: SQLAlchemy engine/session factory; Alembic migrations track schema.
- Auth:
  - Users stored with salted password hashes.
  - JWT access and refresh tokens, issued at login/refresh and stored in HTTP-only cookies.
  - Dependency-based guards for authenticated and role-gated routes (for admin).
- Domain slices:
  - Catalog: categories, products, product images/variants; search and pagination filters.
  - Cart and checkout: carts keyed by user or guest session; merges guest cart on login; stock validated on write.
  - Orders and payments: order builder captures price snapshots; Stripe PaymentIntent for payments; webhooks reconcile status.
  - Content: editable content blocks for hero/about/faq/shipping/care.
  - Email: SMTP-backed service for transactional emails (order confirmation, password reset).
- Cross-cutting: structured logging with request IDs, CORS config, rate limiting on auth endpoints, upload validation for file type and size.
- Testing: pytest suite with factory helpers and integration tests against a temporary Postgres (for example, via testcontainers).

### Backend request and data flow (checkout example)

1. Frontend sends cart and address to `POST /api/v1/checkout` (or an order builder endpoint).
2. FastAPI handler loads user or guest session, validates stock, builds an order snapshot, and creates a Stripe PaymentIntent.
3. Client secret returned to frontend; frontend confirms payment with Stripe JS.
4. Stripe webhook hits `/api/v1/webhooks/stripe`, signature verified, order status updated.
5. Background task (or immediate call) triggers order confirmation email.

## Frontend (Angular 18 + Tailwind)

- Shell: app component provides layout, header/footer, and responsive navigation.
- Routing: lazy-loaded feature routes for catalog, product detail, cart/checkout, auth/account, and admin.
- State and data:
  - Services using `HttpClient` for API calls; interceptors for auth cookies, loading, and error handling.
  - Signals or observables for client state (cart, session, feature flags).
  - LocalStorage used to persist guest carts or session IDs and merge with server carts after login.
- UI:
  - Shared primitives (button, input, card, modal, toast) with Tailwind design tokens.
  - Storefront components for hero, featured grid, product cards/detail, filters, and search.
  - Admin area with guarded routes and tables/forms for products, orders, content, and users.
- Error handling: global error boundary or route guard surfaces toasts, friendly fallback pages, and retries where safe.

### Frontend to backend flows

- Browsing: `/products` with pagination and filter params; product detail fetched by slug; images served from backend or S3-compatible storage.
- Cart: guest cart stored locally and synced via `/cart`; server validates stock on add, update, and delete.
- Auth: login/register/reset forms call auth endpoints; refresh handled via interceptor; logout clears cookies and local state.
- Admin: guarded routes call admin-prefixed APIs for product, order, and content CRUD; uploads validated client-side before send.

## Infra and CI/CD

- Local dev: `docker compose up --build` runs Postgres, backend, and frontend with hot reload once Dockerfiles exist.
- Environment parity: `.env.example` files document required settings for each service.
- CI (present): GitHub Actions run backend lint/tests/type-check and frontend lint/tests/build.
- CI (planned): deployment and release workflow to build and push containers once runtime code lands.

## Observability and security (planned)

- Structured JSON logs with request IDs for traceability.
- Basic metrics such as request latency and error rate via ASGI middleware; health and readiness endpoints for Compose or Kubernetes.
- Input validation via Pydantic schemas; strict CORS for production origins; rate limiting on auth-sensitive routes; upload validation to prevent malicious files.
