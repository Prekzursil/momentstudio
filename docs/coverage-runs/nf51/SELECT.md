# Nf51 Select — not-found home / suggested / message keys

N=3 first specs for the 404 page (`NotFoundComponent` had 0 specs on main):

1. `notFoundHomeLinks` — primary home escape path (sync with template routerLink)
2. `notFoundSuggestedPaths` — shop / blog recovery paths (sync with template routerLinks)
3. `notFoundMessage` — eyebrow / title / body keys + body fallback

Helpers: `frontend/src/app/pages/not-found/not-found.helpers.ts`
Spec: `frontend/src/app/pages/not-found/not-found.component.spec.ts`

Branch: cursor/golden-wu-not-found-coverage-4739
