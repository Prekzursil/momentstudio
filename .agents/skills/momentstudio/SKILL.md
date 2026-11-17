```markdown
# momentstudio Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development, testing, and coverage enforcement patterns used in the `momentstudio` TypeScript codebase. Frontend unit coverage uses **Karma** (`npm run test:coverage`) plus a **PR-added-line** ratchet via `frontend/scripts/diff-coverage.mjs` (requires `GITHUB_BASE_REF`; skip ≠ green). Do **not** claim whole-repo or per-file istanbul global line/branch/function/statement 100%, and do **not** use jest for this gate. Component coverage WUs follow governed stages ending at draft PR only.

---

## Coding Conventions

- **File Naming:**  
  Use `kebab-case` for all file names.
  - Example:  
    `user-profile.component.ts`  
    `api-service.spec.ts`

- **Import Style:**  
  Use relative imports.
  - Example:  
    ```typescript
    import { UserService } from './user-service';
    ```

- **Export Style:**  
  Use named exports.
  - Example:  
    ```typescript
    export function calculateTotal() { ... }
    export class AuthGuard { ... }
    ```

- **Test Files:**  
  Test files are named with the `.spec.ts` suffix and placed alongside their corresponding source files.
  - Example:  
    `user-profile.component.ts`  
    `user-profile.component.spec.ts`

---

## Workflows

### Add 100% Behavioral Test Coverage for Component
**Trigger:** When you want a governed coverage WU for a frontend Angular component (INNER ratchet + paired e2e + verify + draft PR).  
**Command:** `/add-component-coverage` (alias) → `/add-100-percent-behavioral-test-coverage-for-component`

1. Follow stages: Ground → Select → Impl → DeSlop → ValidateInner → LaneOuter → RepoVerify → Review → DraftPR.
2. Write or update the colocated `.spec.ts` (TDD); annotate unreachable code with reasoned istanbul ignore only.
3. ValidateInner: `export GITHUB_BASE_REF=<base>` then `npm run test:coverage` (Karma) and zero misses from `diff-coverage.mjs` on **PR-added executable `frontend/src` lines**. Skip-log = fail. Not global L/B/F/S 100%; not jest.
4. LaneOuter: invoke `/run-component-paired-e2e`. Missing visual secrets → `outer:blocked` (not silent skip).
5. RepoVerify: `make verify`. Independent Review required. Draft PR only when INNER ∧ LANE_OUTER ∧ REPO_VERIFY ∧ Review; never INNER-only; never merge.

**Example:**
```typescript
// user-profile.component.ts
export class UserProfileComponent {
  getUserName(user: User | null): string {
    if (!user) {
      /* istanbul ignore next -- user is always set in UI */
      return 'Unknown';
    }
    return user.name;
  }
}
```
```typescript
// user-profile.component.spec.ts
describe('UserProfileComponent', () => {
  it('returns user name when user is present', () => {
    // test logic
  });
  it('returns "Unknown" when user is null', () => {
    // test logic
  });
});
```

---

### Add 100% Behavioral Test Coverage for Service
**Trigger:** When you want to ensure a frontend Angular service is fully tested and meets strict coverage gates.  
**Command:** `/add-service-coverage`

1. Write or update the service's `.spec.ts` file to cover all public methods and code branches.
2. Assert correct HTTP verb, URL, params, and observable emissions for each method.
3. Annotate any unreachable SSR or defensive code with `/* istanbul ignore next */` if needed.
4. Run coverage tools for the service lane (**rewrite deferred** — do not treat scaffold 100% language as the component INNER gate; component WUs use diff-coverage + Karma).
5. Commit the `.spec.ts` file (and `.ts` if annotations are added).

**Example:**
```typescript
// api.service.ts
export class ApiService {
  fetchData(): Observable<Data> {
    return this.http.get<Data>('/api/data');
  }
}
```
```typescript
// api.service.spec.ts
it('should call GET /api/data', () => {
  // test logic
});
```

---

### Add 100% Behavioral Test Coverage for Utility or Guard
**Trigger:** When you want to fully test a utility, guard, or handler file for correctness and coverage compliance.  
**Command:** `/add-utility-coverage`

1. Write or update the `.spec.ts` file for the utility/guard/handler, covering all logic and error branches.
2. Annotate any unreachable code (e.g., SSR-only logic) with `/* istanbul ignore next */`.
3. Run coverage tools (**utility lane scaffold**; component INNER gate is diff-coverage + Karma — see component workflow).
4. Commit the `.spec.ts` file (and `.ts` if annotations are added).

**Example:**
```typescript
// auth.guard.ts
export function isAuthenticated(user: User | null): boolean {
  if (!user) {
    /* istanbul ignore next -- user always present in prod */
    return false;
  }
  return user.isLoggedIn;
}
```

---

### Add Istanbul Ignore Directives for Unreachable Branches
**Trigger:** When you encounter a code branch that cannot be covered in unit tests due to environment constraints or provable logic.  
**Command:** `/add-istanbul-ignore`

1. Identify the unreachable branch (e.g., SSR-only code, defensive fallback).
2. Annotate the branch with a reasoned `/* istanbul ignore next */` or `/* istanbul ignore file */` directive, matching repo conventions.
3. Document the reasoning in a comment for future maintainers.
4. Commit the updated file.

**Example:**
```typescript
if (typeof window === 'undefined') {
  /* istanbul ignore next -- SSR only */
  doSsrLogic();
}
```

---

### Merge Feature Coverage Branch into Main Coverage Branch
**Trigger:** When a coverage feature branch is ready to be integrated into the main coverage branch.  
**Command:** `/merge-coverage-branch`

1. Open a merge request from the feature coverage branch to the main coverage branch.
2. Resolve any conflicts (usually in `.ts` or `.spec.ts` files).
3. Complete the merge, ensuring the main branch now includes the new/updated spec and source files.

---

## Testing Patterns

- **Framework:**  
  Frontend unit tests run under **Karma** via `npm run test:coverage`. E2E uses Playwright. Do not use jest for the component INNER gate.

- **Test File Pattern:**  
  All test files use the `.spec.ts` suffix and are colocated with their source files.

- **Coverage Enforcement:**  
  INNER ratchet = 100% of **PR-added executable lines under `frontend/src`** via `diff-coverage.mjs` with `GITHUB_BASE_REF` set (skip ≠ green). Unreachable code is annotated with Istanbul ignore directives and a comment explaining why. Paired OUTER + `make verify` + Review required for WU done.

- **Test Example:**
  ```typescript
  // math.util.ts
  export function add(a: number, b: number): number {
    return a + b;
  }

  // math.util.spec.ts
  import { add } from './math.util';

  describe('add', () => {
    it('adds two numbers', () => {
      expect(add(2, 3)).toBe(5);
    });
  });
  ```

---

## Commands

| Command                 | Purpose                                                      |
|-------------------------|--------------------------------------------------------------|
| /add-component-coverage | Alias → `/add-100-percent-behavioral-test-coverage-for-component` (INNER diff-coverage + OUTER + verify + draft PR) |
| /add-100-percent-behavioral-test-coverage-for-component | Governed component coverage WU (gate-truth: PR-added lines, Karma) |
| /run-component-paired-e2e | LaneOuter Playwright map + visual blocked semantics |
| /add-service-coverage   | Service coverage scaffold (rewrite deferred) |
| /add-utility-coverage   | Add or update a utility/guard/handler spec |
| /add-istanbul-ignore    | Annotate unreachable code branches with Istanbul directives  |
| /merge-coverage-branch  | Merge a coverage feature branch into the main branch         |
```
