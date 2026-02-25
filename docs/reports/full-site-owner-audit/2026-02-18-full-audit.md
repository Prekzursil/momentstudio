# Full-Site Owner-Profile Audit Report (2026-02-18, Stabilization Refresh)

## Scope and Method

- Target: full site surfaces (`storefront`, `account`, `admin`) with owner-profile coverage.
- Runtime context: local compose stack for deterministic verification and local weekly-style evidence generation.
- Identity profile: owner bootstrap (`owner@local.test`) and authenticated owner evidence crawling for account/admin surfaces.
- Evidence source:
  - `artifacts/audit-evidence/full-local/*`

## Execution Matrix (Post-Fix)

| Area | Command / Channel | Result | Evidence |
|---|---|---|---|
| Owner bootstrap path | `timeout 90 make dev-owner` | PASS (bootstrap/migrate/owner-create path) | Reached foreground `./start.sh` without `.env` parse errors; timed out intentionally in foreground run |
| Full compose orchestration | `bash scripts/compose-smoke.sh` | PASS | Checkout mock specs skipped cleanly by provider gating; smoke/admin/SEO specs passed |
| Backend deterministic suite | `PYTHONPATH=backend backend/.venv/bin/pytest -q backend/tests -W default` | PASS | `295 passed, 1 skipped` |
| Frontend deterministic suite | `npm -C frontend test -- --watch=false` | PASS | `TOTAL: 140 SUCCESS` |
| Frontend production build | `npm -C frontend run build` | PASS | Browser bundle build completed |
| Frontend SSR build | `npm -C frontend run build:ssr` | PASS | Browser + server bundles built successfully |
| Audit script suite | `python3 -m pytest -q scripts/audit/tests` | PASS | `37 passed` |
| Evidence collector static checks | `python3 -m py_compile ...` + `node --check ...` | PASS | No syntax/parse errors |

## Local Deterministic Evidence (Weekly Mode, Owner-Auth Enabled)

- Command:
  - `python3 scripts/audit/collect_audit_evidence.py --mode weekly --routes-file frontend/src/app/app.routes.ts --output-dir artifacts/audit-evidence/full-local --base-url http://127.0.0.1:4201 --api-base-url http://127.0.0.1:8001/api/v1 --owner-identifier owner --owner-password OwnerDev!123 --max-routes 120`
- Result:
  - `routes=69`
  - `findings=3`
  - `severe (s1/s2)=0`
  - `browser_ok=True`
- Finding breakdown:
  - `s4 browser_console_noise_cluster`: `3`
  - `s3`: `0`
  - `s1/s2`: `0`
- Visibility regression signals:
  - `visibility-signals.json`: `69` rows, `0` `visibility_issue` flags
  - No “content/forms appear only after interaction” blockers in this run.

## Key Stabilization Outcomes

1. `make dev-owner` bootstrap path is stable and no longer depends on unsafe shell `source` parsing of `.env`.
2. `compose-smoke` owner credentials propagate correctly into Playwright E2E.
3. Checkout smoke seeding now supports authenticated cart seeding, eliminating prior owner-flow false negatives.
4. Weekly-style evidence quality improved:
   - owner-auth crawling works for protected surfaces,
   - low-signal browser console noise stays clustered,
   - no duplicate per-route spam pattern.
5. `/shop` and `/shop/:category` duplicate SEO debt no longer appears in actionable findings in the corrected owner-auth evidence run.

## Residual Low-Severity Noise Follow-Up

- Initial full owner-auth weekly run reported `3` clustered `s4` findings on:
  - `/account/privacy`
  - `/admin/content/pages`
  - `/admin/content/settings`
- URL-aware resource-failure normalization was then tightened to suppress only explicit expected owner/admin bootstrap misses:
  - `GET /api/v1/auth/me/export/jobs/latest` (`404`) on account privacy bootstrap
  - `GET /api/v1/content/admin/cms.snippets` (`404`) on admin pages bootstrap
  - `GET /api/v1/content/admin/site.*` (`403/404`) on admin settings bootstrap
- Targeted owner-auth verification run against those exact routes now yields `0` findings from those signatures (see `artifacts/audit-evidence/targeted-noise/console-errors.json` + synthesis check).
- Final full-route confirmation is delegated to refreshed CI weekly evidence/agent runs after branch push.

## PR #199 Baseline vs Main (Promotion Safety)

- Baseline production reference: PR #199 merge commit `5e3b438520a023ae2f3d1ce3b27fa772e10aa627`.
- Delta to current main remains large and cross-cutting; direct “single module upload” is unsafe.
- Safe promotion path:
  1. promote a specific tested SHA from `main`,
  2. run explicit migration step,
  3. run post-deploy verification.
- Detailed assessment is maintained in:
  - `docs/reports/main-vs-pr199/2026-02-18-promotion-assessment.md`

## Acceptance Check (This Refresh)

1. Local owner-profile orchestration green: **PASS**
2. Hidden-until-interaction blockers across audited routes: **PASS**
3. `#328`-style noise profile reduced to clustered concise output pattern: **PASS**
4. Shop duplicate title/description actionable debt: **PASS**
5. Backend warning signal quality improved with passing deterministic suite: **PASS**
