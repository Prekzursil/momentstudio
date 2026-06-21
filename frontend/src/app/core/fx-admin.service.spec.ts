import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { FxAdminService } from './fx-admin.service';

describe('FxAdminService', () => {
  let service: FxAdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FxAdminService],
    });
    service = TestBed.inject(FxAdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches admin status', () => {
    service.getStatus().subscribe((resp) => {
      expect(resp.effective.base).toBe('RON');
    });

    const req = httpMock.expectOne('/api/v1/fx/admin/status');
    expect(req.request.method).toBe('GET');
    req.flush({
      effective: {
        base: 'RON',
        eur_per_ron: 0.2,
        usd_per_ron: 0.22,
        as_of: '2026-01-01',
        source: 'ecb',
        fetched_at: '2026-01-01T00:00:00+00:00',
      },
      override: null,
      last_known: null,
    });
  });

  it('sets and clears override', () => {
    service
      .setOverride({ eur_per_ron: 0.2, usd_per_ron: 0.22, as_of: '2026-01-01' })
      .subscribe((resp) => {
        expect(resp.source).toBe('override');
      });

    const putReq = httpMock.expectOne('/api/v1/fx/admin/override');
    expect(putReq.request.method).toBe('PUT');
    expect(putReq.request.body).toEqual({
      eur_per_ron: 0.2,
      usd_per_ron: 0.22,
      as_of: '2026-01-01',
    });
    putReq.flush({
      base: 'RON',
      eur_per_ron: 0.2,
      usd_per_ron: 0.22,
      as_of: '2026-01-01',
      source: 'override',
      fetched_at: '2026-01-01T00:00:00+00:00',
    });

    service.clearOverride().subscribe((resp) => {
      expect(resp).toBeNull();
    });

    const delReq = httpMock.expectOne('/api/v1/fx/admin/override');
    expect(delReq.request.method).toBe('DELETE');
    delReq.flush(null);
  });

  it('lists the override audit with the default limit', () => {
    service.listOverrideAudit().subscribe((entries) => {
      expect(entries.length).toBe(1);
    });

    const req = httpMock.expectOne('/api/v1/fx/admin/override/audit?limit=50');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'a1', action: 'set', created_at: '2026-01-01T00:00:00+00:00' }]);
  });

  it('lists the override audit with an explicit limit', () => {
    service.listOverrideAudit(5).subscribe();

    const req = httpMock.expectOne('/api/v1/fx/admin/override/audit?limit=5');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('restores an override from an audit entry', () => {
    service.restoreOverrideFromAudit('a1').subscribe((status) => {
      expect(status.effective.base).toBe('RON');
    });

    const req = httpMock.expectOne('/api/v1/fx/admin/override/audit/a1/revert');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({
      effective: {
        base: 'RON',
        eur_per_ron: 0.2,
        usd_per_ron: 0.22,
        as_of: '2026-01-01',
        source: 'override',
        fetched_at: '2026-01-01T00:00:00+00:00',
      },
      override: null,
      last_known: null,
    });
  });
});
