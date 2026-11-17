# Home45 SEAL — CONDITIONAL

- Spec: frontend/src/app/pages/home/home.component.spec.ts
- Target: HomeComponent `focalPosition` / `isExternalHttpUrl` / `columnsGridClasses`
- INNER: 5 SUCCESS (focused `ng test --include='**/home.component.spec.ts'`; N=3 new arms + 2 prior colocated)
- New arms (≥3 SUCCESS required):
  1. `focalPosition clamps, rounds, and defaults object-position percentages`
  2. `isExternalHttpUrl accepts trimmed http(s) and rejects non-http urls`
  3. `columnsGridClasses maps columns_count and breakpoint to the full grid class matrix`
- Evidence: `/tmp/home45-inner.log` EXIT:0 TOTAL:5 SUCCESS
- make verify: pending (serial karma; do not run full verify in this WU)
- Draft PR: pending after push
- tip_impl: 99207918398d264747906f713808c5a7d63bbab3
- Branch: cursor/golden-wu-home-focal-url-columns-coverage-4739
