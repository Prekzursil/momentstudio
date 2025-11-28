7. TODO / Roadmap

Below is a comprehensive checklist (50+ items). You can turn each into issues or Jira tickets.

7.1 Project & Infra

 Initialize monorepo with backend/, frontend/, infra/ directories.

 Create docker-compose.yml with services for api, frontend, and postgres.

 Add .env.example for backend with placeholders for DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*, FRONTEND_ORIGIN.

 Add .env.example for frontend with API_BASE_URL, STRIPE_PUBLISHABLE_KEY, APP_ENV.

 Set up .gitignore for Python, Node, environment files, and build artifacts.

 Configure GitHub Actions workflow for backend (lint + tests + type‑checks).

 Configure GitHub Actions workflow for frontend (lint + tests + build).

 Add CONTRIBUTING.md describing branching strategy, commit style, and how to run the stack.

 Add ARCHITECTURE.md describing high‑level design, modules, and data flow.

7.2 Backend – Core & Auth

 Scaffold FastAPI application with a main.py and versioned router (/api/v1).

 Implement Settings class using pydantic-settings for configuration.

 Configure SQLAlchemy engine and session management with PostgreSQL.

 Create User model and Alembic migration.

 Implement password hashing & verification (e.g., using passlib).

 Implement registration endpoint (POST /auth/register).

 Implement login endpoint (POST /auth/login) returning access + refresh tokens.

 Implement refresh endpoint (POST /auth/refresh) to rotate tokens.

 Implement logout endpoint (clear cookies).

 Protect authenticated routes with dependency that validates JWT and loads User.

 Implement role‑based guard for admin endpoints (requires role == admin).

 Add tests for auth flows (register, login, refresh, invalid credentials).

7.3 Backend – Catalog & Products

 Create Category model + Alembic migration.

 Create Product model + migration.

 Create ProductImage model + migration.

 (Optional) Create ProductVariant model + migration for color/size variants.

 Implement GET /categories endpoint for public catalog filters.

 Implement GET /products endpoint with pagination, category filter, search by name, and price range filter.

 Implement GET /products/{slug} endpoint for product detail.

 Implement admin endpoints for POST /admin/products (create) and PUT /admin/products/{id} (update).

 Implement DELETE /admin/products/{id} as soft delete (mark inactive instead of hard delete).

 Implement admin endpoints for product image upload and deletion.

 Add service layer for image storage (local filesystem first, S3‑compatible later).

 Seed database with a few example products and categories for dev/demo.

7.4 Backend – Cart & Checkout

 Create Cart and CartItem models + migrations.

 Implement guest cart support with session_id passed via cookie or header.

 Implement GET /cart to fetch current cart (guest or user).

 Implement POST /cart/items to add items (with product + variant + quantity).

 Implement PATCH /cart/items/{id} to update quantity.

 Implement DELETE /cart/items/{id} to remove an item.

 Add stock validation in cart endpoints (prevent exceeding available stock).

 Add logic to merge guest cart into user cart on login.

7.5 Backend – Orders, Payment, Addresses

 Create Address model + migration.

 Implement CRUD endpoints for user addresses (/me/addresses).

 Create Order and OrderItem models + migrations.

 Implement service to build an order from a cart (including price snapshot).

 Integrate Stripe:

 Create PaymentIntent when user confirms checkout.

 Return client secret to frontend.

 Implement Stripe webhook endpoint to handle payment_intent.succeeded and payment_intent.payment_failed.

 Update order status based on payment events.

 Implement GET /me/orders and GET /me/orders/{id} for order history.

 Implement admin endpoints for listing and filtering orders by status.

 Implement admin endpoint to update order status and tracking info.

7.6 Backend – CMS & Content

 Create ContentBlock model + migration for static pages.

 Seed default blocks for:

 Homepage hero.

 About page.

 FAQ.

 Shipping & returns.

 Care instructions.

 Implement GET /content/{key} endpoint for public content retrieval.

 Implement admin endpoints for editing content blocks.

 Add validation for markdown/HTML to avoid unsafe content.

