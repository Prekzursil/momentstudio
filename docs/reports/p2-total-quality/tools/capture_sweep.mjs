/**
 * P2 capture sweep — "capture once, analyse many".
 *
 * Drives every route in routes.json across the viewport x theme matrix and writes
 * a self-contained evidence bundle per cell. Hundreds of analysis agents then read
 * those artifacts read-only, instead of each launching its own browser (this box
 * has ~1.5 GB free RAM; concurrent Chromium fleets freeze it — that failure mode is
 * already on the ledger).
 *
 * Per cell it records: screenshot, rendered HTML, console + page errors, failed
 * network requests, axe-core violations, layout/tap-target/contrast-adjacent DOM
 * metrics, and navigation timings.
 *
 * Deps resolve from the ui-audit skill (which vendors playwright + @axe-core/playwright)
 * via createRequire, so this file can live in the repo while reusing that toolchain.
 *
 * Usage:
 *   node capture_sweep.mjs --base http://localhost:4202 --out <dir> [--concurrency 2]
 *                          [--only storefront|admin] [--limit N] [--resume]
 *
 * Terminal state: prints SUCCESS:<id> or FAILED:<id> <reason> as the last line.
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA_SKILL = join(os.homedir(), '.claude', 'skills', 'ui-audit', 'package.json');
const req = createRequire(UA_SKILL);
const { chromium } = req('playwright');

let AxeBuilder = null;
try {
  const mod = req('@axe-core/playwright');
  AxeBuilder = mod.default ?? mod.AxeBuilder ?? mod;
} catch {
  AxeBuilder = null; // reported explicitly per cell — never silently "clean"
}

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = (arg('base', 'http://localhost:4202') || '').replace(/\/$/, '');
const OUT = arg('out', join(HERE, '..', '_artifacts'));
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '2'), 10) || 2);
const ONLY = arg('only');
// `--auth-only` re-captures just the gated routes (admin + account); `--anon-only`
// its complement. Needed because a session defect invalidates ONLY the gated half.
const AUTH_ONLY = flag('auth-only');
const ANON_ONLY = flag('anon-only');
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const RESUME = flag('resume');

const OWNER_USER = process.env.P2_OWNER_USER || 'owner';
const OWNER_PASS = process.env.P2_OWNER_PASS || '';

const VIEWPORTS = [
  { id: 'mobile', width: 375, height: 812 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 },
];
const THEMES = ['light', 'dark'];

// ---------------------------------------------------------------- helpers
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root';

/** In-page metrics: the deterministic signals analysis agents reason over. */
const COLLECT = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const interactive = Array.from(
    document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[tabindex]'),
  ).filter(vis);

  const smallTargets = interactive
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height),
               text: (el.textContent || '').trim().slice(0, 40),
               sel: el.id ? `#${el.id}` : el.className && typeof el.className === 'string'
                    ? `.${el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}` : el.tagName.toLowerCase() };
    })
    .filter((t) => (t.w < 24 || t.h < 24) && t.w > 0 && t.h > 0);

  const imgsNoAlt = Array.from(document.images)
    .filter((i) => !i.hasAttribute('alt'))
    .map((i) => (i.currentSrc || i.src || '').slice(-70));
  const imgsNoDims = Array.from(document.images)
    .filter((i) => !i.getAttribute('width') || !i.getAttribute('height'))
    .length;

  // Horizontal overflow: the classic i18n/long-string breakage.
  const de = document.documentElement;
  const overflowX = de.scrollWidth - de.clientWidth;
  const overflowing = Array.from(document.querySelectorAll('*'))
    .filter((el) => vis(el) && el.getBoundingClientRect().right > de.clientWidth + 2)
    .slice(0, 12)
    .map((el) => ({ tag: el.tagName.toLowerCase(),
                    sel: el.id ? `#${el.id}` : (typeof el.className === 'string' ? el.className.split(/\s+/)[0] : ''),
                    right: Math.round(el.getBoundingClientRect().right),
                    text: (el.textContent || '').trim().slice(0, 40) }));

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent || '').trim().slice(0, 70) }));

  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = Object.fromEntries(
    performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
  );

  return {
    title: document.title,
    lang: document.documentElement.lang || null,
    textLen: (document.body.innerText || '').trim().length,
    counts: {
      interactive: interactive.length,
      images: document.images.length,
      forms: document.forms.length,
      h1: document.querySelectorAll('h1').length,
    },
    headings: headings.slice(0, 25),
    a11yQuick: {
      imagesMissingAlt: imgsNoAlt.length,
      imagesMissingAltSamples: imgsNoAlt.slice(0, 6),
      imagesMissingDimensions: imgsNoDims,
      smallTapTargets: smallTargets.length,
      smallTapTargetSamples: smallTargets.slice(0, 8),
      emptyLinks: Array.from(document.querySelectorAll('a[href]'))
        .filter((a) => !(a.textContent || '').trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])'))
        .length,
      buttonsNoAccessibleName: Array.from(document.querySelectorAll('button'))
        .filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'))
        .length,
    },
    layout: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, overflowX, overflowing },
    seo: {
      metaDescription: document.querySelector('meta[name="description"]')?.content?.slice(0, 160) || null,
      canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
      jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
      robots: document.querySelector('meta[name="robots"]')?.content || null,
    },
    perf: {
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      transferSize: nav.transferSize || 0,
      ...paints,
    },
    themeTokens: {
      background: getComputedStyle(de).getPropertyValue('--background').trim() || null,
      text: getComputedStyle(de).getPropertyValue('--text').trim() || null,
      hasMsTheme: !!document.getElementById('ms-theme'),
    },
  };
};

