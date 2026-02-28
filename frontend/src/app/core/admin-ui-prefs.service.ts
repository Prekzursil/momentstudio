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

  private isMode(value: unknown): value is AdminUiMode {
    return value === 'simple' || value === 'advanced';
  }

  private isPreset(value: unknown): value is AdminUiPreset {
    return value === 'custom' || value === 'owner_basic';
  }

  private normalizeLoadedState(parsed: unknown): {
    mode: AdminUiMode | null;
    preset: AdminUiPreset | null;
    sidebarCompact: boolean | null;
  } {
    const data = (parsed ?? {}) as Record<string, unknown>;
    const mode = this.isMode(data['mode']) ? data['mode'] : null;
    const preset = this.isPreset(data['preset']) ? data['preset'] : null;
    const sidebarCompact = typeof data['sidebarCompact'] === 'boolean' ? data['sidebarCompact'] : null;
    return { mode, preset, sidebarCompact };
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const normalized = this.normalizeLoadedState(JSON.parse(raw));
      if (normalized.mode) this.mode.set(normalized.mode);
      if (normalized.preset) this.preset.set(normalized.preset);
      if (normalized.sidebarCompact !== null) this.sidebarCompact.set(normalized.sidebarCompact);
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
