# AI Audit Phases

This document defines the two implemented phases of the repository AI audit program.

## Goal

Keep audit automation deterministic, reproducible, and low-noise while still benefiting from agent-driven analysis and triage.

The split is explicit:

1. Evidence Pack (deterministic CI) collects facts.
2. Agent Pass (Copilot issue assignment) produces judgment.

No OpenAI/Anthropic API calls are used in CI workflows for this program.

## Phase 1 (Implemented): Evidence Pack + Agent Pass

### Architecture

Phase 1 is intentionally split into deterministic collection and agent reasoning.

Deterministic artifacts are produced by:

- `scripts/audit/collect_audit_evidence.py`
- `scripts/audit/extract_route_map.py`
- `scripts/audit/normalize_findings_fingerprint.py`

Primary workflows:

- `.github/workflows/audit-pr-evidence.yml`
- `.github/workflows/audit-weekly-evidence.yml`
- `.github/workflows/audit-weekly-agent.yml`
- `.github/workflows/audit-pr-deep-agent.yml`
- `.github/workflows/audit-agent-watchdog.yml`

Output artifact contract (`audit-evidence-pack`):

- `route-map.json`
- `surface-map.json`
- `seo-snapshot.json`
- `console-errors.json`
- `layout-signals.json`
- `deterministic-findings.json`
- `screenshots/`
- `evidence-index.md`

### Trigger model

- PR path:
  - `Audit PR Evidence` runs on pull requests to `main`.
  - `Audit PR Deep Agent` is opt-in and label-gated (`audit:deep`).
- Weekly path:
  - `Audit Weekly Evidence` runs on schedule/manual.
  - `Audit Weekly Agent` runs from weekly evidence completion and can be manually dispatched.

### Issue lifecycle

- Severe findings (`severity:s1`, `severity:s2`): upserted as individual issues, deduped by deterministic fingerprint.
- Lower findings (`severity:s3`, `severity:s4`): aggregated in `Weekly UX/IA Audit Digest`.
- Agent labels:
  - `ai:ready`
  - `ai:in-progress`
  - `ai:done`
  - `ai:blocked`

### Watchdog behavior

`audit-agent-watchdog.yml` de-stalls stale in-progress issues:

- Scans open `ai:in-progress` issues.
- On stale threshold, comments, re-queues (`ai:ready`), and unassigns `copilot`.

## Phase 1 runbook

### Weekly expected flow

1. `Audit Weekly Evidence` succeeds and uploads `audit-evidence-pack`.
2. `Audit Weekly Agent` consumes that run.
3. Severe issues are upserted.
4. Weekly digest issue is created/updated and assigned to `@copilot`.

### Common failure modes

- No successful weekly evidence run:
  - Weekly agent fails source resolution when no successful evidence run exists.
- Copilot assignment unavailable:
  - Workflow leaves fallback guidance comment and keeps issue open.
- Artifact mismatch:
  - If findings file is missing/invalid, severe upsert cannot proceed.

## Phase 2 (Implemented): Severe issue roadmap auto-sync

Phase 2 adds an optional project sync so open severe issues are mirrored into the roadmap lane `Now`.

### Scope

- Sync target: user project `Prekzursil` #2 by default (`AdrianaArt Roadmap`).
- Source: severe issue upsert output from weekly agent run.
- Policy:
  - Upsert open severe issues into project.
  - Force `Roadmap Lane=Now`.
  - Set `Status=Todo` only when status is empty or non-terminal.
  - Do not auto-remove/archive items in this phase.

### Token-gated execution

Phase 2 runs only when a project write token is configured.

Configuration:

- Secret: `ROADMAP_PROJECT_WRITE_TOKEN` (optional)
- Variable: `ROADMAP_PROJECT_OWNER` (default `Prekzursil`)
- Variable: `ROADMAP_PROJECT_NUMBER` (default `2`)

If `ROADMAP_PROJECT_WRITE_TOKEN` is missing:

- Workflow stays green.
- Sync step is skipped with explicit reason in step summary.

### Implementation components

- Severe handoff output:
  - `scripts/audit/upsert_audit_issues.py` via `--severe-output`
- Project sync engine:
  - `scripts/audit/sync_severe_issues_to_project.py`
- Weekly wiring:
  - `.github/workflows/audit-weekly-agent.yml`

### Data handoff contract

`severe-issues-upserted.json` rows include:

- `issue_number`
- `issue_node_id`
- `fingerprint`
- `route`
- `surface`
- `severity`
- `action` (`created` or `updated`)

`project-sync-summary.json` includes:

- `scanned`
- `added`
- `updated`
- `lane_updates`
- `status_updates`
- `skip_reason` (when skipped)
- `project_url`

## Security and operational constraints

- Project sync uses strict GraphQL variables (no query string interpolation).
- Tokens are never printed in logs.
- Repo/path inputs are validated and path writes stay in audit artifact roots.
- Phase 2 only mutates project metadata; it does not change code/runtime behavior.

## Validation checklist

1. Run weekly evidence.
2. Run weekly agent with token missing and verify safe skip summary.
3. Configure `ROADMAP_PROJECT_WRITE_TOKEN` and rerun weekly agent.
4. Verify severe issues appear in `AdrianaArt Roadmap` lane `Now`.
5. Verify no duplicate project items for rerun of same severe issues.

## Next phase

Planned follow-up:

- AI audit phase 3: bi-directional roadmap sync based on issue lifecycle and closure policy.
