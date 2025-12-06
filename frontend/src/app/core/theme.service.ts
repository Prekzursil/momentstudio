import { Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly preferenceSignal = signal<ThemePreference>('system');
  private readonly modeSignal = signal<ThemeMode>('light');
  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'matchMedia' in window) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener?.('change', (event) => {
        if (this.preferenceSignal() === 'system') {
          this.applyMode(event.matches ? 'dark' : 'light');
        }
      });
    }
    const saved = this.getSavedPreference();
    this.setPreference(saved, false);
  }

  preference() {
    return this.preferenceSignal.asReadonly();
  }

  mode() {
    return this.modeSignal.asReadonly();
  }

  toggle(): void {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.preferenceSignal()) + 1) % order.length];
    this.setPreference(next);
  }

  setPreference(pref: ThemePreference, persist = true): void {
    this.preferenceSignal.set(pref);
    const resolved = this.resolveMode(pref);
    this.applyMode(resolved);
    if (persist && typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', pref);
    }
  }

  private resolveMode(pref: ThemePreference): ThemeMode {
    if (pref === 'system') {
      const prefersDark = this.mediaQuery?.matches;
      return prefersDark ? 'dark' : 'light';
    }
    return pref;
  }

  private applyMode(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', mode === 'dark');
    }
  }

  private getSavedPreference(): ThemePreference {
    if (typeof localStorage === 'undefined') return 'system';
    const saved = localStorage.getItem('theme') as ThemePreference | null;
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
    return 'system';
  }
}
