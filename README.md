# momentstudio

A modern e‑commerce site for showcasing and selling handmade / artisanal products (ceramics, decor, textiles, etc.).

Customers can browse beautifully photographed pieces, add items to their cart, create an account, and check out securely. Shop owners get an admin dashboard to manage products, photos, categories, inventory, and orders without touching code.

---

## 1. Goals

- **Showcase handmade products** with high‑quality imagery, clear categories, and small‑batch drops.
- **Make buying dead simple**: pick items → cart → checkout → pay → confirmation email.
- **Give the maker control** via an admin dashboard for products, photos, stock, and content.
- **Use a stack that’s easy to extend** and friendly to small teams.

---

## 2. Tech Stack

You can swap pieces later, but the initial design assumes:

### Frontend

- **Framework**: Angular 18 (standalone components)
- **UI**: Tailwind CSS + a small component library (or Angular Material if preferred)
- **State management**: Angular signals / services, plus localStorage for guest carts
- **HTTP**: Angular `HttpClient` talking to the FastAPI backend
- **Routing**: Angular Router (lazy‑loaded feature routes)

### Backend

- **Language / Framework**: Python 3.11+ with FastAPI
- **Database**: PostgreSQL
- **ORM & migrations**: SQLAlchemy + Alembic
- **Auth**: JWT (access + refresh) stored in HTTP‑only cookies
- **Background tasks**: FastAPI background tasks initially, optional Celery/RQ later

### Payments & Email

- **Payments**: Stripe (test mode for local dev)
- **Email**: SMTP (Gmail app password / Brevo / Mailgun) via a simple email service wrapper

### DevOps / Tooling

- **Containers**: Docker & docker-compose for local stack
- **CI**: GitHub Actions (backend tests, frontend tests, lint, type-check)
- **Lint / Format**:
  - Backend: `black`, `isort`, `ruff`, `mypy`
  - Frontend: ESLint, Prettier, Angular strict TypeScript

## 3.1 Data portability & backups (how to move/restore)

- Export all data (users, categories, products with images/options/variants/tags, addresses, orders) to JSON:

  ```bash
  cd backend
  python -m app.cli export-data --output export.json
  ```

- Import JSON into a fresh database (idempotent upserts):

  ```bash
  cd backend
  DATABASE_URL=postgresql+asyncpg://... python -m app.cli import-data --input export.json
  ```

- Full backup helper (Postgres dump + JSON + uploads):

  ```bash
  cd infra/backup
  ./export_all.sh  # requires DATABASE_URL env and pg_dump installed
  ```

- Verify a backup can restore:

  ```bash
  ./infra/backup/check_backup.sh backups/backup-YYYYMMDD-HHMMSS.tar.gz
  ```

- Move to a new server (one-command outline):
  1) Copy the `backups/backup-*.tar.gz` archive + `uploads/` directory (if outside the archive).
  2) On the new host: install Docker or Postgres + Python deps; set `DATABASE_URL`.
  3) Restore DB via `pg_restore` from the `.dump` in the archive.
  4) Restore media by extracting `uploads/`.
  5) Run `alembic upgrade head` to sync schema.
  6) Run `python -m app.cli import-data --input export-*.json` to upsert JSON entities.
  7) Start the app and hit `/api/v1/health`.

- Schedule backups (example cron, daily at 3:00):

  ```
  0 3 * * * cd /opt/momentstudio/infra/backup && DATABASE_URL=... ./export_all.sh >> /var/log/momentstudio-backup.log 2>&1
  ```

## 3.2 Running locally vs. prod-like

