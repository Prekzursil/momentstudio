# Ct46 SEAL — CONDITIONAL

- Spec: frontend/src/app/pages/contact/contact.component.extra.spec.ts
- Target: ContactComponent assertion gaps (whitespace preview / FB initials / empty-title h1)
- New its:
  - uses the public contact path when preview token is whitespace-only
  - renders facebook avatar initials when the page has no thumbnail_url
  - falls back the h1 to contact.title when the CMS title is empty
- INNER: 28 SUCCESS (focused `ng test --include='**/contact.component.extra.spec.ts'`; ≥3 new)
- make verify: pending (do not run full verify in this WU)
- Draft PR: pending after push
- tip: see branch HEAD after this seal commit
