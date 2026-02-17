# Production Safe Smoke (PR #199 Baseline Runtime)

Date: 2026-02-16  
Target: `https://momentstudio.ro`  
Access level: public + safe auth probes only (no destructive/admin mutations)

## Probe Summary

### Storefront/document shell

- `GET /` -> `200`
- `GET /shop` -> `200`
- `GET /contact` -> `200`
- `GET /blog` -> `200`
- `GET /products/non-existent-slug` -> `200` (SPA shell route)
- `GET /newsletter/confirm` -> `200` (SPA shell route)
- `GET /newsletter/unsubscribe` -> `200` (SPA shell route)

### API readiness/content

- `GET /api/v1/health/ready` -> `200`
- `GET /api/v1/content/home.sections` -> `200`
- `GET /api/v1/content/site.navigation` -> `200`

### Shipping APIs

- `GET /api/v1/shipping/lockers?provider=fan_courier...` -> `200` (returns locker list)
- `GET /api/v1/shipping/lockers?provider=sameday...` -> `503` (`Locker API is not configured`)
- `GET /api/v1/shipping/lockers/cities?provider=sameday...` -> `404` (endpoint absent on baseline deployment)

### Safe auth probes (no credentials)

- `POST /api/v1/auth/refresh` -> `401` (`Refresh token missing`) expected for anonymous probe
- `POST /api/v1/auth/login` with bogus credentials -> `400` (`CAPTCHA required`) expected under production captcha policy

## Interpretation

1. Production behavior is consistent with PR #199-era deployment posture (no Sameday mirror city endpoint, Sameday provider not configured).
2. Fan Courier path is available on production baseline.
3. Safe auth checks did not uncover unexpected 5xx behavior.
4. Full authenticated production flow was intentionally not executed because no production credentials were used in this audit.

Coverage gap recorded:
- Authenticated session and checkout pre-payment stages were validated locally, but only anonymous-safe probes were run on production.

