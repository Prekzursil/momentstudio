import { Observable, of, throwError } from 'rxjs';

import { AnalyticsService } from './analytics.service';
import { ApiService } from './api.service';

type AnalyticsApiSpy = jasmine.SpyObj<Pick<ApiService, 'post'>>;
type AnalyticsPostImpl = (path: string, body: unknown, headers?: Record<string, string>) => Observable<any>;

function createService(postImpl?: AnalyticsPostImpl): { service: AnalyticsService; api: AnalyticsApiSpy } {
  const api = jasmine.createSpyObj<AnalyticsApiSpy>('ApiService', ['post']);
  api.post.and.callFake(((path: string, body: unknown, headers?: Record<string, string>) => {
    if (postImpl) {
      return postImpl(path, body, headers);
    }
    if (path === '/analytics/token') {
      return of({ token: 'stub-token', expires_in: 3600 });
    }
    return of({ received: true });
  }) as any);
  return { service: new AnalyticsService(api as unknown as ApiService), api };
}

describe('AnalyticsService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, document.title, '/');
    delete window.dataLayer;
  });

  it('emits an analytics opt-in event whenever consent is toggled', () => {
    const { service } = createService();
    let received: boolean | null = null;
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      received = Boolean(custom.detail?.enabled);
    };

    window.addEventListener('app:analytics-opt-in', handler);
    service.setEnabled(false);
    window.removeEventListener('app:analytics-opt-in', handler);

    expect(received).toBeFalse();
  });

  it('tracks enabled events to dataLayer and sends tokenized analytics payloads', () => {
    const { service, api } = createService();
    service.setEnabled(true);
    api.post.calls.reset();
    window.sessionStorage.removeItem('analytics.token.v1');
    window.sessionStorage.removeItem('analytics.token_expires_at.v1');
    window.dataLayer = [];
    let receivedEvent: string | null = null;
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ event?: string }>;
      receivedEvent = String(custom.detail?.event || '');
    };

    window.addEventListener('app:analytics', handler);
    service.track('product_view', { sku: 'sku-1' });
    window.removeEventListener('app:analytics', handler);

    const record = window.dataLayer?.[0] as Record<string, unknown>;
    const sessionIdValue = record['session_id'];
    const sessionId = typeof sessionIdValue === 'string' ? sessionIdValue : '';
    expect(record['event']).toBe('product_view');
    expect(record['sku']).toBe('sku-1');
    expect(sessionId.length).toBeGreaterThan(0);
    expect(String(receivedEvent)).toBe('product_view');
    expect(api.post).toHaveBeenCalledWith('/analytics/token', { session_id: sessionId }, { 'X-Silent': '1' });
    expect(api.post).toHaveBeenCalledWith(
      '/analytics/events',
      { event: 'product_view', session_id: sessionId, path: '/', payload: { sku: 'sku-1' } },
      { 'X-Silent': '1', 'X-Analytics-Token': 'stub-token' }
    );
  });

  it('reuses stored analytics tokens across multiple tracked events', () => {
    const { service, api } = createService();
    service.setEnabled(true);
    api.post.calls.reset();
    window.sessionStorage.removeItem('analytics.token.v1');
    window.sessionStorage.removeItem('analytics.token_expires_at.v1');

    service.track('view_one');
    service.track('view_two');

    const calls = api.post.calls.allArgs();
    expect(calls.filter((args) => args[0] === '/analytics/token').length).toBe(1);
    expect(calls.filter((args) => args[0] === '/analytics/events').length).toBe(2);
  });

  it('drops stale tokens and still sends events without token header when token fetch fails', () => {
    const { service, api } = createService((path) => {
      if (path === '/analytics/token') {
        return throwError(() => new Error('token unavailable'));
      }
      return of({ received: true });
    });
    service.setEnabled(true);
    api.post.calls.reset();
    window.sessionStorage.setItem('analytics.token.v1', 'stale-token');
    window.sessionStorage.setItem('analytics.token_expires_at.v1', String(Date.now() - 1_000));

    service.track('checkout_start');

    expect(window.sessionStorage.getItem('analytics.token.v1')).toBeNull();
    const eventCall = api.post.calls.allArgs().find((args) => args[0] === '/analytics/events');
    expect(eventCall).toBeDefined();
    expect(eventCall?.[1]).toEqual(jasmine.objectContaining({ event: 'checkout_start', path: '/', payload: null }));
    expect(eventCall?.[2]).toEqual({ 'X-Silent': '1' });
  });
});
