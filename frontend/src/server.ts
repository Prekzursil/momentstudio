import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import bootstrap from './main.server';

function resolveIndexHtml(distFolder: string): string {
  const original = join(distFolder, 'index.original.html');
  return existsSync(original) ? original : join(distFolder, 'index.html');
}

function renderAngularApp(commonEngine: CommonEngine, indexHtml: string, distFolder: string): express.RequestHandler {
  return (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;
    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: distFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
      })
      .then((html) => res.send(html))
      .catch((err) => next(err));
  };
}

// The Express app is exported so that it can be reused by tests/other runtimes.
export function app(): express.Express {
  const server = express();
  const distFolder = join(process.cwd(), 'dist/app/browser');
  const indexHtml = resolveIndexHtml(distFolder);
  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', distFolder);

  server.use(express.static(distFolder, {
    maxAge: '1y',
    index: false,
  }));

  server.use(renderAngularApp(commonEngine, indexHtml, distFolder));

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
