# Copilot Agent Instructions (Repository-wide)

This repository uses an evidence-first AI workflow:

1. Deterministic CI collects evidence.
2. Agents produce judgment and implementation proposals.
3. High-severity findings become issues; lower-severity findings stay in digest form.

Core rules:

- Preserve shell boundaries:
  - Storefront shell handles shopper UX.
  - Account shell handles user self-service only.
  - Admin shell handles operations and management only.
- Avoid duplicate control surfaces:
  - Do not add the same primary action in multiple unrelated pages.
  - If a page has more than 3 primary actions, move extras to overflow/settings.
- Use evidence citations:
  - Every claim must cite artifact paths from `artifacts/audit-evidence/` and/or source paths.
- Keep implementation additive and safe:
  - No direct pushes to protected branches.
  - Use focused PRs with tests and risk notes.
- Respect repository policy:
  - Required checks must pass.
  - Merge behavior stays checks-only unless policy docs explicitly change.

Output contract for audit narratives:

1. Top 10 highest-impact issues:
   - Issue
   - Evidence file paths
   - Why it matters
   - Fix
   - Effort (`S|M|L`)
   - Impact (`1-5`)
2. Surface boundary proposal:
   - What belongs in storefront vs account vs admin shell.
3. Control surface rule per page type:
   - Primary job
   - Top 1-3 actions
   - What moves to overflow/settings
4. Start general, then deep-dive.
