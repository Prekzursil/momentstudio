# momentstudio P2 "Total Quality" — Program Plan

Executes `00-DECISION-LOG.md`. Branch: `feat/p2-total-quality` (from `main` @ `95a6edf0`).
Artifact root: `docs/reports/p2-total-quality/` — **every agent writes here**; `ls` it before writing.

## Environment (Phase 0 — established, do not re-derive)

Full stack via the repo's own compose (the CI `compose-smoke` path, known-good):

```
PAYMENTS_PROVIDER=mock LOCKERS_USE_OVERPASS_FALLBACK=0 \
  docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml exec -T backend alembic upgrade head
docker compose -f infra/docker-compose.yml exec -T backend python -m app.seeds --profile <profile>
docker compose -f infra/docker-compose.yml exec -T backend python -m app.cli bootstrap-owner --email ... --password ... --username ... --display-name Owner
```

- Frontend (nginx, **production build**): `http://localhost:4201`
- Backend: `http://localhost:8001/api/v1` (`/health`, `/health/ready`)
- DB: **Postgres 16** (prod-faithful). Redis + media-worker included.
- Payments run in **mock** mode → checkout is safe to drive end-to-end.

**KNOWN DEFECT (found during Phase 0, must be filed):** `alembic upgrade head` FAILS on SQLite —
the chain emits Postgres-only DDL (`ALTER TABLE products ALTER COLUMN is_deleted DROP DEFAULT`).
Tests never caught it because they use `Base.metadata.create_all`. Migrations are therefore
**unverified against anything but Postgres**. File as a real finding.

## The audit matrix (D5, D9)

76 routes × {375, 768, 1440} × {light, dark} ≈ **456 cells**, ×2 languages (EN/RO) where text-bearing.
Storefront (17 areas) and admin (13 sections) at **equal depth**.

## Agent lenses (D10)

| Lens | Standard of evidence |
|---|---|
| L1 functional / dead-control | GROUNDED: repro steps + `file:line` + console/network capture |
| L2 a11y WCAG 2.2 AA | GROUNDED: axe violation id + selector + screenshot |
| L3 visual / design-quality | GROUNDED: screenshot + rubric dimension score (design-quality rules) |
| L4 i18n EN+RO | GROUNDED: screenshot of overflow/missing key + i18n key path |
| L5 performance / SEO / CWV | GROUNDED: measured metric value vs target (no estimates) |
| L6 security (authz/payments/input) | GROUNDED: request/response evidence; **execute-to-confirm** before calling anything exploitable |
| L7 **discovery** (unnamed dimensions) | IDEATION: cite an external source/domain; do NOT ground in repo |

Discovery seeds (non-exhaustive, agents must extend): error/empty/loading states, offline+PWA
(`pages/offline` exists), GDPR/cookie consent (EU storefront — legal), touch-target size,
browser compat, print styles, transactional email rendering, form UX + validation messaging,
data integrity, observability, RO locale formatting (dates/currency/diacritics).

## Non-negotiable agent contract (every spawn prompt repeats this verbatim — it does NOT inherit)

1. **Honesty instrumentation.** Tag every uncertain claim inline with `UNVERIFIED` **adjacent to the
   claim** — a limitations section at the end does NOT satisfy this. If a recommendation rests on an
   UNVERIFIED premise, the recommendation inherits the tag in its heading. Every `UNVERIFIED` names
   the experiment that would settle it.
2. **Confidence band** on every forward-looking claim, from this enumerated set:
   `almost-certain (90-99%)` · `likely (55-80%)` · `even (~50%)` · `unlikely (20-45%)` · `remote (1-10%)`.
   Pair each band with its evidence tag. A bare "should work" is a hedge, not a conclusion.
3. **Reproduce before reporting.** A finding you did not observe executing is a hypothesis; label it so.
4. **No fake-green.** Never lower a threshold, weaken/delete a test, add a skip, or stub a gate.
   A blocked item is reported blocked (see A3) — never quietly dropped.
5. **EVIDENCE block** of 3-5 anchors (`file:line`, URL, screenshot path, command output) —
   EXEMPT from the word cap.
6. **Digest cap 350 words** (EVIDENCE block excluded). The cap is not lossy; it forces prioritisation.
7. **Scoped writes only.** Explicit paths on `git add`; never `git add -A` (parallel siblings share one index).
8. **Terminal state**: end with `SUCCESS:<unit-id>` + payload, or `FAILED:<unit-id> <reason>` + diagnostic tail.
   Never return nothing; never return "started in the background".

## Orchestrator fan-in gates (applied to every wave)

- **Verify the artifact exists on disk before reading any digest** — a digest is a claim, not a receipt.
- Reject any result containing `started in the background` / `Check /codex:status`.
- On a split verdict about a briefed fact, **the specific probe wins over agent count** — read the probes.
- Digest silence ≠ absence of caveats; open the artifact.
- Adversarial reviewers get siblings' **full text**, not digests.
- **Never score agents on output volume** — that selects against falsification work.

## Triage is MECHANICAL, not LLM-judged (fan-out-contract C4)

Dedupe/cluster findings with a deterministic script (normalize route+viewport+theme+selector+rule-id,
hash, group). LLM judgement is reserved for *does this matter / what does it mean*, never for
set-membership or comparison — a prior 338-item LLM classification ran 86% accurate with **100% of
errors pointing at data loss**.

## Phases

| # | Phase | Parallelism |
|---|---|---|
| 0 | Stack up + rich seed (D8) + admin owner bootstrapped | serial (blocking) |
| 1 | **Playwright e2e safety net** — BEFORE any rewrite (D6, D7 consequence) | parallel by journey |
| 2 | Audit fan-out across 456 cells × 7 lenses | massive parallel (read-only, no collision) |
| 3 | Mechanical triage + dedupe + severity rank | deterministic script |
| 4 | Fix waves — file-disjoint lanes, worktree-isolated | parallel + adversarial review |
| 5 | Redesign worst-scoring screens (identity preserved, D11) | parallel by screen |
| 6 | Verification: e2e + full CI + re-audit delta | serial gate |
| 7 | One integration PR → merge to `main` (D12, D4) | serial |

Phase 2 is read-only (drives the app, writes only findings) → safe at high concurrency.
Phase 4/5 mutate source → **worktree isolation per lane** (repo IS git-backed; `.claude/worktrees/`).
