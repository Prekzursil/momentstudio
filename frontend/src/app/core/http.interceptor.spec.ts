import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { authAndErrorInterceptor } from './http.interceptor';
import { AuthService } from './auth.service';
import { ErrorHandlerService } from '../shared/error-handler.service';

describe('authAndErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    const auth = {
      getAccessToken: jasmine.createSpy('getAccessToken').and.returnValue('access123'),
      getStepUpToken: jasmine.createSpy('getStepUpToken').and.returnValue(null),
      getRefreshToken: jasmine.createSpy('getRefreshToken').and.returnValue(null),
      user: jasmine.createSpy('user').and.returnValue(null),
      clearStepUpToken: jasmine.createSpy('clearStepUpToken'),
      ensureStepUp: jasmine.createSpy('ensureStepUp').and.returnValue(of(null)),
    } as Partial<AuthService> as AuthService;
    const handler = { handle: jasmine.createSpy('handle') } as Partial<ErrorHandlerService> as ErrorHandlerService;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authAndErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: ErrorHandlerService, useValue: handler }
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
    const auth = TestBed.inject(AuthService) as any;
    (auth.getStepUpToken as jasmine.Spy).and.returnValue('step123');

    http.get('/api/v1/orders/admin/export').subscribe();
    const req = httpMock.expectOne('/api/v1/orders/admin/export');
    expect(req.request.headers.get('X-Admin-Step-Up')).toBe('step123');
    req.flush({});
  });

  it('retries blob requests after step-up prompt', fakeAsync(() => {
    const auth = TestBed.inject(AuthService) as any;
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
});
