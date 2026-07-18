# P1a theme deploy gate

The pre-deploy quality gate for the P1a theme foundation. Six **fail-loud**
sub-gates prove the theme system is safe to ship; a single run surfaces every
breach and exits non-zero if any sub-gate fails.

| # | Sub-gate | Entrypoint | Invariant |
|---|----------|-----------|-----------|
| 1 | migration consistency | `theme_migration_consistency.py` | `0159` is the single head, applies cleanly on a fresh DB, and models produce **no autogenerate diff** |
| 2 | migration reversibility | `theme_migration_reversibility.py` | `0159` `upgrade()`→`downgrade()`→`upgrade()` round-trips cleanly — the theme tables **drop** on downgrade and **re-create** on re-upgrade (rollback safety, plan B3) |
| 3 | security lane | `../quality/theme_security_lane.sh` (WU13) | the adversarial sink/authz regression suite (`backend/tests/security`) actually runs and passes |
| 4 | themed-render smoke | `theme_render_smoke.py` | the default theme renders a **complete, injection-safe** `<style>` injected into `<head>`, and the **report-only CSP** `style-src 'sha256-…'` hash-pins that block (R4-B6 cond. b) |
| 5 | post-deploy smoke | `theme_post_deploy_smoke.py` | real HTTP `GET /theme` → **200** (complete token payload) **and** `GET /content/home.sections` → **200** (plan §9 post-deploy smoke) |
| 6 | cache posture | `theme_cache_posture.py` | **no themeable route is served from a full-page cache carrying a baked theme blob** — the theme stays request-time (R3-B1) |

Orchestrator: **`p1a_theme_gate.sh`** runs all six (does not short-circuit) and
prints one `SUCCESS:` marker per sub-gate plus a final `SUCCESS: p1a-theme-gate`.

## Run locally

```bash
# whole gate (uses ~/ms-be-venv, or set PYTHON=/path/to/python)
bash scripts/deploy/p1a_theme_gate.sh

# individual sub-gates
python scripts/deploy/theme_migration_consistency.py
python scripts/deploy/theme_migration_reversibility.py
bash   scripts/quality/theme_security_lane.sh
python scripts/deploy/theme_render_smoke.py
python scripts/deploy/theme_post_deploy_smoke.py
python scripts/deploy/theme_cache_posture.py

# gate self-tests — STRICT 100% line+branch on the gate modules
coverage run --rcfile=scripts/deploy/.coveragerc -m pytest scripts/deploy/tests
coverage report --rcfile=scripts/deploy/.coveragerc --fail-under=100
```

## How each sub-gate FAILS LOUD

Each check raises a `GateFailure` with a diagnostic message, the CLI prints
`FAILED:<id>` to **stderr** and exits **1**, and the orchestrator/CI job goes red.

**1. Migration consistency** (`theme_migration_consistency.py`)
- **Two heads / wrong head** → `check_single_head` fails: un-merged migration
  branches shipped, or `0159` is no longer the tip.
- **Migration does not apply** → `verify_tables_present` fails: a theme table is
  missing after `upgrade()`.
- **Seed missing / wrong** → `verify_default_seed` fails: no singleton *published*
  v1 default row (a fresh deploy would render unstyled).
- **Model changed without a migration** → `check_models_match_migration` fails:
  `compare_metadata` (scoped to the theme tables) returns a non-empty diff. Add a
  `Theme.new_col` to the model without touching `0159` and this gate goes red with
  the exact `add_column` op printed.

  *Dialect note.* The check runs on in-memory SQLite (the repo's DB-test
  convention) and compares the migrated schema against `Base.metadata` on the
  **same dialect**, so it is free of cross-dialect (UUID-vs-VARCHAR) false
  positives. `compare_type=False` is deliberate — the migration intentionally
  renders `postgresql.UUID` as `sa.String` on non-Postgres backends. See the
  *Postgres complement* below for the full-schema autogenerate check.

**2. Migration reversibility** (`theme_migration_reversibility.py`)
- Runs the real `0159` `upgrade()` → `downgrade()` → `upgrade()` in-process on a
  fresh SQLite DB (the `alembic upgrade head && downgrade -1` reversibility
  assertion, delivered as the self-contained 0159 round-trip variant per plan B3).
- **Upgrade did not create/seed** → `check_upgraded` fails.
- **Downgrade left a table behind** → `check_downgraded` fails: `0159` is not
  reversible; a bad theme release could not be rolled back cleanly (delete the
  `op.drop_table("themes")` line from the migration's `downgrade()` and this gate
  goes red).
- **Round-trip not repeatable** → the second `upgrade()` fails (a leftover table
  or un-dropped `themestatus` enum makes the re-create collide).

**3. Security lane** (`theme_security_lane.sh`)
- Any regression in the WU13 sink revalidator or theme authz (the 6-bypass saga)
  makes `pytest backend/tests/security` fail → the sub-gate fails.

