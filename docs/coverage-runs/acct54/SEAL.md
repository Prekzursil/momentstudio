# Acct54 SEAL — CONDITIONAL

- Spec: `frontend/src/app/pages/account/account-profile.arms.spec.ts`
- Target: account/profile dirty-save guards, avatar crop zoom normalize, section toggles
- INNER: **3 SUCCESS** (focused `ng test --include='**/account-profile.arms.spec.ts'`)
- N=3:
  1. `marks profile dirty on edits, discards to baseline, and saveProfile no-ops when signed out`
  2. `normalizes avatar crop zoom transform for finite, NaN, and out-of-range values`
  3. `navigateToSection skips blank/password and navigationSection remaps password to security`
- `make verify`: **skipped** (per WU; INNER only)
- Draft PR: pending after push
- tip: see branch HEAD after this seal commit
