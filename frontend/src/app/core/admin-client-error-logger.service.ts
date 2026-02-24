import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AdminClientErrorIn, AdminClientErrorKind, AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { appConfig } from './app-config';
import { captureException } from './sentry';

@Injectable({ providedIn: 'root' })
export class AdminClientErrorLoggerService {
  private initialized = false;
  private enabled = false;
  private readonly recent = new Map<string, number>();

  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof window === 'undefined') return;

    this.updateEnabled(this.router.url);
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      this.updateEnabled(event.urlAfterRedirects || event.url);
    });

    window.addEventListener('error', (event) => this.onWindowError(event));
    window.addEventListener('unhandledrejection', (event) => this.onUnhandledRejection(event));
  }

  private updateEnabled(url: string): void {
    const next = (url || '').trim();
    this.enabled = next === '/admin' || next.startsWith('/admin/');
  }

  private shouldSend(): boolean {
    if (!this.enabled) return false;
    const role = this.auth.role();
    return role === 'owner' || role === 'admin' || role === 'support' || role === 'fulfillment' || role === 'content';
  }

  private send(payload: AdminClientErrorIn): void {
    if (!this.shouldSend()) return;

    const signature = `${payload.kind}:${payload.message}:${(payload.stack || '').slice(0, 120)}`;
    const now = Date.now();
    const prev = this.recent.get(signature);
    if (prev && now - prev < 5000) return;
    this.recent.set(signature, now);
    if (this.recent.size > 50) {
      const entries = Array.from(this.recent.entries()).sort((a, b) => a[1] - b[1]);
      entries.slice(0, entries.length - 50).forEach(([key]) => this.recent.delete(key));
    }

    this.admin.logClientError(payload).subscribe({ error: () => void 0 });
  }

  private buildBasePayload(
    kind: AdminClientErrorKind,
    message: string,
    stack: string | null,
    context?: Record<string, any> | null
  ): AdminClientErrorIn {
    const url = typeof location !== 'undefined' ? location.href : null;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
    return {
      kind,
      message: (message || '').trim().slice(0, 4000) || 'Unknown error',
      stack: stack ? stack.slice(0, 20000) : null,
      url,
      route: this.router.url,
      user_agent: userAgent,
      occurred_at: new Date().toISOString(),
      context: {
        app_env: appConfig.appEnv,
        ...(appConfig.appVersion ? { app_version: appConfig.appVersion } : {}),
        ...(context || {})
      }
    };
  }

  private onWindowError(event: ErrorEvent): void {
    const err = event.error;
    captureException(err || event);
    const message = err instanceof Error ? err.message : event.message;
    const stack = err instanceof Error ? err.stack || null : null;
    this.send(
      this.buildBasePayload('window_error', message || 'Window error', stack, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      })
    );
  }

  private onUnhandledRejection(event: PromiseRejectionEvent): void {
    const reason = event.reason;
    captureException(reason);
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack || null : null;
    this.send(this.buildBasePayload('unhandled_rejection', message || 'Unhandled rejection', stack));
  }
}


