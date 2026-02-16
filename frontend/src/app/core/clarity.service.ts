import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';

import { appConfig } from './app-config';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';

type ClarityWindow = Window & {
  clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
};

@Injectable({ providedIn: 'root' })
export class ClarityService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthService);

  private started = false;
  private initialized = false;
  private routerSub?: Subscription;
  private readonly analyticsOptInListener = (event: Event) => {
    const custom = event as CustomEvent<{ enabled?: boolean }>;
    if (custom?.detail?.enabled !== true) return;
    this.maybeInit();
  };

  private static readonly privatePrefixes = [
    '/admin',
    '/account',
    '/checkout',
    '/login',
    '/register',
    '/auth',
    '/password-reset',
    '/verify-email',
    '/newsletter',
    '/tickets',
    '/cart',
    '/receipt',
  ];

  start(): void {
    if (!isPlatformBrowser(this.platformId) || this.started) return;
    this.started = true;
    this.routerSub = this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.maybeInit();
    });
    window.addEventListener('app:analytics-opt-in', this.analyticsOptInListener);
    this.maybeInit();
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (!isPlatformBrowser(this.platformId)) return;
    window.removeEventListener('app:analytics-opt-in', this.analyticsOptInListener);
  }

  private maybeInit(): void {
    if (this.initialized) return;
    const projectId = String(appConfig.clarityProjectId || '').trim();
    if (!projectId) return;
    if (!appConfig.clarityEnabled) return;
    if (!this.analytics.enabled()) return;
    if (this.auth.isAuthenticated()) return;
    if (!this.isPublicStorefrontPath(this.currentPathname())) return;

    this.ensureClarityQueueFunction();
    this.injectScript(projectId);
    this.initialized = true;
  }

  private ensureClarityQueueFunction(): void {
    const clarityWindow = window as ClarityWindow;
    if (typeof clarityWindow.clarity === 'function') return;
    const clarityFn = ((...args: unknown[]) => {
      if (!clarityFn.q) clarityFn.q = [];
      clarityFn.q.push(args);
    }) as ((...args: unknown[]) => void) & { q?: unknown[][] };
    clarityWindow.clarity = clarityFn;
  }

  private injectScript(projectId: string): void {
    const existing = this.document.querySelector('script[data-clarity="true"]') as HTMLScriptElement | null;
    if (existing) return;
    const script = this.document.createElement('script');
    const src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
    const isKarma = Boolean((window as Window & { __karma__?: unknown }).__karma__);
    script.async = true;
    script.src = isKarma ? 'about:blank' : src;
    script.setAttribute('data-clarity-src', src);
    script.setAttribute('data-clarity', 'true');
    script.onerror = () => void 0;
    const firstScript = this.document.getElementsByTagName('script')[0] ?? null;
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
      return;
    }
    this.document.head.appendChild(script);
  }

  private currentPathname(): string {
    const routerUrl = String(this.router.url || '').trim();
    if (routerUrl) {
      const fromRouter = routerUrl.split('#')[0].split('?')[0].trim();
      if (fromRouter) {
        return fromRouter.startsWith('/') ? fromRouter : `/${fromRouter}`;
      }
    }
    try {
      return window.location.pathname || '/';
    } catch {
      return '/';
    }
  }

  private isPublicStorefrontPath(pathname: string): boolean {
    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return !ClarityService.privatePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  }
}