async function captureCell(ctx, route, vp, theme, outDir) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => failedRequests.push({ url: r.url().slice(0, 160), err: r.failure()?.errorText || '' }));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ url: r.url().slice(0, 160), status: r.status() }); });

  const rec = { route: route.url, surface: route.surface, auth: route.auth, viewport: vp.id, theme,
                base: BASE, ok: false };
  const t0 = Date.now();
  try {
    const resp = await page.goto(BASE + route.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    rec.httpStatus = resp ? resp.status() : null;
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => { rec.networkIdle = false; });
    if (rec.networkIdle !== false) rec.networkIdle = true;
    await page.waitForTimeout(400);

    rec.metrics = await page.evaluate(COLLECT);
    rec.finalUrl = page.url().replace(BASE, '');
    rec.redirected = rec.finalUrl !== route.url;

    // HARD auth assertion. A gated route that bounces to `/` or `/login` renders the
    // PUBLIC page — axe/SEO/layout numbers collected from it describe the homepage,
    // not the admin screen, and they are indistinguishable from a clean result once
    // aggregated. The first sweep silently recorded 132 such cells as valid. Fail the
    // cell loudly instead, so triage can never consume a logged-out capture as
    // evidence about a gated screen.
    if (route.auth !== 'anon') {
      const f = rec.finalUrl;
      const bounced =
        f === '/' || f === '' || f.startsWith('/login') || f.startsWith('/auth/login') ||
        (route.url.startsWith('/admin') && !f.startsWith('/admin'));
      rec.authOk = !bounced;
      if (bounced) {
        rec.authFailed = true;
        throw new Error(`auth-bounce: gated ${route.url} rendered ${f} (session not applied)`);
      }
    }

    if (AxeBuilder) {
      try {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        rec.axe = {
          available: true,
          violationCount: results.violations.length,
          violations: results.violations.map((v) => ({
            id: v.id, impact: v.impact, help: v.help,
            nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, html: (n.html || '').slice(0, 160) })),
            nodeCount: v.nodes.length,
          })),
        };
      } catch (e) {
        rec.axe = { available: true, error: String(e.message).slice(0, 160) };
      }
    } else {
      rec.axe = { available: false, note: 'axe not installed — a11y NOT scanned for this cell' };
    }

    const stem = `${slug(route.url)}__${vp.id}__${theme}`;
    await page.screenshot({ path: join(outDir, `${stem}.png`), fullPage: true }).catch(() => {});
    writeFileSync(join(outDir, `${stem}.html`), await page.content(), 'utf8');
    rec.screenshot = `${stem}.png`;
    rec.html = `${stem}.html`;
    rec.ok = true;
  } catch (e) {
    rec.error = String(e.message).slice(0, 300);
  }
  rec.consoleErrors = consoleErrors.slice(0, 15);
  rec.pageErrors = pageErrors.slice(0, 15);
  rec.failedRequests = failedRequests.slice(0, 20);
  rec.elapsedMs = Date.now() - t0;
  await page.close().catch(() => {});
  return rec;
}

