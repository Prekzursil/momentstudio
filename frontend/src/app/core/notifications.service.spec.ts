import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [NotificationsService],
    });
    service = TestBed.inject(NotificationsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('refreshes unread count', () => {
    service.refreshUnreadCount();

    const req = httpMock.expectOne('/api/v1/notifications/unread-count');
    expect(req.request.method).toBe('GET');
    req.flush({ count: 3 });

    expect(service.unreadCount()).toBe(3);
  });

  it('loads notifications and derives unread count', () => {
    service.load(25);

    const req = httpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({
      items: [
        {
          id: 'n1',
          type: 'order',
          title: 'Order',
          created_at: '2000-01-01T00:00:00+00:00',
          read_at: null,
        },
        {
          id: 'n2',
          type: 'order',
          title: 'Old',
          created_at: '2000-01-01T00:00:00+00:00',
          read_at: '2000-01-01T00:00:00+00:00',
        },
      ],
    });

    expect(service.items().map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(service.unreadCount()).toBe(1);
  });

  it('marks a notification as read', () => {
    service.load(20);
    const loadReq = httpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(loadReq.request.method).toBe('GET');
    expect(loadReq.request.params.get('limit')).toBe('20');
    loadReq.flush({
      items: [
        {
          id: 'n1',
          type: 'order',
          title: 'Order',
          created_at: '2000-01-01T00:00:00+00:00',
          read_at: null,
        },
      ],
    });

    service.markRead('n1');
    const req = httpMock.expectOne('/api/v1/notifications/n1/read');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'n1',
      type: 'order',
      title: 'Order',
      created_at: '2000-01-01T00:00:00+00:00',
      read_at: '2000-01-01T00:00:00+00:00',
    });

    expect(service.items()[0].read_at).toBeTruthy();
    expect(service.unreadCount()).toBe(0);
  });

  it('dismisses a notification', () => {
    service.load(20);
    const loadReq = httpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(loadReq.request.method).toBe('GET');
    expect(loadReq.request.params.get('limit')).toBe('20');
    loadReq.flush({
      items: [
        {
          id: 'n1',
          type: 'order',
          title: 'Order',
          created_at: '2000-01-01T00:00:00+00:00',
          read_at: null,
        },
      ],
    });

    service.dismiss('n1');
    const req = httpMock.expectOne('/api/v1/notifications/n1/dismiss');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'n1',
      type: 'order',
      title: 'Order',
      created_at: '2000-01-01T00:00:00+00:00',
      dismissed_at: '2000-01-01T00:00:00+00:00',
    });

    expect(service.items().length).toBe(0);
  });

  it('resets all state', () => {
    service.refreshUnreadCount();
    httpMock.expectOne('/api/v1/notifications/unread-count').flush({ count: 5 });
    expect(service.unreadCount()).toBe(5);
    service.reset();
    expect(service.items()).toEqual([]);
    expect(service.unreadCount()).toBe(0);
    expect(service.loading()).toBeFalse();
  });

  it('coerces a non-numeric unread count to zero', () => {
    service.refreshUnreadCount();
    httpMock
      .expectOne('/api/v1/notifications/unread-count')
      .flush({ count: 'not-a-number' as unknown as number });
    expect(service.unreadCount()).toBe(0);
  });

  it('throttles unread-count refresh after an error', () => {
    service.refreshUnreadCount();
    httpMock.expectOne('/api/v1/notifications/unread-count').error(new ProgressEvent('error'));

    // Second call within the cooldown window is a no-op (no HTTP request).
    service.refreshUnreadCount();
    httpMock.expectNone('/api/v1/notifications/unread-count');
  });

  it('treats a non-array load response as empty', () => {
    service.load(20);
    httpMock
      .expectOne((r) => r.url === '/api/v1/notifications')
      .flush({ items: null as unknown as [] });
    expect(service.items()).toEqual([]);
    expect(service.unreadCount()).toBe(0);
    expect(service.loading()).toBeFalse();
  });

  it('does not start a second load while one is in flight', () => {
    service.load(20);
    const req = httpMock.expectOne((r) => r.url === '/api/v1/notifications');
    service.load(20); // guarded by loadingSignal
    httpMock.expectNone((r) => r.url === '/api/v1/notifications');
    req.flush({ items: [] });
  });

  it('clears loading after a load error', () => {
    service.load(20);
    httpMock.expectOne((r) => r.url === '/api/v1/notifications').error(new ProgressEvent('error'));
    expect(service.loading()).toBeFalse();
  });

  it('ignores markRead/dismiss with an empty id', () => {
    service.markRead('');
    service.dismiss('');
    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('uses the default limit of 20 when none is provided', () => {
    service.load();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush({ items: [] });
  });

  it('only updates the matching notification on markRead and recomputes unread', () => {
    service.load();
    httpMock
      .expectOne((r) => r.url === '/api/v1/notifications')
      .flush({
        items: [
          { id: 'n1', type: 'order', title: 'A', created_at: 'd', read_at: null },
          { id: 'n2', type: 'order', title: 'B', created_at: 'd', read_at: null },
        ],
      });
    expect(service.unreadCount()).toBe(2);

    service.markRead('n1');
    httpMock.expectOne('/api/v1/notifications/n1/read').flush({
      id: 'n1',
      type: 'order',
      title: 'A',
      created_at: 'd',
      read_at: 'now',
    });
    // n1 replaced (matches updated.id), n2 left as-is (no match).
    expect(service.items().map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(service.unreadCount()).toBe(1);
  });

  it('removes only the dismissed notification', () => {
    service.load();
    httpMock
      .expectOne((r) => r.url === '/api/v1/notifications')
      .flush({
        items: [
          { id: 'n1', type: 'order', title: 'A', created_at: 'd', read_at: null },
          { id: 'n2', type: 'order', title: 'B', created_at: 'd', dismissed_at: 'x' },
        ],
      });
    service.dismiss('n1');
    httpMock.expectOne('/api/v1/notifications/n1/dismiss').flush({
      id: 'n1',
      type: 'order',
      title: 'A',
      created_at: 'd',
      dismissed_at: 'now',
    });
    expect(service.items().map((n) => n.id)).toEqual(['n2']);
    expect(service.unreadCount()).toBe(0);
  });

  it('handles markRead errors without throwing', () => {
    service.markRead('n1');
    const req = httpMock.expectOne('/api/v1/notifications/n1/read');
    expect(() => req.error(new ProgressEvent('error'))).not.toThrow();
  });

  it('handles dismiss errors without throwing', () => {
    service.dismiss('n1');
    const req = httpMock.expectOne('/api/v1/notifications/n1/dismiss');
    expect(() => req.error(new ProgressEvent('error'))).not.toThrow();
  });
});
