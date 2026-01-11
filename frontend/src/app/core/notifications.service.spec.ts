import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [NotificationsService]
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
        { id: 'n1', type: 'order', title: 'Order', created_at: '2000-01-01T00:00:00+00:00', read_at: null },
        { id: 'n2', type: 'order', title: 'Old', created_at: '2000-01-01T00:00:00+00:00', read_at: '2000-01-01T00:00:00+00:00' }
      ]
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
      items: [{ id: 'n1', type: 'order', title: 'Order', created_at: '2000-01-01T00:00:00+00:00', read_at: null }]
    });

    service.markRead('n1');
    const req = httpMock.expectOne('/api/v1/notifications/n1/read');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'n1',
      type: 'order',
      title: 'Order',
      created_at: '2000-01-01T00:00:00+00:00',
      read_at: '2000-01-01T00:00:00+00:00'
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
      items: [{ id: 'n1', type: 'order', title: 'Order', created_at: '2000-01-01T00:00:00+00:00', read_at: null }]
    });

    service.dismiss('n1');
    const req = httpMock.expectOne('/api/v1/notifications/n1/dismiss');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'n1',
      type: 'order',
      title: 'Order',
      created_at: '2000-01-01T00:00:00+00:00',
      dismissed_at: '2000-01-01T00:00:00+00:00'
    });

    expect(service.items().length).toBe(0);
  });
});
