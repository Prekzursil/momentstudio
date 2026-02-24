import { Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';

export type AdminUiMode = 'simple' | 'advanced';
export type AdminUiPreset = 'custom' | 'owner_basic';

@Injectable({ providedIn: 'root' })
export class AdminUiPrefsService {
  mode = signal<AdminUiMode>('simple');
  preset = signal<AdminUiPreset>('custom');
  sidebarCompact = signal(false);

  constructor(private readonly auth: AuthService) {
    this.load();
  }

  setPreset(preset: AdminUiPreset): void {
    this.preset.set(preset);
    if (preset === 'owner_basic') {
      this.mode.set('simple');
    }
    this.persist();
  }

  setMode(mode: AdminUiMode): void {
    if (this.preset() !== 'custom' && mode !== 'simple') {
      this.preset.set('custom');
    }
    this.mode.set(mode);
    this.persist();
  }

  setSidebarCompact(value: boolean): void {
    this.sidebarCompact.set(value);
    this.persist();
  }

  toggleSidebarCompact(): void {
    this.setSidebarCompact(!this.sidebarCompact());
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
      const mode = (parsed)?.mode;
      if (mode === 'simple' || mode === 'advanced') {
        this.mode.set(mode);
      }
      const preset = (parsed)?.preset;
      if (preset === 'custom' || preset === 'owner_basic') {
        this.preset.set(preset);
      }
      const sidebarCompact = (parsed)?.sidebarCompact;
      if (typeof sidebarCompact === 'boolean') {
        this.sidebarCompact.set(sidebarCompact);
      }
      if (this.preset() === 'owner_basic') {
        this.mode.set('simple');
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        this.storageKey(),
        JSON.stringify({ mode: this.mode(), preset: this.preset(), sidebarCompact: this.sidebarCompact() })
      );
    } catch {
      // ignore
    }
  }
}

