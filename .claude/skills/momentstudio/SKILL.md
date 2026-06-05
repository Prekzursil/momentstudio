````markdown
# momentstudio Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill provides guidance on the development patterns, coding conventions, and workflows used in the `momentstudio` Python codebase. It covers file organization, code style, commit conventions, and routine maintenance tasks to ensure code quality and consistency.

## Coding Conventions

### File Naming

- Use **snake_case** for all Python file names.
  - Example: `user_profile.py`, `data_loader.py`

### Import Style

- Prefer **relative imports** within the package.
  - Example:
    ```python
    from .models import User
    from ..utils import format_date
    ```

### Export Style

- Use **named exports**; explicitly define what is exported from each module.
  - Example:
    ```python
    __all__ = ["User", "Profile"]
    ```

### Commit Messages

- Follow **Conventional Commit** format.
- Common prefixes: `refactor`, `style`
  - Example:
    ```
    refactor: optimize coupon validation logic for performance
    style: apply Black formatting to analytics module
    ```

## Workflows

### Code Cleanup and Formatting

**Trigger:** When code quality tools (like linters or static analyzers) report issues, or after a batch of changes to maintain style consistency.  
**Command:** `/cleanup-format`

1. **Identify Issues:** Use static analysis tools (e.g., CodeQL, Ruff) to find dead code and unused imports.
2. **Remove or Refactor:** Clean up the identified code in relevant files.
   - Example:

     ```python
     # Before
     import os
     import sys  # unused

     # After
     import os
     ```

3. **Format Code:** Run formatting tools (e.g., Autopep8, Black, Ruff Formatter) on affected files.
   - Example command:
     ```
     black backend/app/api/v1/analytics.py
     ```
4. **Verify:** Ensure linters and formatters report no further issues.
   - Example command:
     ```
     ruff check backend/app/api/v1/analytics.py
     ```
5. **Document:** Optionally, comment on any non-obvious changes in code or commit messages.

**Files Commonly Involved:**

- `backend/app/api/v1/analytics.py`
- `backend/app/api/v1/coupons_v2.py`
- `backend/app/services/catalog.py`
- `scripts/audit/collect_audit_evidence.py`

**Frequency:** ~2x/month

## Testing Patterns

- **Test File Naming:** Test files follow the `*.test.*` pattern.
  - Example: `user_service.test.py`
- **Testing Framework:** Not explicitly detected; check project documentation or test files for specifics.
- **Test Structure:** Place tests alongside or near the modules they cover.

## Commands

| Command         | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| /cleanup-format | Run code cleanup and formatting workflow as described above. |
````
