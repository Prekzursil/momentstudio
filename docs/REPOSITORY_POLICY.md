# Repository Policy

This document defines the collaboration baseline for `Prekzursil/AdrianaArt`.

## Governance Files

The repository includes:

- `LICENSE` (MIT)
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `CODEOWNERS`
- `.editorconfig`
- `.gitattributes`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/*`

## Label Taxonomy

The recommended labels are:

- Type:
  - `type:bug`
  - `type:feature`
  - `type:chore`
  - `type:docs`
  - `type:test`
- Area:
  - `area:backend`
  - `area:frontend`
  - `area:infra`
  - `area:ci`
  - `area:docs`
  - `area:payments`
  - `area:seo`
  - `area:dam`
- Priority:
  - `priority:p0`
  - `priority:p1`
  - `priority:p2`
  - `priority:p3`
- Audit:
  - `audit:deep`
  - `audit:ux`
  - `audit:ia`
  - `audit:seo`
  - `audit:correctness`
- Surface:
  - `surface:storefront`
  - `surface:account`
  - `surface:admin`
- Severity:
  - `severity:s1`
  - `severity:s2`
  - `severity:s3`
  - `severity:s4`
- AI flow:
  - `ai:ready`
  - `ai:in-progress`
  - `ai:automerge`
  - `ai:blocked`
  - `ai:done`

Default GitHub labels (`bug`, `enhancement`, etc.) remain for compatibility.

## Required CI checks for `main`

Branch protection should require these checks for pull requests into `main`:

- `Backend CI / backend (pull_request)`
- `Backend CI / backend-postgres (pull_request)`
- `Frontend CI / frontend (pull_request)`
- `Docker Compose Smoke / compose-smoke (pull_request)`
- `Audit PR Evidence / audit-pr-evidence (pull_request)`

Policy selection for this phase:

- Require status checks: enabled
- Strict up-to-date requirement: enabled
- Require approvals: disabled (checks-only)
- Require conversation resolution: disabled
- Disallow force pushes/deletions: enabled

Checks-only is the current steady-state policy for this repository. If contributor cadence changes in the future, review this document and explicitly update branch protection in a dedicated governance PR.

## Non-blocking observability checks

- `Percy Visual` runs visual snapshot coverage for storefront routes:
  - PR core snapshot pass
  - weekly/manual expanded snapshot pass
- `Applitools Visual` runs Eyes snapshot coverage for storefront routes:
  - PR core snapshot pass
  - weekly/manual run
- Percy is intentionally non-blocking in this phase and is not part of required branch-protection checks.
- Applitools is intentionally non-blocking in this phase and is not part of required branch-protection checks.
- If `PERCY_TOKEN` is missing, Percy workflows skip with an explicit summary message.
- If `APPLITOOLS_API_KEY` is missing, Applitools workflows skip with an explicit summary message.
- Copilot custom setup workflow must expose a single job named `copilot-setup-steps` for agent compatibility.

## Production observability policy

- Production backend startup requires `SENTRY_DSN` (fail-fast enforcement in startup checks).
- `send_default_pii` is intentionally enabled repository-wide (`SENTRY_SEND_DEFAULT_PII=1` for backend/frontend).
- Frontend Sentry remains runtime-gated (`SENTRY_ENABLED`) and DSN-gated (`SENTRY_DSN`).
- GitHub Actions `Sentry Release` workflow publishes releases and uploads frontend sourcemaps when configured:
  - secret: `SENTRY_AUTH_TOKEN`
  - variables: `SENTRY_ORG`, `SENTRY_PROJECT` (optional `SENTRY_URL` for self-hosted)
- Missing Sentry CI configuration is treated as a non-fatal skip with explicit workflow summary output.

## Evidence Pack vs Agent Pass

This repository intentionally separates deterministic data collection from AI judgment:

- Evidence Pack (deterministic CI):
  - `Audit PR Evidence` and `Audit Weekly Evidence` collect route map, SEO snapshot, console/layout signals, screenshots, and deterministic findings from SSR-rendered pages.
  - No LLM/API calls are used in CI evidence collection.
- Agent Pass (Copilot issue assignment):
  - `Audit Weekly Agent` updates the rolling issue `Weekly UX/IA Audit Digest`, upserts severe findings, and assigns `@copilot`.
  - `Audit PR Agent` creates/updates a PR-scoped audit issue when `audit:agent` is applied to a PR (or manual dispatch is used) and assigns `@copilot` when safe.
  - `Audit PR Deep Agent` is opt-in and only runs for PRs labeled `audit:deep`.

## Workflow Permissions Model

- `audit-pr-evidence.yml`: `contents: read`
- `audit-weekly-evidence.yml`: `contents: read`
- `audit-weekly-agent.yml`: `contents: read`, `issues: write`, `pull-requests: read`
- `audit-pr-agent.yml`: `contents: read`, `issues: write`, `pull-requests: read`
- `audit-pr-deep-agent.yml`: `contents: read`, `issues: write`, `pull-requests: read`
- `audit-agent-watchdog.yml`: `contents: read`, `issues: write`

Security constraints:

- PR evidence workflow stays read-only.
- No privileged `workflow_run` artifact-consumer chain is used for untrusted PR code.
- Deep agent assignment skips fork PR auto-assignment and posts maintainer-run guidance in the issue.

## Audit Tracking Rules

- Severe findings (`severity:s1/s2`):
  - upsert as individual issues using deterministic fingerprint dedupe.
- Medium SEO debt findings (`severity:s3`, indexable storefront only):
  - upsert as individual issues when labeled `audit:seo` and `indexable=true`.
  - keep dedupe behavior identical (fingerprint marker in issue body).
- Remaining lower-severity findings (`severity:s3/s4`) not eligible for direct issue upsert:
  - kept in the rolling digest issue.
- Noindex storefront routes:
  - excluded from strict SEO content gating and severe technical SEO issue creation.
- Deep PR agent pass:
  - requires `audit:deep` label.
  - produces/updates one deep-audit issue for that PR.


## Agent Issue Watchdog

To avoid long-running stalled agent tasks, `audit-agent-watchdog.yml` runs on a daily schedule and via manual dispatch.

Policy:

- Target issues: open issues labeled `ai:in-progress`.
- Optional scope filter: `audit:*` (default), `all`, or exact audit labels like `audit:ux`.
- Staleness threshold: **5 days** by default (maintainers may override to a value in the 3–7 day range on manual dispatch).
- Escalation action for stale issues:
  - post an automated timeout/escalation comment,
  - remove `ai:in-progress`,
  - add `ai:ready` (re-queue),
  - unassign `copilot` if still assigned.
- Workflow output logs counters for `scanned`, `stale`, and `updated` issues.

## Merge Strategy Guidance

- Prefer PRs with focused scope and clear testing evidence.
- Keep conventional commits and update `TODO.md` with evidence.
- Avoid merging when required checks are pending or skipped without rationale.

## Roadmap Project

- Project: `AdrianaArt Roadmap` — https://github.com/users/Prekzursil/projects/2
- Field model: default `Status` + custom `Roadmap Lane` (`Now`, `Next`, `Later`)
- Item policy: seed as draft items first, then convert to tracked issues when moved to `Now` with owner/date set.

Note: GitHub CLI/API support for creating/configuring custom project views is currently limited. Use the project UI to keep:

- `Roadmap Board` grouped by `Roadmap Lane`
- `Execution Table` sorted by `Status` then `Roadmap Lane`

## One-time `gh` commands (optional scripted setup)

The following commands can be used to apply remote policy directly:

```bash
# Branch protection (checks-only)
cat > /tmp/adrianaart-main-protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Backend CI / backend (pull_request)",
      "Backend CI / backend-postgres (pull_request)",
      "Frontend CI / frontend (pull_request)",
      "Docker Compose Smoke / compose-smoke (pull_request)",
      "Audit PR Evidence / audit-pr-evidence (pull_request)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

gh api \
  --method PUT \
  repos/Prekzursil/AdrianaArt/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input /tmp/adrianaart-main-protection.json

rm -f /tmp/adrianaart-main-protection.json
```

```bash
# Optional helper: apply AI governance labels + required checks
bash scripts/repo/apply_ai_governance.sh Prekzursil/AdrianaArt
```

```bash
# Repository metadata
gh repo edit Prekzursil/AdrianaArt \
  --description "Bilingual RO/EN e-commerce storefront + admin suite with local-first DAM, SEO reliability, and production-safe payments." \
  --enable-issues \
  --disable-wiki

gh repo edit Prekzursil/AdrianaArt \
  --add-topic fastapi \
  --add-topic angular \
  --add-topic ecommerce \
  --add-topic postgresql \
  --add-topic payments \
  --add-topic seo \
  --add-topic dam \
  --add-topic redis
```
