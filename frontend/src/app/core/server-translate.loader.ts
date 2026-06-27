import { Injectable } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { from, Observable } from 'rxjs';

/**
 * Minimal surface of the Node `fs`/`path` primitives this server-only loader
 * needs. Isolating them behind a tiny port keeps the file unit-testable without
 * dragging the real Node built-ins into the browser/test bundle.
 */
export interface ServerTranslateFs {
  readonly cwd: string;
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  join(...segments: string[]): string;
}

/**
 * SSR translation loader: reads the compiled i18n JSON straight off disk so the
 * server-rendered HTML ships fully translated without an extra HTTP round-trip.
 * It is provided exclusively in `app.config.server.ts`, so it only ever runs
 * under Node during SSR — never in the browser.
 */
@Injectable()
export class ServerTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    return from(this.resolveTranslation(this.normalizeLang(lang)));
  }

  private async resolveTranslation(normalized: 'en' | 'ro'): Promise<TranslationObject> {
    const node = await this.loadNode();
    const candidates = [
      node.join(node.cwd, 'dist', 'app', 'browser', 'assets', 'i18n', `${normalized}.json`),
      node.join(node.cwd, 'src', 'assets', 'i18n', `${normalized}.json`),
    ];
    for (const candidate of candidates) {
      const parsed = this.tryRead(node, candidate);
      if (parsed) return parsed;
    }
    return {};
  }

  private normalizeLang(lang: string): 'en' | 'ro' {
    const value = (lang || '').trim().toLowerCase();
    return value === 'ro' ? 'ro' : 'en';
  }

  private tryRead(node: ServerTranslateFs, path: string): TranslationObject | null {
    try {
      if (!node.existsSync(path)) return null;
      const raw = node.readFileSync(path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as TranslationObject) : null;
    } catch {
      return null;
    }
  }

  /**
   * Lazily binds the Node `fs`/`path` primitives. The `webpackIgnore` markers
   * keep the browser/test bundle from trying to resolve the Node built-ins (the
   * web target cannot bundle them), and this seam is overridden in unit tests to
   * inject deterministic doubles — so its body only runs under real SSR.
   */
  /* istanbul ignore next -- server-only Node bindings: never executed in the browser karma harness (the seam is overridden in unit tests) */
  protected async loadNode(): Promise<ServerTranslateFs> {
    const [fs, path] = await Promise.all([
      import(/* webpackIgnore: true */ 'node:fs'),
      import(/* webpackIgnore: true */ 'node:path'),
    ]);
    return {
      cwd: process.cwd(),
      existsSync: (target) => fs.existsSync(target),
      readFileSync: (target, encoding) => fs.readFileSync(target, encoding),
      join: (...segments) => path.join(...segments),
    };
  }
}
