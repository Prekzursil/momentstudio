import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminUsersService],
    });
    service = TestBed.inject(AdminUsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const profileUser = {
    id: 'u1',
    email: 'a@b.c',
    username: 'alice',
    role: 'customer',
    email_verified: true,
    created_at: 'd',
    vip: false,
  };

  it('searches users and forwards every query param', () => {
    service
      .search({ q: 'al', role: 'customer', page: 2, limit: 25, include_pii: true })
      .subscribe((res) => {
        expect(res.meta.page).toBe(2);
        expect(res.items.length).toBe(1);
      });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/users/search');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('al');
    expect(req.request.params.get('role')).toBe('customer');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      items: [
        {
          id: 'u1',
          email: 'a@b.c',
          username: 'alice',
          role: 'customer',
          email_verified: true,
          created_at: 'd',
        },
      ],
      meta: { total_items: 1, total_pages: 1, page: 2, limit: 25 },
    });
  });

  it('gets a profile with PII opts', () => {
    service.getProfile('u1', { include_pii: true }).subscribe((res) => {
      expect(res.user.id).toBe('u1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/users/u1/profile');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      user: profileUser,
      addresses: [],
      orders: [],
      tickets: [],
      security_events: [],
    });
  });

  it('gets a profile without opts', () => {
    service.getProfile('u1').subscribe((res) => {
      expect(res.addresses).toEqual([]);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/users/u1/profile');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('include_pii')).toBeFalse();
    req.flush({
      user: profileUser,
      addresses: [],
      orders: [],
      tickets: [],
      security_events: [],
    });
  });

  it('updates internal admin fields', () => {
    service.updateInternal('u1', { vip: true, admin_note: 'note' }).subscribe((res) => {
      expect(res.vip).toBe(false);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/users/u1/internal');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ vip: true, admin_note: 'note' });
    req.flush(profileUser);
  });

  it('impersonates a user', () => {
    service.impersonate('u1').subscribe((res) => {
      expect(res.access_token).toBe('tok');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/users/u1/impersonate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ access_token: 'tok', expires_at: 'd' });
  });

  it('updates security fields', () => {
    service
      .updateSecurity('u1', {
        locked_until: 'd',
        locked_reason: 'fraud',
        password_reset_required: true,
      })
      .subscribe((res) => {
        expect(res.id).toBe('u1');
      });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/users/u1/security');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      locked_until: 'd',
      locked_reason: 'fraud',
      password_reset_required: true,
    });
    req.flush(profileUser);
  });

  it('fetches email verification history', () => {
    service.getEmailVerificationHistory('u1').subscribe((res) => {
      expect(res.tokens.length).toBe(1);
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/u1/email/verification',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ tokens: [{ id: 't1', created_at: 'd', expires_at: 'd', used: false }] });
  });

  it('resends email verification', () => {
    service.resendEmailVerification('u1').subscribe((res) => {
      expect(res.detail).toBe('sent');
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/u1/email/verification/resend',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ detail: 'sent' });
  });

  it('resends a password reset with an explicit payload', () => {
    service.resendPasswordReset('u1', { email: 'new@b.c' }).subscribe((res) => {
      expect(res.detail).toBe('ok');
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/u1/password-reset/resend',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'new@b.c' });
    req.flush({ detail: 'ok' });
  });

  it('resends a password reset with no payload (falls back to {})', () => {
    service.resendPasswordReset('u1').subscribe((res) => {
      expect(res.detail).toBe('ok');
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/u1/password-reset/resend',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ detail: 'ok' });
  });

  it('overrides email verification with a password', () => {
    service.overrideEmailVerification('u1', 'secret').subscribe((res) => {
      expect(res.email_verified).toBe(true);
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/u1/email/verification/override',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'secret' });
    req.flush({ ...profileUser, email_verified: true });
  });

  it('lists GDPR export jobs', () => {
    service
      .listGdprExportJobs({ q: 'a', status: 'pending', page: 1, limit: 20 })
      .subscribe((res) => {
        expect(res.items).toEqual([]);
      });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/gdpr/exports');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('status')).toBe('pending');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 } });
  });

  it('retries a GDPR export job', () => {
    service.retryGdprExportJob('j1').subscribe((res) => {
      expect(res.id).toBe('j1');
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/gdpr/exports/j1/retry',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({
      id: 'j1',
      user: { id: 'u1', email: 'a@b.c', username: 'alice', role: 'customer' },
      status: 'pending',
      progress: 0,
      created_at: 'd',
      updated_at: 'd',
      has_file: false,
      sla_due_at: 'd',
      sla_breached: false,
    });
  });

  it('downloads a GDPR export job file', () => {
    service.downloadGdprExportJob('j1').subscribe((blob) => {
      expect(blob.size).toBe(3);
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/gdpr/exports/j1/download',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['zip']));
  });

  it('lists GDPR deletion requests', () => {
    service.listGdprDeletionRequests({ q: 'a', page: 1, limit: 20 }).subscribe((res) => {
      expect(res.items).toEqual([]);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/gdpr/deletions');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('a');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 } });
  });

  it('executes a GDPR deletion with a password', () => {
    service.executeGdprDeletion('u1', 'secret').subscribe((res) => {
      expect(res).toBeNull();
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/gdpr/deletions/u1/execute',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ password: 'secret' });
    req.flush(null);
  });

  it('cancels a GDPR deletion', () => {
    service.cancelGdprDeletion('u1').subscribe((res) => {
      expect(res).toBeNull();
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/gdpr/deletions/u1/cancel',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null);
  });

  it('lists the repeat-buyers segment', () => {
    service
      .listRepeatBuyersSegment({ q: 'a', min_orders: 2, page: 1, limit: 20 })
      .subscribe((res) => {
        expect(res.items).toEqual([]);
      });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/segments/repeat-buyers',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('min_orders')).toBe('2');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 } });
  });

  it('lists the high-AOV segment', () => {
    service
      .listHighAovSegment({ q: 'a', min_orders: 2, min_aov: 100, page: 1, limit: 20 })
      .subscribe((res) => {
        expect(res.items).toEqual([]);
      });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/admin/dashboard/users/segments/high-aov',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('min_aov')).toBe('100');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 } });
  });
});
