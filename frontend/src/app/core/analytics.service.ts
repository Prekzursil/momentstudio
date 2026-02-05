import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

type AnalyticsTokenResponse = {
  token: string;
  expires_in: number;
};

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly enabledStorageKey = 'analytics.opt_in.v1';
  private readonly sessionStorageKey = 'analytics.session_id.v1';
  private readonly sessionStartedKey = 'analytics.session_started.v1';
  private readonly tokenStorageKey = 'analytics.token.v1';
  private readonly tokenExpiresAtKey = 'analytics.token_expires_at.v1';

  private enabledState = signal(this.readEnabled());
  private sessionStarted = this.readSessionStarted();
  private tokenRequest$?: Observable<string | null>;

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
    this.ensureToken(sessionId).subscribe({
      next: (token) => {
        const headers: Record<string, string> = { 'X-Silent': '1' };
        if (token) headers['X-Analytics-Token'] = token;
        this.api
          .post<{ received: boolean }>(
            '/analytics/events',
            { event, session_id: sessionId, path: this.getPath(), payload: payload ?? null },
            headers
          )
          .subscribe({ error: () => void 0 });
      },
      error: () => void 0
    });
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

  private readToken(): string | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const token = sessionStorage.getItem(this.tokenStorageKey);
      if (!token) return null;
      const expiresAtRaw = sessionStorage.getItem(this.tokenExpiresAtKey);
      if (!expiresAtRaw) return token;
      const expiresAt = Number(expiresAtRaw);
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) return token;
      if (Date.now() > expiresAt - 30_000) {
        sessionStorage.removeItem(this.tokenStorageKey);
        sessionStorage.removeItem(this.tokenExpiresAtKey);
        return null;
      }
      return token;
    } catch {
      return null;
    }
  }

  private persistToken(token: string, expiresIn: number | undefined): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(this.tokenStorageKey, token);
      if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
        sessionStorage.setItem(this.tokenExpiresAtKey, String(Date.now() + expiresIn * 1000));
      } else {
        sessionStorage.removeItem(this.tokenExpiresAtKey);
      }
    } catch {
      // ignore
    }
  }

  private ensureToken(sessionId: string) {
    const existing = this.readToken();
    if (existing) return of(existing);
    if (this.tokenRequest$) return this.tokenRequest$;

    this.tokenRequest$ = this.api.post<AnalyticsTokenResponse>(
      '/analytics/token',
      { session_id: sessionId },
      { 'X-Silent': '1' }
    ).pipe(
      tap((res) => {
        if (res?.token) this.persistToken(res.token, res.expires_in);
      }),
      map((res) => (res?.token ? res.token : null)),
      catchError(() => of(null)),
      finalize(() => {
        this.tokenRequest$ = undefined;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    return this.tokenRequest$;
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
