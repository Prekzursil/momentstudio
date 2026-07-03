---
name: add-100-percent-behavioral-test-coverage-for-service
description: Workflow command scaffold for add-100-percent-behavioral-test-coverage-for-service in momentstudio.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-100-percent-behavioral-test-coverage-for-service

Use this workflow when working on **add-100-percent-behavioral-test-coverage-for-service** in `momentstudio`.

## Goal

Adds or updates a spec file to achieve 100% behavioral test coverage for a frontend Angular service, asserting HTTP calls, observable emissions, and all code branches.

## Common Files

- `frontend/src/app/core/[a-z0-9-]*.service.spec.ts`
- `frontend/src/app/core/[a-z0-9-]*.service.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Write or update the service's .spec.ts file with behavioral tests covering all public methods and code branches.
- Assert correct HTTP verb, URL, params, and observable emissions for each method.
- Annotate any unreachable SSR or defensive code with 'istanbul ignore next' if needed.
- Run coverage tools to verify 100% line/branch/function/statement coverage for the service.
- Commit the .spec.ts file (and .ts if annotations are added).

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.