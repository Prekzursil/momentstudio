import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotificationsService } from './notifications.service';

let notificationsService: NotificationsService;
let notificationsHttpMock: HttpTestingController;

describe('NotificationsService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [NotificationsService]
    });
    notificationsService = TestBed.inject(NotificationsService);
    notificationsHttpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    notificationsHttpMock.verify();
  });

  defineRefreshUnreadCountSpec();
  defineLoadNotificationsSpec();
  defineMarkReadSpec();
  defineDismissSpec();
});

const defineRefreshUnreadCountSpec = (): void => {
  it('refreshes unread count', () => {
    notificationsService.refreshUnreadCount();

    const req = notificationsHttpMock.expectOne('/api/v1/notifications/unread-count');
    expect(req.request.method).toBe('GET');
    req.flush({ count: 3 });

    expect(notificationsService.unreadCount()).toBe(3);
  });
};

const defineLoadNotificationsSpec = (): void => {
  it('loads notifications and derives unread count', () => {
    notificationsService.load(25);

    const req = notificationsHttpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({
      items: [
        { id: 'n1', type: 'order', title: 'Order', created_at: '2000-01-01T00:00:00+00:00', read_at: null },
        { id: 'n2', type: 'order', title: 'Old', created_at: '2000-01-01T00:00:00+00:00', read_at: '2000-01-01T00:00:00+00:00' }
      ]
    });

    expect(notificationsService.items().map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(notificationsService.unreadCount()).toBe(1);
  });
};

const defineMarkReadSpec = (): void => {
  it('marks a notification as read', () => {
    notificationsService.load(20);
    const loadReq = notificationsHttpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(loadReq.request.method).toBe('GET');
    expect(loadReq.request.params.get('limit')).toBe('20');
    loadReq.flush({
      items: [{ id: 'n1', type: 'order', title: 'Order', created_at: '2000-01-01T00:00:00+00:00', read_at: null }]
    });

    notificationsService.markRead('n1');
    const req = notificationsHttpMock.expectOne('/api/v1/notifications/n1/read');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'n1',
      type: 'order',
      title: 'Order',
      created_at: '2000-01-01T00:00:00+00:00',
      read_at: '2000-01-01T00:00:00+00:00'
    });

    expect(notificationsService.items()[0].read_at).toBeTruthy();
    expect(notificationsService.unreadCount()).toBe(0);
  });
};

const defineDismissSpec = (): void => {
  it('dismisses a notification', () => {
    notificationsService.load(20);
    const loadReq = notificationsHttpMock.expectOne((r) => r.url === '/api/v1/notifications');
    expect(loadReq.request.method).toBe('GET');
    expect(loadReq.request.params.get('limit')).toBe('20');
    loadReq.flush({
      items: [{ id: 'n1', type: 'order', title: 'Order', created_at: '2000-01-01T00:00:00+00:00', read_at: null }]
    });

    notificationsService.dismiss('n1');
    const req = notificationsHttpMock.expectOne('/api/v1/notifications/n1/dismiss');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: 'n1',
      type: 'order',
      title: 'Order',
      created_at: '2000-01-01T00:00:00+00:00',
      dismissed_at: '2000-01-01T00:00:00+00:00'
    });

    expect(notificationsService.items().length).toBe(0);
  });
};
