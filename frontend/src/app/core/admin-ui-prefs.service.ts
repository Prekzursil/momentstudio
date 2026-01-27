import { Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';

export type AdminUiMode = 'simple' | 'advanced';

@Injectable({ providedIn: 'root' })
export class AdminUiPrefsService {
  mode = signal<AdminUiMode>('simple');

  constructor(private auth: AuthService) {
    this.load();
  }

  setMode(mode: AdminUiMode): void {
    this.mode.set(mode);
    this.persist();
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'simple' ? 'advanced' : 'simple');
  }

  private storageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.ui.mode.v1:${userId || 'anonymous'}`;
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const mode = (parsed as any)?.mode;
      if (mode === 'simple' || mode === 'advanced') {
        this.mode.set(mode);
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify({ mode: this.mode() }));
    } catch {
      // ignore
    }
  }
}
