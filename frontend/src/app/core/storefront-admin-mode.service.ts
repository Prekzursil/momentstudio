import { Injectable, computed, effect, signal } from '@angular/core';
import { AuthService } from './auth.service';

const STORAGE_KEY = 'storefront_admin_edit_mode';

@Injectable({ providedIn: 'root' })
export class StorefrontAdminModeService {
  private readonly enabledSignal = signal(false);
  readonly enabled = this.enabledSignal.asReadonly();
  readonly available = computed(() => this.auth.isAdmin() && !this.auth.isImpersonating());

  constructor(private auth: AuthService) {
    const saved = this.loadSaved();
    this.enabledSignal.set(saved && this.available());
    effect(() => {
      if (this.available()) return;
      if (!this.enabledSignal()) return;
      this.enabledSignal.set(false);
      this.save(false);
    });
  }

  setEnabled(next: boolean): void {
    if (next && !this.available()) return;
    this.enabledSignal.set(next);
    this.save(next);
  }

  toggle(): void {
    this.setEnabled(!this.enabledSignal());
  }

  private loadSaved(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private save(enabled: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (enabled) {
        localStorage.setItem(STORAGE_KEY, '1');
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }
}

