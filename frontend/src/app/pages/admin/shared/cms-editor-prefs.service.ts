import { Injectable, signal } from '@angular/core';
import { AuthService } from '../../../core/auth.service';

export type CmsEditorMode = 'simple' | 'advanced';

@Injectable({ providedIn: 'root' })
export class CmsEditorPrefsService {
  mode = signal<CmsEditorMode>('simple');

  constructor(private auth: AuthService) {
    this.load();
  }

  setMode(mode: CmsEditorMode): void {
    this.mode.set(mode);
    this.persist();
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'simple' ? 'advanced' : 'simple');
  }

  private storageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.content.editorMode.v1:${userId || 'anonymous'}`;
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

