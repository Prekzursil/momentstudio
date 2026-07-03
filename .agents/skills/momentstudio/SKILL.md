```markdown
# momentstudio Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development, testing, and coverage enforcement patterns used in the `momentstudio` TypeScript codebase. The repository emphasizes strict behavioral test coverage (100% for most files), clear code organization, and maintainable conventions for both code and tests. While Angular components and services are present, the patterns apply broadly to frontend TypeScript projects with a focus on robust testing and code quality.

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
**Trigger:** When you want to ensure a frontend Angular component is fully tested and meets strict coverage gates.  
**Command:** `/add-component-coverage`

1. Write or update the component's `.spec.ts` file to cover all logic branches, methods, and error paths.
2. Annotate any genuinely unreachable code (e.g., SSR guards) with `/* istanbul ignore next */` and a comment explaining why.
3. Run coverage tools (e.g., `jest --coverage`) to verify 100% line/branch/function/statement coverage.
4. Commit both the `.spec.ts` and (if needed) the component `.ts` file with coverage annotations.

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
4. Run coverage tools to verify 100% coverage.
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
3. Run coverage tools to verify 100% coverage.
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
  [Jest](https://jestjs.io/) is used for all testing.

- **Test File Pattern:**  
  All test files use the `.spec.ts` suffix and are colocated with their source files.

- **Coverage Enforcement:**  
  100% line/branch/function/statement coverage is enforced for most files.  
  Unreachable code is annotated with Istanbul ignore directives and a comment explaining why.

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
| /add-component-coverage | Add or update a component spec to achieve 100% coverage      |
| /add-service-coverage   | Add or update a service spec to achieve 100% coverage        |
| /add-utility-coverage   | Add or update a utility/guard/handler spec for 100% coverage |
| /add-istanbul-ignore    | Annotate unreachable code branches with Istanbul directives  |
| /merge-coverage-branch  | Merge a coverage feature branch into the main branch         |
```
