import { Component, PLATFORM_ID } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject } from 'rxjs';

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
    expect(script?.getAttribute('data-clarity-src')).toContain(
      'https://www.clarity.ms/tag/vicuv3ldav',
    );
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

  it('ignores opt-in events that are not enabled and only starts once', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    analytics.enabledValue = true;
    router.initialNavigation();
    tick();
    service.start();
    service.start(); // second call is a no-op (started guard)
    tick();
    getClarityScript()?.remove();

    // detail.enabled is not strictly true -> listener returns early
    window.dispatchEvent(new CustomEvent('app:analytics-opt-in', { detail: { enabled: false } }));
    tick();
    expect(getClarityScript()).toBeNull();
  }));

  it('skips initialization when the project id is empty', fakeAsync(() => {
    (appConfig as { clarityProjectId?: string }).clarityProjectId = '   ';
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    analytics.enabledValue = true;
    router.initialNavigation();
    tick();
    service.start();
    tick();
    expect(getClarityScript()).toBeNull();
  }));

  it('skips initialization when clarity is disabled by config', fakeAsync(() => {
    (appConfig as { clarityEnabled?: boolean }).clarityEnabled = false;
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    analytics.enabledValue = true;
    router.initialNavigation();
    tick();
    service.start();
    tick();
    expect(getClarityScript()).toBeNull();
  }));

  it('reuses an existing clarity queue function and existing script tag', fakeAsync(() => {
    const clarityWindow = window as Window & {
      clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
    };
    const existingFn = (() => {}) as ((...args: unknown[]) => void) & { q?: unknown[][] };
    clarityWindow.clarity = existingFn;

    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    analytics.enabledValue = true;
    router.initialNavigation();
    tick();
    service.start();
    tick();
    // Existing function is left intact (no replacement).
    expect(clarityWindow.clarity).toBe(existingFn);
    expect(getClarityScript()).toBeTruthy();
  }));

  it('queues args through the generated clarity function', fakeAsync(() => {
    resetClarityScript();
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    analytics.enabledValue = true;
    router.initialNavigation();
    tick();
    service.start();
    tick();
    const clarityWindow = window as Window & {
      clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
    };
    clarityWindow.clarity?.('event', 'x');
    clarityWindow.clarity?.('event', 'y');
    expect(clarityWindow.clarity?.q?.length).toBe(2);
  }));

  it('does not inject twice when a script already exists', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    analytics.enabledValue = true;
    router.initialNavigation();
    tick();
    service.start();
    tick();
    const first = getClarityScript();
    expect(first).toBeTruthy();
    // Re-run init logic by dispatching opt-in again; initialized guard + existing-script guard apply.
    window.dispatchEvent(new CustomEvent('app:analytics-opt-in', { detail: { enabled: true } }));
    tick();
    expect(document.querySelectorAll('script[data-clarity="true"]').length).toBe(1);
  }));

  it('unsubscribes and removes the listener on destroy', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    const removeSpy = spyOn(window, 'removeEventListener').and.callThrough();
    router.initialNavigation();
    tick();
    service.start();
    tick();
    service.ngOnDestroy();
    expect(removeSpy).toHaveBeenCalledWith('app:analytics-opt-in', jasmine.any(Function));
  }));

  it('runs maybeInit on navigation events that fire after start()', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(ClarityService);
    // analytics off so start() does not initialize yet (stays uninitialized).
    analytics.enabledValue = false;
    service.start();
    tick();
    expect(getClarityScript()).toBeNull();

    // Enable, then a NavigationEnd after start() flows through the router
    // subscription -> maybeInit() and injects the script.
    analytics.enabledValue = true;
    void router.navigateByUrl('/shop');
    tick();
    expect(getClarityScript()).toBeTruthy();
  }));
});

