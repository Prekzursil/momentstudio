import { Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { appConfig } from './app-config';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { ClarityService } from './clarity.service';

@Component({ standalone: true, template: '<h1>Public</h1>' })
class PublicRouteComponent {}

@Component({ standalone: true, template: '<h1>Private</h1>' })
class PrivateRouteComponent {}

class AnalyticsServiceStub {
  enabledValue = false;

  enabled(): boolean {
    return this.enabledValue;
  }
}

class AuthServiceStub {
  authenticated = false;

  isAuthenticated(): boolean {
    return this.authenticated;
  }
}

function getClarityScript(): HTMLScriptElement | null {
  return document.querySelector('script[data-clarity="true"]');
}

function resetClarityScript(): void {
  getClarityScript()?.remove();
  const clarityWindow = window as Window & { clarity?: unknown };
  if ('clarity' in clarityWindow) {
    delete clarityWindow.clarity;
  }
}

describe('ClarityService', () => {
  const originalConfig = {
    clarityEnabled: (appConfig as { clarityEnabled?: boolean }).clarityEnabled,
    clarityProjectId: (appConfig as { clarityProjectId?: string }).clarityProjectId,
  };

  let analytics: AnalyticsServiceStub;
  let auth: AuthServiceStub;

  beforeEach(async () => {
    resetClarityScript();
    (appConfig as { clarityEnabled?: boolean }).clarityEnabled = true;
    (appConfig as { clarityProjectId?: string }).clarityProjectId = 'vicuv3ldav';
    analytics = new AnalyticsServiceStub();
    auth = new AuthServiceStub();

    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([
          { path: '', component: PublicRouteComponent },
          { path: 'shop', component: PublicRouteComponent },
          { path: 'admin', component: PrivateRouteComponent },
        ]),
      ],
      providers: [
        ClarityService,
        { provide: AnalyticsService, useValue: analytics },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    resetClarityScript();
    (appConfig as { clarityEnabled?: boolean }).clarityEnabled = originalConfig.clarityEnabled;
    (appConfig as { clarityProjectId?: string }).clarityProjectId = originalConfig.clarityProjectId;
  });

  it('injects script for anonymous users on public routes after opt-in', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);

    router.initialNavigation();
    tick();
    service.start();
    tick();
    expect(getClarityScript()).toBeNull();

    analytics.enabledValue = true;
    window.dispatchEvent(new CustomEvent('app:analytics-opt-in', { detail: { enabled: true } }));
    tick();

    const script = getClarityScript();
    expect(script).toBeTruthy();
    expect(script?.getAttribute('data-clarity-src')).toContain('https://www.clarity.ms/tag/vicuv3ldav');
  }));

  it('does not initialize on private routes', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);

    router.initialNavigation();
    tick();
    void router.navigateByUrl('/admin');
    tick();

    analytics.enabledValue = true;
    service.start();
    tick();

    expect(getClarityScript()).toBeNull();
  }));

  it('does not initialize for authenticated sessions', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    auth.authenticated = true;
    analytics.enabledValue = true;

    router.initialNavigation();
    tick();
    void router.navigateByUrl('/shop');
    tick();

    service.start();
    tick();

    expect(getClarityScript()).toBeNull();
  }));
});
