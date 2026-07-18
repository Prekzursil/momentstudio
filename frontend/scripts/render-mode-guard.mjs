//
// WU6 (B1 / repo-reality #2) - render-mode guard.
//
// This repo renders the storefront 100% request-time via src/server.ts
// (CommonEngine.render per request, which injects the theme <style> + CSP). It
// has no app.routes.server.ts / ServerRoute[] surface. The "re-theme with no
// rebuild" guarantee therefore hinges on themeable storefront routes staying on
// that express request-time path and NEVER being moved under angular.json's
// inert `prerender` build target - a prerendered route is baked at build time,
// which would either freeze the theme or drop the request-time injection
// entirely. Since the ENTIRE public storefront is themeable, the config
// invariant is simply: the prerender target bakes NO routes, and the
// request-time `server` target (src/server.ts) is the SSR host.
//
// This is a config/CI assertion (not a ServerRoute[] classification, which this
// builder ignores). Run standalone (`node scripts/render-mode-guard.mjs`) it
// exits non-zero on a violation; scripts/render-mode-guard.spec.mjs is the
// red-then-green proof over both the real config and a seeded regression.
//

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'app';
export const SERVER_TARGET = 'server';
export const SERVER_BUILDER = '@angular-devkit/build-angular:server';
export const SERVER_MAIN = 'src/server.ts';
export const PRERENDER_TARGET = 'prerender';

const DEFAULT_ANGULAR_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'angular.json');

/** The architect target map for the `app` project (throws if absent). */
export function getArchitect(angularJson) {
  const project = angularJson?.projects?.[PROJECT];
  if (project === undefined) {
    throw new Error(`render-mode-guard: angular.json has no "${PROJECT}" project`);
  }
  const architect = project.architect;
  if (architect === undefined) {
    throw new Error(`render-mode-guard: project "${PROJECT}" has no architect targets`);
  }
  return architect;
}

/**
 * Assert the request-time `server` target is the SSR host: it exists, uses the
 * `:server` builder, and points at src/server.ts (the express entry that injects
 * the theme per request). Without this, there is no request-time theming host.
 */
export function assertRequestTimeServerTarget(angularJson) {
  const architect = getArchitect(angularJson);
  const server = architect[SERVER_TARGET];
  if (server === undefined) {
    throw new Error(
      `render-mode-guard: missing "${SERVER_TARGET}" target - the request-time SSR host`,
    );
  }
  if (server.builder !== SERVER_BUILDER) {
    throw new Error(
      `render-mode-guard: "${SERVER_TARGET}" builder must be ${SERVER_BUILDER}, got ${String(
        server.builder,
      )}`,
    );
  }
  const main = server.options?.main;
  if (main !== SERVER_MAIN) {
    throw new Error(
      `render-mode-guard: "${SERVER_TARGET}" options.main must be ${SERVER_MAIN} (the theme-injecting express entry), got ${String(
        main,
      )}`,
    );
  }
}

/**
 * Assert the inert `prerender` target bakes NO route. Every public storefront
 * route is themeable, so any baked route would break request-time re-theming.
 * A missing prerender target is fine (nothing is baked).
 */
export function assertNoThemeablePrerender(angularJson) {
  const architect = getArchitect(angularJson);
  const prerender = architect[PRERENDER_TARGET];
  if (prerender === undefined) {
    return;
  }
  const routes = prerender.options?.routes ?? [];
  if (!Array.isArray(routes)) {
    throw new Error(
      `render-mode-guard: "${PRERENDER_TARGET}" options.routes must be an array, got ${typeof routes}`,
    );
  }
  if (routes.length > 0) {
    throw new Error(
      `render-mode-guard: "${PRERENDER_TARGET}" bakes themeable route(s) [${routes.join(
        ', ',
      )}] at build time - move them off the prerender target so they render request-time (theme injected per request, no rebuild to re-theme)`,
    );
  }
}

/** Full render-mode guard: request-time host present + nothing baked. */
export function assertRequestTimeTheming(angularJson) {
  assertRequestTimeServerTarget(angularJson);
  assertNoThemeablePrerender(angularJson);
}

/** Parse an angular.json from disk. */
export function readAngularJson(path = DEFAULT_ANGULAR_JSON) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Standalone CLI: exit non-zero (with a terminal-state marker) on a violation.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertRequestTimeTheming(readAngularJson());
    process.stdout.write('SUCCESS:render-mode-guard themeable routes render request-time\n');
  } catch (err) {
    process.stderr.write(`FAILED:render-mode-guard ${err.message}\n`);
    process.exitCode = 1;
  }
}
