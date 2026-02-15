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

Default GitHub labels (`bug`, `enhancement`, etc.) remain for compatibility.

## Required CI checks for `main`

Branch protection should require these checks for pull requests into `main`:

- `Backend CI / backend (pull_request)`
- `Backend CI / backend-postgres (pull_request)`
- `Frontend CI / frontend (pull_request)`
- `Docker Compose Smoke / compose-smoke (pull_request)`

Policy selection for this phase:

- Require status checks: enabled
- Strict up-to-date requirement: enabled
- Require approvals: disabled (checks-only)
- Require conversation resolution: disabled
- Disallow force pushes/deletions: enabled

## Repo policy phase 2: required approval trigger

This repository uses a staged policy for required PR approvals.

- Current state: checks-only (`required_pull_request_reviews` disabled).
- Goal state (when trigger passes): require exactly `1` approval.
- Scope: no code-owner mandatory review requirement in this phase.

Trigger conditions (must all be true):

1. At least `3` non-bot contributors each with at least `2` merged PRs in the last `60` days.
2. At least `25` merged non-bot PRs in the last `60` days.
3. The condition above must hold for `2` consecutive monthly evaluations.

Evaluation automation:

- Workflow: `.github/workflows/repo-policy-phase2-eval.yml`
- Script: `scripts/repo/evaluate_review_cadence.py`
- Schedule: monthly + manual (`workflow_dispatch`)
- Outputs: JSON + Markdown artifact and Actions job summary

Latest baseline snapshot:

- `docs/reports/repo-policy-phase2-baseline-2026-02.md`
- Baseline status: **HOLD** (trigger not met; keep checks-only mode)

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
gh api \
  --method PUT \
  repos/Prekzursil/AdrianaArt/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]="Backend CI / backend (pull_request)" \
  -f required_status_checks.contexts[]="Backend CI / backend-postgres (pull_request)" \
  -f required_status_checks.contexts[]="Frontend CI / frontend (pull_request)" \
  -f required_status_checks.contexts[]="Docker Compose Smoke / compose-smoke (pull_request)" \
  -F enforce_admins=false \
  -f required_pull_request_reviews= \
  -f restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=false
```

```bash
# Branch protection rollout (phase 2, only after trigger passes twice consecutively)
gh api \
  --method PUT \
  repos/Prekzursil/AdrianaArt/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Backend CI / backend (pull_request)",
      "Backend CI / backend-postgres (pull_request)",
      "Frontend CI / frontend (pull_request)",
      "Docker Compose Smoke / compose-smoke (pull_request)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_conversation_resolution": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
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
