---
name: add-100-percent-behavioral-test-coverage-for-component
description: Workflow command scaffold for add-100-percent-behavioral-test-coverage-for-component in momentstudio.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-100-percent-behavioral-test-coverage-for-component

Use this workflow when working on **add-100-percent-behavioral-test-coverage-for-component** in `momentstudio`.

## Goal

Adds or updates a spec file to achieve 100% behavioral test coverage for a frontend Angular component, often including all methods, branches, and error paths. Sometimes includes adding istanbul ignore directives for unreachable SSR or defensive code paths.

## Common Files

- `frontend/src/app/pages/**/[a-z0-9-]*.component.spec.ts`
- `frontend/src/app/pages/**/[a-z0-9-]*.component.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Write or update the component's .spec.ts file with comprehensive behavioral tests covering all logic branches, methods, and error paths.
- Annotate any genuinely unreachable code (e.g., SSR guards) with 'istanbul ignore next' or similar repo-standard comments.
- Run coverage tools to verify 100% line/branch/function/statement coverage for the component.
- Commit both the .spec.ts and (if needed) the component .ts file with coverage annotations.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.