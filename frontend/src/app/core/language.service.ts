import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

export type AppLanguage = 'en' | 'ro';

function normalizeLanguage(value: string | null | undefined): AppLanguage | null {
  return value === 'ro' ? 'ro' : value === 'en' ? 'en' : null;
}

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly languageSignal = signal<AppLanguage>('en');
  readonly language = this.languageSignal.asReadonly();

  constructor(
    private translate: TranslateService,
    private auth: AuthService,
    private toast: ToastService
  ) {
    const savedLang = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;
    const userLang = this.auth.user()?.preferred_language;
    const browserLang = this.translate.getBrowserLang();

    const initial =
      normalizeLanguage(userLang) ??
      normalizeLanguage(savedLang) ??
      (browserLang === 'ro' ? 'ro' : 'en');

    this.setLanguage(initial, { persist: false, syncBackend: false });
  }

  setLanguage(lang: AppLanguage, opts?: { persist?: boolean; syncBackend?: boolean }): void {
    const persist = opts?.persist ?? true;
    const syncBackend = opts?.syncBackend ?? true;

    this.languageSignal.set(lang);
    this.translate.use(lang);
    this.applyDocumentLanguage(lang);

    if (persist && typeof localStorage !== 'undefined') {
      localStorage.setItem('lang', lang);
    }

    if (syncBackend && this.auth.isAuthenticated()) {
      this.auth.updatePreferredLanguage(lang).subscribe({
        error: () =>
          this.toast.error(
            this.translate.instant('auth.languageNotSaved'),
            this.translate.instant('auth.languageNotSavedDetail')
          )
      });
    }
  }

  private applyDocumentLanguage(lang: AppLanguage): void {
    if (typeof document === 'undefined') return;
    try {
      document.documentElement.lang = lang;
    } catch {
      // ignore
    }
  }
}
