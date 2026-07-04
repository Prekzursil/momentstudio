import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import bootstrap from './main.server';
import { applyThemeSsr } from './server/theme-head';
import { resolvePreviewDoc } from './server/theme-preview-source';
import { defaultFetchDeps, getThemeTokens, readThemeConfig } from './server/theme-source';

// The Express app is exported so that it can be reused by tests/other runtimes.
export function app(): express.Express {
  const server = express();
  const distFolder = join(process.cwd(), 'dist/app/browser');
  const indexHtml = existsSync(join(distFolder, 'index.original.html'))
    ? join(distFolder, 'index.original.html')
    : join(distFolder, 'index.html');

  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', distFolder);

  server.use(
    express.static(distFolder, {
      maxAge: '1y',
      index: false,
    }),
  );

  // All regular routes use the Angular engine
  server.use((req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: distFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
      })
      // WU6/WU12: resolve the theme express-side (never via Angular HttpClient,
      // so it never enters TransferState) and inject the hash-pinned head <style>
      // + report-only CSP. When the request carries a `theme_preview` token, the
      // admin DRAFT/version is rendered instead of the published doc (token-gated
      // at the backend; WU12) — never published, never cached/indexed. A backend
      // blip / kill-switch / bad-or-expired preview token degrades to compiled
      // defaults inside applyThemeSsr — never a 500, never unstyled, never the
      // published doc leaked to a failed preview.
      .then(async (html) => {
        const config = readThemeConfig();
        const deps = defaultFetchDeps();
        const preview = await resolvePreviewDoc(originalUrl, config, deps);
        const doc = preview.isPreview ? preview.doc : await getThemeTokens(config, deps);
        const themed = await applyThemeSsr(html, doc);
        res.setHeader('Content-Security-Policy-Report-Only', themed.cspHeader);
        if (preview.isPreview) {
          // A draft render must never be cached or indexed (mirrors the backend
          // GET /theme/preview no-store / noindex headers).
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Robots-Tag', 'noindex');
        }
        res.send(themed.html);
      })
      .catch((err) => next(err));
  });

  return server;
}

function run(): void {
  const port = process.env['PORT'] || 4000;

  // Start up the Node server
  const server = app();
  server.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

// Keep startup ESM-safe: avoid CommonJS `require.main` checks in bundled output.
if (process.env['SSR_AUTOSTART'] !== '0') {
  run();
}

export default bootstrap;