- **Local-only dev (quick start)**:  
  - Use SQLite by setting `DATABASE_URL=sqlite+aiosqlite:///./local.db` in `backend/.env` (already handled by pydantic settings).  
  - Media goes to the local `uploads/` directory; no S3 keys required.  
  - Use Stripe test keys (`STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`) and the built-in email console logger (no SMTP).  
  - Start both (recommended): `make dev` (or `./start.sh` / `start.bat`).  
  - Backend only: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`.  
  - Frontend only: `cd frontend && npm ci && npm start` (uses `frontend/.env` / `.env.example`; keep `API_BASE_URL=/api/v1` when using the dev proxy).

- **Prod-like mode**:  
  - Set `DATABASE_URL` to Postgres (`postgresql+asyncpg://...`).  
  - Configure S3-compatible storage in `backend/.env` (bucket, region, access keys) and point `MEDIA_ROOT` to the mounted volume or S3 base path.  
  - SMTP settings (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) for real email delivery.  
  - Optional: configure Sentry (`SENTRY_DSN` in `backend/.env` and `frontend/.env`) for error reporting.  
  - Stripe live keys in `.env` (and webhook secret) plus HTTPS/TLS in the reverse proxy.  
  - Run migrations: `cd backend && alembic upgrade head`.  
  - Build frontend: `cd frontend && npm install && npm run build` and serve the `dist/` output via your web server or CDN.

---

## 3.3 Currency policy (RON-only)

- **Single currency**: all product prices and order totals are stored and processed in Romanian Leu (**RON**).
- **Checkout**: Stripe PaymentIntents are created in **RON**; there is no multi-currency checkout.
- **Display-only conversions**: when browsing in English, the UI may show an approximate **EUR** and **USD** value in parentheses for convenience. Rates are fetched from BNR via `/api/v1/fx/rates` and cached server-side (with optional admin override/fallback).
- **Admin/import**: products and coupons must use **RON**. The API rejects other currencies.

## 3.4 Operational notifications (owner inbox)

- **Owner role**: the app has a unique `owner` role (admin-equivalent) that receives operational notifications.
- **Routing**: if an owner exists, notifications are sent to `owner.email`; otherwise they fall back to `ADMIN_ALERT_EMAIL`.
- **Covers**: new order alerts, low stock alerts, refund requests, and Stripe dispute webhooks (plus any future support/contact flows).

Bootstrap/transfer the owner account:

```bash
cd backend
python -m app.cli bootstrap-owner --email owner@example.com --password 'ChangeMe123' --username owner --display-name 'Owner'
```

## 3. Features Overview

### Customer‑Facing

- Public storefront with:
  - Hero section featuring current collection / drop
  - Category navigation (e.g., Bowls, Cups & Mugs, Plates, Homeware, Teaware, Gift cards)
  - Product grids with price, availability, and quick “Add to cart”
- Product detail pages:
  - Multiple photos
  - Variant options (color, size) where relevant
  - Stock indicator (“In stock”, “Sold out”)
  - Short story / description for each piece
- Browsing enhancements:
  - Search bar (by product name)
  - Filters (category, price range, color/tag)
  - Sorting (price, newest)
- Cart & checkout:
  - Guest cart (no login required)
  - Login / sign‑up for account‑linked orders
  - Order summary, shipping address, payment via Stripe
  - Confirmation page + confirmation email
- Customer account:
  - Order history and order details
  - Saved addresses
  - Profile (name, email, password change)

### Admin Dashboard

- Login as admin / shop staff
- Product management:
  - Create / edit / archive products
  - Upload multiple images per product; set primary image and ordering
  - Manage categories and tags
  - Manage variants (e.g., color options) and stock levels
- Order management:
  - View all orders
  - Filter by status (Pending, Paid, Shipped, Delivered, Cancelled)
  - Update status and add tracking information
- Content management:
  - Edit homepage hero sections and featured collections
  - Edit “About”, “FAQ”, “Shipping & returns”, “Care instructions” pages
- User management:
  - List customers
  - Promote/demote admin users

---

## 4. Domain Model (Initial)

### User

- `id` (UUID)
- `email` (unique)
- `hashed_password`
- `name`
- `role` (enum: `customer`, `admin`)
- `created_at`, `updated_at`

### Product

