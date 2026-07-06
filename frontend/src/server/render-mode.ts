/**
 * Render-mode classification for the SSR theme sink (P1a WU6).
 *
 * This repo renders 100% request-time via server.ts (CommonEngine.render per
 * request); it has no app.routes.server.ts / ServerRoute[] surface (old
 * `@angular-devkit/build-angular:server` builder). The "re-theme with no
 * rebuild" guarantee therefore hinges on themeable storefront routes staying on
 * the express request-time path and NEVER being baked under angular.json's inert
 * `prerender` build target (which would freeze — or drop — the theme at build
 * time). This module names which routes are themeable so the guard test and the
 * request-time render test can both reason about them; the angular.json config
 * assertion lives in scripts/render-mode-guard.mjs.
 */

/** Storefront route prefixes that render themed via the request-time SSR sink. */
export const THEMEABLE_STOREFRONT_ROUTES: readonly string[] = Object.freeze([
  '/',
  '/shop',
  '/about',
  '/contact',
  '/blog',
]);

/**
 * Route prefixes that are NOT themeable — the admin/account surfaces consume the
 * shared slate/indigo primitives, not the storefront theme tokens, and are
 * auth-gated (never prerendered anyway).
 */
const NON_THEMEABLE_PREFIXES: readonly string[] = Object.freeze(['/admin', '/account']);

/** Strip query/hash so classification works on the path alone. */
function pathOf(url: string): string {
  const queryAt = url.indexOf('?');
  const hashAt = url.indexOf('#');
  let end = url.length;
  if (queryAt !== -1 && queryAt < end) {
    end = queryAt;
  }
  if (hashAt !== -1 && hashAt < end) {
    end = hashAt;
  }
  return url.slice(0, end);
}

/**
 * Is `url` a themeable storefront route (served request-time with the injected
 * theme `<style>`)? Admin/account paths are not themeable; everything else on
 * the public storefront is.
 */
export function isThemeableRoute(url: string): boolean {
  const path = pathOf(url);
  return !NON_THEMEABLE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
