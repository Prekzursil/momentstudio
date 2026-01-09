import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { authAndErrorInterceptor } from './http.interceptor';
import { AuthService } from './auth.service';
import { ErrorHandlerService } from '../shared/error-handler.service';

describe('authAndErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    const auth = { getAccessToken: () => 'access123' } as Partial<AuthService> as AuthService;
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
});