- `id` (UUID)
- `slug`
- `name`
- `short_description`
- `long_description`
- `category_id`
- `base_price` (decimal)
- `currency` (always `"RON"`)
- `is_active` (bool)
- `is_featured` (bool)
- `stock_quantity` (int)
- `labels` (json/text for badges like `["new", "free_shipping"]`)
- `created_at`, `updated_at`

### ProductImage

- `id`
- `product_id`
- `url`
- `alt_text`
- `sort_order` (int)

### Category

- `id`
- `slug`
- `name`
- `description`
- `parent_id` (nullable for nested categories)

### ProductVariant (optional, for multi‑color/size items)

- `id`
- `product_id`
- `name` (e.g., “Ivory”, “Haar”, “Tamba”)
- `additional_price_delta`
- `stock_quantity`

### Cart + CartItem

- `Cart`:
  - `id`
  - `user_id` (nullable for guest carts)
  - `session_id` (for anonymous cart tracking)
  - `created_at`, `updated_at`
- `CartItem`:
  - `id`
  - `cart_id`
  - `product_id`
  - `variant_id` (nullable)
  - `quantity`
  - `unit_price_at_add`

### Order + OrderItem

- `Order`:
  - `id`
  - `user_id`
  - `status` (Pending, PaymentPending, Paid, Shipped, Delivered, Cancelled)
  - `total_amount`
  - `currency` (always `"RON"`)
  - `stripe_payment_intent_id`
  - `shipping_address_id`
  - `billing_address_id`
  - `created_at`, `updated_at`
- `OrderItem`:
  - `id`
  - `order_id`
  - `product_id`
  - `variant_id` (nullable)
  - `quantity`
  - `unit_price`
  - `subtotal`

### Address

- `id`
- `user_id`
- `label` (e.g., “Home”, “Studio”)
- `line1`, `line2`
- `city`, `region`, `postal_code`, `country`
- `is_default_shipping`, `is_default_billing`

### CMS ContentBlock (simple CMS)

- `id`
- `key` (e.g., `home.hero`, `page.about`, `page.faq`)
- `title`
- `body_markdown`
- `updated_at`

---

## 5. Project Structure

```text
ateliercraft/
  README.md
  backend/
    app/
      api/
        v1/
          auth.py
          users.py
          products.py
          carts.py
          orders.py
          content.py
          admin/
            products_admin.py
            orders_admin.py
            users_admin.py
      core/
        config.py
        security.py
        dependencies.py
      models/
      schemas/
      services/
        email_service.py
        payment_service.py
        image_storage.py
      main.py
    alembic/
      env.py
      versions/
    tests/
  frontend/
    src/
      app/
        core/
        shared/
        auth/
        catalog/
        product-detail/
        cart/
        checkout/
        account/
        admin/
          dashboard/
          products/
          orders/
          content/
      assets/
    angular.json
    package.json
  infra/
    docker-compose.yml
    nginx.conf (optional)

## 6. Local Development

### Prerequisites

- Python 3.11+
- Node.js 20 LTS
- Docker & docker‑compose
- PostgreSQL (or use the Docker service)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env            # or .topsecret -> .env pattern
# edit DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*

alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Backend available at: http://localhost:8000
- Docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
cp .env.example .env            # or .env.local if you prefer
# set API_BASE_URL, STRIPE_PUBLISHABLE_KEY, etc.

npm start
```

- Frontend available at: http://localhost:4200

### Docker (optional, all‑in‑one)

```bash
cd infra
docker compose up --build
```

### Caching & CDN (guidance)

- **Catalog** (`GET /api/v1/catalog/*`): public responses can be cached (short TTL) and/or served with ETags for CDN efficiency.
- **Media** (`/media/*`): assets are stored with unique filenames (UUID-based), so they’re safe to cache with a long TTL (e.g. `Cache-Control: public, max-age=31536000, immutable`) when served via a CDN/reverse proxy.
