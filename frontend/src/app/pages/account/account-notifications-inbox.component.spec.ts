import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AccountNotificationsInboxComponent } from './account-notifications-inbox.component';
import { ApiService } from '../../core/api.service';
import { NotificationsService, UserNotification } from '../../core/notifications.service';

function makeNotification(overrides: Partial<UserNotification> = {}): UserNotification {
  return {
    id: 'n1',
    type: 'system',
    title: 'Title',
    body: 'Body',
    url: null,
    created_at: '2026-01-01T00:00:00Z',
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

describe('AccountNotificationsInboxComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let notifications: jasmine.SpyObj<NotificationsService>;

  function setup(): AccountNotificationsInboxComponent {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
    notifications = jasmine.createSpyObj<NotificationsService>('NotificationsService', [
      'refreshUnreadCount',
    ]);
    // Default: empty list so ngOnInit's auto-load resolves cleanly.
    api.get.and.returnValue(of({ items: [] }));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountNotificationsInboxComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: NotificationsService, useValue: notifications },
      ],
    });

    const fixture = TestBed.createComponent(AccountNotificationsInboxComponent);
    return fixture.componentInstance;
  }

  it('loads notifications on init and refreshes the unread count', () => {
    const items = [makeNotification({ id: 'a' }), makeNotification({ id: 'b' })];
    const cmp = setup();
    api.get.and.returnValue(of({ items }));

    cmp.ngOnInit();

    expect(api.get).toHaveBeenCalledWith('/notifications', {
      limit: 75,
      include_dismissed: true,
      include_old_read: true,
    });
    expect(cmp.items).toEqual(items);
    expect(cmp.loading).toBeFalse();
    expect(cmp.errorKey).toBe('');
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
  });

  it('coerces a non-array items payload to an empty list', () => {
    const cmp = setup();
    api.get.and.returnValue(of({ items: undefined as unknown as UserNotification[] }));

    cmp.load();

    expect(cmp.items).toEqual([]);
    expect(cmp.loading).toBeFalse();
  });

  it('sets the error key and stops loading when the request fails', () => {
    const cmp = setup();
    api.get.and.returnValue(throwError(() => new Error('boom')));

    cmp.load();

    expect(cmp.errorKey).toBe('notifications.loadError');
    expect(cmp.loading).toBeFalse();
  });

  it('partitions notifications into active and hidden lists', () => {
    const active = makeNotification({ id: 'active', dismissed_at: null });
    const hidden = makeNotification({ id: 'hidden', dismissed_at: '2026-01-02T00:00:00Z' });
    const cmp = setup();
    cmp.items = [active, hidden];

    expect(cmp.activeNotifications()).toEqual([active]);
    expect(cmp.hiddenNotifications()).toEqual([hidden]);
  });

  it('currentList follows the active tab on inbox', () => {
    const active = makeNotification({ id: 'active', dismissed_at: null });
    const hidden = makeNotification({ id: 'hidden', dismissed_at: '2026-01-02T00:00:00Z' });
    const cmp = setup();
    cmp.items = [active, hidden];

    cmp.tab = 'inbox';
    expect(cmp.currentList()).toEqual([active]);
  });

  it('currentList follows the hidden tab', () => {
    const active = makeNotification({ id: 'active', dismissed_at: null });
    const hidden = makeNotification({ id: 'hidden', dismissed_at: '2026-01-02T00:00:00Z' });
    const cmp = setup();
    cmp.items = [active, hidden];

    cmp.tab = 'hidden';
    expect(cmp.currentList()).toEqual([hidden]);
  });

  it('opens an unread, undismissed notification: marks it read and navigates', () => {
    const cmp = setup();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const n = makeNotification({ id: 'x', read_at: null, dismissed_at: null, url: '/go/here' });
    cmp.items = [n];
    api.post.and.returnValue(of(makeNotification({ id: 'x', read_at: '2026-01-03T00:00:00Z' })));

    cmp.openNotification(n);

    expect(api.post).toHaveBeenCalledWith('/notifications/x/read', {});
    expect(navSpy).toHaveBeenCalledWith('/go/here');
  });

  it('opening an already-read notification skips markRead but still navigates', () => {
    const cmp = setup();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const n = makeNotification({ id: 'x', read_at: '2026-01-03T00:00:00Z', url: '/somewhere' });
    cmp.items = [n];

    cmp.openNotification(n);

    expect(api.post).not.toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith('/somewhere');
  });

  it('opening a dismissed notification skips markRead', () => {
    const cmp = setup();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const n = makeNotification({
      id: 'x',
      read_at: null,
      dismissed_at: '2026-01-02T00:00:00Z',
      url: null,
    });
    cmp.items = [n];

    cmp.openNotification(n);

    expect(api.post).not.toHaveBeenCalled();
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('marks a notification read and replaces only the matching item', () => {
    const cmp = setup();
    const target = makeNotification({ id: 'm1', read_at: null });
    const other = makeNotification({ id: 'm2', read_at: null });
    cmp.items = [target, other];
    const updated = makeNotification({ id: 'm1', read_at: '2026-01-04T00:00:00Z' });
    api.post.and.returnValue(of(updated));

    cmp.markRead(target);

    expect(api.post).toHaveBeenCalledWith('/notifications/m1/read', {});
    expect(cmp.items).toEqual([updated, other]);
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
  });

  it('dismisses a notification and replaces only the matching item', () => {
    const cmp = setup();
    const target = makeNotification({ id: 'd1' });
    const other = makeNotification({ id: 'd2' });
    cmp.items = [target, other];
    const updated = makeNotification({ id: 'd1', dismissed_at: '2026-01-05T00:00:00Z' });
    api.post.and.returnValue(of(updated));

    cmp.dismiss(target);

    expect(api.post).toHaveBeenCalledWith('/notifications/d1/dismiss', {});
    expect(cmp.items).toEqual([updated, other]);
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
  });

  it('restores a notification and replaces only the matching item', () => {
    const cmp = setup();
    const target = makeNotification({ id: 'r1', dismissed_at: '2026-01-05T00:00:00Z' });
    const other = makeNotification({ id: 'r2', dismissed_at: '2026-01-05T00:00:00Z' });
    cmp.items = [target, other];
    const updated = makeNotification({ id: 'r1', dismissed_at: null });
    api.post.and.returnValue(of(updated));

    cmp.restore(target);

    expect(api.post).toHaveBeenCalledWith('/notifications/r1/restore', {});
    expect(cmp.items).toEqual([updated, other]);
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
  });

  it('encodes notification ids with reserved characters in the URL', () => {
    const cmp = setup();
    const n = makeNotification({ id: 'a/b c', read_at: null });
    cmp.items = [n];
    api.post.and.returnValue(of(makeNotification({ id: 'a/b c' })));

    cmp.markRead(n);

    expect(api.post).toHaveBeenCalledWith('/notifications/a%2Fb%20c/read', {});
  });

  function configureModule(getReturn: ReturnType<ApiService['get']>): void {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
    notifications = jasmine.createSpyObj<NotificationsService>('NotificationsService', [
      'refreshUnreadCount',
    ]);
    api.get.and.returnValue(getReturn);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountNotificationsInboxComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: NotificationsService, useValue: notifications },
      ],
    });
  }

  it('renders the active notification on the inbox tab', () => {
    const active = makeNotification({ id: 'active', title: 'Active item', dismissed_at: null });
    const hidden = makeNotification({
      id: 'hidden',
      title: 'Hidden item',
      dismissed_at: '2026-01-02T00:00:00Z',
    });
    configureModule(of({ items: [active, hidden] }));

    const fixture = TestBed.createComponent(AccountNotificationsInboxComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Active item');
    expect(fixture.nativeElement.textContent).not.toContain('Hidden item');
  });

  it('renders the dismissed notification on the hidden tab', () => {
    const active = makeNotification({ id: 'active', title: 'Active item', dismissed_at: null });
    const hidden = makeNotification({
      id: 'hidden',
      title: 'Hidden item',
      dismissed_at: '2026-01-02T00:00:00Z',
    });
    configureModule(of({ items: [active, hidden] }));

    const fixture = TestBed.createComponent(AccountNotificationsInboxComponent);
    fixture.componentInstance.tab = 'hidden';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Hidden item');
    expect(fixture.nativeElement.textContent).not.toContain('Active item');
  });

  it('renders the empty state when there are no notifications', () => {
    configureModule(of({ items: [] }));

    const fixture = TestBed.createComponent(AccountNotificationsInboxComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('notifications.empty');
  });

  it('renders the error message in the template when loading fails', () => {
    configureModule(throwError(() => new Error('boom')));

    const fixture = TestBed.createComponent(AccountNotificationsInboxComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.errorKey).toBe('notifications.loadError');
    expect(fixture.nativeElement.textContent).toContain('notifications.loadError');
  });
});
