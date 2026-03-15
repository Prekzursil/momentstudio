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

## Phase 2 (Current): Weekly issue-only triage

Roadmap project auto-sync was retired. The weekly agent now keeps a strict issue-only flow:

- Severe findings (`s1/s2`) are upserted as issues with deterministic fingerprint dedupe.
- Lower-severity findings (`s3/s4`) remain in the rolling digest issue.
- No project board token or project variables are required.

### Implementation components

- Severe handoff output:
  - `scripts/audit/upsert_audit_issues.py` via `--severe-output`
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

## Security and operational constraints

- Tokens are never printed in logs.
- Repo/path inputs are validated and path writes stay in audit artifact roots.

## Validation checklist

1. Run weekly evidence.
2. Run weekly agent.
3. Verify severe findings are upserted as issues.
4. Verify lower-severity findings are rendered into the rolling digest body.

## Next phase

Planned follow-up:

- AI audit phase 3: bi-directional roadmap sync based on issue lifecycle and closure policy.