async function main() {
  const routesFile = join(HERE, '..', 'routes.json');
  const { routes } = JSON.parse(readFileSync(routesFile, 'utf8'));
  let work = routes.filter((r) => (ONLY ? r.surface === ONLY : true));
  if (AUTH_ONLY) work = work.filter((r) => r.auth !== 'anon');
  if (ANON_ONLY) work = work.filter((r) => r.auth === 'anon');
  if (LIMIT) work = work.slice(0, LIMIT);

  mkdirSync(OUT, { recursive: true });
  const cellsDir = join(OUT, 'cells');
  mkdirSync(cellsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // ONE login per worker, never a shared session.
  //
  // The backend ROTATES refresh tokens (auth.py `replaced_by_jti` / revoke-on-rotate).
  // Sharing a single storageState across N parallel workers therefore self-destructs:
  // the first worker to refresh revokes the token every other worker holds, they get
  // 401 on /api/v1/auth/refresh, the app logs them out and bounces to `/`. Measured on
  // the first sweep: the very first route captured fine and 132/216 later gated cells
  // rendered the homepage. Each worker logging in independently gets its own token
  // pair, so rotation is per-worker and uncontended; re-login on bounce additionally
  // covers plain access-token expiry over a long sweep.
  const needsAuth = work.some((r) => r.auth !== 'anon');

  async function login(tag) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage();
    let state;
    try {
      const res = await pg.request.post(`${BASE}/api/v1/auth/login`, {
        data: { identifier: OWNER_USER, password: OWNER_PASS },
      });
      const body = await res.json().catch(() => ({}));
      await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Real shape (verified): { user: {...}, tokens: { access_token, refresh_token, token_type } }
      // plus a refresh_token cookie. Seed every plausible storage key AND keep the
      // cookie, so the app bootstraps a session whichever mechanism it reads.
      const token =
        body?.tokens?.access_token || body?.access_token || body?.token || body?.data?.access_token;
      const refresh = body?.tokens?.refresh_token || body?.refresh_token;
      if (token) {
        await pg.evaluate(
          ({ t, r }) => {
            for (const k of ['access_token', 'token', 'auth_token', 'ms_access_token']) {
              localStorage.setItem(k, t);
            }
            if (r) localStorage.setItem('refresh_token', r);
            localStorage.setItem('auth', JSON.stringify({ access_token: t, refresh_token: r }));
          },
          { t: token, r: refresh },
        );
      }
      state = await ctx.storageState();
      // One login per gated cell would flood the log; only anomalies are interesting.
      if (res.status() !== 200 || !token) {
        console.log(`[auth:${tag}] login status=${res.status()} tokenCaptured=${!!token}`);
      }
    } catch (e) {
      console.log(`[auth:${tag}] FAILED: ${String(e.message).slice(0, 140)}`);
    }
    await ctx.close().catch(() => {});
    return state;
  }

  if (needsAuth && !OWNER_PASS) {
    console.log('[auth] no P2_OWNER_PASS provided — gated routes will FAIL the auth assertion');
  }

  const cells = [];
  for (const r of work) for (const vp of VIEWPORTS) for (const theme of THEMES) cells.push({ r, vp, theme });
  console.log(`[sweep] ${work.length} routes x ${VIEWPORTS.length} viewports x ${THEMES.length} themes = ${cells.length} cells (concurrency ${CONCURRENCY})`);

  let done = 0, failed = 0, skipped = 0, authFailed = 0;
  const index = [];
  let cursor = 0;

  async function worker(id) {
    let myState; // set per gated cell below (see the replay note there)

    while (cursor < cells.length) {
      const cell = cells[cursor++];
      const stem = `${slug(cell.r.url)}__${cell.vp.id}__${cell.theme}`;
      const outJson = join(cellsDir, `${stem}.json`);
      if (RESUME && existsSync(outJson)) { skipped++; index.push({ stem, resumed: true }); continue; }

      const gated = cell.r.auth !== 'anon';
      // A PRISTINE session per gated cell. Probed: two logins for the same user yield
      // independent, mutually-valid sessions, so parallelism is not the problem —
      // REPLAY is. Every browser context built from one saved storageState re-sends
      // the same refresh token, and the backend rotates-and-revokes on first use, so
      // context #2 onward can 401 and get logged out. One login per cell is ~0.2s and
      // removes that class entirely instead of relying on a rotation grace window.
      if (gated && OWNER_PASS) myState = (await login(`w${id}:${slug(cell.r.url)}`)) || myState;
      const attempt = async () => {
        const cellCtx = await browser.newContext({
          viewport: { width: cell.vp.width, height: cell.vp.height },
          colorScheme: cell.theme,
          storageState: gated ? myState : undefined,
          ignoreHTTPSErrors: true,
        });
        try {
          return await captureCell(cellCtx, cell.r, cell.vp, cell.theme, cellsDir);
        } catch (e) {
          return { route: cell.r.url, viewport: cell.vp.id, theme: cell.theme, ok: false,
                   error: String(e.message).slice(0, 200) };
        } finally {
          await cellCtx.close().catch(() => {});
        }
      };

      let rec = await attempt();
      // A bounce means this worker's session expired or was rotated out from under it.
      // Re-login and retry ONCE; if it bounces again the failure is real, not transient.
      if (gated && rec.authFailed && OWNER_PASS) {
        myState = (await login(`w${id}:relogin`)) || myState;
        rec = await attempt();
        rec.reloggedIn = true;
      }
      writeFileSync(outJson, JSON.stringify(rec, null, 2), 'utf8');
      index.push({ stem, route: rec.route, viewport: rec.viewport, theme: rec.theme, ok: rec.ok,
                   axeViolations: rec.axe?.violationCount ?? null,
                   consoleErrors: (rec.consoleErrors || []).length,
                   overflowX: rec.metrics?.layout?.overflowX ?? null });
      rec.ok ? done++ : failed++;
      if (rec.authFailed) authFailed++;
      if ((done + failed) % 20 === 0) console.log(`[sweep] ${done + failed}/${cells.length} (ok=${done} failed=${failed} authFailed=${authFailed})`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  await browser.close();

  writeFileSync(join(OUT, 'index.json'),
    JSON.stringify({ base: BASE, generatedFrom: 'capture_sweep.mjs', totals: { cells: cells.length, ok: done, failed, skipped, authFailed }, cells: index }, null, 2), 'utf8');

  console.log(`[sweep] ok=${done} failed=${failed} authFailed=${authFailed} skipped=${skipped} -> ${OUT}`);
  // An auth bounce is never acceptable: it silently substitutes the public page for a
  // gated one, so treat ANY occurrence as a run failure rather than a tolerated ratio.
  console.log(authFailed > 0 ? `FAILED:p2-capture-sweep ${authFailed} gated cells rendered logged-out`
            : failed > cells.length * 0.25 ? `FAILED:p2-capture-sweep too many cell failures (${failed}/${cells.length})`
                                           : `SUCCESS:p2-capture-sweep ok=${done} failed=${failed} skipped=${skipped}`);
}

main().catch((e) => { console.error(`FAILED:p2-capture-sweep ${String(e.stack || e.message).slice(0, 400)}`); process.exit(1); });
