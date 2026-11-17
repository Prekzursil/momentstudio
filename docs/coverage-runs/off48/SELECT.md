# Off48 Select — offline retry / nav / online helpers

N=3 first specs for the tiny offline PWA page (`OfflineComponent` had 0 specs on main):

1. `offlineNavLinks` — home / shop / blog escape paths (sync with template routerLinks)
2. `detectBrowserOnline` — navigator.onLine read + optimistic default when API missing
3. `shouldReloadOnRetry` — reload only when online (offline stay)

Helpers: `frontend/src/app/pages/offline/offline.helpers.ts`
Spec: `frontend/src/app/pages/offline/offline.component.spec.ts`

Branch: cursor/golden-wu-offline-retry-coverage-4739
