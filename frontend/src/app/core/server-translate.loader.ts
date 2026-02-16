import { Injectable } from '@angular/core';
import { TranslateLoader } from '@ngx-translate/core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Observable, of } from 'rxjs';

type TranslateMap = Record<string, any>;

@Injectable()
export class ServerTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    const normalized = this.normalizeLang(lang);
    const candidates = [
      join(process.cwd(), 'dist', 'app', 'browser', 'assets', 'i18n', `${normalized}.json`),
      join(process.cwd(), 'src', 'assets', 'i18n', `${normalized}.json`),
    ];
    for (const candidate of candidates) {
      const parsed = this.tryRead(candidate);
      if (parsed) return of(parsed);
    }
    return of({});
  }

  private normalizeLang(lang: string): 'en' | 'ro' {
    const value = (lang || '').trim().toLowerCase();
    return value === 'ro' ? 'ro' : 'en';
  }

  private tryRead(path: string): TranslateMap | null {
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
