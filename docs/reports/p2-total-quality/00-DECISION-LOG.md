# momentstudio P2 "Total Quality" — Grill Decision Log (2026-07-26)

Authoritative output of `/grill-me-extensive`. Every downstream agent MUST obey this.
Owner answered 12 foundation questions; nothing here may be re-litigated by an agent.

## Locked decisions

| # | Decision | Answer |
|---|---|---|
| D1 | **Target app** | **momentstudio ONLY.** The "uninstall/install reframe app" clause was a slip — Reframe 1.4.1 stays installed and UNTOUCHED. |
| D2 | **Where the audit runs** | **Local seeded instance.** `momentstudio.ro` production is OFF-LIMITS (no driving, no deploy, no data pull). |
| D3 | **Ambition** | **Evidence-driven hybrid** — fix EVERY bug app-wide; redesign only screens the audit scores worst. P1a token system stays the foundation. |
| D4 | **Definition of done** | Merged to `main` + verified running locally end-to-end. **NO unattended production deploy.** |
| D5 | **Scope** | **Everything, EQUAL depth** — storefront (17 areas) AND admin (13 sections), all 76 routes. |
| D6 | **Verification bar** | **Permanent Playwright e2e suite** in CI + one regression test per bug found. |
| D7 | **Refactor authority** | **AGGRESSIVE** — agents may rewrite poorly-structured areas freely (not just proven defect sources). |
| D8 | **Seed data** | **Rich synthetic + deliberate edge cases**: long names, missing images, zero-stock, unicode/RO diacritics, 200+ rows (pagination), explicit empty states. |
| D9 | **Viewport matrix** | **FULL** — every route × {375, 768, 1440} × {light, dark}, admin included at phone size. ≈456 cells. |
| D10 | **Quality lenses** | a11y (WCAG 2.2 AA) + i18n (EN+RO) + performance/SEO/CWV + security (authz/payments/validation) + **open-ended DISCOVERY** (find lenses not yet named). |
| D11 | **Visual direction** | **Keep the identity** (slate/indigo tokens, Cinzel/Inter), **elevate execution**: hierarchy, spacing rhythm, depth, designed hover/focus/active, empty/loading/error states. NO re-brand. |
| D12 | **Merge cadence** | **ONE big integration PR at the end**, merged to `main` when green. |

## Load-bearing consequence of D7 (stated, not optional)

Aggressive rewrite authority makes the regression net **load-bearing**. Therefore the
Playwright e2e suite (D6) is built **BEFORE** any rewrite lands — a rewrite with no
oracle is how unattended agents silently break a working app.

## Assumptions (owner not present to confirm; reversible, flagged)

- **A1** Agent fan-out sized to real work (owner authorized 300–1000); Opus for all substantive agents.
- **A2** Prior art RECONCILED not duplicated: `docs/AI_AUDIT_PHASES.md` (existing evidence-pack + agent-pass audit system) and `docs/reports/full-site-owner-audit/` are extended.
- **A3** Anything unfixable unattended (needs a live secret, payment sandbox, prod access) is QUEUED + documented — never faked, never stubbed green.
- **A4** Branch history stays granular (many small commits) even though it lands as one PR — preserves per-change revertibility.
- **A5** CI runs periodically on the branch, not only at the end — do not discover breakage at hour 10.
- **A6** Open Dependabot PRs folded in only if they don't destabilize; otherwise left alone.
- **A7** Never self-throttle on 529/"temporarily limiting" — that is server-side, not our fan-out.

## Non-negotiables inherited from the estate contract

- No force-push to `main`; no `--no-verify`; no secrets committed; no blind `git add -A` (scoped adds only).
- No fake-green: never lower a threshold, weaken/delete a test, or add a skip to pass a gate.
- Coverage: `.coverage-thresholds.json` is SSOT (100% changed-line on this repo).
- Every claim of "fixed" carries executable evidence (test, screenshot, or command output).

## Program phases (see 01-PROGRAM-PLAN.md)

0. Local instance + rich seed (BLOCKING — nothing else can run without it)
1. Playwright e2e safety net (BEFORE rewrites, per D7 consequence)
2. Massive parallel audit across 456 cells × lenses
3. Mechanical triage + dedupe (deterministic, NOT LLM-judged)
4. Parallel fix waves (worktrees, file-disjoint) + adversarial review
5. Redesign worst-scoring screens (identity preserved)
6. Full verification: e2e + CI + re-audit delta
7. One integration PR → merge to `main`
