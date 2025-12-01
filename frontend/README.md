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
