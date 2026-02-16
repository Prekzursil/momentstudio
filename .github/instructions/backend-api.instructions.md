# Backend API Instructions

Scope:

- `backend/app/api/**`
- `backend/app/services/**`
- `backend/app/models/**`
- `backend/app/schemas/**`
- `backend/alembic/**`

Rules:

- Keep API contracts additive unless explicitly declared breaking.
- Maintain deterministic behavior for CI evidence generation.
- For operational pipelines:
  - log structured status
  - preserve fallback behavior on upstream failures
  - avoid hard fail paths for user-facing checkout flows when snapshots exist
- Keep role-based access controls explicit in endpoint handlers.
- Add tests for any behavior change that impacts admin control surfaces or checkout-critical paths.