**4. Themed-render smoke** (`theme_render_smoke.py`)
- **Incomplete render** → `check_render_complete` fails: a primary or derived
  token is missing/empty (a fresh deploy would render partially unstyled).
- **Unsafe value** → `check_values_injection_safe` fails: a rendered value would
  break out of the `<style>` block (checked with the real WU2 `encode_css_safe`).
- **Malformed / mis-injected `<style>`** → `check_style_tag_wellformed` /
  `check_injected_into_head` fail.
- **Report-only CSP missing / mismatched** → `check_report_only_csp` fails: the
  themed response's `Content-Security-Policy-Report-Only` must carry a `style-src
  'sha256-<hash>'` matching the injected `:root{…}` block, plus the zero-cost
  hardening directives (R4-B6 condition (b)).

  *CSP-hash mirror.* The authoritative hash is computed in the WU6 TS sink
  (`frontend/src/server/theme-head.ts`: base64 SHA-256 of the sorted `:root{…}`
  body via `crypto.subtle` + `btoa`). Recomputing it needs a Node/TS runtime this
  Python-only deploy lane does not have, so the smoke **mirrors** that algorithm in
  `sha256_base64` / `build_csp_report_only` and guards the mirror two ways: it
  asserts internal consistency (header hash == fresh hash of the block it injects)
  **and** `assert_ts_sink_parity` reads `theme-head.ts` and FAILS LOUD if the TS
  sink's hash algorithm / CSP directive set drifts from the mirror — so the real
  sink and the mirror cannot silently desync (switch the TS `SHA-256` to `SHA-384`
  and this gate goes red).

**5. Post-deploy smoke** (`theme_post_deploy_smoke.py`)
- Drives the real FastAPI app over an in-memory SQLite DB (`create_all` +
  `ensure_default_theme` + a seeded published `home.sections`) via `TestClient` —
  a real HTTP round-trip, not a bare service call.
- **`GET /theme` not 200 / incomplete** → `check_theme_endpoint` fails.
- **`GET /content/home.sections` not 200** → `check_home_sections_endpoint` fails.

**6. Cache posture** (`theme_cache_posture.py`) — R3-B1
- **Theme baked into the static shell** → `check_theme_not_baked_in_shell` fails:
  `server.ts` serves `dist/app/browser` via `express.static(…, { maxAge: '1y' })`,
  so the themed `<style id="ms-theme">` must never be in the source `index.html`
  (paste a `:root{…}` theme block into `index.html` and this gate goes red).
- **No request-time injection seam** → `check_request_time_injection` fails: the
  SSR handler must render per-request (`commonEngine`) and inject the theme
  express-side (`applyThemeSsr` / `getThemeTokens`), never via the Angular app /
  `TransferState`.
- **Shared full-page cache directive** → `check_no_shared_full_page_cache` fails:
  the themed HTML response must not carry a `public` / `max-age` / `s-maxage` /
  `immutable` `Cache-Control` (only the preview `no-store` is permitted). The
  `maxAge:'1y'` on `express.static` is for hashed assets and is excluded (the
  check inspects only `Cache-Control` values set **inside** the render handler).

## How it slots into the quality pipeline

The repo's required check is **`quality / quality`** (`.github/workflows/quality.yml`),
a thin caller of the shared reusable workflow on the `quality-zero-platform`
template branch. **That reusable workflow is owned by another repo and is NOT
edited here.**

This gate is **additive**: a NEW in-repo workflow,
[`.github/workflows/theme-deploy-gate.yml`](../../.github/workflows/theme-deploy-gate.yml),
runs on every PR/push to `main` alongside `quality / quality`. Wire it in by:

1. **Add `theme-deploy-gate / theme-deploy-gate` as a required status context** in
   branch protection for `main`, next to `quality / quality`.
2. **Gate deploys on it.** The workflow exposes `workflow_call`, so
   `deploy-production-manual.yml` can add it as a `needs:`/called job so a manual
   production deploy cannot proceed unless all six theme sub-gates pass.

Coverage boundary: the gate modules live under `scripts/deploy/` — **outside**
`backend/app`, which is the lean gate's coverage scope — so they do not dilute the
`quality / quality` 100% number. Their own strict 100% line+branch coverage is
enforced by the gate's self-test step (`scripts/deploy/.coveragerc`).

## Postgres complement (full-schema autogenerate, advisory)

Sub-gate 1 is scoped to the theme tables and dialect-safe by construction. The
natural full-schema complement is a real Alembic autogenerate check on Postgres —
the repo already runs `alembic upgrade head` against a Postgres service in the
`backend-postgres` job (`.github/workflows/backend.yml`). Appending `alembic check`
there (after `upgrade head`) gives a whole-tree "no model is un-migrated" gate on
the real dialect. It is left advisory here because it asserts over **all** models,
not just P1a's theme tables.
