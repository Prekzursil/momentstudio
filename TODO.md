# Project Backlog

This file tracks **open work**. The previous “full roadmap” (now completed) is archived in `docs/TODO-archive.md`.

## High priority
- [ ] Docs: add a production deployment guide (reverse proxy, env vars, migrations, backups, first-owner bootstrap).
- [ ] DX: update `.pre-commit-config.yaml` to match the current toolchain (ESLint v9 flat config, remove deprecated hooks).
- [ ] Infra: add a local helper to run the CI Docker smoke flow (same steps as `compose-smoke`).
- [ ] Security: require admin 2FA toggle + recovery codes; document recommended default for production.
- [ ] Observability: add an ops “health dashboard” view in admin (surface uptime, recent errors, backpressure signals).

## Medium priority
- [ ] CMS: add “diff preview” before publishing (draft vs published) for pages/blog/global sections.
- [ ] CMS: add bulk tools for redirects (import/export, detect loops, dry-run preview).
- [ ] Orders: add batch print/export center (packing slips, invoices, labels) with retention.
- [ ] Catalog: add variant matrix editor (bulk update price/stock across options) for faster inventory updates.
- [ ] UX: run an accessibility pass (keyboard nav, focus states, contrast) and fix any critical issues.

## Low priority
- [ ] Storefront: add product share controls (copy link / share sheet) on product pages.
- [ ] Storefront: add optional PWA install prompt + offline fallback page.
- [ ] Admin: add keyboard shortcuts for common actions (search, save, next/prev).
- [ ] Blog: add editorial workflow states (draft/review/published) with author attribution.
- [ ] Analytics: add lightweight funnel metrics (sessions → carts → checkouts → orders) with opt-in tracking.
