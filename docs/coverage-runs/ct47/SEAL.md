# Ct47 SEAL — CONDITIONAL

- Spec: frontend/src/app/pages/contact/contact.component.extra.spec.ts
- Target: ContactComponent assertion gaps (IG thumbnail / admin edit DOM / tel+mailto hrefs)
- New its:
  - renders an Instagram thumbnail image when thumbnail_url is present
  - shows the edit button in the DOM when storefront admin mode is enabled
  - exposes tel and mailto hrefs from the social phone and email signals
- INNER: 28 SUCCESS (focused `ng test --include='**/contact.component.extra.spec.ts'`; ≥3 new)
- make verify: pending (do not run full verify in this WU)
- Draft PR: do not open (report-only)
- tip: see branch HEAD after this seal commit
