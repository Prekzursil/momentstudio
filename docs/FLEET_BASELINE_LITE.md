# Fleet Baseline Lite

This repository baseline package is intended for rollout to additional repos after Wave-1 validation.

## Included components

### Core governance files

1. **`AGENTS.md`** - Operating contract for AI-assisted workflows
   - Source: `/AGENTS.md`
   - Evidence-first workflow model
   - Risk policy (low/medium/high)
   - Canonical verification command

2. **`.github/ISSUE_TEMPLATE/agent_task.yml`** - Issue intake template
   - Source: `/.github/ISSUE_TEMPLATE/agent_task.yml`
   - Structured task definition fields
   - Risk/scope/acceptance criteria

3. **`.github/pull_request_template.md`** - PR template
   - Source: `/.github/pull_request_template.md`
   - Summary/Risk/Evidence/Rollback/Scope Guard sections
   - Verification checklist
   - Backlog sync tracking

### Workflow automations

1. **`.github/workflows/agent-label-sync.yml`** - Label synchronization
   - Source: `/.github/workflows/agent-label-sync.yml`
   - Creates/updates agent:*, risk:*, area:* labels
   - Manual dispatch trigger

2. **`.github/workflows/agent-task-queue.yml`** - Agent task queue
   - Source: `/.github/workflows/agent-task-queue.yml`
   - Triggers on `agent:ready` label
   - Posts execution packet for @copilot
   - Includes verification command and guardrails

3. **`.github/workflows/kpi-weekly-digest.yml`** - KPI reporting
   - Source: `/.github/workflows/kpi-weekly-digest.yml`
   - Automated PR/issue metrics snapshot
   - Weekly schedule (Mondays 06:15 UTC)
   - Creates tracking issue with KPI fields

4. **`.github/workflows/branch-protection-audit.yml`** - Protection validation
   - Source: `/.github/workflows/branch-protection-audit.yml`
   - Audits main branch protection settings
   - Weekly schedule (Mondays 06:30 UTC)
   - Creates issue on policy violations

### Agent profiles (optional)

1. **`.github/agents/`** - Starter agent profiles
   - `docs-gardener.agent.md` - Documentation alignment
   - `release-assistant.agent.md` - Release preparation
   - `security-sheriff.agent.md` - Security hardening
   - `test-specialist.agent.md` - Test-driven changes
   - `triage.agent.md` - Issue triage and planning
   - `ui-polish.agent.md` - UX improvements

### Supporting documentation

1. **`docs/KPI_BASELINE.md`** - KPI definitions
   - Source: `/docs/KPI_BASELINE.md`
   - Core metrics (6 KPIs)
   - Escaped-regression tracking
   - Operating notes

2. **`docs/REPOSITORY_POLICY.md`** - Repository policy baseline
    - Source: `/docs/REPOSITORY_POLICY.md`
    - Branch protection requirements
    - Label taxonomy
    - Merge strategy guidance

## Rollout checklist

Use this checklist when applying baseline-lite to a new repository:

### Prerequisites

- [ ] Repository has a clear verification command (e.g., `make verify`, `npm test`)
- [ ] Repository has CI workflows for linting/testing
- [ ] Team has agreed on risk-gating policy

### Installation steps

1. **Core files** (required)
   - [ ] Copy `AGENTS.md` to repository root
   - [ ] Copy `.github/ISSUE_TEMPLATE/agent_task.yml`
   - [ ] Copy `.github/pull_request_template.md`
   - [ ] Update verification command in `AGENTS.md` to match repository

2. **Workflows** (required)
   - [ ] Copy `.github/workflows/agent-label-sync.yml`
   - [ ] Copy `.github/workflows/agent-task-queue.yml`
   - [ ] Copy `.github/workflows/kpi-weekly-digest.yml`
   - [ ] Copy `.github/workflows/branch-protection-audit.yml`
   - [ ] Update `VERIFY_COMMAND` env var in `agent-task-queue.yml`

3. **Agent profiles** (optional, customize per repo needs)
   - [ ] Copy desired profiles from `.github/agents/`
   - [ ] Customize agent instructions for repository-specific patterns
   - [ ] Add repository-specific context to agent prompts

4. **Documentation** (required)
   - [ ] Copy `docs/KPI_BASELINE.md`
   - [ ] Customize production-sensitive areas for the repository
   - [ ] Add repository-specific regression categories if needed

5. **Initial setup** (one-time actions)
   - [ ] Run `.github/workflows/agent-label-sync.yml` manually to create labels
   - [ ] Configure branch protection rules (see `docs/REPOSITORY_POLICY.md`)
   - [ ] Test agent queue by creating test issue with `agent:ready` label

### Validation

- [ ] Weekly KPI digest workflow runs successfully
- [ ] Branch protection audit workflow runs successfully
- [ ] Agent queue workflow responds to `agent:ready` label
- [ ] All required labels exist in repository

## Rollout rule

Only apply this package to non-Wave repositories after Wave-1 KPIs remain stable for at least two weekly cycles.

## Maintenance notes

- Keep baseline-lite synchronized with governance evolution in Wave-1 repos
- Document breaking changes in rollout guidance
- Version baseline packages when making incompatible changes
