# Final Audit Scorecard: Main vs PR #199

Date: 2026-02-16  
Baseline: PR #199 (`5e3b438520a023ae2f3d1ce3b27fa772e10aa627`)  
Current head audited: `dd589b6adcfcc295b14f0c9cae71abb949d1dbf7`

## Verdict

`PASS` - current `main` is better-than-or-equal to PR #199 for critical contracts, with no unresolved S1/S2 regressions.

## Contract Gate Results

1. Netopia webhook 200-ack contract (PR #199 core contract): **PASS**
2. Checkout/compose smoke payment coverage contract: **PASS**
3. Main required checks trend (backend/frontend/compose-smoke/CodeQL): **PASS**
4. Shipping/Fan path operational in baseline production and covered in main tests: **PASS**
5. Media/DAM admin contract targeted tests: **PASS**

## Findings (Ranked)

### S3-1: provider-mode test parity trap (fixed)

- Issue: one checkout assertion assumed providers-mode capture ID under dev mock defaults.
- Evidence:
  - pre-fix run: `37 passed, 1 failed` in `PAYMENTS_PROVIDER=mock`.
  - providers-mode run: `38 passed`.
- Remediation:
  - hardened `backend/tests/test_checkout_flow.py` to assert correct behavior in both provider modes.
- Status: **resolved**.

### S3-2: dev locker defaults could look broken by configuration (fixed)

- Issue: local dev profile could initialize with `LOCKERS_USE_OVERPASS_FALLBACK=0` and `SAMEDAY_MIRROR_ENABLED=1`.
- User-facing impact: Fan/Sameday could appear unavailable locally when credentials/snapshot are absent.
- Remediation:
  - `scripts/env/bootstrap.sh` now seeds dev with:
    - `LOCKERS_USE_OVERPASS_FALLBACK=1`
    - `SAMEDAY_MIRROR_ENABLED=0`
  - `scripts/env/doctor.sh` now warns explicitly for inconsistent locker config in dev.
  - docs updated in `docs/ENVIRONMENT_PROFILES.md`.
- Status: **resolved**.

### S4-1: non-blocking sqlite thread warnings in tests (known, not introduced here)

- Issue: occasional `aiosqlite` shutdown warnings in test teardown.
- Impact: noise only; no functional regression observed.
- Status: accepted as non-blocking for this audit batch.

## Production Comparison Notes

Observed on production baseline (`momentstudio.ro`):

- Fan lockers: available (`200`).
- Sameday lockers: unavailable (`503`, not configured).
- Sameday cities endpoint: `404` (expected for baseline deployment that predates mirror API rollout).

Interpretation:

- No contradiction with PR #199 baseline goals.
- Sameday mirror behavior is a post-199 capability and deployment/config topic, not a PR #199 contract regression.

## Acceptance Criteria Check

1. Evidence-backed audit artifacts produced: **PASS**
2. Better-or-equal on baseline critical contracts: **PASS**
3. Confirmed regressions fixed in one branch: **PASS**
4. Fan/Sameday/media paths explicitly validated: **PASS**
5. Env parity hardening added: **PASS**
6. No unresolved S1/S2 findings: **PASS**