describe('ClarityService (mocked DOCUMENT/Router for branch edges)', () => {
  const originalConfig = {
    clarityEnabled: (appConfig as { clarityEnabled?: boolean }).clarityEnabled,
    clarityProjectId: (appConfig as { clarityProjectId?: string }).clarityProjectId,
  };

  class RouterStub {
    url = '/';
    events = new Subject<unknown>();
  }
  class AnalyticsStub {
    enabled() {
      return true;
    }
  }
  class AuthStub {
    isAuthenticated() {
      return false;
    }
  }

  let routerStub: RouterStub;

  function configure(doc: Document, platform: 'browser' | 'server' = 'browser'): ClarityService {
    routerStub = new RouterStub();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ClarityService,
        { provide: Router, useValue: routerStub },
        { provide: DOCUMENT, useValue: doc },
        { provide: PLATFORM_ID, useValue: platform },
        { provide: AnalyticsService, useValue: new AnalyticsStub() },
        { provide: AuthService, useValue: new AuthStub() },
      ],
    });
    return TestBed.inject(ClarityService);
  }

  beforeEach(() => {
    (appConfig as { clarityEnabled?: boolean }).clarityEnabled = true;
    (appConfig as { clarityProjectId?: string }).clarityProjectId = 'pid123';
  });

  afterEach(() => {
    (appConfig as { clarityEnabled?: boolean }).clarityEnabled = originalConfig.clarityEnabled;
    (appConfig as { clarityProjectId?: string }).clarityProjectId = originalConfig.clarityProjectId;
  });

  function makeDoc(overrides: Partial<Document> = {}): Document {
    const head = document.createElement('head');
    return {
      querySelector: () => null,
      createElement: (tag: string) => document.createElement(tag),
      getElementsByTagName: () => [] as unknown as HTMLCollectionOf<Element>,
      head,
      ...overrides,
    } as unknown as Document;
  }

  it('does nothing in start() on the server platform', () => {
    const service = configure(makeDoc(), 'server');
    expect(() => service.start()).not.toThrow();
    expect((service as unknown as { started: boolean }).started).toBeFalse();
  });

  it('skips the listener removal in ngOnDestroy on the server platform', () => {
    const service = configure(makeDoc(), 'server');
    const removeSpy = spyOn(window, 'removeEventListener');
    service.ngOnDestroy();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('appends to head when there is no first script to insert before', () => {
    const doc = makeDoc();
    const appendSpy = spyOn(doc.head, 'appendChild').and.callThrough();
    const service = configure(doc);
    service.start();
    routerStub.events.next(new NavigationEnd(1, '/', '/'));
    expect(appendSpy).toHaveBeenCalled();
  });

  it('inserts before the first script when one with a parent exists', () => {
    const parent = document.createElement('div');
    const firstScript = document.createElement('script');
    parent.appendChild(firstScript);
    const insertSpy = spyOn(parent, 'insertBefore').and.callThrough();
    const doc = makeDoc({
      getElementsByTagName: () => [firstScript] as unknown as HTMLCollectionOf<Element>,
    });
    const service = configure(doc);
    service.start();
    expect(insertSpy).toHaveBeenCalled();
  });

  it('does not inject when a clarity script already exists', () => {
    const doc = makeDoc({ querySelector: () => document.createElement('script') });
    const createSpy = spyOn(doc, 'createElement').and.callThrough();
    const service = configure(doc);
    service.start();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('uses the real clarity src when not running under karma', () => {
    const doc = makeDoc();
    const created: HTMLScriptElement[] = [];
    spyOn(doc, 'createElement').and.callFake((tag: string) => {
      const el = document.createElement(tag) as HTMLScriptElement;
      created.push(el);
      return el;
    });
    const karmaWindow = window as Window & { __karma__?: unknown };
    const savedKarma = karmaWindow.__karma__;
    delete karmaWindow.__karma__;
    try {
      const service = configure(doc);
      service.start();
    } finally {
      karmaWindow.__karma__ = savedKarma;
    }
    expect(created[0].src).toContain('https://www.clarity.ms/tag/pid123');
  });

  it('derives the path from the router url, normalizing a missing leading slash', () => {
    const doc = makeDoc();
    const appendSpy = spyOn(doc.head, 'appendChild').and.callThrough();
    const service = configure(doc);
    routerStub.url = 'shop?x=1#frag';
    service.start();
    // 'shop' is public -> script injected.
    expect(appendSpy).toHaveBeenCalled();
  });

  it('falls back to window.location when router url is blank', () => {
    const doc = makeDoc();
    const appendSpy = spyOn(doc.head, 'appendChild').and.callThrough();
    const service = configure(doc);
    routerStub.url = '   ';
    service.start();
    expect(appendSpy).toHaveBeenCalled();
  });

  it('does not initialize on a private router path', () => {
    const doc = makeDoc();
    const appendSpy = spyOn(doc.head, 'appendChild').and.callThrough();
    const service = configure(doc);
    routerStub.url = '/admin/orders';
    service.start();
    expect(appendSpy).not.toHaveBeenCalled();
  });
});
