# UI/UX Keyboard Smoke Checklist

Use this checklist for the UI/UX refactor accessibility phase-2 evidence.

## Playwright (automated)

Run:

```bash
E2E_BASE_URL=https://momentstudio.ro npm -C frontend run e2e -- frontend/e2e/accessibility-keyboard.spec.ts
```

Coverage:
- Shopper login form tab order (`Email or username` → `Password` → `Login`).
- Legal consent modal focus loop (`Accept` ↔ `Close`) and consent completion.
- Admin orders page route heading focus + keyboard reachability to search filter (requires `E2E_OWNER_PASSWORD`).

## Manual QA (desktop + mobile)

Record pass/fail and timestamp in release notes:

1. **Shopper login (`/login`)**
   - Tab order stays predictable and visible.
   - Focus ring remains visible in both light and dark themes.
2. **Checkout legal modals**
   - Focus is trapped while modal is open.
   - Focus returns to trigger checkbox after closing.
3. **Admin products/orders/content (desktop + mobile)**
   - Route heading receives focus after navigation.
   - Primary actions are reachable without mouse.
   - Sticky mobile action bars remain keyboard reachable.
4. **Critical buttons**
   - Disabled/loading buttons do not consume focus unexpectedly.
   - Error actions (`Retry`, `Back`) are focusable and actionable.