7.7 Backend – Email & Notifications

 Implement EmailSettings configuration (SMTP host, port, username, password, sender).

 Implement generic EmailService with plain‑text and HTML support.

 Implement order confirmation email template and sending logic after payment success.

 Implement password reset email with one‑time token.

 Implement simple logging and error handling around email sending.

 Add background task for sending emails so HTTP responses are not blocked.

7.8 Backend – Security, Observability, Testing

 Add CORS configuration for dev and production origins.

 Add rate limiting for login, registration, and password reset endpoints.

 Validate file types and sizes for image uploads.

 Add structured logging (JSON logs) with request ID.

 Add health check endpoints (/health, /readiness) used by Docker/infra.

 Add pytest suite for services (auth, catalog, cart, checkout).

 Add integration tests with a temporary PostgreSQL (or test DB) and real API calls.

 Add mypy type‑checking and fix major type issues.

7.9 Frontend – Shell & Shared

 Scaffold Angular app with routing and strict TypeScript enabled.

 Set up Tailwind CSS and base design tokens (colors, spacing, typography).

 Implement main layout with header, footer, and responsive navigation.

 Add shared components: button, input, card, modal, toast/notification.

 Implement global error handling and an error boundary/route.

 Implement an API service layer for calling backend endpoints (with interceptors for auth tokens).

7.10 Frontend – Storefront

 Implement homepage hero section with current collection and “Shop now” CTA.

 Implement “Featured products” grid on homepage.

 Implement category listing page with product grid and pagination.

 Add filter sidebar: category, price range, tags.

 Add search bar that hits /products?search=....

 Implement product card component with image, name, price, and stock badge.

 Implement product detail page:

 Image gallery (thumbnails / carousel).

 Variant selector (color/size).

 Quantity selector and “Add to cart” button.

 Short note about handmade nature and uniqueness of each piece.

7.11 Frontend – Cart & Checkout

 Implement cart drawer or page with list of cart items, quantities, and totals.

 Add ability to update quantity and remove items from cart.

 Show stock error messages if user tries to exceed available stock.

 Implement checkout stepper:

 Step 1: Sign in or continue as guest.

 Step 2: Shipping address form.

 Step 3: Payment (Stripe card element).

 Display order summary throughout checkout (items, shipping, total).

 Implement success page with order summary and “continue shopping” link.

7.12 Frontend – Auth & Account

 Implement login page with email/password form and error feedback.

 Implement registration page with simple validation and success flow.

 Implement password reset request page and reset form.

 Implement account dashboard:

 Display profile info and allow name/email update.

 Address book with add/edit/delete.

 Order history table with links to order details.

 Implement order detail page in account area.

7.13 Frontend – Admin Dashboard

 Create /admin layout with sidebar navigation.

 Implement admin login guard and role‑based route protection.

 Implement product list table with sorting and searching.

 Implement product create/edit form:

 Name, slug (auto‑generated), category, price, stock.

 Description (rich text or markdown).

 Image upload, preview, and reordering.

 Variant editor (add/remove color/size options).

 Implement admin orders list with filters by status and date.

 Implement admin order detail view with ability to change status and add tracking link.

 Implement content editor for homepage hero and static pages (About, FAQ).

 Implement basic user list page for admins (view customers, promote/demote admins).

7.14 UX, Performance, SEO & Accessibility

 Implement mobile‑first responsive design for all key pages.

 Add loading skeletons/spinners for product lists and detail pages.

 Add toast notifications for key actions (add to cart, save product, status updates).

 Integrate image optimization (e.g., srcset, modern formats, lazy loading).

 Add SEO meta tags (title, description) per page.

 Add Open Graph meta tags for sharing product pages.

 Generate sitemap.xml and robots.txt.

 Run Lighthouse performance + accessibility audits and fix major issues.

 Ensure keyboard navigation works across menus, forms, modals.

 Ensure sufficient color contrast and accessible form labels.
