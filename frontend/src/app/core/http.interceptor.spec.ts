import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
  TestRequest,
} from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';

import { authAndErrorInterceptor } from './http.interceptor';
import { AuthService } from './auth.service';
import { appConfig } from './app-config';
import { HttpErrorBusService, HttpErrorEvent } from './http-error-bus.service';

interface AuthMock {
  getAccessToken: jasmine.Spy;
  getStepUpToken: jasmine.Spy;
  getRefreshToken: jasmine.Spy;
  user: jasmine.Spy;
  clearStepUpToken: jasmine.Spy;
  ensureStepUp: jasmine.Spy;
  refresh: jasmine.Spy;
  expireSession: jasmine.Spy;
}

describe('authAndErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthMock;
  let bus: HttpErrorBusService;

  beforeEach(() => {
    auth = {
      getAccessToken: jasmine.createSpy('getAccessToken').and.returnValue('access123'),
      getStepUpToken: jasmine.createSpy('getStepUpToken').and.returnValue(null),
      getRefreshToken: jasmine.createSpy('getRefreshToken').and.returnValue(null),
      user: jasmine.createSpy('user').and.returnValue(null),
      clearStepUpToken: jasmine.createSpy('clearStepUpToken'),
      ensureStepUp: jasmine.createSpy('ensureStepUp').and.returnValue(of(null)),
      refresh: jasmine.createSpy('refresh').and.returnValue(of(null)),
      expireSession: jasmine.createSpy('expireSession'),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authAndErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth as unknown as AuthService },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    bus = TestBed.inject(HttpErrorBusService);
  });

  afterEach(() => httpMock.verify());

  it('passes non-API requests through untouched', () => {
    http.get('/assets/i18n/en.json').subscribe();
    const req = httpMock.expectOne('/assets/i18n/en.json');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('adds access token when Authorization header is missing', () => {
    http.get('/api/v1/ping').subscribe();
    const req = httpMock.expectOne('/api/v1/ping');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access123');
    req.flush({});
  });

  it('does not override an explicit Authorization header', () => {
    http
      .post(
        '/api/v1/auth/google/complete',
        {},
        { headers: new HttpHeaders({ Authorization: 'Bearer completion' }) },
      )
      .subscribe();
    const req = httpMock.expectOne('/api/v1/auth/google/complete');
    expect(req.request.headers.get('Authorization')).toBe('Bearer completion');
    req.flush({});
  });

  it('adds step-up token when available and not already present', () => {
    auth.getStepUpToken.and.returnValue('step123');
    http.get('/api/v1/orders/admin/export').subscribe();
    const req = httpMock.expectOne('/api/v1/orders/admin/export');
    expect(req.request.headers.get('X-Admin-Step-Up')).toBe('step123');
    req.flush({});
  });

  it('does not add tokens when none are present', () => {
    auth.getAccessToken.and.returnValue(null);
    http.get('/api/v1/ping').subscribe();
    const req = httpMock.expectOne('/api/v1/ping');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  describe('401 refresh flow', () => {
    it('refreshes and retries the original request on success', fakeAsync(() => {
      auth.getRefreshToken.and.returnValue('refresh123');
      auth.refresh.and.returnValue(of({ access_token: 'new' }));
      auth.getAccessToken.and.returnValues('access123', 'newtoken', 'newtoken');

      let result: unknown;
      http.get('/api/v1/me').subscribe((r) => (result = r));
      httpMock.expectOne('/api/v1/me').flush(null, { status: 401, statusText: 'Unauthorized' });
      tick(0);
      expect(auth.refresh).toHaveBeenCalled();
      const retry = httpMock.expectOne('/api/v1/me');
      expect(retry.request.headers.get('Authorization')).toBe('Bearer newtoken');
      retry.flush({ ok: true });
      expect(result).toEqual({ ok: true });
    }));

    it('expires the session when refresh returns no tokens', fakeAsync(() => {
      auth.getRefreshToken.and.returnValue('refresh123');
      auth.refresh.and.returnValue(of(null));
      let errored = false;
      http.get('/api/v1/me').subscribe({ error: () => (errored = true) });
      httpMock.expectOne('/api/v1/me').flush(null, { status: 401, statusText: 'Unauthorized' });
      tick(0);
      expect(auth.expireSession).toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('retries without Authorization when no new token is issued', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.refresh.and.returnValue(of({ access_token: 'x' }));
      auth.getAccessToken.and.returnValues('access123', null, null);
      http.get('/api/v1/me').subscribe();
      httpMock.expectOne('/api/v1/me').flush(null, { status: 401, statusText: 'Unauthorized' });
      tick(0);
      const retry = httpMock.expectOne('/api/v1/me');
      expect(retry.request.headers.has('Authorization')).toBeFalse();
      retry.flush({});
    }));

    it('propagates the original error when refresh itself errors', fakeAsync(() => {
      auth.getRefreshToken.and.returnValue('refresh123');
      auth.refresh.and.returnValue(throwError(() => new Error('refresh failed')));
      let errored = false;
      http.get('/api/v1/me').subscribe({ error: () => (errored = true) });
      httpMock.expectOne('/api/v1/me').flush(null, { status: 401, statusText: 'Unauthorized' });
      tick(0);
      expect(errored).toBeTrue();
    }));

    it('does not refresh for the refresh/login/register/logout endpoints', () => {
      auth.getRefreshToken.and.returnValue('refresh123');
      let errored = false;
      http.post('/api/v1/auth/refresh', {}).subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/auth/refresh')
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      expect(auth.refresh).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });

    it('does not refresh when there is no session at all', () => {
      auth.getAccessToken.and.returnValue(null);
      auth.getRefreshToken.and.returnValue(null);
      auth.user.and.returnValue(null);
      let errored = false;
      http.get('/api/v1/me').subscribe({ error: () => (errored = true) });
      httpMock.expectOne('/api/v1/me').flush(null, { status: 401, statusText: 'Unauthorized' });
      expect(auth.refresh).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });
  });

  describe('403 step-up flow', () => {
    it('retries after a step-up prompt using a sync error code', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.ensureStepUp.and.returnValue(of('stepNEW'));
      auth.getAccessToken.and.returnValue('access123');

      http.get('/api/v1/admin/secure').subscribe();
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: 'step_up_required' }, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.clearStepUpToken).toHaveBeenCalled();
      const retry = httpMock.expectOne('/api/v1/admin/secure');
      expect(retry.request.headers.get('X-Admin-Step-Up')).toBe('stepNEW');
      expect(retry.request.headers.get('X-Step-Up-Retry')).toBe('1');
      expect(retry.request.headers.get('Authorization')).toBe('Bearer access123');
      retry.flush({});
    }));

    it('retries blob requests after reading the step-up code from a Blob', async () => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.ensureStepUp.and.returnValue(of('stepBLOB'));

      http.get('/api/v1/newsletter/admin/export', { responseType: 'blob' as 'json' }).subscribe();
      httpMock
        .expectOne('/api/v1/newsletter/admin/export')
        .flush(
          new Blob([JSON.stringify({ code: 'step_up_required' })], { type: 'application/json' }),
          { status: 403, statusText: 'Forbidden' },
        );
      // Blob.text() resolves on a real microtask queue outside fakeAsync/Zone
      // control, so poll for the dispatched retry request instead of racing a
      // fixed timeout (which is flaky on a loaded CI runner). Capture the request
      // from match() so we never do a second, consuming lookup.
      let retry: TestRequest | undefined;
      for (let i = 0; i < 100 && !retry; i++) {
        retry = httpMock.match('/api/v1/newsletter/admin/export')[0];
        if (!retry) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      expect(retry).toBeDefined();
      expect(retry!.request.headers.get('X-Admin-Step-Up')).toBe('stepBLOB');
      retry!.flush(new Blob(['ok']));
    });

    it('reads the step-up code from an ArrayBuffer body', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.ensureStepUp.and.returnValue(of('stepAB'));

      http.get('/api/v1/admin/secure', { responseType: 'arraybuffer' as 'json' }).subscribe();
      const buffer = new TextEncoder().encode(JSON.stringify({ code: 'step_up_required' })).buffer;
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush(buffer, { status: 403, statusText: 'Forbidden' });
      tick(0);
      const retry = httpMock.expectOne('/api/v1/admin/secure');
      expect(retry.request.headers.get('X-Admin-Step-Up')).toBe('stepAB');
      retry.flush(new ArrayBuffer(0));
    }));

    it('treats an unparseable ArrayBuffer body as no step-up code', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', { responseType: 'arraybuffer' as 'json' })
        .subscribe({ error: () => (errored = true) });
      const buffer = new TextEncoder().encode('not json {').buffer;
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush(buffer, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('extracts an error code from a JSON string body', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.ensureStepUp.and.returnValue(of('stepSTR'));
      http.get('/api/v1/admin/secure', { responseType: 'text' as 'json' }).subscribe();
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush(JSON.stringify({ code: 'step_up_required' }), {
          status: 403,
          statusText: 'Forbidden',
        });
      tick(0);
      const retry = httpMock.expectOne('/api/v1/admin/secure');
      expect(retry.request.headers.get('X-Admin-Step-Up')).toBe('stepSTR');
      retry.flush('');
    }));

    it('handles an unparseable string body with no code', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', { responseType: 'text' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush('not json {', { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('falls back to the X-Error-Code header when the body has no code', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.ensureStepUp.and.returnValue(of('stepHDR'));
      http.get('/api/v1/admin/secure').subscribe();
      httpMock.expectOne('/api/v1/admin/secure').flush(
        { detail: 'nope' },
        {
          status: 403,
          statusText: 'Forbidden',
          headers: new HttpHeaders({ 'X-Error-Code': 'step_up_required' }),
        },
      );
      tick(0);
      const retry = httpMock.expectOne('/api/v1/admin/secure');
      expect(retry.request.headers.get('X-Admin-Step-Up')).toBe('stepHDR');
      retry.flush({});
    }));

    it('treats an object body with an empty code as no step-up', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http.get('/api/v1/admin/secure').subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: '' }, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('treats an unparseable Blob body as no step-up code', async () => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/newsletter/admin/export', { responseType: 'blob' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/newsletter/admin/export')
        .flush(new Blob(['not json {'], { type: 'text/plain' }), {
          status: 403,
          statusText: 'Forbidden',
        });
      // The blob body is parsed asynchronously via Blob.text(); poll for the
      // terminal error state instead of relying on a fixed timeout (which is
      // flaky on a loaded CI runner).
      for (let i = 0; i < 100 && !errored; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });

    it('treats an ArrayBuffer body with an empty code as no step-up', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', { responseType: 'arraybuffer' as 'json' })
        .subscribe({ error: () => (errored = true) });
      const buffer = new TextEncoder().encode(JSON.stringify({ code: '' })).buffer;
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush(buffer, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('does not retry step-up when the request was already a step-up retry', () => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', {
          headers: new HttpHeaders({ 'X-Step-Up-Retry': '1' }),
        })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: 'step_up_required' }, { status: 403, statusText: 'Forbidden' });
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });

    it('propagates the error when the code is not step_up_required', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http.get('/api/v1/admin/secure').subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('propagates the error when step-up cannot be obtained', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      auth.ensureStepUp.and.returnValue(of(null));
      let errored = false;
      http.get('/api/v1/admin/secure').subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: 'step_up_required' }, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(errored).toBeTrue();
    }));

    it('honors X-Silent and skips the step-up retry', () => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', { headers: new HttpHeaders({ 'X-Silent': '1' }) })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: 'step_up_required' }, { status: 403, statusText: 'Forbidden' });
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });
  });

  describe('error bus surface', () => {
    it('emits 5xx errors to the bus', () => {
      const seen: HttpErrorEvent[] = [];
      bus.events$.subscribe((e) => seen.push(e));
      http.get('/api/v1/ping').subscribe({ error: () => undefined });
      httpMock.expectOne('/api/v1/ping').flush(null, { status: 500, statusText: 'Server Error' });
      expect(seen).toEqual([{ status: 500, method: 'GET', url: '/api/v1/ping' }]);
    });

    it('emits network (status 0) errors to the bus', () => {
      const seen: HttpErrorEvent[] = [];
      bus.events$.subscribe((e) => seen.push(e));
      http.get('/api/v1/ping').subscribe({ error: () => undefined });
      httpMock.expectOne('/api/v1/ping').error(new ProgressEvent('error'), { status: 0 });
      expect(seen.length).toBe(1);
      expect(seen[0].status).toBe(0);
    });

    it('does not emit statuses at or above 600 to the bus', () => {
      const seen: HttpErrorEvent[] = [];
      bus.events$.subscribe((e) => seen.push(e));
      http.get('/api/v1/ping').subscribe({ error: () => undefined });
      httpMock.expectOne('/api/v1/ping').flush(null, { status: 600, statusText: 'Weird' });
      expect(seen).toEqual([]);
    });

    it('does not emit 4xx errors to the bus', () => {
      const seen: HttpErrorEvent[] = [];
      bus.events$.subscribe((e) => seen.push(e));
      http.get('/api/v1/ping').subscribe({ error: () => undefined });
      httpMock.expectOne('/api/v1/ping').flush(null, { status: 404, statusText: 'Not Found' });
      expect(seen).toEqual([]);
    });

    it('does not emit when X-Silent is set', () => {
      const seen: HttpErrorEvent[] = [];
      bus.events$.subscribe((e) => seen.push(e));
      http
        .get('/api/v1/ping', { headers: new HttpHeaders({ 'X-Silent': '1' }) })
        .subscribe({ error: () => undefined });
      httpMock.expectOne('/api/v1/ping').flush(null, { status: 503, statusText: 'Unavailable' });
      expect(seen).toEqual([]);
    });
  });

  describe('edge-case error-code extraction and config', () => {
    it('treats an empty string body as no step-up code', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', { responseType: 'text' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush('', { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('treats a parseable string body without a code as no step-up', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/admin/secure', { responseType: 'text' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush('{"detail":"nope"}', { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('treats a Blob body of valid JSON without a code as no step-up', async () => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/newsletter/admin/export', { responseType: 'blob' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/newsletter/admin/export')
        .flush(new Blob(['{}'], { type: 'application/json' }), {
          status: 403,
          statusText: 'Forbidden',
        });
      for (let i = 0; i < 100 && !errored; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });

    it('treats an empty Blob body as no step-up code', async () => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      http
        .get('/api/v1/newsletter/admin/export', { responseType: 'blob' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/newsletter/admin/export')
        .flush(new Blob([''], { type: 'application/json' }), {
          status: 403,
          statusText: 'Forbidden',
        });
      for (let i = 0; i < 100 && !errored; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });

    it('recovers as no code when reading the Blob body rejects', async () => {
      auth.user.and.returnValue({ id: 'u1' });
      let errored = false;
      const blob = new Blob(['{}'], { type: 'application/json' });
      spyOn(blob, 'text').and.returnValue(Promise.reject(new Error('read failed')));
      http
        .get('/api/v1/newsletter/admin/export', { responseType: 'blob' as 'json' })
        .subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/newsletter/admin/export')
        .flush(blob, { status: 403, statusText: 'Forbidden' });
      for (let i = 0; i < 100 && !errored; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    });

    it('reads an empty ArrayBuffer body without a TextDecoder available', fakeAsync(() => {
      auth.user.and.returnValue({ id: 'u1' });
      const original = (window as { TextDecoder?: unknown }).TextDecoder;
      (window as { TextDecoder?: unknown }).TextDecoder = undefined;
      try {
        let errored = false;
        http
          .get('/api/v1/admin/secure', { responseType: 'arraybuffer' as 'json' })
          .subscribe({ error: () => (errored = true) });
        httpMock
          .expectOne('/api/v1/admin/secure')
          .flush(new ArrayBuffer(0), { status: 403, statusText: 'Forbidden' });
        tick(0);
        expect(auth.ensureStepUp).not.toHaveBeenCalled();
        expect(errored).toBeTrue();
      } finally {
        (window as { TextDecoder?: unknown }).TextDecoder = original;
      }
    }));

    it('does not attempt step-up on a 403 when there is no session', fakeAsync(() => {
      auth.getAccessToken.and.returnValue(null);
      auth.getRefreshToken.and.returnValue(null);
      auth.user.and.returnValue(null);
      let errored = false;
      http.get('/api/v1/admin/secure').subscribe({ error: () => (errored = true) });
      httpMock
        .expectOne('/api/v1/admin/secure')
        .flush({ code: 'step_up_required' }, { status: 403, statusText: 'Forbidden' });
      tick(0);
      expect(auth.ensureStepUp).not.toHaveBeenCalled();
      expect(errored).toBeTrue();
    }));

    it('matches API requests when the configured base URL is absolute', () => {
      const original = appConfig.apiBaseUrl;
      appConfig.apiBaseUrl = 'http://api.example.com/api/v1';
      try {
        auth.getAccessToken.and.returnValue('access123');
        http.get('http://api.example.com/api/v1/ping').subscribe();
        const req = httpMock.expectOne('http://api.example.com/api/v1/ping');
        expect(req.request.headers.get('Authorization')).toBe('Bearer access123');
        req.flush({});
      } finally {
        appConfig.apiBaseUrl = original;
      }
    });
  });
});
