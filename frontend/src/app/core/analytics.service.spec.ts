import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { AnalyticsService } from './analytics.service';
import { ApiService } from './api.service';

describe('AnalyticsService', () => {
  let post: jasmine.Spy;

  // Chrome 149 exposes crypto.randomUUID on Crypto.prototype (inherited), not as
  // an own property of the crypto instance. A sibling spec captures
  // Object.getOwnPropertyDescriptor(crypto, 'randomUUID') (which is therefore
  // undefined), defines a throwing OWN property to test its fallback, and then
  // skips its `if (orig)` restore -- leaking a read-only, throwing
  // crypto.randomUUID into every later spec. Snapshot the genuine implementation
  // once (captured at registration time, before any spec mutates it) and
  // re-install a clean, writable, configurable own property before each test so
  // these specs are isolated from that cross-spec contamination.
  const realRandomUUID = crypto.randomUUID.bind(crypto);

  function configure(): AnalyticsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AnalyticsService, { provide: ApiService, useValue: { post } }],
    });
    return TestBed.inject(AnalyticsService);
  }

  beforeEach(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value: realRandomUUID,
    });
    localStorage.clear();
    sessionStorage.clear();
    delete (window as { dataLayer?: unknown[] }).dataLayer;
    post = jasmine.createSpy('post').and.callFake((url: string) => {
      if (url === '/analytics/token') return of({ token: 'tok-1', expires_in: 3600 });
      return of({ received: true });
    });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Drop our own override so the pristine inherited crypto.randomUUID is
    // restored and this suite never leaks state into later specs.
    delete (crypto as { randomUUID?: unknown }).randomUUID;
  });

  it('reads the persisted opt-in state on construction', () => {
    localStorage.setItem('analytics.opt_in.v1', '1');
    expect(configure().enabled()).toBeTrue();
  });

  it('defaults to disabled', () => {
    expect(configure().enabled()).toBeFalse();
  });

  it('persists opt-in and dispatches an event', () => {
    const service = configure();
    let received: boolean | null = null;
    const handler = (e: Event) =>
      (received = Boolean((e as CustomEvent<{ enabled?: boolean }>).detail?.enabled));
    window.addEventListener('app:analytics-opt-in', handler);
    service.setEnabled(true);
    window.removeEventListener('app:analytics-opt-in', handler);

    expect(received).toBeTrue();
    expect(localStorage.getItem('analytics.opt_in.v1')).toBe('1');
  });

  it('clears the opt-in flag when disabled', () => {
    localStorage.setItem('analytics.opt_in.v1', '1');
    const service = configure();
    service.setEnabled(false);
    expect(localStorage.getItem('analytics.opt_in.v1')).toBeNull();
  });

  it('starts a session and posts session_start on opt-in', () => {
    const service = configure();
    service.setEnabled(true);
    expect(post).toHaveBeenCalledWith('/analytics/token', jasmine.anything(), jasmine.anything());
    expect(post).toHaveBeenCalledWith(
      '/analytics/events',
      jasmine.objectContaining({ event: 'session_start' }),
      jasmine.objectContaining({ 'X-Analytics-Token': 'tok-1' }),
    );
    expect(sessionStorage.getItem('analytics.session_started.v1')).toBe('1');
  });

  it('does not start a session twice', () => {
    sessionStorage.setItem('analytics.session_started.v1', '1');
    const service = configure();
    service.setEnabled(true);
    service.startSession();
    const starts = post.calls
      .allArgs()
      .filter((a) => a[0] === '/analytics/events' && a[1]?.event === 'session_start');
    expect(starts.length).toBe(0);
  });

  it('ignores track calls when disabled', () => {
    const service = configure();
    service.track('page_view');
    expect(post).not.toHaveBeenCalled();
  });

  it('pushes events to the data layer and posts them', () => {
    const service = configure();
    service.setEnabled(true);
    post.calls.reset();
    service.track('page_view', { page: '/x' });

    expect((window as { dataLayer?: unknown[] }).dataLayer?.length).toBeGreaterThan(0);
    expect(post).toHaveBeenCalledWith(
      '/analytics/events',
      jasmine.objectContaining({ event: 'page_view' }),
      jasmine.anything(),
    );
  });

  it('appends to an existing data layer array', () => {
    (window as { dataLayer?: unknown[] }).dataLayer = [{ existing: true }];
    const service = configure();
    service.setEnabled(true);
    service.track('page_view');
    expect((window as { dataLayer?: unknown[] }).dataLayer?.length).toBeGreaterThan(1);
  });

  it('reuses a cached token and skips the token request', () => {
    sessionStorage.setItem('analytics.token.v1', 'cached');
    sessionStorage.setItem('analytics.token_expires_at.v1', String(Date.now() + 60_000));
    const service = configure();
    service.setEnabled(true);
    expect(post).not.toHaveBeenCalledWith(
      '/analytics/token',
      jasmine.anything(),
      jasmine.anything(),
    );
  });

  it('discards an expired token', () => {
    sessionStorage.setItem('analytics.token.v1', 'old');
    sessionStorage.setItem('analytics.token_expires_at.v1', String(Date.now() - 1000));
    const service = configure();
    service.setEnabled(true);
    expect(post).toHaveBeenCalledWith('/analytics/token', jasmine.anything(), jasmine.anything());
    expect(sessionStorage.getItem('analytics.token.v1')).toBe('tok-1');
  });

  it('tolerates a token endpoint failure', () => {
    post.and.callFake((url: string) =>
      url === '/analytics/token' ? throwError(() => new Error('x')) : of({ received: true }),
    );
    const service = configure();
    expect(() => service.setEnabled(true)).not.toThrow();
  });

  it('captures utm attribution and a referrer host', () => {
    const originalUrl = window.location.href;
    history.replaceState(null, '', '/p?utm_source=news&utm_medium=email');
    spyOnProperty(document, 'referrer', 'get').and.returnValue('https://ref.example.com/path');
    try {
      const service = configure();
      service.setEnabled(true);

      const startCall = post.calls
        .allArgs()
        .find((a) => a[0] === '/analytics/events' && a[1]?.event === 'session_start');
      expect(startCall?.[1]?.payload).toEqual(
        jasmine.objectContaining({ utm_source: 'news', referrer_host: 'ref.example.com' }),
      );
      expect(sessionStorage.getItem('analytics.attribution.v1')).toContain('news');
    } finally {
      history.replaceState(null, '', originalUrl);
    }
  });

  it('returns no attribution when there are no utm params or referrer', () => {
    const originalUrl = window.location.href;
    history.replaceState(null, '', '/plain');
    spyOnProperty(document, 'referrer', 'get').and.returnValue('');
    try {
      const service = configure();
      service.setEnabled(true);
      const startCall = post.calls.allArgs().find((a) => a[1]?.event === 'session_start');
      expect(startCall?.[1]?.payload).toBeNull();
    } finally {
      history.replaceState(null, '', originalUrl);
    }
  });

  it('ignores a malformed referrer url', () => {
    const originalUrl = window.location.href;
    history.replaceState(null, '', '/p?utm_source=x');
    spyOnProperty(document, 'referrer', 'get').and.returnValue('not a url');
    try {
      const service = configure();
      expect(() => service.setEnabled(true)).not.toThrow();
    } finally {
      history.replaceState(null, '', originalUrl);
    }
  });

  it('reuses cached attribution from session storage', () => {
    sessionStorage.setItem('analytics.attribution.v1', JSON.stringify({ utm_source: 'cached' }));
    const service = configure();
    service.setEnabled(true);
    const startCall = post.calls.allArgs().find((a) => a[1]?.event === 'session_start');
    expect(startCall?.[1]?.payload).toEqual(jasmine.objectContaining({ utm_source: 'cached' }));
  });

  it('persists a token without expiry when expires_in is missing', () => {
    post.and.callFake((url: string) =>
      url === '/analytics/token' ? of({ token: 'no-exp' }) : of({ received: true }),
    );
    const service = configure();
    service.setEnabled(true);
    expect(sessionStorage.getItem('analytics.token.v1')).toBe('no-exp');
    expect(sessionStorage.getItem('analytics.token_expires_at.v1')).toBeNull();
  });

  it('generates and reuses a session id', () => {
    const service = configure();
    service.setEnabled(true);
    const id = sessionStorage.getItem('analytics.session_id.v1');
    expect(id).toBeTruthy();
    service.track('again');
    expect(sessionStorage.getItem('analytics.session_id.v1')).toBe(id);
  });

  it('keeps a token that has no stored expiry', () => {
    sessionStorage.setItem('analytics.token.v1', 'tok-no-exp');
    const service = configure();
    service.setEnabled(true);
    expect(post).not.toHaveBeenCalledWith(
      '/analytics/token',
      jasmine.anything(),
      jasmine.anything(),
    );
  });

  it('keeps a token when the stored expiry is not a positive number', () => {
    sessionStorage.setItem('analytics.token.v1', 'tok-bad-exp');
    sessionStorage.setItem('analytics.token_expires_at.v1', 'not-a-number');
    const service = configure();
    service.setEnabled(true);
    expect(post).not.toHaveBeenCalledWith(
      '/analytics/token',
      jasmine.anything(),
      jasmine.anything(),
    );
  });

  it('falls back to a timestamp id when crypto.randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    (crypto as unknown as { randomUUID?: unknown }).randomUUID = undefined;
    try {
      const service = configure();
      service.setEnabled(true);
      expect(sessionStorage.getItem('analytics.session_id.v1')).toBeTruthy();
    } finally {
      (crypto as unknown as { randomUUID?: unknown }).randomUUID = original;
    }
  });

  it('tolerates an events endpoint failure', () => {
    post.and.callFake((url: string) =>
      url === '/analytics/token'
        ? of({ token: 'tok-1', expires_in: 3600 })
        : throwError(() => new Error('events down')),
    );
    const service = configure();
    expect(() => service.setEnabled(true)).not.toThrow();
  });

  it('treats a non-object cached attribution as absent', () => {
    sessionStorage.setItem('analytics.attribution.v1', JSON.stringify('a-string'));
    const originalUrl = window.location.href;
    history.replaceState(null, '', '/p?utm_source=fresh');
    try {
      const service = configure();
      service.setEnabled(true);
      const startCall = post.calls.allArgs().find((a) => a[1]?.event === 'session_start');
      expect(startCall?.[1]?.payload).toEqual(jasmine.objectContaining({ utm_source: 'fresh' }));
    } finally {
      history.replaceState(null, '', originalUrl);
    }
  });

  it('maps a token response without a token to null', () => {
    post.and.callFake((url: string) =>
      url === '/analytics/token' ? of({ expires_in: 10 }) : of({ received: true }),
    );
    const service = configure();
    service.setEnabled(true);
    const eventCall = post.calls.allArgs().find((a) => a[0] === '/analytics/events');
    expect(eventCall?.[2]?.['X-Analytics-Token']).toBeUndefined();
  });

  it('reuses an in-flight token request for concurrent events', () => {
    const token$ = new Subject<{ token: string; expires_in: number }>();
    post.and.callFake((url: string) =>
      url === '/analytics/token' ? token$.asObservable() : of({ received: true }),
    );
    const service = configure();
    service.setEnabled(true); // first track: opens the in-flight token request
    service.track('a'); // second track: must reuse tokenRequest$
    service.track('b');
    token$.next({ token: 'tok-1', expires_in: 3600 });
    token$.complete();
    const tokenCalls = post.calls.allArgs().filter((a) => a[0] === '/analytics/token');
    expect(tokenCalls.length).toBe(1);
  });

  it('recovers from a readToken failure and fetches a fresh token', () => {
    const service = configure();
    service.setEnabled(true);
    const realGet = sessionStorage.getItem.bind(sessionStorage);
    spyOn(sessionStorage, 'getItem').and.callFake((key: string) => {
      if (key === 'analytics.token.v1') throw new Error('blocked');
      return realGet(key);
    });
    post.calls.reset();
    service.track('x');
    expect(post).toHaveBeenCalledWith('/analytics/token', jasmine.anything(), jasmine.anything());
  });

  it('is a no-op across all storage when the environment lacks browser globals', () => {
    const origLs = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const origSs = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => undefined });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => undefined });
    try {
      const service = configure();
      expect(service.enabled()).toBeFalse();
      expect(() => service.setEnabled(true)).not.toThrow();
      expect(() => service.track('x')).not.toThrow();
    } finally {
      if (origLs) Object.defineProperty(window, 'localStorage', origLs);
      if (origSs) Object.defineProperty(window, 'sessionStorage', origSs);
    }
  });

  it('swallows storage read/write failures', () => {
    spyOn(sessionStorage, 'getItem').and.throwError('blocked');
    spyOn(sessionStorage, 'setItem').and.throwError('blocked');
    spyOn(localStorage, 'getItem').and.throwError('blocked');
    spyOn(localStorage, 'setItem').and.throwError('blocked');
    spyOn(localStorage, 'removeItem').and.throwError('blocked');
    const service = configure();
    expect(() => service.setEnabled(true)).not.toThrow();
    expect(() => service.track('x')).not.toThrow();
  });
});
