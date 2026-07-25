import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  AdminContactSubmissionRead,
  AdminSupportService,
  SupportCannedResponseRead,
  SupportSlaSettings,
} from './admin-support.service';

describe('AdminSupportService', () => {
  let service: AdminSupportService;
  let httpMock: HttpTestingController;

  const submission: AdminContactSubmissionRead = {
    id: 's1',
    topic: 'support',
    status: 'new',
    name: 'Jane',
    email: 'jane@example.com',
    message: 'Help me',
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-01T00:00:00+00:00',
  };

  const canned: SupportCannedResponseRead = {
    id: 'c1',
    title: 'Welcome',
    body_en: 'Hi',
    body_ro: 'Salut',
    is_active: true,
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-01T00:00:00+00:00',
  };

  const sla: SupportSlaSettings = { first_reply_hours: 4, resolution_hours: 48 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminSupportService],
    });
    service = TestBed.inject(AdminSupportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('submits feedback with the message payload', () => {
    const payload = { message: 'great app', context: 'orders page' };
    service.submitFeedback(payload).subscribe((res) => {
      expect(res.id).toBe('s1');
    });

    const req = httpMock.expectOne('/api/v1/support/admin/feedback');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(submission);
  });

  it('lists submissions and defaults include_pii to true', () => {
    service.list({ q: 'jane', status_filter: 'new', page: 2, limit: 10 }).subscribe((res) => {
      expect(res.meta.page).toBe(2);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/submissions');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('jane');
    expect(req.request.params.get('status_filter')).toBe('new');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 2, limit: 10 } });
  });

  it('lists submissions and honors an explicit include_pii=false', () => {
    service.list({ include_pii: false }).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/submissions');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 } });
  });

  it('lists assignees', () => {
    service.listAssignees().subscribe((res) => {
      expect(res.length).toBe(1);
    });

    const req = httpMock.expectOne('/api/v1/support/admin/assignees');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'a1', username: 'agent', role: 'support' }]);
  });

  it('gets one submission with default include_pii', () => {
    service.getOne('s1').subscribe((res) => {
      expect(res.id).toBe('s1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/submissions/s1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush(submission);
  });

  it('gets one submission with an explicit include_pii=false', () => {
    service.getOne('s1', { include_pii: false }).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/submissions/s1');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush(submission);
  });

  it('updates a submission with default include_pii', () => {
    const payload = { status: 'triaged' as const, admin_note: 'noted', assignee_id: 'a1' };
    service.update('s1', payload).subscribe((res) => {
      expect(res.id).toBe('s1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/submissions/s1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(payload);
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush(submission);
  });

  it('updates a submission with an explicit include_pii=false', () => {
    service.update('s1', { status: 'resolved' }, { include_pii: false }).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/submissions/s1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush(submission);
  });

  it('adds a message with default include_pii', () => {
    service.addMessage('s1', 'hello there').subscribe((res) => {
      expect(res.id).toBe('s1');
    });

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/support/admin/submissions/s1/messages',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ message: 'hello there' });
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush(submission);
  });

  it('adds a message with an explicit include_pii=false', () => {
    service.addMessage('s1', 'hi', { include_pii: false }).subscribe();

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/support/admin/submissions/s1/messages',
    );
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush(submission);
  });

  it('lists canned responses with provided params', () => {
    service.listCannedResponses({ include_inactive: true }).subscribe((res) => {
      expect(res.length).toBe(1);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/canned-responses');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_inactive')).toBe('true');
    req.flush([canned]);
  });

  it('lists canned responses with no params (defaults to empty object)', () => {
    service.listCannedResponses().subscribe((res) => {
      expect(res).toEqual([]);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/support/admin/canned-responses');
    expect(req.request.params.keys().length).toBe(0);
    req.flush([]);
  });

  it('creates a canned response', () => {
    const payload = { title: 'New', body_en: 'En', body_ro: 'Ro', is_active: true };
    service.createCannedResponse(payload).subscribe((res) => {
      expect(res.id).toBe('c1');
    });

    const req = httpMock.expectOne('/api/v1/support/admin/canned-responses');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush(canned);
  });

  it('updates a canned response', () => {
    const payload = { title: 'Edited', is_active: false };
    service.updateCannedResponse('c1', payload).subscribe((res) => {
      expect(res.id).toBe('c1');
    });

    const req = httpMock.expectOne('/api/v1/support/admin/canned-responses/c1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(payload);
    req.flush(canned);
  });

  it('deletes a canned response', () => {
    let completed = false;
    service.deleteCannedResponse('c1').subscribe(() => {
      completed = true;
    });

    const req = httpMock.expectOne('/api/v1/support/admin/canned-responses/c1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(completed).toBeTrue();
  });

  it('gets SLA settings', () => {
    service.getSlaSettings().subscribe((res) => {
      expect(res.first_reply_hours).toBe(4);
    });

    const req = httpMock.expectOne('/api/v1/support/admin/sla-settings');
    expect(req.request.method).toBe('GET');
    req.flush(sla);
  });

  it('updates SLA settings', () => {
    const payload: SupportSlaSettings = { first_reply_hours: 2, resolution_hours: 24 };
    service.updateSlaSettings(payload).subscribe((res) => {
      expect(res.resolution_hours).toBe(48);
    });

    const req = httpMock.expectOne('/api/v1/support/admin/sla-settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(payload);
    req.flush(sla);
  });
});
