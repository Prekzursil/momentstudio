# Err50 Select — error page message / nav / retry

N=3 first specs for the error recovery page (`ErrorComponent` had 0 specs on main):

1. `errorPageMessage` — known-kind mapping + generic fallback
2. `errorNavLinks` — home / shop / blog escape paths (sync with template routerLinks)
3. `shouldReloadOnRetry` — reload only when a reload fn exists and not already reloading

Helpers: `frontend/src/app/pages/error/error.helpers.ts`
Spec: `frontend/src/app/pages/error/error.component.spec.ts`

Branch: cursor/golden-wu-error-page-coverage-4739
