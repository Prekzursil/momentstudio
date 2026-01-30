import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly enabledStorageKey = 'analytics.opt_in.v1';
  private readonly sessionStorageKey = 'analytics.session_id.v1';
  private readonly sessionStartedKey = 'analytics.session_started.v1';

  private enabledState = signal(this.readEnabled());
  private sessionStarted = this.readSessionStarted();

  constructor(private api: ApiService) {}

  enabled(): boolean {
    return this.enabledState();
  }

  setEnabled(value: boolean): void {
    this.enabledState.set(Boolean(value));
    this.persistEnabled(this.enabledState());
    if (this.enabledState()) {
      this.startSession();
    }
  }

  startSession(): void {
    if (!this.enabledState()) return;
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    this.persistSessionStarted(true);
    this.send('session_start');
  }

  track(event: string, payload?: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    if (!this.enabledState()) return;
    if (event !== 'session_start') {
      this.startSession();
    }

    const sessionId = this.getSessionId();
    const record = { event, session_id: sessionId, ...(payload ?? {}) };

    try {
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push(record);
      } else {
        window.dataLayer = [record];
      }
    } catch {
      // ignore
    }

    try {
      window.dispatchEvent(new CustomEvent('app:analytics', { detail: record }));
    } catch {
      // ignore
    }

    if (!sessionId) return;
    this.api
      .post<{ received: boolean }>(
        '/analytics/events',
        { event, session_id: sessionId, path: this.getPath(), payload: payload ?? null },
        { 'X-Silent': '1' }
      )
      .subscribe({ error: () => void 0 });
  }

  private send(event: string, payload?: Record<string, unknown>): void {
    this.track(event, payload);
  }

  private readEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(this.enabledStorageKey) === '1';
    } catch {
      return false;
    }
  }

  private persistEnabled(value: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (value) localStorage.setItem(this.enabledStorageKey, '1');
      else localStorage.removeItem(this.enabledStorageKey);
    } catch {
      // ignore
    }
  }

  private readSessionStarted(): boolean {
    if (typeof sessionStorage === 'undefined') return false;
    try {
      return sessionStorage.getItem(this.sessionStartedKey) === '1';
    } catch {
      return false;
    }
  }

  private persistSessionStarted(value: boolean): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      if (value) sessionStorage.setItem(this.sessionStartedKey, '1');
      else sessionStorage.removeItem(this.sessionStartedKey);
    } catch {
      // ignore
    }
  }

  private getSessionId(): string {
    if (typeof sessionStorage === 'undefined') return '';
    try {
      const existing = sessionStorage.getItem(this.sessionStorageKey);
      if (existing) return existing;
      const id = crypto.randomUUID?.() || `${Date.now()}`;
      sessionStorage.setItem(this.sessionStorageKey, id);
      return id;
    } catch {
      return '';
    }
  }

  private getPath(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.location?.pathname + window.location?.search;
    } catch {
      return null;
    }
  }
}
