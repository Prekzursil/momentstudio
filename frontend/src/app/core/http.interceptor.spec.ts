import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { authAndErrorInterceptor } from './http.interceptor';
import { AuthService } from './auth.service';
import { HttpErrorBusService } from './http-error-bus.service';

describe('authAndErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: any;
  let errorBus: { emit: jasmine.Spy };

  beforeEach(() => {
    auth = {
      getAccessToken: jasmine.createSpy('getAccessToken').and.returnValue('access123'),
      getStepUpToken: jasmine.createSpy('getStepUpToken').and.returnValue(null),
      getRefreshToken: jasmine.createSpy('getRefreshToken').and.returnValue(null),
      user: jasmine.createSpy('user').and.returnValue(null),
      clearStepUpToken: jasmine.createSpy('clearStepUpToken'),
      ensureStepUp: jasmine.createSpy('ensureStepUp').and.returnValue(of(null)),
      refresh: jasmine.createSpy('refresh').and.returnValue(of({ access_token: 'refreshed' })),
      expireSession: jasmine.createSpy('expireSession')
    } as Partial<AuthService> as AuthService;
    errorBus = { emit: jasmine.createSpy('emit') };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authAndErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: HttpErrorBusService, useValue: errorBus }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('adds access token when Authorization header is missing', () => {
    http.get('/api/v1/ping').subscribe();
    const req = httpMock.expectOne('/api/v1/ping');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access123');
    req.flush({});
  });

  it('does not override an explicit Authorization header', () => {
    http
      .post('/api/v1/auth/google/complete', {}, { headers: new HttpHeaders({ Authorization: 'Bearer completion' }) })
      .subscribe();
    const req = httpMock.expectOne('/api/v1/auth/google/complete');
    expect(req.request.headers.get('Authorization')).toBe('Bearer completion');
    req.flush({});
  });

  it('adds step-up token when available', () => {
    (auth.getStepUpToken as jasmine.Spy).and.returnValue('step123');

    http.get('/api/v1/orders/admin/export').subscribe();
    const req = httpMock.expectOne('/api/v1/orders/admin/export');
    expect(req.request.headers.get('X-Admin-Step-Up')).toBe('step123');
    req.flush({});
  });

  it('retries blob requests after step-up prompt', fakeAsync(() => {
    (auth.ensureStepUp as jasmine.Spy).and.returnValue(of('step123'));

    http.get('/api/v1/newsletter/admin/export', { responseType: 'blob' as 'json' }).subscribe();
    const first = httpMock.expectOne('/api/v1/newsletter/admin/export');
    first.flush(
      new Blob([JSON.stringify({ detail: 'Step-up authentication required', code: 'step_up_required' })], {
        type: 'application/json'
      }),
      { status: 403, statusText: 'Forbidden', headers: new HttpHeaders({ 'X-Error-Code': 'step_up_required' }) }
    );

    tick(0);

    expect(auth.ensureStepUp).toHaveBeenCalled();
    const retry = httpMock.expectOne('/api/v1/newsletter/admin/export');
    expect(retry.request.headers.get('X-Admin-Step-Up')).toBe('step123');
    expect(retry.request.headers.get('X-Step-Up-Retry')).toBe('1');
    retry.flush(new Blob(['email,confirmed_at,source\n'], { type: 'text/csv' }));
  }));

  it('does not inject auth for non-api requests', () => {
    http.get('/assets/i18n/en.json').subscribe();
    const req = httpMock.expectOne('/assets/i18n/en.json');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    expect(req.request.withCredentials).toBeFalse();
    req.flush({ ok: true });
  });

  it('retries 401 API requests by refreshing session when session exists', fakeAsync(() => {
    (auth.getRefreshToken as jasmine.Spy).and.returnValue('refresh-token');
    (auth.getAccessToken as jasmine.Spy).and.returnValues('access-old', 'access-new');
    (auth.refresh as jasmine.Spy).and.returnValue(of({ access_token: 'access-new' }));

    http.get('/api/v1/orders').subscribe();
    const first = httpMock.expectOne('/api/v1/orders');
    expect(first.request.headers.get('Authorization')).toBe('Bearer access-old');
    first.flush({ detail: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    tick(0);

    expect(auth.refresh).toHaveBeenCalled();
    const retry = httpMock.expectOne('/api/v1/orders');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-new');
    retry.flush({ ok: true });
  }));

  it('does not refresh on excluded auth endpoints', () => {
    (auth.getRefreshToken as jasmine.Spy).and.returnValue('refresh-token');
    http.post('/api/auth/login', {}).subscribe({
      error: () => undefined
    });
    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ detail: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('expires session when refresh returns empty tokens', fakeAsync(() => {
    (auth.getRefreshToken as jasmine.Spy).and.returnValue('refresh-token');
    (auth.refresh as jasmine.Spy).and.returnValue(of(null));
    const onError = jasmine.createSpy('onError');

    http.get('/api/v1/account').subscribe({
      error: onError
    });
    const req = httpMock.expectOne('/api/v1/account');
    req.flush({ detail: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    tick(0);

    expect(auth.expireSession).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(onError.calls.mostRecent().args[0].status).toBe(401);
  }));

  it('does not retry step-up when server code is not step_up_required', fakeAsync(() => {
    (auth.ensureStepUp as jasmine.Spy).and.returnValue(of('step123'));
    const onError = jasmine.createSpy('onError');

    http.get('/api/v1/orders/admin/export').subscribe({
      error: onError
    });
    const req = httpMock.expectOne('/api/v1/orders/admin/export');
    req.flush({ code: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    tick(0);

    expect(auth.ensureStepUp).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(onError.calls.mostRecent().args[0].status).toBe(403);
  }));

  it('emits global bus event for 5xx responses unless silent', () => {
    http.get('/api/v1/admin/reports').subscribe({
      error: () => undefined
    });
    const noisy = httpMock.expectOne('/api/v1/admin/reports');
    noisy.flush({ detail: 'server error' }, { status: 500, statusText: 'Server Error' });
    expect(errorBus.emit).toHaveBeenCalledWith(jasmine.objectContaining({ status: 500, method: 'GET' }));

    (errorBus.emit as jasmine.Spy).calls.reset();
    http.get('/api/v1/admin/reports', { headers: new HttpHeaders({ 'X-Silent': '1' }) }).subscribe({
      error: () => undefined
    });
    const silent = httpMock.expectOne('/api/v1/admin/reports');
    silent.flush({ detail: 'server error' }, { status: 500, statusText: 'Server Error' });
    expect(errorBus.emit).not.toHaveBeenCalled();
  });

  it('emits global bus event for network failures', () => {
    http.get('/api/v1/catalog').subscribe({
      error: () => undefined
    });
    const req = httpMock.expectOne('/api/v1/catalog');
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(errorBus.emit).toHaveBeenCalledWith(jasmine.objectContaining({ status: 0, method: 'GET' }));
  });
});
