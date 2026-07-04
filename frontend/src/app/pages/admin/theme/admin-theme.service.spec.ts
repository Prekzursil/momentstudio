import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ThemeResetService } from '../../../shared/theme-reset-frame.component';
import { AdminThemeService, type ThemeTokensRead } from './admin-theme.service';

const PUBLISHED: ThemeTokensRead = {
  tokens: { '--accent': '79 70 229' },
  version: 3,
  schema_version: 1,
  status: 'published',
  published_at: '2026-07-04T00:00:00Z',
  updated_at: '2026-07-04T00:00:00Z',
};

describe('AdminThemeService', () => {
  let service: AdminThemeService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      // Mirror the admin route's seam binding so `inject(ThemeResetService)`
      // resolves to the AdminThemeService instance (WU9 panic-frame contract).
      providers: [AdminThemeService, { provide: ThemeResetService, useExisting: AdminThemeService }],
    });
    service = TestBed.inject(AdminThemeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('is provided as the ThemeResetService seam (WU9 panic frame impl)', () => {
    expect(TestBed.inject(ThemeResetService)).toBe(service);
  });

  it('GET /theme reads the published tokens', () => {
    service.getPublished().subscribe((resp) => expect(resp.version).toBe(3));
    const req = httpMock.expectOne('/api/v1/theme');
    expect(req.request.method).toBe('GET');
    req.flush(PUBLISHED);
  });

  it('GET /theme/draft reads the editable draft', () => {
    service.getDraft().subscribe((resp) => expect(resp.status).toBe('published'));
    const req = httpMock.expectOne('/api/v1/theme/draft');
    expect(req.request.method).toBe('GET');
    req.flush(PUBLISHED);
  });

  it('GET /theme/versions lists the version history', () => {
    service.listVersions().subscribe((resp) => expect(resp.items.length).toBe(1));
    const req = httpMock.expectOne('/api/v1/theme/versions');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [{ version: 1, schema_version: 1, status: 'published', created_at: 'x' }] });
  });

  it('PUT /theme/draft saves the editable-token map', () => {
    const tokens = { '--accent': '10 20 30' };
    service.saveDraft(tokens).subscribe();
    const req = httpMock.expectOne('/api/v1/theme/draft');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ tokens });
    req.flush(PUBLISHED);
  });

  it('POST /theme/publish carries the optimistic-concurrency version', () => {
    service.publish(7).subscribe();
    const req = httpMock.expectOne('/api/v1/theme/publish');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ expected_version: 7 });
    req.flush(PUBLISHED);
  });

  it('POST /theme/publish sends a null version when unversioned', () => {
    service.publish(null).subscribe();
    const req = httpMock.expectOne('/api/v1/theme/publish');
    expect(req.request.body).toEqual({ expected_version: null });
    req.flush(PUBLISHED);
  });

  it('POST /theme/rollback/{version} restores a prior version', () => {
    service.rollback(2).subscribe();
    const req = httpMock.expectOne('/api/v1/theme/rollback/2');
    expect(req.request.method).toBe('POST');
    req.flush(PUBLISHED);
  });

  it('POST /theme/reset-to-default force-publishes the safe defaults', () => {
    service.resetToDefault().subscribe();
    const req = httpMock.expectOne('/api/v1/theme/reset-to-default');
    expect(req.request.method).toBe('POST');
    req.flush(PUBLISHED);
  });
});
