# PR #199 Baseline vs Current `main` Promotion Assessment (2026-02-18)

## Baseline and target

- Production baseline PR: `#199`
- Baseline commit: `5e3b438520a023ae2f3d1ce3b27fa772e10aa627` (2026-02-13)
- Current main commit: `8c3dc4757cfa64cb690197cb351f25b75b01c12a` (2026-02-18)

## Delta size

- Commits ahead: `128`
- Files changed: `252`
- Diff volume: `+38,026 / -5,817`

## Impacted domains

The delta includes coordinated changes across:

- frontend runtime/SSR and SEO behavior,
- backend API/services/migrations,
- audit automation and issue lifecycle workflows,
- observability (Sentry/Percy/Applitools/Clarity) and CI orchestration,
- production infra and runbooks.

## Promotion conclusion

A one-off “single module upload” is **not safe** for this baseline gap.

Reason:

- current `main` is a cross-cutting system update, not an isolated patch,
- DB/schema + SSR + workflow behavior changed together,
- partial file-copy deployment risks runtime/config drift and schema mismatch.

## Safe promotion path from `main`

Use controlled, SHA-based deploy on VPS:

1. Trigger `.github/workflows/deploy-production-manual.yml`.
2. Choose target SHA (default latest `origin/main`).
3. Keep `run_backup=true` and `run_verify=true` for normal release.
4. Workflow performs:
   - git checkout to exact SHA,
   - optional backup,
   - `docker compose up -d --build`,
   - explicit `alembic upgrade head`,
   - `infra/prod/verify-live.sh`.
5. If rollback needed, rerun same workflow with previous known-good SHA.

## Minimum pre-promote checks

- `Backend CI` green
- `Frontend CI` green
- `Docker Compose Smoke` green
- `Audit Weekly Evidence` + `Audit Weekly Agent` healthy (no severe unresolved regressions)

## Operational note

`infra/prod/docker-compose.yml` keeps `RUN_DB_MIGRATIONS="0"` for runtime startup safety,
and migrations are intentionally executed explicitly during deploy (`deploy.sh` / manual deploy workflow).
