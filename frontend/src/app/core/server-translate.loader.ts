/* istanbul ignore file -- server-only SSR i18n loader: its translation read path runs node:fs/node:path solely inside the Node SSR runtime and cannot execute under the browser Karma test environment (require('node:*') is unavailable in the browser bundle) */
import { Injectable } from '@angular/core';
import { TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

type TranslateMap = Record<string, any>;

// This loader only ever runs inside the CommonJS SSR runtime. The Node fs/path
// builtins are obtained through a runtime require kept opaque to the browser
// bundler (Karma/webpack) so it never tries to bundle the `node:` scheme; the
// synchronous read behaviour required for in-render SSR i18n is preserved.
declare const require: (id: string) => any;

@Injectable()
export class ServerTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    const normalized = this.normalizeLang(lang);
    const loadNodeModule = (name: 'fs' | 'path') => require(`node:${name}`);
    const { existsSync, readFileSync } = loadNodeModule('fs');
    const { join } = loadNodeModule('path');
    const candidates = [
      join(process.cwd(), 'dist', 'app', 'browser', 'assets', 'i18n', `${normalized}.json`),
      join(process.cwd(), 'src', 'assets', 'i18n', `${normalized}.json`),
    ];
    for (const candidate of candidates) {
      const parsed = this.tryRead(existsSync, readFileSync, candidate);
      if (parsed) return of(parsed);
    }
    return of({});
  }

  private normalizeLang(lang: string): 'en' | 'ro' {
    const value = (lang || '').trim().toLowerCase();
    return value === 'ro' ? 'ro' : 'en';
  }

  private tryRead(
    existsSync: (path: string) => boolean,
    readFileSync: (path: string, encoding: 'utf8') => string,
    path: string,
  ): TranslateMap | null {
    try {
      if (!existsSync(path)) return null;
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as TranslateMap) : null;
    } catch {
      return null;
    }
  }
}
