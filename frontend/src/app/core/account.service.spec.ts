import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { AccountService } from './account.service';

describe('AccountService', () => {
  let service: AccountService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService, AccountService]
    });
    service = TestBed.inject(AccountService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('downloadExport fetches a JSON blob', () => {
    service.downloadExport().subscribe((blob) => {
      expect(blob).toBeTruthy();
    });

    const req = httpMock.expectOne('/api/v1/auth/me/export');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['{}'], { type: 'application/json' }));
  });

  it('requestAccountDeletion posts confirm text', () => {
    service.requestAccountDeletion('DELETE', 'supersecret').subscribe((resp) => {
      expect(resp.cooldown_hours).toBe(24);
    });

    const req = httpMock.expectOne('/api/v1/auth/me/delete');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ confirm: 'DELETE', password: 'supersecret' });
    req.flush({ requested_at: null, scheduled_for: '2030-01-01T00:00:00+00:00', deleted_at: null, cooldown_hours: 24 });
  });

  it('getDeletionStatus fetches current deletion status', () => {
    service.getDeletionStatus().subscribe((resp) => {
      expect(resp.cooldown_hours).toBe(24);
      expect(resp.scheduled_for).toBeNull();
    });

    const req = httpMock.expectOne('/api/v1/auth/me/delete/status');
    expect(req.request.method).toBe('GET');
    req.flush({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 });
  });

  it('cancelAccountDeletion posts to cancel endpoint', () => {
    service.cancelAccountDeletion().subscribe((resp) => {
      expect(resp.scheduled_for).toBeNull();
    });

    const req = httpMock.expectOne('/api/v1/auth/me/delete/cancel');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 });
  });
});
