# AI-Native Engineering Playbook

This playbook defines how `Prekzursil/AdrianaArt` executes engineering work with humans + agents.
It is process/governance guidance (soft-enforced) and applies to backend, frontend, infra, CI, and audit automation.

References:
- OpenAI Codex guide: `build-ai-native-engineering-team`
- OpenAI agents guide: `https://developers.openai.com/api/docs/guides/agents`
- VS Code multi-agent/agent tooling blog sequence (2024–2025)

## 1) Task Intake Standard

Every task/PR should explicitly declare:
- Problem statement
- Success criteria
- Scope boundaries (what is out of scope)
- Risk level (`low`, `medium`, `high`)
- Evidence required before merge (tests, workflow runs, report artifacts)

## 2) Execution Model

Default execution sequence:
1. Decompose into independently shippable slices.
2. Assign an explicit owner for each slice (human or agent role).
3. Parallelize slices that do not share mutable state.
4. Run an integration checkpoint before merge.

Rules:
- Deterministic evidence first, judgment second.
- Keep change sets narrow; avoid bundled unrelated refactors.
- For medium/high-risk work, include explicit rollback steps in PR.

## 3) Agent Role Topology

Standard role map:
- `Planner`: scope, constraints, acceptance criteria, ordering.
- `Implementer`: minimal code changes to satisfy scope.
- `Verifier`: tests, CI checks, security checks, evidence collection.
- `Reviewer`: regression/risk review, residual risk callouts.
- `Operator`: workflow/runbook/deployment updates.

A single person can hold multiple roles, but each role output should still be explicit in the PR body.

## 4) Soft Quality Gates

Required evidence (non-blocking policy, but expected in every PR):
- Commands run and outcomes (or explicit rationale if skipped)
- Regression surfaces reviewed
- Security/privacy checks when relevant
- Rollback plan for risky changes

High-risk domains requiring explicit human sign-off note in PR:
- Payments
- Auth/security boundaries
- Database migrations/data transforms
- Production deployment workflows

## 5) Definition of Done

Work is done when:
- Code, tests, and docs are aligned.
- Required CI checks are green.
- Residual risk is documented.
- Follow-up work is tracked (`TODO.md` and/or issue links).

## 6) Escalation Rules

Stop automation and escalate for human decision when:
- requirements conflict or become ambiguous,
- risk model changes materially during implementation,
- three consecutive fix attempts fail in same area,
- production-impacting uncertainty remains without reproducible evidence.

## 7) Evidence-First Audit Fit

This repository already follows an evidence-first audit architecture:
- CI workflows collect deterministic artifacts.
- Agent workflows synthesize judgment and open/update issues.
- Severe findings are deduped by fingerprint and tracked as issues.

This playbook extends that model to all engineering work, not only audits.

## 8) Current Enforcement Mode

Current mode: **soft-enforced**.

Mechanisms:
- PR template prompts for intake/risk/verification/rollback metadata.
- Issue templates collect owner role, risk, evidence, and acceptance criteria.
- Workflow summaries may warn on missing playbook metadata.

No new required status checks are introduced in this phase.

## 9) Adoption Cadence

Suggested rollout:
1. Week 1: publish playbook + templates.
2. Week 2: maintainers enforce playbook fields in review.
3. Week 3: collect friction/adoption metrics.
4. Week 4: decide selective hard-enforcement candidates.

## 10) Practical Checklist

Before opening PR:
- Intake complete
- Scope + risk explicit
- Role map explicit
- Tests and verification evidence attached
- Rollback note present for medium/high risk
- Docs/runbooks updated when behavior changes
