# Admin Instructions

Scope:

- `frontend/src/app/pages/admin/**`
- `frontend/src/app/pages/admin/content/**`
- `frontend/src/app/pages/admin/shared/**`

Rules:

- Admin pages are operational control surfaces:
  - one primary workflow per page.
- Prevent duplicate action clusters:
  - keep top 1-3 actions visible, move the rest to overflow.
- Preserve first-paint reliability:
  - no interaction-gated rendering.
- Keep dense tables/forms readable:
  - avoid nested scrollbars and sticky-layer stacking.
- For DAM and ops pages:
  - preserve audit timeline clarity and deterministic state transitions.
