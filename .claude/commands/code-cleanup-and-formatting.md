---
name: code-cleanup-and-formatting
description: Workflow command scaffold for code-cleanup-and-formatting in momentstudio.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /code-cleanup-and-formatting

Use this workflow when working on **code-cleanup-and-formatting** in `momentstudio`.

## Goal

Removes dead code, unused imports, and applies code formatting tools to maintain code quality and consistency.

## Common Files

- `backend/app/api/v1/analytics.py`
- `backend/app/api/v1/coupons_v2.py`
- `backend/app/services/catalog.py`
- `scripts/audit/collect_audit_evidence.py`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Identify dead code and unused imports via static analysis tools (e.g., CodeQL, Ruff).
- Remove or refactor the identified code in relevant files.
- Run code formatting tools (e.g., Autopep8, Black, Ruff Formatter) on the affected files.
- Verify that linters and formatters report no further issues.
- Optionally, document or comment on any non-obvious changes.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
