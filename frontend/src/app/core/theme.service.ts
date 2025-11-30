import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly themeSignal = signal<Theme>('light');

  constructor() {
    const saved = typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') as Theme) : null;
    if (saved === 'dark' || saved === 'light') {
      this.themeSignal.set(saved);
      this.applyTheme(saved);
    }
  }

  theme() {
    return this.themeSignal.asReadonly();
  }

  toggle(): void {
    const next = this.themeSignal() === 'light' ? 'dark' : 'light';
    this.setTheme(next);
  }

  setTheme(theme: Theme): void {
    this.themeSignal.set(theme);
    this.applyTheme(theme);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', theme);
    }
  }

  private applyTheme(theme: Theme): void {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}
