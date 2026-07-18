//
// WU6 render-mode guard - red-then-green proof over angular.json + server.ts.
//
// GREEN: the real angular.json keeps every themeable storefront route on the
// request-time server target and bakes nothing under prerender, and server.ts
// injects the theme inside its per-request handler. RED: seeding a themeable
// route under prerender, or breaking the request-time server host, trips the
// guard - so the "re-theme with no rebuild" invariant is machine-checked, not
// trusted.
//

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRERENDER_TARGET,
  SERVER_MAIN,
  SERVER_TARGET,
  assertNoThemeablePrerender,
  assertRequestTimeServerTarget,
  assertRequestTimeTheming,
  readAngularJson,
} from './render-mode-guard.mjs';

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

test('GREEN: the real angular.json passes the render-mode guard', () => {
  const angularJson = readAngularJson();
  assert.doesNotThrow(() => assertRequestTimeTheming(angularJson));

  const architect = angularJson.projects.app.architect;
  // The request-time SSR host is src/server.ts...
  assert.equal(architect[SERVER_TARGET].options.main, SERVER_MAIN);
  // ...and the inert prerender target bakes NO themeable route.
  assert.deepEqual(architect[PRERENDER_TARGET].options.routes, []);
});

test('RED: a themeable route seeded under the prerender target trips the guard', () => {
  const angularJson = structuredClone(readAngularJson());
  angularJson.projects.app.architect[PRERENDER_TARGET].options.routes = ['/'];
  assert.throws(() => assertNoThemeablePrerender(angularJson), /bakes themeable route/);
  assert.throws(() => assertRequestTimeTheming(angularJson), /prerender/);
});

test('RED: a non-array prerender routes value trips the guard', () => {
  const angularJson = structuredClone(readAngularJson());
  angularJson.projects.app.architect[PRERENDER_TARGET].options.routes = '/';
  assert.throws(() => assertNoThemeablePrerender(angularJson), /must be an array/);
});

test('GREEN: a missing prerender target is fine (nothing is baked)', () => {
  const angularJson = structuredClone(readAngularJson());
  delete angularJson.projects.app.architect[PRERENDER_TARGET];
  assert.doesNotThrow(() => assertNoThemeablePrerender(angularJson));
});

test('RED: breaking the request-time server host trips the guard', () => {
  const missing = structuredClone(readAngularJson());
  delete missing.projects.app.architect[SERVER_TARGET];
  assert.throws(() => assertRequestTimeServerTarget(missing), /missing "server" target/);

  const rebuilt = structuredClone(readAngularJson());
  rebuilt.projects.app.architect[SERVER_TARGET].options.main = 'src/prerender-baked.ts';
  assert.throws(() => assertRequestTimeServerTarget(rebuilt), /options\.main must be/);

  const wrongBuilder = structuredClone(readAngularJson());
  wrongBuilder.projects.app.architect[SERVER_TARGET].builder =
    '@angular-devkit/build-angular:prerender';
  assert.throws(() => assertRequestTimeServerTarget(wrongBuilder), /builder must be/);
});

test('RED: an angular.json with no app project / architect trips the guard', () => {
  assert.throws(() => assertRequestTimeTheming({ projects: {} }), /no "app" project/);
  assert.throws(() => assertRequestTimeTheming({ projects: { app: {} } }), /no architect targets/);
});

// The other half of the invariant: server.ts must inject the theme at REQUEST
// time - inside the per-request CommonEngine.render(...).then(...) handler, not
// at build/prerender time. A static source assertion (server.ts is a node-only
// express bootstrap, excluded from the karma runtime) that the wiring is present
// and request-scoped.
test('server.ts injects the theme inside the per-request render handler (request-time)', () => {
  const server = readFileSync(join(FRONTEND_DIR, 'src', 'server.ts'), 'utf8');
  const renderAt = server.indexOf('commonEngine');
  const thenAt = server.indexOf('.then(', renderAt);
  const catchAt = server.indexOf('.catch(', thenAt);
  assert.ok(renderAt !== -1 && thenAt !== -1 && catchAt !== -1, 'per-request render chain present');

  const handler = server.slice(thenAt, catchAt);
  // The theme is resolved + injected + CSP-set for THIS request, in the handler.
  assert.match(handler, /getThemeTokens\(/, 'resolves the published theme per request');
  assert.match(handler, /applyThemeSsr\(/, 'injects the theme <style> per request');
  assert.match(handler, /Content-Security-Policy-Report-Only/, 'sets the per-request CSP header');
});
