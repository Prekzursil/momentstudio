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

## Merge Strategy Guidance

- Prefer PRs with focused scope and clear testing evidence.
- Keep conventional commits and update `TODO.md` with evidence.
- Avoid merging when required checks are pending or skipped without rationale.

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
