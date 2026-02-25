# AGENTS.md

## Operating Model

This repository follows an evidence-first, zero-external-API-cost workflow.
Use GitHub Copilot coding agent and Codex app/IDE/CLI for implementation and review.

## Existing Audit Pipeline

This repository already has advanced audit/evidence workflows.
Do not duplicate them. Extend and reuse existing audit contracts instead.

## Risk Policy

- Default merge policy: human-reviewed only.
- Use explicit risk labels: `risk:low`, `risk:medium`, `risk:high`.
- Payments/auth/security-sensitive changes require explicit rollback notes and human sign-off.

## Canonical Verification Command

Run this command before completion claims:

```bash
make verify
```

## Scope Guardrails

- Keep changes minimal and task-focused.
- Preserve storefront/account/admin shell boundaries.
- Avoid broad refactors unless explicitly requested.

## Agent Queue Contract

- Intake issues via `.github/ISSUE_TEMPLATE/agent_task.yml`.
- Queue work by adding `agent:ready`.
- Queue workflow posts execution packet and notifies `@copilot`.

## Queue Trigger Warning

Applying label `agent:ready` triggers the queue workflow immediately.
