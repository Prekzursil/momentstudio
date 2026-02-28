# Baseline Exclusions and AdrianaArt Overlays

This document defines which advanced components in AdrianaArt should **NOT** be included in baseline-lite rollouts to other repositories.

## Excluded: Advanced Audit Pipeline

AdrianaArt has a comprehensive Phase 1/2 audit pipeline that is **intentionally excluded** from baseline-lite packages. These workflows represent advanced, repository-specific automation that requires significant setup and customization.

### Excluded workflows

**Evidence collection (deterministic CI):**

- `.github/workflows/audit-pr-evidence.yml` - PR-scoped evidence collection
- `.github/workflows/audit-weekly-evidence.yml` - Weekly evidence collection
- Scripts: `scripts/audit/collect_audit_evidence.py`
- Scripts: `scripts/audit/extract_route_map.py`
- Scripts: `scripts/audit/normalize_findings_fingerprint.py`

**Agent analysis (AI-powered):**

- `.github/workflows/audit-pr-agent.yml` - PR-scoped audit agent
- `.github/workflows/audit-pr-deep-agent.yml` - Deep PR audit (opt-in)
- `.github/workflows/audit-weekly-agent.yml` - Weekly audit digest
- `.github/workflows/audit-agent-watchdog.yml` - Stale issue de-escalation
- Scripts: `scripts/audit/upsert_audit_issues.py`
- Scripts: `scripts/audit/sync_severe_issues_to_project.py`
- Scripts: `scripts/audit/agent_issue_watchdog.py`

**Why excluded:**

- Requires frontend/backend SSR infrastructure for evidence collection
- Depends on route mapping and SEO snapshot capabilities
- Produces artifacts specific to storefront/account/admin shell architecture
- Includes complex fingerprinting and deduplication logic
- Integrates with GitHub Projects for roadmap sync (Phase 2)

**Baseline-lite replacement:**

- Use simpler curation digest workflow (`.github/workflows/curation-weekly-digest.yml`) for manual quality tracking
- Let repositories develop their own audit patterns based on specific needs

## Excluded: Visual regression testing

AdrianaArt uses Percy and Applitools for visual regression coverage. These are **intentionally excluded** from baseline-lite:

**Excluded workflows:**

- `.github/workflows/percy-visual.yml` - Percy snapshot testing
- `.github/workflows/applitools-visual.yml` - Applitools Eyes testing
- Scripts: `scripts/audit/percy_auto_approve.py`

**Why excluded:**

- Requires Percy and Applitools API keys and paid accounts
- Configured as non-blocking observability (intentionally not in branch protection)
- Specific to storefront visual consistency tracking

**Baseline-lite guidance:**

- Visual testing remains opt-in and repository-specific
- Recommend manual visual review or simpler screenshot diffing for baseline repos

## Excluded: Advanced release automation

AdrianaArt has Sentry release tracking and sourcemap upload automation:

**Excluded workflows:**

- `.github/workflows/sentry-release.yml` - Sentry release publishing
- `.github/workflows/release.yml` - Release artifact packaging

**Why excluded:**

- Requires Sentry account and API tokens
- Production observability setup is environment-specific
- Release packaging is repository-specific

**Baseline-lite replacement:**

- Repositories should configure their own production observability
- Keep release automation lightweight and tool-agnostic in baseline

## Excluded: Repository-specific CI

AdrianaArt has specialized CI workflows for its tech stack:

**Excluded workflows:**

- `.github/workflows/frontend.yml` - Angular frontend CI
- `.github/workflows/backend.yml` (implied) - FastAPI backend CI
- `.github/workflows/compose-smoke.yml` - Docker Compose smoke tests
- `.github/workflows/dependency-review.yml` - Dependency scanning
- `.github/workflows/codacy-coverage.yml` - Codacy coverage reporting

**Why excluded:**

- Tech stack specific (Angular/FastAPI/PostgreSQL/Redis)
- Repository has unique build/test requirements
- Coverage reporting is optional and tool-specific

**Baseline-lite guidance:**

- Repositories must implement their own CI based on tech stack
- Branch protection audit should validate required checks exist

## Excluded: Copilot custom setup

AdrianaArt has a custom Copilot setup workflow:

**Excluded workflow:**

- `.github/workflows/copilot-setup-steps.yml` - Custom agent environment setup

**Why excluded:**

- Highly repository-specific (installs Angular CLI, Python deps, etc.)
- Requirements vary dramatically by tech stack
- Must expose single job named `copilot-setup-steps` for compatibility

**Baseline-lite guidance:**

- Repositories should create their own `copilot-setup-steps.yml` if needed
- Document required setup steps for agent execution environment

## AdrianaArt-specific overlays (included but require customization)

These components ARE included in baseline-lite but require significant customization:

### 1. Production-sensitive area definitions

**File:** `docs/KPI_BASELINE.md` - Escaped-regression tracking section

AdrianaArt defines these high-sensitivity areas:

- Payments (Stripe integration)
- Authentication (OAuth flows)
- SEO (canonical/meta/structured data)
- Security (sanitization, CORS, rate limiting)

**Customization required:**

- Identify production-sensitive areas for target repository
- Update regression categories to match common failure modes
- Adjust tracking workflow to match CI/review processes

### 2. Branch protection requirements

**File:** `docs/REPOSITORY_POLICY.md` - Required CI checks section

AdrianaArt requires:

- Backend CI / backend (pull_request)
- Backend CI / backend-postgres (pull_request)
- Frontend CI / frontend (pull_request)
- Docker Compose Smoke / compose-smoke (pull_request)
- Audit PR Evidence / audit-pr-evidence (pull_request)

**Customization required:**

- Replace with target repository's actual CI check names
- Adjust strict up-to-date requirement based on team size
- Update `branch-protection-audit.yml` to validate correct checks

### 3. Agent profiles

**Directory:** `.github/agents/*.agent.md`

AdrianaArt has 6 agent profiles with repository-specific knowledge:

- Knowledge of storefront/account/admin shell boundaries
- References to specific files and patterns (e.g., SeoHeadLinksService)
- Admin UX patterns and conventions

**Customization required:**

- Remove or adapt AdrianaArt-specific references
- Add repository-specific patterns and conventions
- Tailor agent instructions to target repository's architecture

### 4. Verification command

**File:** `AGENTS.md` and `.github/workflows/agent-task-queue.yml`

AdrianaArt uses: `make verify`

**Customization required:**

- Update to target repository's verification command
- Ensure command runs full lint and test suite
- Update `VERIFY_COMMAND` env var in agent-task-queue.yml

## Rollout process for exclusions

When rolling out baseline-lite to a new repository:

1. **Do NOT copy excluded workflows** - Review this document first
2. **Customize overlays** - Update production-sensitive areas, branch protection, verification command
3. **Validate fit** - Ensure baseline components match repository's maturity and team size
4. **Start minimal** - Add advanced workflows only after baseline is validated

## Future baseline evolution

As governance patterns mature across Wave-1 repositories:

- Extract reusable patterns from advanced audit pipeline
- Create "baseline-standard" tier for repositories ready for more automation
- Document migration path from lite → standard → advanced
- Keep lite package deliberately minimal to maximize applicability
