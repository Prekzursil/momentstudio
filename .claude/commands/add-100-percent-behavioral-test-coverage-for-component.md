---
name: add-100-percent-behavioral-test-coverage-for-component
description: Governed coverage WU for a frontend Angular component — INNER diff-coverage ratchet, paired e2e outer, make verify, draft PR only.
allowed_tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Task"]
---

# /add-100-percent-behavioral-test-coverage-for-component

Alias: `/add-component-coverage` → this command.

## Gate truth (kill-list)

**INNER enforced ratchet** = 100% of **PR-added executable lines under `frontend/src`** via [`frontend/scripts/diff-coverage.mjs`](../../frontend/scripts/diff-coverage.mjs) against `merge-base(origin/$GITHUB_BASE_REF)...HEAD`, plus Karma floor.

- **Not** whole-repo / component-wide / legacy global istanbul line/branch/function/statement 100%.
- **Not** jest. Use `npm run test:coverage` (Karma) from `frontend/`.
- Filename may keep `100-percent` only with this adjacent disclaimer.
- If `GITHUB_BASE_REF` is unset, `diff-coverage.mjs` may exit 0 and skip — treat skip-log as **INNER fail**. Export `GITHUB_BASE_REF` (usually `main`) before ValidateInner.

## Goal

Add or update a colocated `*.component.spec.ts` so the INNER ratchet passes for the WU diff, run mandatory DeSlop, invoke `/run-component-paired-e2e` for LaneOuter, run `make verify`, obtain independent Review, then open or reuse an **idempotent draft PR**. No merge. No product behavior change.

## Common files

- `frontend/src/app/pages/**/*.component.ts`
- `frontend/src/app/pages/**/*.component.spec.ts`
- Receipt: `docs/coverage-runs/<run_id>/<component_slug>.receipt.md`

## Canonical stages

`Ground → Select → Impl → DeSlop → ValidateInner → LaneOuter → RepoVerify → Review → DraftPR`

```mermaid
flowchart LR
  Ground --> Select --> Impl --> DeSlop --> ValidateInner --> LaneOuter --> RepoVerify --> Review --> DraftPR
```

1. **Ground** — full `/source` = agent-sort (repo evidence; not AGENTS skim). Receipt: `GROUND-SOURCE: agent-sort|<path-or-hash>`.
2. **Select** — resolve `component_path`. Hard-stop on G-6 denylist unless written owner-exception id (`risk:high` alone insufficient). Checkout/payment never golden. Golden first WU: **`about` or `contact` only**.
3. **Impl** — colocated spec; TDD; istanbul ignore only with reason; no product behavior change. Write `UNIT-COMPLETE: <component_path>` (Impl marker only — **not** done).
4. **DeSlop** — mandatory separate pass.
5. **ValidateInner** — `export GITHUB_BASE_REF` if unset → fail; `cd frontend && npm run test:coverage`; zero `diff-coverage.mjs` misses; skip-log = fail.
6. **LaneOuter** — call `/run-component-paired-e2e` (do not fork a second outer procedure). Case A/B per outer command.
7. **RepoVerify** — `make verify` exit 0 required for done. Never claim full QZP green without live Chromatic+Applitools contexts.
8. **Review** — independent non-author receipt+diff verify **after** OUTER+REPO evidence. Required before mark-done/DraftPR. Single-agent Impl does not waive this seat.
9. **DraftPR** — idempotent: resolve existing draft by `wu_id`/branch/component before open; reuse URL + `DRAFT-PR: <url>`; refuse double open. **Refuse open** unless receipt has INNER + LANE_OUTER + REPO_VERIFY + REVIEW (LANE_OUTER may be `outer:blocked` but must not be absent). Draft only; risk label; never merge.

## Done predicate

`done ⇔ INNER ∧ LANE_OUTER ∧ REPO_VERIFY ∧ Review`

No `--mark-done` / DraftPR “complete” on `UNIT-COMPLETE` alone. Not INNER-only draft (G-24).

## Receipt (exact lines)

`docs/coverage-runs/<run_id>/<component_slug>.receipt.md` must include:

- `INNER-STATUS: pass|fail`
- `DIFF-COVERAGE: enforced|skipped|failed` (+ `GITHUB_BASE_REF: <ref>`; skipped ⇒ fail)
- `UNIT-COMPLETE: <component_path>`
- `OUTER-STATUS: green|outer:blocked` (+ `blocker_id=` if blocked)
- `REPO-VERIFY: pass|fail`
- `REVIEW: pass|fail`

Fan-in rejects missing lines; rejects unredacted secret-shaped evidence (use presence-only / `[REDACTED]`).

## Digest schema floor (all required)

`{ digest, evidence, component_path, outer_status, repo_verify, ground_source, diff_coverage_status, review }`

- `outer_status ∈ {green, outer:blocked}`
- `repo_verify ∈ {pass, fail}`
- `diff_coverage_status ∈ {enforced, skipped, failed}` — reject `skipped` as INNER green
- `review ∈ {pass, fail}`

## ResumeManifest

`docs/coverage-runs/<run_id>/manifest/` — append-only `done.jsonl` with `state ∈ {partial, done, failed}`. Ordered: `--mark-partial` → … → DraftPR → `--mark-done` or `--mark-failed`. Persist `failed[]` in NOTES; never silent-pending failed.

## Args

`args ?? {}`; auto-discover via Glob when path omitted.

## Out of scope

Auto-merge, Continuous-Claude install, service-command rewrite, inventing auth/payment credentials, lowering coverage thresholds.
