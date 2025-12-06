# Frontend

Angular 18 storefront/admin UI. Configure API endpoint and Stripe keys via `.env.example`.

Quick start (placeholder):
```bash
npm install
cp .env.example .env
npm start
```

Stripe:
- Set your publishable key in `index.html` as `<meta name="stripe-publishable-key" content="pk_test_xxx" />`.
- Backend must have `STRIPE_SECRET_KEY` (and webhook secret if used) configured.

Performance & bundle budget:
- Angular budgets are configured in `angular.json`; keep main bundle < 600 kB transfer. Use lazy loading for heavy routes and `ngOptimizedImage` + `loading=\"lazy\"` where possible.
- Prefer `npm run build --configuration production` for CI; this enables minification, output hashing, and ESBuild optimizations.
- Assets are compressed at the hosting layer; ensure gzip/brotli are enabled in your deploy target.
- Prefetch critical data via route resolvers (e.g., shop categories) to improve first meaningful paint.

Compression/caching guidance:
- Serve `dist/` with long-lived cache headers for JS/CSS (with hash) and shorter cache for HTML.
- Turn on brotli/gzip in your reverse proxy/CDN. Avoid shipping source maps to production.
